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
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  summarySystemPrompt: string;
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
  const prefix = shell('brew --prefix whisper-cpp');
  if (prefix) return `${prefix}/bin/whisper-cli`;
  // Apple Silicon 默认安装位置
  return '/opt/homebrew/opt/whisper-cpp/bin/whisper-cli';
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
  },
  llm: {
    baseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/+$/, ''),
    model: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct',
    apiKey: process.env.OLLAMA_API_KEY ?? 'ollama',
    summarySystemPrompt: SUMMARY_SYSTEM_PROMPT,
  },
};

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

/** 运行时探测所有外部依赖；前端用此渲染「缺依赖」横幅。 */
export async function checkHealth(): Promise<HealthStatus> {
  const ffmpegPath = config.ffmpegBin ?? which('ffmpeg');
  const whisperCliOk = fileAccessible(config.whisper.cli);
  const whisperModelOk = existsSync(config.whisper.model);

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
