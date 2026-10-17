/**
 * 听写历史：JSONL 追加存储（data/dictation/history.jsonl），超出上限裁掉最旧的。
 * 与会话存储一致走纯文件系统，追加频率低（人一次一条），整文件重写足够。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { newId } from '../util/id.js';

export interface DictationHistoryEntry {
  id: string;
  /** ISO 时间。 */
  time: string;
  /** ASR 原始转写（口令剥离后）。 */
  transcript: string;
  /** 最终成稿（润色/纠错后）。 */
  text: string;
  durationMs: number;
  /** 命中翻译口令/固定输出语言时的目标语言代码。 */
  targetLanguage?: string;
}

const historyDir = join(config.dataDir, 'dictation');
const historyPath = join(historyDir, 'history.jsonl');

function readAll(): DictationHistoryEntry[] {
  try {
    if (!existsSync(historyPath)) return [];
    const lines = readFileSync(historyPath, 'utf8').split('\n').filter(Boolean);
    const out: DictationHistoryEntry[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as DictationHistoryEntry);
      } catch {
        /* 跳过损坏行 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeAll(entries: DictationHistoryEntry[]): void {
  mkdirSync(historyDir, { recursive: true });
  const tmp = `${historyPath}.tmp`;
  writeFileSync(
    tmp,
    entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''),
  );
  renameSync(tmp, historyPath);
}

/** 追加一条历史，超过 limit 时裁掉最旧的；返回带 id 的完整条目。 */
export function appendHistory(
  entry: Omit<DictationHistoryEntry, 'id' | 'time'>,
  limit: number,
): DictationHistoryEntry {
  const full: DictationHistoryEntry = {
    ...entry,
    id: newId(),
    time: new Date().toISOString(),
  };
  const all = [...readAll(), full];
  writeAll(all.length > limit ? all.slice(all.length - limit) : all);
  return full;
}

/** 最近历史（新的在前）。 */
export function listHistory(limit = 100): DictationHistoryEntry[] {
  return readAll().reverse().slice(0, Math.max(1, limit));
}

/** 删除单条；返回是否删到。 */
export function deleteHistoryEntry(id: string): boolean {
  const all = readAll();
  const next = all.filter((e) => e.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  return true;
}

/** 清空全部历史。 */
export function clearHistory(): void {
  writeAll([]);
}
