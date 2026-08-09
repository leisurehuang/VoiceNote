import { execSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 打包成单文件（cjs）后 import.meta.url 可能不可用，兜底到 cwd；
// 打包模式下实际路径都由 env 提供，这里只是开发态默认值的兜底。
let here = process.cwd();
try {
  here = dirname(fileURLToPath(import.meta.url));
} catch {
  /* cjs 打包态：用 cwd 兜底 */
}
const projectRoot = resolve(here, '..', '..', '..');

// 加载项目根 .env（本地工具，免装 dotenv；进程已有环境变量优先）
function loadEnvFile(): void {
  const envPath = process.env.VOICE_NOTES_ENV_FILE ?? join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1];
    const raw = m[2];
    if (k !== undefined && raw !== undefined && process.env[k] === undefined) {
      process.env[k] = raw.replace(/^['"]|['"]$/g, '');
    }
  }
}
loadEnvFile();

export interface WhisperConfig {
  cli: string;
  model: string;
  threads: number;
  language: string;
  prompt: string;
  /** 专有名词术语表，运行时注入 whisper/摘要 prompt 偏置（由 settingsStore 同步）。 */
  glossary: string[];
}

export type TranscriptionEngine = 'whisper' | 'sherpa';

/** sherpa-onnx 引擎配置(说话人分离 + Paraformer 中文 ASR)。模型默认放 ~/.voice-notes-models/sherpa-onnx/models/。 */
export interface SherpaConfig {
  diarizationCli: string;
  asrCli: string;
  segmentationModel: string;
  embeddingModel: string;
  asrModel: string;
  asrTokens: string;
  /** 未知说话人数时的聚类阈值,越大说话人越少(默认 0.90)。 */
  clusterThreshold: number;
  /** 已知说话人数时优先用;null 走 clusterThreshold 自动聚类。 */
  numSpeakers: number | null;
  threads: number;
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  summarySystemPrompt: string;
  // —— 实时增量摘要（录音期间滚动更新）——
  incrementalSummarySystemPrompt: string;
  incrementalModel: string;
  incrementalThresholdChars: number;
  incrementalMinIntervalMs: number;
  // —— 输入长度限制（防止超过模型上下文窗口）——
  /** 单次摘要允许的最大输入字符数。超出时从尾部截取（最新内容优先），避免超过上下文窗口。 */
  maxTranscriptChars: number;
}

export interface AppConfig {
  port: number;
  projectRoot: string;
  dataDir: string;
  sessionsDir: string;
  frontendDist: string;
  maxUploadBytes: number;
  ffmpegBin: string | null;
  ffprobeBin: string | null;
  whisper: WhisperConfig;
  sherpa: SherpaConfig;
  /** 当前激活的转写引擎(被 settingsStore 运行时覆盖)。 */
  transcription: { engine: TranscriptionEngine };
  llm: LlmConfig;
}

function shell(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** `command -v name` —— 返回可执行文件绝对路径，找不到返回 null。 */
export function which(name: string): string | null {
  return shell(`command -v ${name}`) || null;
}

function fileAccessible(p: string): boolean {
  try {
    accessSync(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveWhisperCli(): string {
  if (process.env.WHISPER_CLI) return process.env.WHISPER_CLI;
  // 首先检查 PATH 中是否有 whisper-cli
  const fromPath = which('whisper-cli');
  if (fromPath) return fromPath;
  // 检查 Linux 安装脚本的默认位置
  const userInstalled = join(process.env.HOME ?? '', '.voice-notes-models', 'bin', 'whisper-cli');
  if (fileAccessible(userInstalled)) return userInstalled;
  // 检查 macOS Homebrew 位置作为后备
  const prefix = shell('brew --prefix whisper-cpp 2>/dev/null');
  if (prefix) return `${prefix}/bin/whisper-cli`;
  // macOS Apple Silicon 默认安装位置
  return '/opt/homebrew/opt/whisper-cpp/bin/whisper-cli';
}

// sherpa-onnx 二进制 / 模型默认目录（brew 无 sherpa-onnx formula，靠 fetch-sherpa.sh 下预编译）
const sherpaDir = process.env.SHERPA_DIR ?? join(process.env.HOME ?? '', '.voice-notes-models', 'sherpa-onnx');
const sherpaModelsDir = process.env.SHERPA_MODELS_DIR ?? join(sherpaDir, 'models');

/** 解析 sherpa-onnx 二进制路径：env 优先 → PATH 探测 → 默认下载目录。 */
function resolveSherpaCli(name: string, envKey: string): string {
  if (process.env[envKey]) return process.env[envKey] as string;
  const fromPath = which(name);
  if (fromPath) return fromPath;
  return join(sherpaDir, 'bin', name);
}


const SUMMARY_SYSTEM_PROMPT =
  '你是专业会议纪要整理器，负责将用户传入的语音转写文稿整理为结构化标准中文会议纪要。\n' +
  '===== 强制输出规范 =====\n' +
  '1. 仅输出纪要正文，首行直接为内容，不添加前置话术；\n' +
  '2. 开篇先用一句话概括整场讨论核心结论；\n' +
  '3. 使用Markdown分级小标题划分板块，可选板块包含「主要议题」「关键决定」「待办事项」，原文无对应内容则直接删除该标题，严禁凭空编造板块与信息；\n' +
  '4. 内容按讨论主题分类聚合，合并同类表述，分维度梳理：现状情况、现存问题、相关诉求、各类解决方案、意见分歧；\n' +
  '5. 单独梳理全场达成一致的共识内容；\n' +
  '6. 待办事项完整记录：任务内容、执行要求、时限、相关约束条件；\n' +
  '7. 单独列出本次未达成统一、存在争议、需后续跟进的遗留问题；\n' +
  '===== 硬性禁止规则 =====\n' +
  '- 禁止输出寒暄、客套、自我介绍类语句，如“好的”“以下为整理结果”“我帮你整理完毕”等；\n' +
  '- 禁止复述整理规则、禁止解释自身工作逻辑、禁止对话式交互；\n' +
  '- 禁止主观评价原文、额外补充方案、拓展原文不存在的观点；\n' +
  '===== 内容处理要求 =====\n' +
  '全程严格忠于原始文稿，仅可修正口语冗余、同音错字、语序混乱问题，不得新增、篡改任何原文未提及的信息。';

// 实时增量摘要：把「已有草稿 + 新增转写」滚动合并，篇幅精炼、优先速度，终版由 SUMMARY_SYSTEM_PROMPT 覆盖。
const INCREMENTAL_SUMMARY_SYSTEM_PROMPT =
  '你是实时会议纪要整理器。用户会持续给你两类输入：「当前已有草稿」与「本次新增转写文本」。\n' +
  '===== 任务 =====\n' +
  '把新增内容合并进已有草稿，输出重新组织后的完整纪要，不是简单追加。\n' +
  '===== 输出规范 =====\n' +
  '1. 仅输出纪要正文，首行即为内容，无前置话术；\n' +
  '2. 开篇一句话概括核心结论；\n' +
  '3. 用Markdown小标题划分板块，可选「主要议题」「关键决定」「待办事项」，无对应内容则删除该标题，禁止编造；\n' +
  '4. 同类表述合并，按现状/问题/方案/分歧分维度梳理；\n' +
  '5. 全程忠于原文，仅修正口语冗余与同音错字，不新增、不篡改、不评价；\n' +
  '6. 篇幅精炼、优先速度；本结果会在结束后被高质量终版覆盖。\n' +
  '===== 禁止 =====\n' +
  '禁止寒暄、自我介绍、复述规则、对话式交互。';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(projectRoot, 'data');

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3000),
  projectRoot,
  dataDir,
  sessionsDir: join(dataDir, 'sessions'),
  frontendDist: process.env.FRONTEND_DIST
    ? resolve(process.env.FRONTEND_DIST)
    : join(projectRoot, 'packages', 'frontend', 'dist'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 500 * 1024 * 1024),
  ffmpegBin: process.env.FFMPEG ?? null,
  ffprobeBin: process.env.FFPROBE ?? null,
  whisper: {
    cli: resolveWhisperCli(),
    model:
      process.env.WHISPER_MODEL ??
      join(process.env.HOME ?? '', '.voice-notes-models', 'ggml-large-v3-turbo.bin'),
    threads: Number(process.env.WHISPER_THREADS ?? 8),
    language: process.env.WHISPER_LANGUAGE ?? 'auto',
    prompt: process.env.WHISPER_PROMPT ?? '',
    glossary: [], // 启动为空，由 settingsStore.init() 从 settings 应用
  },
  sherpa: {
    diarizationCli: resolveSherpaCli('sherpa-onnx-offline-speaker-diarization', 'SHERPA_DIARIZATION_CLI'),
    asrCli: resolveSherpaCli('sherpa-onnx-offline', 'SHERPA_ASR_CLI'),
    segmentationModel:
      process.env.SHERPA_SEGMENTATION_MODEL ??
      join(sherpaModelsDir, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx'),
    embeddingModel:
      process.env.SHERPA_EMBEDDING_MODEL ??
      join(sherpaModelsDir, '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'),
    asrModel:
      process.env.SHERPA_ASR_MODEL ??
      join(sherpaModelsDir, 'sherpa-onnx-paraformer-zh-2024-03-09', 'model.int8.onnx'),
    asrTokens:
      process.env.SHERPA_ASR_TOKENS ??
      join(sherpaModelsDir, 'sherpa-onnx-paraformer-zh-2024-03-09', 'tokens.txt'),
    clusterThreshold: Number(process.env.SHERPA_CLUSTER_THRESHOLD ?? 0.90),
    numSpeakers: process.env.SHERPA_NUM_SPEAKERS ? Number(process.env.SHERPA_NUM_SPEAKERS) : null,
    threads: Number(process.env.SHERPA_THREADS ?? 8),
  },
  transcription: {
    engine: process.env.TRANSCRIPTION_ENGINE === 'sherpa' ? 'sherpa' : 'whisper',
  },
  llm: {
    baseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/+$/, ''),
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
    apiKey: process.env.OLLAMA_API_KEY ?? 'ollama',
    summarySystemPrompt: SUMMARY_SYSTEM_PROMPT,
    incrementalSummarySystemPrompt:
      process.env.INCREMENTAL_SUMMARY_SYSTEM_PROMPT ?? INCREMENTAL_SUMMARY_SYSTEM_PROMPT,
    incrementalModel:
      process.env.OLLAMA_INCREMENTAL_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
    incrementalThresholdChars: Number(process.env.INCREMENTAL_THRESHOLD_CHARS ?? 280),
    incrementalMinIntervalMs: Number(process.env.INCREMENTAL_MIN_INTERVAL_MS ?? 8000),
    maxTranscriptChars: Number(process.env.MAX_TRANSCRIPT_CHARS ?? 15000),
  },
};

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
  transcriptionEngine: TranscriptionEngine;
  /** sherpa 是可选引擎;sherpa.ok 全 false 不影响顶层 ok。 */
  sherpa: SherpaHealth;
}

/** 运行时探测所有外部依赖；前端用此渲染「缺依赖」横幅。 */
export async function checkHealth(): Promise<HealthStatus> {
  const ffmpegPath = config.ffmpegBin ?? which('ffmpeg');
  const whisperCliOk = fileAccessible(config.whisper.cli);
  const whisperModelOk = existsSync(config.whisper.model);

  const sherpaDiarOk = fileAccessible(config.sherpa.diarizationCli);
  const sherpaAsrCliOk = fileAccessible(config.sherpa.asrCli);
  const sherpaSegOk = existsSync(config.sherpa.segmentationModel);
  const sherpaEmbOk = existsSync(config.sherpa.embeddingModel);
  const sherpaAsrModelOk = existsSync(config.sherpa.asrModel);
  const sherpaAsrTokensOk = existsSync(config.sherpa.asrTokens);
  const sherpaOk =
    sherpaDiarOk && sherpaAsrCliOk && sherpaSegOk && sherpaEmbOk && sherpaAsrModelOk && sherpaAsrTokensOk;

  let ollama = false;
  try {
    const res = await fetch(`${config.llm.baseUrl}/models`, {
      signal: AbortSignal.timeout(2500),
      headers: { Authorization: `Bearer ${config.llm.apiKey}` },
    });
    ollama = res.ok;
  } catch {
    ollama = false;
  }

  // sherpa 是可选引擎，ok 不依赖它；whisper 仍是基线依赖。
  const ok = !!(ffmpegPath && whisperCliOk && whisperModelOk && ollama);
  return {
    ok,
    ffmpeg: !!ffmpegPath,
    ffmpegPath,
    whisperCli: whisperCliOk,
    whisperCliPath: config.whisper.cli,
    whisperModel: whisperModelOk,
    whisperModelPath: config.whisper.model,
    ollama,
    ollamaBaseUrl: config.llm.baseUrl,
    transcriptionEngine: config.transcription.engine,
    sherpa: {
      ok: sherpaOk,
      diarizationCli: sherpaDiarOk,
      asrCli: sherpaAsrCliOk,
      segmentationModel: sherpaSegOk,
      embeddingModel: sherpaEmbOk,
      asrModel: sherpaAsrModelOk,
      asrTokens: sherpaAsrTokensOk,
    },
  };
}

export const SESSION_RUNNING_STATUSES = new Set([
  'recording',
  'converting',
  'transcribing',
  'summarizing',
]);

export type SessionStatus =
  | 'uploaded'
  | 'recording'
  | 'converting'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'error';
