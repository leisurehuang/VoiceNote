import { EventEmitter } from 'node:events';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, SESSION_RUNNING_STATUSES, type SessionStatus } from '../config.js';
import { newId } from '../util/id.js';

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  sourceKind: 'record' | 'upload';
  sourceName: string;
  mimeType: string;
  status: SessionStatus;
  stage: string;
  progress: number;
  error: string | null;
  durationMs: number | null;
  summaryModel: string | null;
}

export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SessionDetail extends SessionMeta {
  transcript: TranscriptSegment[];
  summary: string | null;
}

interface Entry {
  meta: SessionMeta;
  emitter: EventEmitter;
}

// 内存索引：id -> { meta, emitter }。meta 是真相源，每次变更原子落盘。
const entries = new Map<string, Entry>();

// ---- 路径助手 ----
export const sessionDir = (id: string): string => join(config.sessionsDir, id);
export const metaPath = (id: string): string => join(sessionDir(id), 'meta.json');
export const sourcePath = (id: string): string => {
  const meta = entries.get(id)?.meta;
  return join(sessionDir(id), `source${extFor(meta?.mimeType, meta?.sourceName)}`);
};
export const audioPath = (id: string): string => join(sessionDir(id), 'audio.wav');
export const transcriptPath = (id: string): string => join(sessionDir(id), 'transcript.json');
export const summaryPath = (id: string): string => join(sessionDir(id), 'summary.md');

function extFor(mimeType?: string, filename?: string): string {
  if (filename && filename.includes('.')) {
    return filename.slice(filename.lastIndexOf('.'));
  }
  const map: Record<string, string> = {
    'audio/webm': '.webm',
    'audio/mp4': '.mp4',
    'audio/m4a': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/wave': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
  };
  return (mimeType && map[mimeType]) ?? '.bin';
}

// ---- 持久化 ----
function persist(id: string): void {
  const meta = entries.get(id)?.meta;
  if (!meta) return;
  const tmp = join(sessionDir(id), 'meta.json.tmp');
  writeFileSync(tmp, JSON.stringify(meta, null, 2));
  renameSync(tmp, metaPath(id));
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---- 生命周期 ----
/** 启动时调用：建目录、扫描历史会话、把崩溃时停在「运行中」的重置为可重跑的 error。 */
export function init(): void {
  mkdirSync(config.sessionsDir, { recursive: true });
  for (const name of readdirSync(config.sessionsDir)) {
    const id = name;
    const mp = metaPath(id);
    if (!existsSync(mp)) continue;
    try {
      const meta = JSON.parse(readFileSync(mp, 'utf8')) as SessionMeta;
      if (SESSION_RUNNING_STATUSES.has(meta.status)) {
        meta.status = 'error';
        meta.error = '中断（服务重启时仍在处理）';
        meta.stage = '出错';
      }
      entries.set(id, { meta, emitter: new EventEmitter() });
    } catch {
      // 损坏的 meta 跳过
    }
  }
}

export function emitter(id: string): EventEmitter | undefined {
  return entries.get(id)?.emitter;
}

export function get(id: string): SessionMeta | undefined {
  return entries.get(id)?.meta;
}

export function list(): SessionMeta[] {
  return [...entries.values()]
    .map((e) => e.meta)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getDetail(id: string): SessionDetail | undefined {
  const meta = entries.get(id)?.meta;
  if (!meta) return undefined;
  return {
    ...meta,
    transcript: readTranscript(id),
    summary: readSummary(id),
  };
}

/** 合并更新 meta、落盘、并向 SSE 订阅者广播。 */
export function update(id: string, patch: Partial<SessionMeta>): SessionMeta | undefined {
  const entry = entries.get(id);
  if (!entry) return undefined;
  Object.assign(entry.meta, patch, { updatedAt: nowIso() });
  persist(id);
  entry.emitter.emit('meta', entry.meta);
  return entry.meta;
}

export interface CreateArgs {
  stream: Readable;
  filename: string;
  mimeType: string;
  sourceKind: 'record' | 'upload';
  title?: string;
}

export async function createFromUpload(args: CreateArgs): Promise<string> {
  const id = newId();
  mkdirSync(sessionDir(id), { recursive: true });
  const meta: SessionMeta = {
    id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    title: args.title?.trim() || '未命名',
    sourceKind: args.sourceKind,
    sourceName: args.filename,
    mimeType: args.mimeType,
    status: 'uploaded',
    stage: '已上传',
    progress: 0,
    error: null,
    durationMs: null,
    summaryModel: null,
  };
  entries.set(id, { meta, emitter: new EventEmitter() });
  // 先落盘 meta，再写入音频源文件
  persist(id);
  const dest = createWriteStream(join(sessionDir(id), `source${extFor(args.mimeType, args.filename)}`));
  await pipeline(args.stream, dest);
  return id;
}

export function writeTranscript(id: string, segments: TranscriptSegment[]): void {
  writeFileSync(transcriptPath(id), JSON.stringify(segments, null, 2));
}

export function readTranscript(id: string): TranscriptSegment[] {
  try {
    return JSON.parse(readFileSync(transcriptPath(id), 'utf8')) as TranscriptSegment[];
  } catch {
    return [];
  }
}

export function writeSummary(id: string, text: string, model: string): void {
  writeFileSync(summaryPath(id), text);
  update(id, { summaryModel: model });
}

export function readSummary(id: string): string | null {
  try {
    return readFileSync(summaryPath(id), 'utf8');
  } catch {
    return null;
  }
}

export function remove(id: string): boolean {
  if (!entries.has(id)) return false;
  entries.delete(id);
  try {
    rmSync(sessionDir(id), { recursive: true, force: true });
  } catch {
    // 忽略
  }
  return true;
}

/** 仅供调试/校验用：返回会话目录占用的磁盘大小。 */
export function diskSize(id: string): number {
  try {
    return statSync(sessionDir(id)).size;
  } catch {
    return 0;
  }
}
