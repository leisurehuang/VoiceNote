/**
 * 语音听写路由（桌面端全局快捷键调用）。
 *
 * POST /api/dictation        body=16kHz 单声道 PCM16 原始字节（application/octet-stream）
 *                            → 临时 WAV → 当前引擎转写 → 口令检测 → 润色 → 术语纠错 → 记历史
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

export async function registerDictationRoutes(app: FastifyInstance): Promise<void> {
  // 原始 PCM 字节流（Electron 主进程 fetch 发送）
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

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
    const emptyResp = (transcript: string): DictationResponse => ({
      id: null,
      transcript,
      text: '',
      durationMs,
      silent: true,
    });
    if (!raw) return emptyResp('');

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

    const resp: DictationResponse = {
      id,
      transcript,
      text,
      targetLanguage: target?.code,
      durationMs,
      silent: false,
      polishError,
    };
    return resp;
  });

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
