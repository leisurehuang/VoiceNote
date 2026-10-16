/**
 * 语音输入（全局听写）一级页面：独立功能入口（侧栏直达），不隶属设置页。
 * 快捷键/润色/翻译口令/术语纠错 + 听写历史。
 * 桌面端（Electron）下快捷键生效；Web 部署下仅能管理纠错表与历史。
 */

import { useEffect, useState } from 'react';
import { History, Mic, Plus } from 'lucide-react';
import {
  clearDictationHistory,
  deleteDictationHistory,
  getDictationHistory,
  getSettings,
  updateSettings,
} from '../api/client';
import type { DictationHistoryEntry, DictationSettings, Settings, TermCorrection } from '../api/types';
import { fmtDate } from '../format';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { EmptyState } from './ui/EmptyState';
import { Field, Input, Select } from './ui/Field';
import { ListSkeleton, SettingsSkeleton } from './ui/Skeleton';
import { Switch } from './ui/Switch';
import { toast, toastError } from './ui/Toast';

/** 输出语言选项（与后端 outputLanguage.ts 的 BUILTIN_LANGUAGES 对应）。 */
const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: '英文' },
  { code: 'ja', label: '日文' },
  { code: 'ko', label: '韩文' },
  { code: 'zh', label: '中文' },
  { code: 'fr', label: '法文' },
  { code: 'de', label: '德文' },
  { code: 'es', label: '西班牙文' },
];

const DEFAULT_DICTATION: DictationSettings = {
  enabled: true,
  shortcut: 'Ctrl+Alt+D',
  cancelShortcut: 'Escape',
  polish: true,
  translationCommands: true,
  fixedOutputLanguage: undefined,
  termCorrections: [],
  historyLimit: 500,
};

