import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { newId } from '../util/id.js';

export interface LlmPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings {
  activePresetId: string | null;
  presets: LlmPreset[];
}

const settingsPath = join(config.dataDir, 'settings.json');

/** 用当前 config.llm 造一个默认预设，首次开箱即用。 */
function defaultSettings(): Settings {
  const preset: LlmPreset = {
    id: newId(),
    name: '默认',
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    model: config.llm.model,
  };
  return { activePresetId: preset.id, presets: [preset] };
}

export function getSettings(): Settings {
  try {
    if (!existsSync(settingsPath)) {
      const d = defaultSettings();
      saveSettings(d);
      return d;
    }
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<Settings>;
    return {
      activePresetId: parsed.activePresetId ?? null,
      presets: Array.isArray(parsed.presets) ? (parsed.presets as LlmPreset[]) : [],
    };
  } catch {
    return { activePresetId: null, presets: [] };
  }
}

function isPreset(p: unknown): p is LlmPreset {
  const x = p as Partial<LlmPreset>;
  return (
    !!x &&
    typeof x.name === 'string' &&
    typeof x.baseUrl === 'string' &&
    typeof x.model === 'string' &&
    typeof x.apiKey === 'string'
  );
}

/** 校验 + 清洗后原子写盘；返回清洗后的 settings。 */
export function saveSettings(s: Settings): Settings {
  const presets: LlmPreset[] = [];
  for (const p of s.presets) {
    if (!isPreset(p)) throw new Error('预设字段缺失或类型错误（需 name/baseUrl/model）');
    presets.push({
      id: p.id || newId(),
      name: p.name.trim(),
      baseUrl: p.baseUrl.trim(),
      apiKey: (p.apiKey ?? '').trim(),
      model: p.model.trim(),
    });
  }
  const cleaned: Settings = {
    activePresetId: presets.some((p) => p.id === s.activePresetId) ? s.activePresetId : null,
    presets,
  };
  mkdirSync(config.dataDir, { recursive: true });
  const tmp = `${settingsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(cleaned, null, 2));
  renameSync(tmp, settingsPath);
  return cleaned;
}

/** 把预设应用到运行时 config.llm（所有摘要调用动态读取，即时生效）。
 *  增量摘要模型跟随主模型，确保切换 provider 后实时增量摘要也走对端点。 */
export function applyPreset(p: LlmPreset): void {
  config.llm.baseUrl = p.baseUrl.replace(/\/+$/, '');
  config.llm.apiKey = p.apiKey;
  config.llm.model = p.model;
  config.llm.incrementalModel = p.model;
}

/** 启动时调用：读 settings，应用激活预设到 config.llm。 */
export function init(): void {
  const s = getSettings();
  const active = s.presets.find((p) => p.id === s.activePresetId);
  if (active) applyPreset(active);
}
