import { execSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // .../packages/backend/src
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
  '你是会议纪要助手。根据用户提供的语音转写文本，生成简洁的中文摘要。' +
  '先用一两句话概述整体内容；再用 Markdown 小标题列出「主要议题」「关键决定」「待办事项」' +
  '（转写里没有对应内容的标题请省略，禁止编造）。' +
  '语言简练，可顺手纠正明显的口语/同音错别字，但不要添加转写中未出现的信息。';

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
  whisper: {
    cli: resolveWhisperCli(),
    model:
      process.env.WHISPER_MODEL ??
      join(process.env.HOME ?? '', '.voice-notes-models', 'ggml-large-v3-turbo.bin'),
    threads: Number(process.env.WHISPER_THREADS ?? 8),
    language: process.env.WHISPER_LANGUAGE ?? 'auto',
    prompt: process.env.WHISPER_PROMPT ?? '以下是普通话的句子。',
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
  const ffmpegPath = which('ffmpeg');
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
  'converting',
  'transcribing',
  'summarizing',
]);

export type SessionStatus =
  | 'uploaded'
  | 'converting'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'error';
