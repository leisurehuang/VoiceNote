import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, type TranscriptionEngine } from '../config.js';
import { newId } from '../util/id.js';

export interface LlmPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** sherpa 引擎的高级参数（运行时同步到 config.sherpa）。 */
export interface SherpaSettings {
  /** 已知说话人数（>0 时优先用，走 --clustering.num-clusters）；null 自动聚类。 */
  numSpeakers?: number | null;
  /** 未知人数时的聚类阈值（默认 0.90）。 */
  clusterThreshold?: number;
}

export interface Settings {
  activePresetId: string | null;
  presets: LlmPreset[];
  /** 专有名词术语表，转写/整理时注入 prompt 偏置。 */
  glossary: string[];
  /** 当前激活的转写引擎；旧 settings.json 无此字段 → fallback 'whisper'（fail-open）。 */
  transcriptionEngine: TranscriptionEngine;
  /** sherpa 引擎高级参数（仅 engine==='sherpa' 时生效）。 */
  sherpa: SherpaSettings;
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
  return { activePresetId: preset.id, presets: [preset], glossary: [], transcriptionEngine: 'whisper', sherpa: {} };
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
      glossary: Array.isArray(parsed.glossary) ? (parsed.glossary as string[]) : [],
      transcriptionEngine: parsed.transcriptionEngine === 'sherpa' ? 'sherpa' : 'whisper',
      sherpa: {
        numSpeakers:
          typeof parsed.sherpa?.numSpeakers === 'number' && (parsed.sherpa.numSpeakers as number) > 0
            ? parsed.sherpa.numSpeakers
            : null,
        clusterThreshold:
          typeof parsed.sherpa?.clusterThreshold === 'number'
            ? parsed.sherpa.clusterThreshold
            : config.sherpa.clusterThreshold,
      },
    };
  } catch {
    return { activePresetId: null, presets: [], glossary: [], transcriptionEngine: 'whisper', sherpa: {} };
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
  const glossary = Array.isArray(s.glossary)
    ? [...new Set(s.glossary.map((t) => String(t).trim()).filter(Boolean))]
    : [];
  const cleaned: Settings = {
    activePresetId: presets.some((p) => p.id === s.activePresetId) ? s.activePresetId : null,
    presets,
    glossary,
    transcriptionEngine: s.transcriptionEngine === 'sherpa' ? 'sherpa' : 'whisper',
    sherpa: {
      numSpeakers:
        typeof s.sherpa?.numSpeakers === 'number' && (s.sherpa.numSpeakers as number) > 0
          ? s.sherpa.numSpeakers
          : null,
      clusterThreshold:
        typeof s.sherpa?.clusterThreshold === 'number'
          ? s.sherpa.clusterThreshold
          : config.sherpa.clusterThreshold,
    },
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

/** 把术语表同步到运行时 config.whisper.glossary（whisper/摘要 prompt 注入用）。 */
export function applyGlossary(terms: string[]): void {
  config.whisper.glossary = terms;
}

/** 切换激活的转写引擎到运行时 config.transcription.engine（即时生效，无需重启）。 */
export function applyTranscriptionEngine(engine: TranscriptionEngine): void {
  config.transcription.engine = engine;
}

/** 把 sherpa 高级参数同步到运行时 config.sherpa。 */
export function applySherpaSettings(s: SherpaSettings): void {
  config.sherpa.numSpeakers =
    typeof s.numSpeakers === 'number' && s.numSpeakers > 0 ? s.numSpeakers : null;
  if (typeof s.clusterThreshold === 'number') config.sherpa.clusterThreshold = s.clusterThreshold;
}

/** 启动时调用：读 settings，应用激活预设到 config.llm。 */
export function init(): void {
  const s = getSettings();
  const active = s.presets.find((p) => p.id === s.activePresetId);
  if (active) applyPreset(active);
  applyGlossary(s.glossary);
  applyTranscriptionEngine(s.transcriptionEngine);
  applySherpaSettings(s.sherpa);
}
