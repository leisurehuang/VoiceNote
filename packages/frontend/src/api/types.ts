// 前后端共享的类型定义（前端侧副本，与后端 config.ts / sessionStore.ts 对应）

export interface HealthStatus {
  ok: boolean;
  ffmpeg: boolean;
  ffmpegPath: string | null;
  whisperCli: boolean;
  whisperCliPath: string;
  whisperModel: boolean;
  whisperModelPath: string;
  ollama: boolean;
  ollamaBaseUrl: string;
}

export type SessionStatus =
  | 'uploaded'
  | 'converting'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'error';

export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface SessionMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  sourceKind: 'record' | 'upload';
  sourceName: string;
  status: SessionStatus;
  stage: string;
  progress: number;
  error: string | null;
  durationMs: number | null;
  summaryModel: string | null;
}

export interface SessionDetail extends SessionMeta {
  transcript: TranscriptSegment[];
  summary: string | null;
}
