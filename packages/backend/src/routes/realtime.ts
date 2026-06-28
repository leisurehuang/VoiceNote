import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { config } from '../config.js';
import { transcribeWavFile } from '../pipeline/whisper.js';
import { summarize, summarizeIncremental, generateTitle } from '../pipeline/summarize.js';
import { EnergyVad } from '../pipeline/vad.js';
import { writeWav } from '../util/wav.js';
import * as store from '../store/sessionStore.js';

function send(socket: WebSocket, obj: unknown): void {
  try {
    socket.send(JSON.stringify(obj));
  } catch {
    /* 连接可能已关闭 */
  }
}

/** 注册实时转写 WebSocket：/api/realtime。 */
export function registerRealtimeRoute(app: FastifyInstance): void {
  app.get('/api/realtime', { websocket: true }, (socket: WebSocket) => {
    let sessionId: string | null = null;
    let vad: EnergyVad | null = null;
    let seq = 0;
    let running = false;
    let finalized = false;
    // 串行化转写/收尾，避免并发 whisper 与 transcript 竞态
    let chain: Promise<void> = Promise.resolve();
    const enqueue = (fn: () => Promise<void>) => {
      chain = chain.then(fn).catch((e) => {
        send(socket, { type: 'error', error: e instanceof Error ? e.message : String(e) });
      });
    };

    // —— 实时增量摘要状态（仅内存，不落盘；终版由 finalize 用高质量 prompt 覆盖）——
    let prevSummary = ''; // 上一版增量摘要全文
    let pendingText = ''; // 自上次成功摘要以来累积的新增转写文本
    let lastSummaryAt = 0; // 上次触发增量摘要的时间戳(ms)
    let incrementalInFlight = false; // 是否正有增量摘要在跑
    let incrementalDirty = false; // 在跑期间又积累新文本 → 跑完补一次
    let pcmChunks: Buffer[] = []; // 累积全部麦克风 PCM，finalize 时写成完整 audio.wav

    // 触发判定：新增字符达阈值、距上次够久、当前空闲 → 排一个增量摘要（串行，不并发）
    const maybeRunIncremental = () => {
      if (!sessionId || !running) return;
      if (incrementalInFlight) {
        incrementalDirty = true; // 已有在跑：标记脏，让它在 finally 里补一次
        return;
      }
      if (pendingText.length < config.llm.incrementalThresholdChars) return;
      if (Date.now() - lastSummaryAt < config.llm.incrementalMinIntervalMs) return;
      enqueue(() => runIncremental());
    };

    // 跑一次增量摘要：拿「上一版 + 新增」滚动合并，token 经 WS 流式推送
    const runIncremental = async () => {
      incrementalInFlight = true;
      const snapPrev = prevSummary;
      const snapNew = pendingText; // 快照本次要合并的新增文本
      send(socket, { type: 'summary-start' });
      try {
        const { text } = await summarizeIncremental(snapPrev, snapNew, {
          onToken: (delta) => send(socket, { type: 'summary-token', delta }),
        });
        prevSummary = text;
        pendingText = pendingText.slice(snapNew.length); // 切掉已合并部分，保留之后新增的
        send(socket, { type: 'summary-done', summary: text });
      } catch (e) {
        // 增量失败不影响录音/收尾：不改 prevSummary、不清 pendingText（下次重试）
        send(socket, { type: 'summary-error', error: e instanceof Error ? e.message : String(e) });
      } finally {
        incrementalInFlight = false;
        lastSummaryAt = Date.now();
        if (incrementalDirty && running) {
          incrementalDirty = false;
          enqueue(() => runIncremental());
        }
      }
    };

    const doUtterance = async (pcm: Int16Array, startMs: number, _endMs: number) => {
      if (!sessionId) return;
      const n = ++seq;
      const wavPath = join(store.sessionDir(sessionId), `utt-${n}.wav`);
      try {
        writeWav(wavPath, pcm);
        const segs = await transcribeWavFile(wavPath, { language: config.whisper.language });
        for (const seg of segs) {
          // whisper 给的是单句内时间戳，叠加本句在会话中的起点
          const abs = {
            text: seg.text,
            startMs: startMs + seg.startMs,
            endMs: startMs + seg.endMs,
          };
          store.appendTranscriptSegment(sessionId, abs);
          send(socket, { type: 'segment', segment: abs });
          pendingText += (pendingText ? '\n' : '') + seg.text;
        }
        // 本句转写完，尝试触发一次滚动增量摘要（内部自带阈值/间隔/串行门控）
        maybeRunIncremental();
      } finally {
        try {
          unlinkSync(wavPath);
        } catch {
          /* ignore */
        }
      }
    };

    const finalize = async () => {
      if (!sessionId || finalized) {
        send(socket, { type: 'done', id: sessionId });
        return;
      }
      finalized = true;
      try {
        // 物化完整录音：拼接全部 PCM → 写 audio.wav（与逐字稿同一条样本时间轴）。
        // 放在最前，即使后续摘要失败也保留音频。
        const combined = Buffer.concat(pcmChunks);
        const samples = new Int16Array(
          combined.buffer,
          combined.byteOffset,
          Math.floor(combined.length / 2),
        );
        writeWav(store.audioPath(sessionId), samples);
        store.update(sessionId, {
          durationMs: Math.round((samples.length / 16000) * 1000),
          mimeType: 'audio/wav',
        });
        pcmChunks = []; // 释放内存

        const segs = store.readTranscript(sessionId);
        const transcript = segs.map((s) => s.text).join('\n');
        if (transcript.trim()) {
          store.update(sessionId, { status: 'summarizing', stage: '生成摘要' });
          const { text, model } = await summarize(transcript);
          store.writeSummary(sessionId, text, model);
          try {
            const title = await generateTitle(transcript);
            if (title) store.update(sessionId, { title });
          } catch {
            /* 标题失败可忽略 */
          }
        }
        store.update(sessionId, { status: 'done', stage: '完成', progress: 1, error: null });
      } catch (e) {
        store.update(sessionId, { status: 'error', stage: '出错', error: e instanceof Error ? e.message : String(e) });
      }
      send(socket, { type: 'done', id: sessionId });
    };

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      try {
        if (isBinary) {
          if (!running || !vad) return;
          const buf = Buffer.from(data);
          pcmChunks.push(buf);
          const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
          vad.feed(pcm);
          return;
        }
        const msg = JSON.parse(data.toString()) as { type: string; language?: string };
        if (msg.type === 'start') {
          if (running) return;
          running = true;
          finalized = false;
          prevSummary = '';
          pendingText = '';
          lastSummaryAt = 0;
          incrementalInFlight = false;
          incrementalDirty = false;
          pcmChunks = [];
          sessionId = store.createRealtimeSession();
          vad = new EnergyVad({ sampleRate: 16000 });
          vad.onutterance = (pcm, s, e) => enqueue(() => doUtterance(pcm, s, e));
          send(socket, { type: 'ready', id: sessionId });
        } else if (msg.type === 'stop') {
          if (!running) return;
          running = false;
          vad?.flush();
          enqueue(() => finalize());
        }
      } catch (e) {
        send(socket, { type: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    });

    socket.on('close', () => {
      running = false;
      if (sessionId && !finalized) {
        vad?.flush();
        enqueue(() => finalize());
      }
    });
  });
}
