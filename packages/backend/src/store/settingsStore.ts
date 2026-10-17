import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, type AsrApiConfig, type TranscriptionEngine } from '../config.js';
import { newId } from '../util/id.js';

export interface LlmPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 实时增量摘要模型；留空跟随主模型（选小快模型可降低首字延迟）。 */
  incrementalModel?: string;
}

/** sherpa 引擎的高级参数（运行时同步到 config.sherpa）。 */
export interface SherpaSettings {
  /** 已知说话人数（>0 时优先用，走 --clustering.num-clusters）；null 自动聚类。 */
  numSpeakers?: number | null;
  /** 未知人数时的聚类阈值（默认 0.90）。 */
  clusterThreshold?: number;
}

/** 云端转写 API（engine==='api' 时启用；OpenAI 兼容 /audio/transcriptions 形态）。 */
export type AsrApiSettings = AsrApiConfig;

/** 术语纠错条目：误写命中 → 替换为正写（听写输出前生效）。 */
export interface TermCorrection {
  target: string;
  variants: string[];
}

/** 长按单键触发听写（桌面端全局键盘事件监听；macOS 需辅助功能权限）。 */
export interface DictationHoldSettings {
  enabled: boolean;
  /** uiohook 键名（CtrlRight/AltRight/MetaRight/F6/F7/F8）。 */
  key: string;
  /** ptt=按住说话（按住 ≥300ms 开始，松开结束出字）；toggle=长按切换（≥600ms，与组合键行为一致）。 */
  mode: 'ptt' | 'toggle';
}

/** 语音听写（桌面端全局快捷键 → 录音 → 润色 → 粘贴）配置。 */
export interface DictationSettings {
  /** 总开关：false 时桌面端不注册全局快捷键。 */
  enabled: boolean;
  /** Electron accelerator，如 'Ctrl+Alt+D'；切换式（按一下开始，再按结束）。 */
  shortcut: string;
  /** 录音期间的取消键（仅录音中临时注册）。 */
  cancelShortcut: string;
  /** 长按单键触发（与组合键快捷键并存，任一触发均可）。 */
  hold: DictationHoldSettings;
  /** 是否用激活的 LLM 预设润色；false 直接输出识别原文。 */
  polish: boolean;
  /** 是否启用句首/句尾翻译口令（「用英文」等）。 */
  translationCommands: boolean;
  /** 固定输出语言代码（outputLanguage.ts 的 code）；不固定留空。 */
  fixedOutputLanguage?: string;
  /** 术语纠错表。 */
  termCorrections: TermCorrection[];
  /** 历史保留条数。 */
  historyLimit: number;
}

export const DEFAULT_DICTATION_SHORTCUT = 'Ctrl+Alt+D';
export const DEFAULT_DICTATION_CANCEL_SHORTCUT = 'Escape';

/** 长按键白名单：均为单独按下无副作用（或副作用可忽略）的键，避免劫持日常输入。 */
const HOLD_KEYS: readonly string[] = ['CtrlRight', 'AltRight', 'MetaRight', 'F6', 'F7', 'F8'];

const ENGINE_VALUES: readonly TranscriptionEngine[] = ['whisper', 'sherpa', 'api'];

function parseEngine(v: unknown): TranscriptionEngine {
  return ENGINE_VALUES.includes(v as TranscriptionEngine) ? (v as TranscriptionEngine) : 'whisper';
}

function parseAsrApi(v: unknown): AsrApiSettings {
  const x = (v ?? {}) as Partial<AsrApiConfig>;
  return {
    baseUrl: typeof x.baseUrl === 'string' ? x.baseUrl : config.asrApi.baseUrl,
    apiKey: typeof x.apiKey === 'string' ? x.apiKey : config.asrApi.apiKey,
    model: typeof x.model === 'string' ? x.model : config.asrApi.model,
  };
}

