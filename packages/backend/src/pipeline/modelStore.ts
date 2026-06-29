import { EventEmitter } from 'node:events';
import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

/** 模型档位清单（与 scripts/setup.sh 一致；URL 走 hf-mirror，国内更稳）。 */
export interface WhisperModelSpec {
  name: string;
  label: string;
  size: string;
  url: string;
}

const MODEL_URL_BASE =
  process.env.WHISPER_MODEL_URL_BASE ?? 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main';

export const WHISPER_MODELS: WhisperModelSpec[] = [
  { name: 'ggml-large-v3-turbo.bin', label: 'turbo', size: '~1.5GB', url: `${MODEL_URL_BASE}/ggml-large-v3-turbo.bin` },
  { name: 'ggml-large-v3.bin', label: 'large-v3', size: '~3.0GB', url: `${MODEL_URL_BASE}/ggml-large-v3.bin` },
  { name: 'ggml-small.bin', label: 'small', size: '~466MB', url: `${MODEL_URL_BASE}/ggml-small.bin` },
];

export interface WhisperModelInfo extends WhisperModelSpec {
  installed: boolean;
  active: boolean;
}

export interface WhisperModelsResult {
  dir: string;
  packaged: boolean; // 打包态目录只读，不允许下载/删除
  models: WhisperModelInfo[];
}

/** whisper 模型目录 = 当前模型文件所在目录。 */
export function whisperModelDir(): string {
  return dirname(config.whisper.model);
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 打包态判断：模型目录不在用户可写区（resources/vn/models 只读）。 */
export function isPackagedModels(): boolean {
  return !isWritable(whisperModelDir());
}

/** 列出档位 + 已装/当前状态。 */
export function listWhisper(): WhisperModelsResult {
  const dir = whisperModelDir();
  const packaged = isPackagedModels();
  const present = new Set<string>();
  try {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.bin')) present.add(f);
    }
  } catch {
    /* 目录读不到视为空 */
  }
  const activeName = config.whisper.model.split('/').pop() ?? config.whisper.model;
  const models = WHISPER_MODELS.map((m) => ({
    ...m,
    installed: present.has(m.name),
    active: m.name === activeName,
  }));
  return { dir, packaged, models };
}

/**
 * 流式下载一个 whisper 模型到模型目录。
 * 进度经返回的 EventEmitter 推送：'progress'(pct 0..1) / 'done' / 'error'(msg)。
 * 写到 <name>.part，完成后原子 rename。
 */
export function downloadWhisper(name: string): EventEmitter {
  const em = new EventEmitter();
  const spec = WHISPER_MODELS.find((m) => m.name === name);
  if (!spec) {
    setImmediate(() => em.emit('error', `未知模型：${name}`));
    return em;
  }
  if (isPackagedModels()) {
    setImmediate(() => em.emit('error', '打包态模型目录只读，不支持下载'));
    return em;
  }

  const dest = join(whisperModelDir(), `${name}.part`);
  const final = join(whisperModelDir(), name);
  void (async () => {
    try {
      const res = await fetch(spec.url, { redirect: 'follow' });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const total = Number(res.headers.get('content-length') ?? 0);
      const stream = createWriteStream(dest, { flags: 'w' });
      const reader = res.body.getReader();
      let written = 0;
      let lastEmit = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        stream.write(Buffer.from(value));
        written += value.length;
        if (total > 0 && written - lastEmit > 4 * 1024 * 1024) {
          em.emit('progress', Math.min(1, written / total));
          lastEmit = written;
        }
      }
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
      renameSync(dest, final);
      em.emit('progress', 1);
      em.emit('done', { name });
    } catch (e) {
      try {
        if (existsSync(dest)) rmSync(dest, { force: true });
      } catch {
        /* 清理失败忽略 */
      }
      em.emit('error', e instanceof Error ? e.message : String(e));
    }
  })();
  return em;
}

/** 删除一个 whisper 模型（禁止删当前 / 打包态）。 */
export function deleteWhisper(name: string): void {
  if (isPackagedModels()) throw new Error('打包态模型目录只读，不支持删除');
  if (!WHISPER_MODELS.some((m) => m.name === name)) throw new Error(`未知模型：${name}`);
  const activeName = config.whisper.model.split('/').pop() ?? config.whisper.model;
  if (name === activeName) throw new Error('不能删除当前使用的模型，请先切换');
  const file = join(whisperModelDir(), name);
  if (!existsSync(file)) throw new Error(`模型未安装：${name}`);
  rmSync(file, { force: true });
}

/** 运行时切换 whisper 模型（仿 settingsStore.applyGlossary），下次转写即时生效。 */
export function applyWhisperModel(name: string): void {
  const file = join(whisperModelDir(), name);
  if (!existsSync(file)) throw new Error(`模型未安装：${name}`);
  config.whisper.model = file;
}

/** 仅供 /health 或调试：模型目录占用大小。 */
export function whisperDirSize(): number {
  try {
    return statSync(whisperModelDir()).size;
  } catch {
    return 0;
  }
}
