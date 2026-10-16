/**
 * AI 整理（LLM）设置 tab：整理模型预设列表 + 固定位置的编辑表单（显式保存）+
 * 本地 Ollama 模型管理（激活预设指向本地时显示）。
 * 激活预设用于：会议摘要、实时增量摘要、语音听写润色。
 */

import { useRef, useState } from 'react';
import { Bot, Eye, EyeOff, Plus } from 'lucide-react';
import { testConnection } from '../api/client';
import type { LlmPreset, Settings } from '../api/types';
import { OllamaModels } from './OllamaModels';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Field, Input } from './ui/Field';
import { IconButton } from './ui/IconButton';
import { toast, toastError } from './ui/Toast';

const EMPTY: LlmPreset = { id: '', name: '', baseUrl: '', apiKey: '', model: '', incrementalModel: '' };

export function LlmSettings({
  settings,
  persist,
}: {
  settings: Settings;
  persist: (next: Settings) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<LlmPreset | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; warning?: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  function activate(id: string) {
    if (settings.activePresetId === id) return;
    void persist({ ...settings, activePresetId: id }).then((ok) => {
      if (ok) toast('已切换激活预设');
      else toastError('切换失败，请检查后端连接');
    });
  }

  function remove(id: string) {
    void persist({
      ...settings,
      activePresetId: settings.activePresetId === id ? null : settings.activePresetId,
      presets: settings.presets.filter((p) => p.id !== id),
    }).then((ok) => {
      if (ok) toast('预设已删除');
      else toastError('删除失败，请检查后端连接');
    });
  }

  function openForm(p: LlmPreset) {
    setEditing({ ...p });
    setTestResult(null);
    // 编辑区固定在列表下方，展开后滚入视野，避免「点了编辑却看不到表单」
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  function saveEdit() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.baseUrl.trim() || !editing.model.trim()) {
      setTestResult({ ok: false, error: '名称、Base URL、模型不能为空' });
      return;
    }
    const id =
      editing.id ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36));
    const exists = settings.presets.some((p) => p.id === editing.id);
    const presets = exists
      ? settings.presets.map((p) => (p.id === editing.id ? { ...editing, id } : p))
      : [...settings.presets, { ...editing, id }];
    const next: Settings = { ...settings, presets };
    if (!next.activePresetId && presets.length === 1) next.activePresetId = id; // 首个预设自动激活
    setEditing(null);
    setTestResult(null);
    void persist(next).then((ok) => {
      if (ok) toast('预设已保存');
      else toastError('保存失败，请检查后端连接');
    });
  }

  async function doTest() {
    if (!editing) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(
        await testConnection({ baseUrl: editing.baseUrl, apiKey: editing.apiKey, model: editing.model }),
      );
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : '请求失败' });
    }
    setTesting(false);
  }

  return (
    <div className="llm-settings">
      <h4 className="block-h">
        <Bot size={13} aria-hidden />
        文字 → 摘要（AI 整理模型）
      </h4>
      <p className="muted">
        支持本地 Ollama 或任意 OpenAI Chat 兼容 API。<b>激活的预设</b>对会议摘要、实时增量摘要、
        语音听写润色全部生效。点「设为激活」即时切换。
      </p>

      <div className="preset-list">
        {settings.presets.length === 0 && <p className="muted">尚无预设，点下方「新增预设」添加。</p>}
        {settings.presets.map((p) => (
          <div key={p.id} className={'preset-item' + (p.id === settings.activePresetId ? ' preset-active' : '')}>
            <div className="preset-info">
              <b>{p.name || '未命名'}</b>
              <span className="muted">
                {p.model} · {p.baseUrl}
              </span>
              {p.id === settings.activePresetId && <Badge tone="accent">使用中</Badge>}
            </div>
            <div className="preset-actions">
              {p.id !== settings.activePresetId && (
                <Button variant="ghost" size="sm" onClick={() => activate(p.id)}>
                  设为激活
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => openForm(p)}>
                编辑
              </Button>
              <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
                删除
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* 编辑区固定在列表下方（新增/编辑共用），不再插入列表中间 */}
      <div className="settings-form" ref={formRef}>
        {editing ? (
          <>
            <h4>{settings.presets.some((p) => p.id === editing.id) ? '编辑预设' : '新增预设'}</h4>
            <Field label="名称">
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="如：本地 Ollama / OpenAI"
              />
            </Field>
            <Field label="Base URL">
              <Input
                value={editing.baseUrl}
                onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                placeholder="http://localhost:11434/v1 或 https://api.openai.com/v1"
              />
            </Field>
            <Field label="API Key">
              <div className="key-row">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={editing.apiKey}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                  placeholder="Ollama 填 ollama；OpenAI 填 sk-..."
                />
                <IconButton
                  size="sm"
                  className="key-toggle"
                  label={showKey ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </IconButton>
              </div>
            </Field>
            <Field label="模型">
              <Input
                value={editing.model}
                onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                placeholder="如 qwen2.5:7b-instruct / gpt-4o-mini"
              />
            </Field>
            <Field label="增量摘要模型（可选，留空跟随主模型）" help="实时转写时滚动摘要用，小快模型更跟手">
              <Input
                value={editing.incrementalModel ?? ''}
                onChange={(e) => setEditing({ ...editing, incrementalModel: e.target.value })}
                placeholder="如 qwen2.5:3b"
              />
            </Field>
            {testResult && (
              <div className={'alert ' + (testResult.ok ? 'ok' : 'err')}>
                {testResult.ok ? '✓ 连接成功' : '连接失败：' + (testResult.error ?? '未知错误')}
                {testResult.warning && <div>{testResult.warning}</div>}
              </div>
            )}
            <div className="rec-controls">
              <Button variant="ghost" onClick={() => void doTest()} disabled={testing || !editing.baseUrl.trim()}>
                {testing ? '测试中…' : '测试连接'}
              </Button>
              <Button variant="primary" onClick={saveEdit}>
                保存
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setTestResult(null);
                }}
              >
                取消
              </Button>
            </div>
          </>
        ) : (
          <Button variant="primary" onClick={() => openForm({ ...EMPTY })}>
            <Plus size={14} aria-hidden />
            新增预设
          </Button>
        )}
      </div>

      <OllamaModels activePresetId={settings.activePresetId ?? undefined} />
    </div>
  );
}
