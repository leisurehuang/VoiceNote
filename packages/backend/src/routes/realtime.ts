import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { config } from '../config.js';
import { transcribeWavFile } from '../pipeline/whisper.js';
import { summarize, generateTitle } from '../pipeline/summarize.js';
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
        }
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
          const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
          vad.feed(pcm);
          return;
        }
        const msg = JSON.parse(data.toString()) as { type: string; language?: string };
        if (msg.type === 'start') {
          if (running) return;
          running = true;
          finalized = false;
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
