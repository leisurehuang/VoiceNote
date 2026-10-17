import { EventEmitter } from 'node:events';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
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
  {
    name: 'ggml-large-v3-turbo.bin',
    label: 'turbo（推荐）',
    size: '~1.5GB',
    url: `${MODEL_URL_BASE}/ggml-large-v3-turbo.bin`,
  },
  {
    name: 'ggml-large-v3.bin',
    label: 'large-v3',
    size: '~3.0GB',
    url: `${MODEL_URL_BASE}/ggml-large-v3.bin`,
  },
  {
    name: 'ggml-small.bin',
    label: 'small（轻量）',
    size: '~466MB',
    url: `${MODEL_URL_BASE}/ggml-small.bin`,
  },
];

/** 内置只读模型目录（打包态由 desktop 注入；新包为空，目录可能不存在）。 */
const BUNDLED_MODELS_DIR = process.env.VOICE_NOTES_BUNDLED_MODELS_DIR ?? '';

/** 用户可写模型目录：打包态 = desktop 注入的 userData 子目录；dev 回落当前模型所在目录（~/.voice-notes-models）。 */
export function userModelsDir(): string {
  return process.env.VOICE_NOTES_MODELS_DIR ?? dirname(config.whisper.model);
}

export interface WhisperModelInfo extends WhisperModelSpec {
  installed: boolean;
  active: boolean;
  /** 内置只读模型（随 app 分发，不可删除/覆盖）。 */
  builtin: boolean;
  /** 文件在用户可写目录，可删除。 */
  deletable: boolean;
}

export interface WhisperModelsResult {
  dir: string;
  /** 当前激活模型文件的绝对路径。 */
  activePath: string;
  models: WhisperModelInfo[];
}

function listBinFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.bin'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  return `~${Math.max(1, Math.round(bytes / 1024 / 1024))}MB`;
}

/** 列出档位 + 用户目录/内置目录里的全部模型 + 已装/当前状态。 */
export function listWhisper(): WhisperModelsResult {
  const dir = userModelsDir();
  const activeBase = basename(config.whisper.model);
  const byName = new Map<string, WhisperModelInfo>();
  const upsert = (i: WhisperModelInfo) => {
    const prev = byName.get(i.name);
    byName.set(
      i.name,
      prev
        ? {
            ...prev,
            installed: prev.installed || i.installed,
            deletable: prev.deletable || i.deletable,
          }
        : i,
    );
  };
  // 1) 固定档位（用户目录或内置目录中任一存在即算已装）
  for (const m of WHISPER_MODELS) {
    const inUser = existsSync(join(dir, m.name));
    const inBundled = BUNDLED_MODELS_DIR ? existsSync(join(BUNDLED_MODELS_DIR, m.name)) : false;
    upsert({
      ...m,
      installed: inUser || inBundled,
      active: m.name === activeBase,
      builtin: inBundled && !inUser,
      deletable: inUser,
    });
  }
  // 2) 用户目录中的其他 .bin（自定义 URL 下载 / 手动放入）
  for (const p of listBinFiles(dir)) {
    const name = basename(p);
    if (byName.has(name)) continue;
    let size = '';
    try {
      size = humanSize(statSync(p).size);
    } catch {
      /* ignore */
    }
    upsert({
      name,
      label: name.replace(/\.bin$/, ''),
      size,
      url: '',
      installed: true,
      active: name === activeBase,
      builtin: false,
      deletable: true,
    });
  }
  // 3) 内置目录中的其他 .bin
  for (const p of BUNDLED_MODELS_DIR ? listBinFiles(BUNDLED_MODELS_DIR) : []) {
    const name = basename(p);
    if (byName.has(name)) continue;
    upsert({
      name,
      label: name.replace(/\.bin$/, ''),
      size: '',
      url: '',
      installed: true,
      active: name === activeBase,
      builtin: true,
      deletable: false,
    });
  }
  return { dir, activePath: config.whisper.model, models: [...byName.values()] };
}

/**
 * 流式下载一个 whisper 模型到用户模型目录。
 * 进度经返回的 EventEmitter 推送：'progress'(pct 0..1) / 'done' / 'error'(msg)。
 * 写到 <name>.part，完成后原子 rename。
 */
export function downloadWhisperSpec(spec: { name: string; url: string }): EventEmitter {
  const em = new EventEmitter();
  // 防路径穿越：只取文件名，清洗非法字符，强制 .bin 后缀
  const name = basename(spec.name || '')
    .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')
    .replace(/^\.+/, '');
  const finalName = name.endsWith('.bin') ? name : `${name}.bin`;
  const url = (spec.url || '').trim();
  if (!finalName || finalName === '.bin') {
    setImmediate(() => em.emit('error', '模型名称无效'));
    return em;
  }
  if (!/^https?:\/\//i.test(url)) {
    setImmediate(() => em.emit('error', 'URL 必须是 http(s) 地址'));
    return em;
  }

  const dir = userModelsDir();
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${finalName}.part`);
  const final = join(dir, finalName);
  void (async () => {
    try {
      const res = await fetch(url, { redirect: 'follow' });
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
      em.emit('done', { name: finalName });
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

/** 按档位名下载（路由 /download 用）。 */
export function downloadWhisper(name: string): EventEmitter {
  const spec = WHISPER_MODELS.find((m) => m.name === name);
  if (!spec) {
    const em = new EventEmitter();
    setImmediate(() => em.emit('error', `未知模型：${name}`));
    return em;
  }
  return downloadWhisperSpec({ name: spec.name, url: spec.url });
}

/** 删除一个 whisper 模型（仅限用户目录中的文件；内置/当前激活禁删）。 */
export function deleteWhisper(name: string): void {
  const file = join(userModelsDir(), basename(name));
  if (!existsSync(file)) {
    if (BUNDLED_MODELS_DIR && existsSync(join(BUNDLED_MODELS_DIR, basename(name)))) {
      throw new Error('内置模型不可删除');
    }
    throw new Error(`模型未安装：${name}`);
  }
  const activeBase = basename(config.whisper.model);
  if (basename(name) === activeBase) throw new Error('不能删除当前使用的模型，请先切换');
  rmSync(file, { force: true });
}

/** 运行时切换 whisper 模型（按名查找：用户目录优先，其次内置目录），下次转写即时生效。 */
export function applyWhisperModel(name: string): void {
  const base = basename(name);
  const userFile = join(userModelsDir(), base);
  const bundledFile = BUNDLED_MODELS_DIR ? join(BUNDLED_MODELS_DIR, base) : '';
  if (existsSync(userFile)) {
    config.whisper.model = userFile;
    return;
  }
  if (bundledFile && existsSync(bundledFile)) {
    config.whisper.model = bundledFile;
    return;
  }
  throw new Error(`模型未安装：${name}`);
}

/** 仅供 /health 或调试：模型目录占用大小。 */
export function whisperDirSize(): number {
  try {
    return statSync(userModelsDir()).size;
  } catch {
    return 0;
  }
}
