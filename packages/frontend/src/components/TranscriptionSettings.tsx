/**
 * 语音转文字（转写引擎）设置 tab：
 * 三张引擎卡片（点选即生效，附就绪状态徽章）+ 当前引擎对应的管理区就近展示——
 * whisper → 模型管理；sherpa → 安装/能力提示；云端 API → 连接配置表单（显式保存）。
 */

import { useEffect, useState } from 'react';
import { getHealth, testConnection } from '../api/client';
import type { HealthStatus, Settings } from '../api/types';
import { WhisperModels } from './WhisperModels';

type EngineId = 'whisper' | 'sherpa' | 'api';

interface EngineCard {
  id: EngineId;
  title: string;
  desc: string;
  badge: (h: HealthStatus | null) => { ok: boolean; label: string };
}

const ENGINES: EngineCard[] = [
  {
    id: 'whisper',
    title: 'whisper.cpp',
    desc: '本地转写，多语言，支持术语表偏置',
    badge: (h) =>
      h?.whisperCli && h?.whisperModel
        ? { ok: true, label: '✓ 就绪' }
        : { ok: false, label: '未装模型' },
  },
  {
    id: 'sherpa',
    title: 'sherpa-onnx',
    desc: '本地中文转写，可区分说话人（仅中文）',
    badge: (h) => (h?.sherpa.ok ? { ok: true, label: '✓ 就绪' } : { ok: false, label: '未安装' }),
  },
  {
    id: 'api',
    title: '☁ 云端 API',
    desc: 'OpenAI 兼容 /audio/transcriptions，无需本地模型',
    badge: (h) =>
      h?.asrApiConfigured ? { ok: true, label: '✓ 已配置' } : { ok: false, label: '未配置' },
  },
];

/** 云端转写 API 表单（表单类配置：显式保存 + 已保存反馈）。 */
function AsrApiForm({
  settings,
  persist,
}: {
  settings: Settings;
  persist: (next: Settings) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(settings.asrApi);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; warning?: string } | null>(null);
  const [savedTip, setSavedTip] = useState(false);

  // 外部 settings 变化（保存成功回写）时同步 draft
  useEffect(() => {
    setDraft(settings.asrApi);
  }, [settings.asrApi]);

  async function save() {
    const ok = await persist({ ...settings, asrApi: draft });
    if (ok) {
      setSavedTip(true);
      setTimeout(() => setSavedTip(false), 2000);
    }
  }

  return (
    <div className="settings-form">
      <h4>云端转写 API（OpenAI 兼容）</h4>
      <label>Base URL</label>
      <input
        value={draft.baseUrl}
        onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
        placeholder="https://api.siliconflow.cn/v1"
      />
      <label>API Key</label>
      <div className="key-row">
        <input
          type={showKey ? 'text' : 'password'}
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          placeholder="sk-..."
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
        value={draft.model}
        onChange={(e) => setDraft({ ...draft, model: e.target.value })}
        placeholder="FunAudioLLM/SenseVoiceSmall"
      />
      {testResult && (
        <div className={'alert ' + (testResult.ok ? 'ok' : 'err')}>
          {testResult.ok ? '✓ 连接成功' : '连接失败：' + (testResult.error ?? '未知错误')}
          {testResult.warning && <div>{testResult.warning}</div>}
        </div>
      )}
      <div className="rec-controls">
        <button
          className="ghost"
          disabled={testing || !draft.baseUrl.trim()}
          onClick={async () => {
            setTesting(true);
            setTestResult(null);
            try {
              setTestResult(await testConnection({ baseUrl: draft.baseUrl, apiKey: draft.apiKey }));
            } catch (e) {
              setTestResult({ ok: false, error: e instanceof Error ? e.message : '请求失败' });
            }
            setTesting(false);
          }}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button className="big" onClick={() => void save()} disabled={!draft.baseUrl.trim() || !draft.model.trim()}>
          保存
        </button>
        {savedTip && <span className="muted">✓ 已保存</span>}
      </div>
      <p className="muted">录音/上传会整段发送给该服务转写；语音听写同样使用此引擎。请注意所选服务的隐私与计费条款。</p>
    </div>
  );
}

export function TranscriptionSettings({
  settings,
  persist,
}: {
  settings: Settings;
  persist: (next: Settings) => Promise<boolean>;
}) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const engine = settings.transcriptionEngine;

  // 就绪徽章数据；引擎切换后重取（asrApiOk 等只在对应引擎下探测）
  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => {});
  }, [engine]);

  return (
    <div className="transcription-settings">
      <h4 className="block-h">🎙️ 语音 → 文字（转写引擎）</h4>
      <p className="muted">点选卡片即时切换引擎；下方只显示当前引擎的配置与模型管理。</p>

      <div className="engine-cards">
        {ENGINES.map((e) => {
          const badge = e.badge(health);
          const active = engine === e.id;
          return (
            <button
              key={e.id}
              className={'engine-card' + (active ? ' active' : '')}
              onClick={() => !active && persist({ ...settings, transcriptionEngine: e.id })}
            >
              <span className="engine-title">{e.title}</span>
              <span className="engine-desc">{e.desc}</span>
              <span className={'engine-badge ' + (badge.ok ? 'ok' : 'warn')}>{badge.label}</span>
            </button>
          );
        })}
      </div>

      {engine === 'whisper' && <WhisperModels settings={settings} persist={persist} />}

      {engine === 'sherpa' && (
        <div className="model-section">
          <h4 className="block-h">📦 sherpa-onnx</h4>
          <p className="muted">
            本地中文转写引擎，逐字稿带说话人标签（彩色区分）。仅支持中文；不支持术语表偏置。
          </p>
          {health?.sherpa.ok ? (
            <p className="muted">✓ 二进制与模型已就绪，可直接使用。</p>
          ) : (
            <div className="alert warn">
              尚未安装：需先运行 <code>bash scripts/fetch-sherpa.sh</code> 下载二进制与模型。
            </div>
          )}
        </div>
      )}

      {engine === 'api' && <AsrApiForm settings={settings} persist={persist} />}
    </div>
  );
}
