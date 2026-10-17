/**
 * 语音听写路由（桌面端全局快捷键调用）。PCM 均为 16kHz 单声道 PCM16。
 *
 * 流式长听写（边录边转写，时长不受限）：
 *   POST /api/dictation/stream/start       → {streamId}
 *   POST /api/dictation/stream/:id/chunk   body=PCM 分段（客户端 ~1s/块）→ VAD 切句逐句转写
 *   POST /api/dictation/stream/:id/finish  → flush 尾句 + 排空转写队列 → 成稿（DictationResponse）
 *   POST /api/dictation/stream/:id/cancel  → 丢弃本流
 *
 * 成稿逻辑：拼接 → 翻译口令 → 润色 → 术语纠错 → 记历史。
 *
 * GET  /api/dictation/history?limit=   最近历史（新的在前）
 * DELETE /api/dictation/history/:id    删除单条
 * DELETE /api/dictation/history        清空
 */

import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { config } from '../config.js';
import { applyTermCorrections, polishDictation } from '../pipeline/dictation.js';
import {
  detectOutputLanguage,
  languageByCode,
  type OutputLanguage,
} from '../pipeline/outputLanguage.js';
import { UtteranceTranscriber } from '../pipeline/utteranceTranscriber.js';
import { getSettings } from '../store/settingsStore.js';
import {
  appendHistory,
  clearHistory,
  deleteHistoryEntry,
  listHistory,
} from '../store/dictationStore.js';
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
  /** 已接收总采样数（算时长用）。 */
  totalSamples: number;
  t: UtteranceTranscriber;
}

const STREAM_TTL_MS = 15 * 60 * 1000;

const streams = new Map<string, DictationStream>();

export async function registerDictationRoutes(app: FastifyInstance): Promise<void> {
  // 原始 PCM 字节流（Electron 主进程 fetch 发送）。客户端每块 ~32KB，上限给到 4MiB 冗余。
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 4 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

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
      totalSamples: 0,
      t: new UtteranceTranscriber({ workDir: dictationDir, filePrefix: `stream-${id}-` }),
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
    // 拷贝出独立视图：转写器会持有块引用直到切句（最长 15s），不能借用请求 Buffer 底层内存
    const view = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1);
    const samples = view.slice();
    st.totalSamples += samples.length;
    st.t.feed(samples);
    return {
      ok: true,
      samples: st.totalSamples,
      chars: st.t.texts.reduce((a, t) => a + t.length, 0),
    };
  });

  app.post('/api/dictation/stream/:id/finish', async (req, reply) => {
    const { id } = req.params as { id: string };
    const st = streams.get(id);
    if (!st) return reply.code(404).send({ error: '听写流不存在或已结束' });
    streams.delete(id);
    st.t.flush(); // 还在攒的尾句入队
    await st.t.waitIdle(); // 排空转写队列
    const durationMs = Math.round((st.totalSamples / 16000) * 1000);
    if (durationMs < 250) {
      return reply.code(400).send({ error: '录音太短（不足 0.25 秒）' });
    }
    const raw = joinSegments(st.t.texts).trim();
    if (!raw) {
      if (st.t.error) return reply.code(500).send({ error: `转写失败：${st.t.error}` });
      return { id: null, transcript: '', text: '', durationMs, silent: true };
    }
    return finalizeDictation(raw, durationMs);
  });

  app.post('/api/dictation/stream/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const st = streams.get(id);
    if (!st) return reply.code(404).send({ error: '听写流不存在' });
    st.t.cancel(); // 队列里未跑的句直接跳过
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