/** accelerator 宽松校验：修饰键(+修饰键)*+主键。 */
function isValidAccelerator(acc: string): boolean {
  const mods = ['Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'];
  const keys = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Tab|CapsLock|NumLock|ScrollLock|Home|End|PageUp|PageDown|Left|Right|Up|Down|Plus|Minus|Escape|Backspace|Delete|Insert|`|\/|\\|\[|\]|;|'|,|\.|\/)$/;
  const parts = acc.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1] ?? '';
  if (!keys.test(last)) return false;
  return parts.slice(0, -1).every((p) => mods.includes(p));
}

/** 语音输入页：自加载 settings（独立页面，不经设置页）。 */
export function DictationView() {
  const isDesktop = !!window.electron?.isDesktop;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<DictationSettings>(DEFAULT_DICTATION);
  const [history, setHistory] = useState<DictationHistoryEntry[] | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    getSettings()
      .then((s) => {
        setSettings(s);
        if (s.dictation) setDraft(s.dictation);
      })
      .catch(() => {
        /* 页面内各保存操作会暴露错误 */
      });
  }, []);

  async function persist(next: Settings): Promise<boolean> {
    try {
      setSettings(await updateSettings(next));
      return true;
    } catch {
      return false;
    }
  }

  async function refreshHistory() {
    setHistErr(null);
    try {
      setHistory(await getDictationHistory(100));
    } catch (e) {
      setHistErr(e instanceof Error ? e.message : '加载历史失败');
    }
  }

  useEffect(() => {
    void refreshHistory();
  }, []);

  function patch(p: Partial<DictationSettings>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function patchCorrection(idx: number, p: Partial<TermCorrection>) {
    setDraft((d) => ({
      ...d,
      termCorrections: d.termCorrections.map((c, i) => (i === idx ? { ...c, ...p } : c)),
    }));
  }

  async function save() {
    if (!settings || saving) return;
    setSaving(true);
    const cleaned: DictationSettings = {
      ...draft,
      shortcut: draft.shortcut.trim() || DEFAULT_DICTATION.shortcut,
      termCorrections: draft.termCorrections
        .map((c) => ({
          target: c.target.trim(),
          variants: c.variants.map((v) => v.trim()).filter(Boolean),
        }))
        .filter((c) => c.target),
    };
    const ok = await persist({ ...settings, dictation: cleaned });
    setSaving(false);
    if (ok) {
      // 通知桌面端热重载全局快捷键
      window.electron?.dictationSettingsChanged?.();
      setDraft(cleaned);
      toast('已保存并刷新快捷键');
    } else {
      toastError('保存失败，请检查后端连接');
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板');
    } catch {
      toastError('复制失败，请检查剪贴板权限');
    }
  }

  async function removeEntry(id: string) {
    try {
      await deleteDictationHistory(id);
      setHistory((h) => (h ? h.filter((e) => e.id !== id) : h));
    } catch (e) {
      setHistErr(e instanceof Error ? e.message : '删除失败');
    }
  }

  async function clearAll() {
    setClearing(true);
    try {
      await clearDictationHistory();
      setHistory([]);
      setConfirmClear(false);
      toast('听写历史已清空');
    } catch (e) {
      setHistErr(e instanceof Error ? e.message : '清空失败');
    } finally {
      setClearing(false);
    }
  }

  const shortcutInvalid = draft.shortcut.trim() !== '' && !isValidAccelerator(draft.shortcut.trim());
  if (!settings) {
    return (
      <div className="content">
        <SettingsSkeleton />
      </div>
    );
  }

  return (
    <div className="dictation-settings">
      <h4 className="block-h">
        <Mic size={13} aria-hidden />
        语音输入
      </h4>
      <p className="muted">
        在任意应用里按全局快捷键说话：再按一下结束，识别并用 AI 整理后自动粘贴到当前光标处；
        录音中按 Esc 取消。识别用「设置 → 语音转文字」选定的引擎，整理用「设置 → AI 整理」激活的预设。
      </p>
      {!isDesktop && (
        <div className="alert err">全局听写快捷键仅桌面版（Windows / Linux / macOS）可用；网页版可继续管理术语纠错与历史。</div>
      )}

      {/* —— 卡片一:基本设置 —— */}
      <div className="card">
        <h3>基本设置</h3>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-title">启用全局听写</span>
            <span className="setting-desc">关闭后快捷键不再触发听写</span>
          </div>
          <Switch checked={draft.enabled} onChange={(v) => patch({ enabled: v })} label="启用全局听写" />
        </div>

        <Field
          label="快捷键（切换式：按一下开始，再按结束）"
          error={shortcutInvalid ? '格式无效：需「修饰键+主键」，例如 Ctrl+Alt+D、CmdOrCtrl+Shift+Space' : undefined}
        >
          <Input
            value={draft.shortcut}
            onChange={(e) => patch({ shortcut: e.target.value })}
            placeholder="Ctrl+Alt+D（修饰键+主键，如 CmdOrCtrl+Shift+Space）"
            aria-invalid={shortcutInvalid}
          />
        </Field>

        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-title">用 AI 整理口语</span>
            <span className="setting-desc">去语气词、理顺句子、加标点；关闭后直接输入识别原文</span>
          </div>
          <Switch checked={draft.polish} onChange={(v) => patch({ polish: v })} label="用 AI 整理口语" />
        </div>

        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-title">语音翻译口令</span>
            <span className="setting-desc">句首或句尾说「用英文」「翻译成日语」等，输出直接翻译</span>
          </div>
          <Switch checked={draft.translationCommands} onChange={(v) => patch({ translationCommands: v })} label="语音翻译口令" />
        </div>

        <Field label="固定输出语言（可选：不喊口令也总是翻译）">
          <Select
            value={draft.fixedOutputLanguage ?? ''}
            onChange={(e) => patch({ fixedOutputLanguage: e.target.value || undefined })}
          >
            <option value="">不固定（跟随说话语言）</option>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="rec-controls card-actions">
          <Button variant="primary" loading={saving} onClick={() => void save()} disabled={shortcutInvalid}>
            保存设置
          </Button>
        </div>
      </div>

      {/* —— 卡片二:术语纠错 —— */}
      <div className="card">
        <h3>术语纠错</h3>
        <p className="muted card-desc">
          识别常错的名字/词：填「正写」与一个或多个「误写」（英文误写整词匹配）。听写输出前自动替换。
        </p>
        {draft.termCorrections.map((c, i) => (
          <div className="dict-correction-row" key={i}>
            <Input
              className="cor-target"
              value={c.target}
              onChange={(e) => patchCorrection(i, { target: e.target.value })}
              placeholder="正写，如 通义千问"
            />
            <span className="muted">←</span>
            <Input
              className="cor-variants"
              value={c.variants.join('、')}
              onChange={(e) =>
                patchCorrection(i, { variants: e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) })
              }
              placeholder="误写（、分隔），如 同义千问、通译千问"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patch({ termCorrections: draft.termCorrections.filter((_, j) => j !== i) })}
            >
              删除
            </Button>
          </div>
        ))}
        <div className="rec-controls card-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => patch({ termCorrections: [...draft.termCorrections, { target: '', variants: [] }] })}
          >
            <Plus size={13} aria-hidden />
            添加纠错
          </Button>
          {draft.termCorrections.length > 0 && (
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              保存纠错表
            </Button>
          )}
        </div>
      </div>

      {/* —— 卡片三:听写历史 —— */}
      <div className="card">
        <h3>听写历史（本机保存）</h3>
        {histErr && <div className="alert err">{histErr}</div>}
        {history === null ? (
          <ListSkeleton rows={3} />
        ) : history.length === 0 ? (
          <EmptyState icon={History} title="暂无听写记录" hint="在任意应用里按下全局快捷键开始第一句听写" />
        ) : (
          <>
            <div className="dict-hist-list">
              {history.map((e) => (
                <div className="dict-hist-item" key={e.id}>
                  <div className="dict-hist-main">
                    <div className="dict-hist-text">{e.text}</div>
                    {e.transcript && e.transcript !== e.text && (
                      <div className="muted dict-hist-raw">原文：{e.transcript}</div>
                    )}
                    <div className="muted dict-hist-meta">
                      {fmtDate(e.time)}
                      {e.targetLanguage ? ` · 译为${LANGUAGES.find((l) => l.code === e.targetLanguage)?.label ?? e.targetLanguage}` : ''}
                      {` · ${Math.round(e.durationMs / 1000)}s`}
                    </div>
                  </div>
                  <div className="preset-actions">
                    <Button variant="ghost" size="sm" onClick={() => void copyText(e.text)}>
                      复制
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void removeEntry(e.id)}>
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="rec-controls card-actions">
              <Button variant="ghost" size="sm" onClick={() => void refreshHistory()}>
                刷新
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
                清空全部
              </Button>
            </div>
          </>
        )}
      </div>

      <p className="muted">
        平台提示：macOS 首次使用需授予麦克风与辅助功能（模拟 ⌘V）权限；Linux 建议安装 xdotool（Wayland
        下自动降级为复制到剪贴板）；Windows 少数管理员窗口会拒绝自动粘贴，此时内容已在剪贴板。
      </p>

      <ConfirmDialog
        open={confirmClear}
        title="清空听写历史？"
        message="全部听写记录将被永久删除，无法恢复。"
        confirmText="清空"
        loading={clearing}
        onConfirm={() => void clearAll()}
        onClose={() => {
          if (!clearing) setConfirmClear(false);
        }}
      />
    </div>
  );
}
