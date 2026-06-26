import { existsSync, readFileSync, rmSync } from 'node:fs';
import { config } from '../config.js';
import type { TranscriptSegment } from '../store/sessionStore.js';
import { run } from '../util/exec.js';
import { DependencyMissingError } from './ffmpeg.js';

interface RawWhisperSegment {
  timestamps?: { from?: string; to?: string };
  offsets?: { from?: number; to?: number };
  text?: string;
}

/** 把 whisper.cpp stderr 里的一行（`[00:00:00.000 --> 00:00:03.000] 文本`）解析成段。 */
export function parseSegmentLine(line: string): { text: string; startMs: number; endMs: number } | null {
  const m = line.match(
    /\[\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*\]\s*(.*)$/,
  );
  if (!m) return null;
  const toMs = (h: string, mi: string, s: string, ms: string) =>
    ((Number(h) * 3600 + Number(mi) * 60 + Number(s)) * 1000 + Number(ms));
  const startMs = toMs(m[1]!, m[2]!, m[3]!, m[4]!);
  const endMs = toMs(m[5]!, m[6]!, m[7]!, m[8]!);
  return { text: (m[9] ?? '').trim(), startMs, endMs };
}

function parseWhisperJson(raw: string): TranscriptSegment[] {
  let data: { transcription?: RawWhisperSegment[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const arr = data.transcription ?? [];
  return arr
    .map((s) => ({
      text: (s.text ?? '').trim(),
      startMs: s.offsets?.from ?? 0,
      endMs: s.offsets?.to ?? 0,
    }))
    .filter((s) => s.text.length > 0);
}

/**
 * 用 whisper.cpp 把 wav 转成带时间戳的逐字段。每完成一段，stderr 会打印一行，
 * 通过 onSegment 实时回调，便于 SSE 推送流式逐字稿。
 */
export async function transcribe(
  wavPath: string,
  onSegment?: (seg: { text: string; startMs: number; endMs: number }) => void,
): Promise<TranscriptSegment[]> {
  const cli = config.whisper.cli;
  if (!existsSync(cli)) throw new DependencyMissingError('whisper-cli');
  const model = config.whisper.model;
  if (!existsSync(model)) throw new DependencyMissingError(`whisper 模型（${model}）`);

  // -oj 输出 JSON，-of 指定输出前缀（生成 <wavPath>.json）
  const args = [
    '-m', model,
    '-f', wavPath,
    '-l', config.whisper.language,
    '-t', String(config.whisper.threads),
    '-oj',
    '-of', wavPath,
  ];
  if (config.whisper.prompt) {
    args.push('--prompt', config.whisper.prompt);
  }

  // whisper-cli 把分段结果打到 stdout（每段一行：[from --> to] 文本）
  await run(cli, args, {
    onStdout: (line) => {
      const seg = parseSegmentLine(line);
      if (seg && seg.text) onSegment?.(seg);
    },
  });

  const jsonPath = `${wavPath}.json`;
  const segments = existsSync(jsonPath)
    ? parseWhisperJson(readFileSync(jsonPath, 'utf8'))
    : [];
  rmSync(jsonPath, { force: true });
  return segments;
}
