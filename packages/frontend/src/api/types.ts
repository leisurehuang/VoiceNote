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
  /** 云端转写 API 三项配置是否齐全。 */
  asrApiConfigured: boolean;
  /** 引擎为 api 时对端点的探测结果（其他引擎下恒为 false）。 */
  asrApiOk: boolean;
  transcriptionEngine: 'whisper' | 'sherpa' | 'api';
  /** sherpa 是可选引擎；sherpa.ok 为 false 不影响顶层 ok。 */
  sherpa: SherpaHealth;
}

export type SessionStatus =
  'uploaded' | 'converting' | 'transcribing' | 'summarizing' | 'done' | 'error';

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

/** 云端转写 API（OpenAI 兼容 /audio/transcriptions 形态，如硅基流动 SenseVoiceSmall）。 */
export interface AsrApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 术语纠错条目：误写命中 → 替换为正写（听写输出前生效）。 */
export interface TermCorrection {
  target: string;
  variants: string[];
}

/** 长按单键触发配置（桌面端 uiohook 全局键盘事件实现）。 */
export interface DictationHoldSettings {
  enabled: boolean;
  /** uiohook 键名（CtrlRight/AltRight/MetaRight/F6/F7/F8）。 */
  key: string;
  /** ptt=按住说话（松开结束出字）；toggle=长按切换（行为同组合键）。 */
  mode: 'ptt' | 'toggle';
}

/** 语音听写配置（桌面端生效）。 */
export interface DictationSettings {
  enabled: boolean;
  /** Electron accelerator，如 'Ctrl+Alt+D'。 */
  shortcut: string;
  /** 录音期间的取消键。 */
  cancelShortcut: string;
  /** 长按单键触发（与组合键快捷键并存）。 */
  hold: DictationHoldSettings;
  polish: boolean;
  translationCommands: boolean;
  /** 固定输出语言代码；不固定为空。 */
  fixedOutputLanguage?: string;
  termCorrections: TermCorrection[];
  historyLimit: number;
}

export interface Settings {
  activePresetId: string | null;
  presets: LlmPreset[];
  glossary?: string[];
  transcriptionEngine: 'whisper' | 'sherpa' | 'api';
  sherpa: SherpaSettings;
  /** 当前激活 whisper 模型文件绝对路径（重启保持）。 */
  whisperModelPath?: string;
  /** 云端转写 API 配置（engine==='api' 时生效）。 */
  asrApi: AsrApiSettings;
  /** 语音听写配置。 */
  dictation?: DictationSettings;
}

/** 听写历史条目。 */
export interface DictationHistoryEntry {
  id: string;
  time: string;
  transcript: string;
  text: string;
  durationMs: number;
  targetLanguage?: string;
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
