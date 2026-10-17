/**
 * 语音听写路由（桌面端全局快捷键调用）。PCM 均为 16kHz 单声道 PCM16。
 *
 * 一次性上传（兼容路径，超长音频受 bodyLimit 约束）：
 *   POST /api/dictation                    body=整段 PCM（application/octet-stream）
 *                                          → 临时 WAV → 转写 → 成稿
 *
 * 流式长听写（推荐：边录边转写，时长不受限）：
 *   POST /api/dictation/stream/start       → {streamId}
 *   POST /api/dictation/stream/:id/chunk   body=PCM 分段（客户端 ~1s/块）→ VAD 切句逐句转写
 *   POST /api/dictation/stream/:id/finish  → flush 尾句 + 排空转写队列 → 成稿（DictationResponse）
 *   POST /api/dictation/stream/:id/cancel  → 丢弃本流
 *
 * 两条路径共用同一套成稿逻辑：拼接 → 翻译口令 → 润色 → 术语纠错 → 记历史。
 *
 * GET  /api/dictation/history?limit=   最近历史（新的在前）
 * DELETE /api/dictation/history/:id    删除单条
 * DELETE /api/dictation/history        清空
 */

import type { FastifyInstance } from 'fastify';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { transcribeUtteranceWithEngine } from '../pipeline/transcribe.js';
import {
  applyTermCorrections,
  polishDictation,
} from '../pipeline/dictation.js';
import {
  detectOutputLanguage,
  languageByCode,
  type OutputLanguage,
} from '../pipeline/outputLanguage.js';
import { EnergyVad } from '../pipeline/vad.js';
import { getSettings } from '../store/settingsStore.js';
import {
  appendHistory,
  clearHistory,
  deleteHistoryEntry,
  listHistory,
} from '../store/dictationStore.js';
import { writeWav } from '../util/wav.js';
import { newId } from '../util/id.js';

const dictationDir = join(config.dataDir, 'dictation');

/** 转写段拼接：中文为主直接连排，含较多拉丁词则用空格连接。 */
function joinSegments(texts: string[]): string {
  const joined = texts.join('');
  let cjk = 0;
  let latin = 0;
  for (const ch of joined) {
    if (/[\p{Script=Han}]/u.test(ch)) cjk++;
    else if (/[A-Za-z]/.test(ch)) latin++;
  }
  return cjk >= latin ? joined : texts.join(' ');
}

export interface DictationResponse {
  id: string | null;
  transcript: string;
  /** 最终成稿（润色+纠错后）；静音时为空。 */
  text: string;
  targetLanguage?: string;
  durationMs: number;
  /** 整段无语音。 */
  silent: boolean;
  /** 润色失败但已回退原文时的错误信息（桌面端浮窗提示用）。 */
  polishError?: string;
}

/**
 * 成稿公共逻辑：翻译口令 → 润色（失败回退原文，不阻断输入）→ 术语纠错 → 记历史。
 * 一次性与流式两条路径共用，保证行为一致。
 */
async function finalizeDictation(raw: string, durationMs: number): Promise<DictationResponse> {
  const emptyResp = (transcript: string): DictationResponse => ({
    id: null,
    transcript,
    text: '',
    durationMs,
    silent: true,
  });

  const d = getSettings().dictation;

  // 翻译口令（句首/句尾）优先，其次固定输出语言
  let transcript = raw;
  let target: OutputLanguage | null = null;
  if (d.translationCommands) {
    const hit = detectOutputLanguage(raw);
    if (hit) {
      target = hit.language;
      transcript = hit.text;
      if (!transcript) return emptyResp(raw);
    }
  }
  if (!target && d.fixedOutputLanguage) {
    target = languageByCode(d.fixedOutputLanguage);
  }

  // 润色（失败回退原文，不阻断输入）
  let text = transcript;
  let polishError: string | undefined;
  if (d.polish) {
    try {
      const r = await polishDictation(transcript, { targetLanguage: target });
      if (r.text) text = r.text;
    } catch (e) {
      polishError = e instanceof Error ? e.message : '润色失败';
    }
  }

  text = applyTermCorrections(text, d.termCorrections).trim();

  let id: string | null = null;
  if (text) {
    const entry = appendHistory(
      { transcript, text, durationMs, targetLanguage: target?.code },
      d.historyLimit,
    );
    id = entry.id;
  }

  return {
    id,
    transcript,
    text,
    targetLanguage: target?.code,
    durationMs,
    silent: false,
    polishError,
  };
}

