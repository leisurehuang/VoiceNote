// 前后端共享的类型定义（前端侧副本，与后端 config.ts / sessionStore.ts 对应）

export interface SherpaHealth {
  ok: boolean;
  diarizationCli: boolean;
  asrCli: boolean;
  segmentationModel: boolean;
  embeddingModel: boolean;
  asrModel: boolean;
  asrTokens: boolean;
}

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
  /** LLM 端点可达且模型列表里能看到当前模型（缺失 → 设置里下载/检查模型名）。 */
  llmModelOk: boolean;
  transcriptionEngine: 'whisper' | 'sherpa';
  /** sherpa 是可选引擎；sherpa.ok 为 false 不影响顶层 ok。 */
  sherpa: SherpaHealth;
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
  /** 说话人编号（0-based）；仅 sherpa-onnx 引擎产出。 */
  speaker?: number;
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
  hasAudio: boolean;
}

export interface LlmPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 实时增量摘要模型；留空跟随主模型。 */
  incrementalModel?: string;
}

export interface SherpaSettings {
  numSpeakers?: number | null;
  clusterThreshold?: number;
}

export interface Settings {
  activePresetId: string | null;
  presets: LlmPreset[];
  glossary?: string[];
  transcriptionEngine: 'whisper' | 'sherpa';
  sherpa: SherpaSettings;
  /** 当前激活 whisper 模型文件绝对路径（重启保持）。 */
  whisperModelPath?: string;
}

export interface TodoItem {
  text: string;
  owner?: string;
  due?: string;
}

export interface WhisperModelInfo {
  name: string;
  label: string;
  size: string;
  url: string;
  installed: boolean;
  active: boolean;
  /** 内置只读模型（不可删除）。 */
  builtin: boolean;
  /** 在用户可写目录，可删除。 */
  deletable: boolean;
}
export interface WhisperModelsResult {
  dir: string;
  /** 当前激活模型文件绝对路径。 */
  activePath: string;
  models: WhisperModelInfo[];
}
export interface LlmModelInfo {
  name: string;
  active: boolean;
}
export interface LlmModelsResult {
  local: boolean;
  models: LlmModelInfo[];
  active: string;
  error?: string;
}