/** 听写配置解析：老 settings.json 无 dictation 字段 → 全默认（fail-open）。 */
function parseDictation(v: unknown): DictationSettings {
  const x = (v ?? {}) as Partial<DictationSettings>;
  const corrections: TermCorrection[] = Array.isArray(x.termCorrections)
    ? x.termCorrections
        .map((c) => c as Partial<TermCorrection>)
        .filter((c) => typeof c.target === 'string' && c.target.trim())
        .map((c) => ({
          target: String(c.target).trim(),
          variants: Array.isArray(c.variants)
            ? c.variants.map((s) => String(s).trim()).filter(Boolean)
            : [],
        }))
        .filter((c) => c.target)
    : [];
  const limit =
    typeof x.historyLimit === 'number' && x.historyLimit > 0 ? Math.floor(x.historyLimit) : 500;
  return {
    enabled: x.enabled !== false,
    shortcut:
      typeof x.shortcut === 'string' && x.shortcut.trim()
        ? x.shortcut.trim()
        : DEFAULT_DICTATION_SHORTCUT,
    cancelShortcut:
      typeof x.cancelShortcut === 'string' && x.cancelShortcut.trim()
        ? x.cancelShortcut.trim()
        : DEFAULT_DICTATION_CANCEL_SHORTCUT,
    hold: {
      enabled: x.hold?.enabled === true,
      key:
        typeof x.hold?.key === 'string' && HOLD_KEYS.includes(x.hold.key)
          ? x.hold.key
          : 'CtrlRight',
      mode: x.hold?.mode === 'toggle' ? 'toggle' : 'ptt',
    },
    polish: x.polish !== false,
    translationCommands: x.translationCommands !== false,
    fixedOutputLanguage:
      typeof x.fixedOutputLanguage === 'string' && x.fixedOutputLanguage
        ? x.fixedOutputLanguage
        : undefined,
    termCorrections: corrections,
    historyLimit: Math.min(Math.max(limit, 50), 5000),
  };
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
  /** 当前激活 whisper 模型文件的绝对路径（用户切换/自定义后持久化，重启保持）。 */
  whisperModelPath?: string;
  /** 云端转写 API 配置（engine==='api' 时生效）。 */
  asrApi: AsrApiSettings;
  /** 语音听写配置（桌面端读；Web 端仅展示/编辑）。 */
  dictation: DictationSettings;
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
  return {
    activePresetId: preset.id,
    presets: [preset],
    glossary: [],
    transcriptionEngine: 'whisper',
    sherpa: {},
    asrApi: parseAsrApi(undefined),
    dictation: parseDictation(undefined),
  };
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
      transcriptionEngine: parseEngine(parsed.transcriptionEngine),
      whisperModelPath:
        typeof parsed.whisperModelPath === 'string' ? parsed.whisperModelPath : undefined,
      asrApi: parseAsrApi(parsed.asrApi),
      dictation: parseDictation(parsed.dictation),
      sherpa: {
        numSpeakers:
          typeof parsed.sherpa?.numSpeakers === 'number' &&
          (parsed.sherpa.numSpeakers as number) > 0
            ? parsed.sherpa.numSpeakers
            : null,
        clusterThreshold:
          typeof parsed.sherpa?.clusterThreshold === 'number'
            ? parsed.sherpa.clusterThreshold
            : config.sherpa.clusterThreshold,
      },
    };
  } catch {
    return {
      activePresetId: null,
      presets: [],
      glossary: [],
      transcriptionEngine: 'whisper',
      sherpa: {},
      whisperModelPath: undefined,
      asrApi: parseAsrApi(undefined),
      dictation: parseDictation(undefined),
    };
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
      incrementalModel: p.incrementalModel?.trim() || undefined,
    });
  }
  const glossary = Array.isArray(s.glossary)
    ? [...new Set(s.glossary.map((t) => String(t).trim()).filter(Boolean))]
    : [];
  const cleaned: Settings = {
    activePresetId: presets.some((p) => p.id === s.activePresetId) ? s.activePresetId : null,
    presets,
    glossary,
    transcriptionEngine: parseEngine(s.transcriptionEngine),
    whisperModelPath:
      typeof s.whisperModelPath === 'string' ? s.whisperModelPath.trim() : undefined,
    asrApi: parseAsrApi(s.asrApi),
    dictation: parseDictation(s.dictation),
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
 *  增量摘要模型若预设里单独配置则用之，否则跟随主模型。 */
export function applyPreset(p: LlmPreset): void {
  config.llm.baseUrl = p.baseUrl.replace(/\/+$/, '');
  config.llm.apiKey = p.apiKey;
  config.llm.model = p.model;
  config.llm.incrementalModel = p.incrementalModel?.trim() || p.model;
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

/** 把自定义 whisper 模型文件路径同步到运行时 config.whisper.model（文件存在才生效）。 */
export function applyWhisperModelPath(p?: string | null): boolean {
  const t = (p ?? '').trim();
  if (!t) return false;
  const abs = resolve(t);
  if (!existsSync(abs)) return false;
  config.whisper.model = abs;
  return true;
}

/** 把云端转写 API 配置同步到运行时 config.asrApi（engine==='api' 时使用）。 */
export function applyAsrApi(a: AsrApiSettings): void {
  config.asrApi = {
    baseUrl: a.baseUrl.trim(),
    apiKey: a.apiKey.trim(),
    model: a.model.trim(),
  };
}

/** 启动时调用：读 settings，应用激活预设到 config.llm、恢复激活的 whisper 模型路径与云端转写配置。 */
export function init(): void {
  const s = getSettings();
  const active = s.presets.find((p) => p.id === s.activePresetId);
  if (active) applyPreset(active);
  applyGlossary(s.glossary);
  applyTranscriptionEngine(s.transcriptionEngine);
  applySherpaSettings(s.sherpa);
  applyWhisperModelPath(s.whisperModelPath);
  applyAsrApi(s.asrApi);
}