// ———————————————— 流式长听写 ————————————————

/** 流状态仅存内存：客户端断连/崩溃后靠 TTL 清理。 */
interface DictationStream {
  id: string;
  createdAt: number;
  lastActive: number;
  canceled: boolean;
  /** 已接收总采样数（算时长用）。 */
  totalSamples: number;
  /** 各句转写文本（顺序与说话顺序一致）。 */
  texts: string[];
  uttSeq: number;
  /** 串行转写队列：与实时转写一致，避免并发跑引擎。 */
  chain: Promise<void>;
  /** 队列内首个转写错误；finish 时无任何文本则上报，有文本则尽力出稿。 */
  error: string | null;
  vad: EnergyVad;
}

const STREAM_TTL_MS = 15 * 60 * 1000;
/** VAD 喂入粒度：与实时转写的 320ms 批一致，与客户端分块大小解耦。 */
const VAD_FEED_SAMPLES = 5120;

const streams = new Map<string, DictationStream>();

export async function registerDictationRoutes(app: FastifyInstance): Promise<void> {
  // 原始 PCM 字节流（Electron 主进程 fetch 发送）。
  // bodyLimit 覆盖一次性整段上传 ~1 小时 PCM（流式路径每块仅 ~32KB，远低于此）。
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 128 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  // —— 一次性上传（兼容路径）——
  app.post('/api/dictation', async (req, reply) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.byteLength < 2) {
      return reply.code(400).send({ error: '请求体需为 PCM16 音频字节' });
    }
    const samples = new Int16Array(buf.byteLength >> 1);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = buf.readInt16LE(i * 2);
      samples[i] = s;
      const v = s < 0 ? -s : s;
      if (v > peak) peak = v;
    }
    const durationMs = Math.round((samples.length / 16000) * 1000);
    if (durationMs < 250) {
      return reply.code(400).send({ error: '录音太短（不足 0.25 秒）' });
    }
    // 静音门限（峰值 < 300 ≈ -40dBFS）：误触/没说话直接返回，
    // 也避免 whisper 对纯静音产生幻觉文本
    if (peak < 300) {
      return { id: null, transcript: '', text: '', durationMs, silent: true };
    }

    const wavPath = join(dictationDir, `tmp-${Date.now()}-${newId()}.wav`);
    let segments;
    try {
      mkdirSync(dictationDir, { recursive: true });
      writeWav(wavPath, samples);
      segments = await transcribeUtteranceWithEngine(wavPath, { durationMs });
    } catch (e) {
      return reply.code(500).send({
        error: e instanceof Error ? e.message : '转写失败',
      });
    } finally {
      try {
        rmSync(wavPath, { force: true });
      } catch {
        /* ignore */
      }
    }

    const raw = joinSegments(segments.map((s) => s.text.trim()).filter(Boolean)).trim();
    if (!raw) return { id: null, transcript: '', text: '', durationMs, silent: true };
    return finalizeDictation(raw, durationMs);
  });

  // —— 流式长听写 ————

  app.post('/api/dictation/stream/start', async () => {
    // TTL 清理：客户端崩溃/断连遗留的流
    const now = Date.now();
    for (const [id, st] of streams) {
      if (now - st.lastActive > STREAM_TTL_MS) streams.delete(id);
    }
    const id = newId();
    const st: DictationStream = {
      id,
      createdAt: now,
      lastActive: now,
      canceled: false,
      totalSamples: 0,
      texts: [],
      uttSeq: 0,
      chain: Promise.resolve(),
      error: null,
      vad: new EnergyVad({ sampleRate: 16000 }),
    };
    st.vad.onutterance = (pcm, startMs, endMs) => {
      const durMs = Math.max(0, endMs - startMs);
      st.chain = st.chain
        .then(() => transcribeUtterance(st, pcm, durMs))
        .catch((e: unknown) => {
          if (!st.error) st.error = e instanceof Error ? e.message : String(e);
        });
    };
    streams.set(id, st);
    return { streamId: id };
  });

  app.post('/api/dictation/stream/:id/chunk', async (req, reply) => {
    const { id } = req.params as { id: string };
    const st = streams.get(id);
    if (!st) return reply.code(404).send({ error: '听写流不存在或已结束' });
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.byteLength < 2) {
      return reply.code(400).send({ error: '请求体需为 PCM16 音频字节' });
    }
    st.lastActive = Date.now();
    // 拷贝出独立视图：VAD 会持有块引用直到切句（最长 15s），不能借用请求 Buffer 底层内存
    const view = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1);
    const samples = view.slice();
    st.totalSamples += samples.length;
    for (let o = 0; o < samples.length; o += VAD_FEED_SAMPLES) {
      st.vad.feed(samples.subarray(o, Math.min(o + VAD_FEED_SAMPLES, samples.length)));
    }
    return {
      ok: true,
      samples: st.totalSamples,
      chars: st.texts.reduce((a, t) => a + t.length, 0),
    };
  });

  app.post('/api/dictation/stream/:id/finish', async (req, reply) => {
    const { id } = req.params as { id: string };
    const st = streams.get(id);
    if (!st) return reply.code(404).send({ error: '听写流不存在或已结束' });
    streams.delete(id);
    st.vad.flush(); // 还在攒的尾句入队
    await st.chain; // 排空转写队列（错误已捕获进 st.error，不会 reject）
    const durationMs = Math.round((st.totalSamples / 16000) * 1000);
    if (durationMs < 250) {
      return reply.code(400).send({ error: '录音太短（不足 0.25 秒）' });
    }
    const raw = joinSegments(st.texts).trim();
    if (!raw) {
      if (st.error) return reply.code(500).send({ error: `转写失败：${st.error}` });
      return { id: null, transcript: '', text: '', durationMs, silent: true };
    }
    return finalizeDictation(raw, durationMs);
  });

  app.post('/api/dictation/stream/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const st = streams.get(id);
    if (!st) return reply.code(404).send({ error: '听写流不存在' });
    st.canceled = true; // 队列里未跑的句直接跳过
    streams.delete(id);
    return { ok: true };
  });

  // —— 历史 ————

  app.get('/api/dictation/history', async (req) => {
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.floor(Number(q.limit)) : 100;
    return { entries: listHistory(Number.isFinite(limit) ? limit : 100) };
  });

  app.delete('/api/dictation/history/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteHistoryEntry(id)) return reply.code(404).send({ error: '条目不存在' });
    return { ok: true };
  });

  app.delete('/api/dictation/history', async () => {
    clearHistory();
    return { ok: true };
  });
}

/** 单句转写：写临时 WAV → 当前引擎 → 文本入 st.texts。只在流的串行队列里跑。 */
async function transcribeUtterance(st: DictationStream, pcm: Int16Array, durationMs: number): Promise<void> {
  if (st.canceled) return;
  const n = ++st.uttSeq;
  const wavPath = join(dictationDir, `stream-${st.id}-${n}.wav`);
  try {
    mkdirSync(dictationDir, { recursive: true });
    writeWav(wavPath, pcm);
    const segs = await transcribeUtteranceWithEngine(wavPath, {
      language: config.whisper.language,
      durationMs,
    });
    for (const s of segs) {
      const t = s.text.trim();
      if (t) st.texts.push(t);
    }
  } finally {
    try {
      rmSync(wavPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}
