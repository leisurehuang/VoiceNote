import { useEffect, useState } from 'react';
import { getSettings, testConnection, updateSettings } from '../api/client';
import type { LlmPreset, Settings } from '../api/types';
import { ModelManager } from './ModelManager';

const EMPTY: LlmPreset = { id: '', name: '', baseUrl: '', apiKey: '', model: '' };

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<LlmPreset | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [glossaryDraft, setGlossaryDraft] = useState('');
  const [tab, setTab] = useState<'models' | 'glossary'>('models');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
  }, []);

  // 术语表回显到编辑框（settings 加载 / 变更时同步）
  useEffect(() => {
    if (settings) setGlossaryDraft(settings.glossary?.join('\n') ?? '');
  }, [settings]);

  async function persist(next: Settings) {
    try {
      setSettings(await updateSettings(next));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    }
  }

  function saveGlossary() {
    if (!settings) return;
    const glossary = glossaryDraft
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);
    void persist({ ...settings, glossary });
  }

  function activate(id: string) {
    if (settings) persist({ ...settings, activePresetId: id });
  }

  function remove(id: string) {
    if (!settings) return;
    persist({
      activePresetId: settings.activePresetId === id ? null : settings.activePresetId,
      presets: settings.presets.filter((p) => p.id !== id),
    });
  }

  function saveEdit() {
    if (!settings || !editing) return;
    if (!editing.name.trim() || !editing.baseUrl.trim() || !editing.model.trim()) {
      setErr('名称、Base URL、模型不能为空');
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
    void persist(next);
  }

  async function doTest() {
    if (!editing) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnection({ baseUrl: editing.baseUrl, apiKey: editing.apiKey }));
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : '请求失败' });
    }
    setTesting(false);
  }

  return (
    <div className="content settings">
      <section className="block">
        <div className="segmented settings-tabs">
          <button
            className={tab === 'models' ? 'seg active' : 'seg'}
            onClick={() => setTab('models')}
          >
            模型配置
          </button>
          <button
            className={tab === 'glossary' ? 'seg active' : 'seg'}
            onClick={() => setTab('glossary')}
          >
            术语表
          </button>
        </div>
        {err && <div className="alert err">{err}</div>}

        {/* 模型配置：预设管理 + whisper/ollama 模型管理。两 pane 常驻 DOM（display 切换）保留下载进度 */}
        <div className={tab === 'models' ? '' : 'hidden'}>
          {!settings ? (
            <p className="muted">加载中…</p>
          ) : (
            <>
              <p className="muted">
                配置整理总结用的模型，支持本地 Ollama 或任意 OpenAI Chat 兼容 API。<b>激活的预设</b>对所有整理总结生效。
              </p>
              <div className="preset-list">
                {settings.presets.length === 0 && <p className="muted">尚无预设，点下方「新增」添加。</p>}
                {settings.presets.map((p) => (
                  <div
                    key={p.id}
                    className={'preset-item' + (p.id === settings.activePresetId ? ' preset-active' : '')}
                  >
                    <div className="preset-info">
                      <b>{p.name || '未命名'}</b>
                      <span className="muted">
                        {p.model} · {p.baseUrl}
                      </span>
                      {p.id === settings.activePresetId && <span className="preset-badge">● 使用中</span>}
                    </div>
                    <div className="preset-actions">
                      {p.id !== settings.activePresetId && (
                        <button className="ghost" onClick={() => activate(p.id)}>
                          设为激活
                        </button>
                      )}
                      <button
                        className="ghost"
                        onClick={() => {
                          setEditing({ ...p });
                          setTestResult(null);
                        }}
                      >
                        编辑
                      </button>
                      <button className="ghost" onClick={() => remove(p.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button className="big" onClick={() => { setEditing({ ...EMPTY }); setTestResult(null); }}>
                ＋ 新增预设
              </button>

              {editing && (
                <div className="settings-form">
                  <h4>{settings.presets.some((p) => p.id === editing.id) ? '编辑预设' : '新增预设'}</h4>
                  <label>名称</label>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="如：本地 Ollama / OpenAI"
                  />
                  <label>Base URL</label>
                  <input
                    value={editing.baseUrl}
                    onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
                    placeholder="http://localhost:11434/v1 或 https://api.openai.com/v1"
                  />
                  <label>API Key</label>
                  <div className="key-row">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={editing.apiKey}
                      onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                      placeholder="Ollama 填 ollama；OpenAI 填 sk-..."
                    />
                    <button
                      type="button"
                      className="ghost key-toggle"
                      onClick={() => setShowKey((v) => !v)}
                      title={showKey ? '隐藏' : '显示'}
                    >
                      {showKey ? '🙈' : '👁'}
                    </button>
                  </div>
                  <label>模型</label>
                  <input
                    value={editing.model}
                    onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                    placeholder="如 qwen2.5:7b-instruct / gpt-4o-mini"
                  />
                  {testResult && (
                    <div className={'alert ' + (testResult.ok ? 'ok' : 'err')}>
                      {testResult.ok ? '✓ 连接成功' : '连接失败：' + (testResult.error ?? '未知错误')}
                    </div>
                  )}
                  <div className="rec-controls">
                    <button className="ghost" onClick={doTest} disabled={testing || !editing.baseUrl.trim()}>
                      {testing ? '测试中…' : '测试连接'}
                    </button>
                    <button className="big" onClick={saveEdit}>
                      保存
                    </button>
                    <button
                      className="ghost"
                      onClick={() => {
                        setEditing(null);
                        setTestResult(null);
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              <ModelManager activePresetId={settings.activePresetId ?? undefined} />
            </>
          )}
        </div>

        {/* 术语表 */}
        <div className={tab === 'glossary' ? '' : 'hidden'}>
          {!settings ? (
            <p className="muted">加载中…</p>
          ) : (
            <div className="glossary-box">
              <h4 className="block-h">📖 术语表</h4>
              <p className="muted">
                专有名词 / 人名 / 公司名，每行一个。转写与整理时自动偏置，提升识别准确率。
              </p>
              <textarea
                className="glossary-edit"
                value={glossaryDraft}
                onChange={(e) => setGlossaryDraft(e.target.value)}
                rows={8}
                placeholder={'例如：\n鸿蒙\n信创\nPaaS'}
              />
              <div className="rec-controls">
                <button className="ghost" onClick={saveGlossary}>
                  保存术语表
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="muted settings-version">Voice Notes v{__APP_VERSION__}</p>
      </section>
    </div>
  );
}
