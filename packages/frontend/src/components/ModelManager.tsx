import { useEffect, useState } from 'react';
import {
  listWhisperModels,
  whisperDownloadUrl,
  whisperDownloadFromUrl,
  setWhisperActive,
  deleteWhisperModel,
  listLlmModels,
  llmPullUrl,
  setLlmActive,
  deleteLlmModel,
} from '../api/client';
import type { Settings, WhisperModelsResult, LlmModelsResult } from '../api/types';

const DEFAULT_LLM_MODEL = 'qwen2.5:7b-instruct';

/** 进度跟踪 + EventSource 生命周期的公共逻辑（whisper 目录下载与 URL 下载共用）。 */
function useSseDownload() {
  const [pct, setPct] = useState<Record<string, number>>({});

  function clear(name: string) {
    setPct((p) => {
      const n = { ...p };
      delete n[name];
      return n;
    });
  }
  function start(key: string, url: string, onDone: () => void, onError: (msg: string) => void) {
    setPct((p) => ({ ...p, [key]: 0 }));
    const es = new EventSource(url);
    es.addEventListener('progress', (e) => {
      const v = (JSON.parse((e as MessageEvent).data) as { pct: number }).pct;
      setPct((p) => ({ ...p, [key]: v }));
    });
    es.addEventListener('done', () => {
      es.close();
      clear(key);
      onDone();
    });
    es.addEventListener('error', (e) => {
      es.close();
      clear(key);
      let msg = '下载失败';
      try {
        const m = JSON.parse((e as MessageEvent).data) as { error?: string };
        if (m.error) msg = m.error;
      } catch {
        /* 连接中断无 data */
      }
      onError(msg);
    });
  }
  return { pct, start };
}

/** 设置页内的模型管理：whisper.cpp 下载/切换/删除 + 本地 ollama pull/切换/删除。下载/拉取进度走 SSE。 */
export function ModelManager({
  activePresetId,
  settings,
  persist,
}: {
  activePresetId?: string;
  settings: Settings;
  persist: (next: Settings) => Promise<boolean>;
}) {
  const [whisper, setWhisper] = useState<WhisperModelsResult | null>(null);
  const [llm, setLlm] = useState<LlmModelsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 自定义模型文件路径
  const [pathDraft, setPathDraft] = useState('');
  const [pathMsg, setPathMsg] = useState<string | null>(null);
  // 自定义 URL 下载
  const [dlUrl, setDlUrl] = useState('');
  const [dlName, setDlName] = useState('');
  const [customPct, setCustomPct] = useState<number | null>(null);
  const { pct: dlPct, start: startDl } = useSseDownload();
  // ollama pull
  const [pullName, setPullName] = useState('');
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);

  async function refresh() {
    try {
      setWhisper(await listWhisperModels());
    } catch {
      /* ignore */
    }
    try {
      setLlm(await listLlmModels());
    } catch {
      /* ignore */
    }
  }
  // 激活预设变化（本地 ollama ↔ 云模型）时，重新判断是否显示 LLM 模型管理；
  // 生效模型路径变化时同步到自定义路径输入框
  useEffect(() => {
    refresh();
  }, [activePresetId]);
  useEffect(() => {
    setPathDraft(whisper?.activePath ?? '');
  }, [whisper?.activePath]);

  async function saveModelPath() {
    if (!settings) return;
    const p = pathDraft.trim();
    setPathMsg(null);
    const ok = await persist({ ...settings, whisperModelPath: p || undefined });
    if (ok) {
      setPathMsg(p ? '已保存，下次转写生效' : '已清除，回落到上面选择的模型');
      refresh();
    }
  }

  function downloadCatalog(name: string) {
    setErr(null);
    startDl(name, whisperDownloadUrl(name), refresh, setErr);
  }

  function downloadCustom() {
    const url = dlUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setErr('请输入 http(s) 模型文件地址');
      return;
    }
    setErr(null);
    const name = dlName.trim();
    setCustomPct(0);
    const es = new EventSource(whisperDownloadFromUrl(name, url));
    es.addEventListener('progress', (e) => {
      setCustomPct((JSON.parse((e as MessageEvent).data) as { pct: number }).pct);
    });
    es.addEventListener('done', () => {
      es.close();
      setCustomPct(null);
      if (!name) setDlUrl(''); // 无自定义名时清空输入便于连续下载
      refresh();
    });
    es.addEventListener('error', (e) => {
      es.close();
      setCustomPct(null);
      try {
        const m = JSON.parse((e as MessageEvent).data) as { error?: string };
        if (m.error) setErr(m.error);
      } catch {
        /* 连接中断无 data */
      }
      refresh();
    });
  }

  async function switchWhisper(name: string) {
    setErr(null);
    try {
      await setWhisperActive(name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '切换失败');
    }
  }

  async function removeWhisper(name: string) {
    setErr(null);
    try {
      await deleteWhisperModel(name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
    }
  }

  function pull() {
    const name = pullName.trim();
    if (!name) return;
    setErr(null);
    setPulling(true);
    setPullPct(0);
    const es = new EventSource(llmPullUrl(name));
    es.addEventListener('progress', (e) => {
      setPullPct((JSON.parse((e as MessageEvent).data) as { pct: number }).pct);
    });
    es.addEventListener('done', () => {
      es.close();
      setPulling(false);
      setPullPct(null);
      setPullName('');
      refresh();
    });
    es.addEventListener('error', (e) => {
      es.close();
      setPulling(false);
      setPullPct(null);
      try {
        const m = JSON.parse((e as MessageEvent).data) as { error?: string };
        if (m.error) setErr(m.error);
      } catch {
        /* ignore */
      }
      refresh();
    });
  }

  async function switchLlm(name: string) {
    setErr(null);
    try {
      await setLlmActive(name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '切换失败');
    }
  }

  async function removeLlm(name: string) {
    setErr(null);
    try {
      await deleteLlmModel(name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
    }
  }

  const anyWhisperInstalled = (whisper?.models ?? []).some((m) => m.installed);

  return (
    <div className="model-mgr">
      {err && <div className="alert err">{err}</div>}

      <div className="model-section">
        <h4 className="block-h">🎙 whisper 转写模型</h4>
        <p className="muted">下载/切换本地 whisper.cpp 模型，切换后新录音即时生效。</p>
        {!anyWhisperInstalled && (
          <div className="alert warn">
            尚未安装转写模型——建议先下载「turbo（推荐）」，完成后即可录音转写。
          </div>
        )}
        {whisper?.models.map((m) => (
          <div key={m.name} className={'model-row' + (m.active ? ' model-active' : '')}>
            <label className="model-radio">
              <input
                type="radio"
                name="whisper-model"
                checked={m.active}
                disabled={!m.installed}
                onChange={() => switchWhisper(m.name)}
              />
              <span className="model-name">{m.label}</span>
              <span className="muted model-size">{m.size}</span>
              {m.builtin && <span className="preset-badge">内置</span>}
            </label>
            <div className="model-ops">
              {dlPct[m.name] != null ? (
                <span className="model-prog">{Math.round((dlPct[m.name] ?? 0) * 100)}%</span>
              ) : m.installed ? (
                m.active ? (
                  <span className="preset-badge">● 使用中</span>
                ) : (
                  <button className="ghost" onClick={() => removeWhisper(m.name)} disabled={!m.deletable}>
                    删除
                  </button>
                )
              ) : (
                <button className="ghost" onClick={() => downloadCatalog(m.name)}>
                  下载
                </button>
              )}
            </div>
            {dlPct[m.name] != null && (
              <div className="model-bar">
                <span style={{ width: `${Math.round((dlPct[m.name] ?? 0) * 100)}%` }} />
              </div>
            )}
          </div>
        ))}

        <div className="rec-controls model-pull">
          <input
            value={dlUrl}
            onChange={(e) => setDlUrl(e.target.value)}
            placeholder="从 URL 下载模型（https://…/ggml-xxx.bin）"
          />
          <input
            className="model-name-input"
            value={dlName}
            onChange={(e) => setDlName(e.target.value)}
            placeholder="名称（可选）"
          />
          <button className="big" onClick={downloadCustom} disabled={!dlUrl.trim()}>
            下载
          </button>
        </div>
        {customPct != null && (
          <div className="model-bar">
            <span style={{ width: `${Math.round(customPct * 100)}%` }} />
          </div>
        )}
        {customPct != null && <span className="model-prog">{Math.round(customPct * 100)}%</span>}

        <div className="rec-controls model-pull">
          <input
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            placeholder="或使用本地模型文件路径（…/ggml-xxx.bin）"
          />
          <button className="big" onClick={saveModelPath} disabled={!settings}>
            使用该路径
          </button>
        </div>
        {pathMsg && <p className="muted">{pathMsg}</p>}
        <p className="muted">缓存目录：{whisper?.dir ?? '…'}</p>
      </div>

      {llm?.local && (
        <div className="model-section">
          <h4 className="block-h">🤖 LLM 模型（Ollama）</h4>
          <p className="muted">下载/切换摘要用的 ollama 模型，对激活预设即时生效。</p>
          {llm.error && <p className="muted">{llm.error}</p>}
          {llm.models.map((m) => (
            <div key={m.name} className={'model-row' + (m.active ? ' model-active' : '')}>
              <label className="model-radio">
                <input
                  type="radio"
                  name="llm-model"
                  checked={m.active}
                  onChange={() => switchLlm(m.name)}
                />
                <span className="model-name">{m.name}</span>
              </label>
              <div className="model-ops">
                {m.active ? (
                  <span className="preset-badge">● 使用中</span>
                ) : (
                  <button className="ghost" onClick={() => removeLlm(m.name)}>
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
          {llm.models.length === 0 && !llm.error && (
            <p className="muted">尚无模型。首次使用建议拉取 {DEFAULT_LLM_MODEL}（约 4.7GB，一次即可）。</p>
          )}

          <div className="rec-controls model-pull">
            <input
              value={pullName}
              onChange={(e) => setPullName(e.target.value)}
              placeholder={DEFAULT_LLM_MODEL}
              disabled={pulling}
            />
            <button className="big" onClick={pull} disabled={pulling || !pullName.trim()}>
              {pulling ? '拉取中…' : '拉取'}
            </button>
          </div>
          {pullPct != null && (
            <div className="model-bar">
              <span style={{ width: `${Math.round(pullPct * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
