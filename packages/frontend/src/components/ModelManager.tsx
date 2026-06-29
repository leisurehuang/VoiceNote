import { useEffect, useState } from 'react';
import {
  listWhisperModels,
  whisperDownloadUrl,
  setWhisperActive,
  deleteWhisperModel,
  listLlmModels,
  llmPullUrl,
  setLlmActive,
  deleteLlmModel,
} from '../api/client';
import type { WhisperModelsResult, LlmModelsResult } from '../api/types';

/** 设置页内的模型管理：whisper.cpp 下载/切换/删除 + 本地 ollama pull/切换/删除。下载/拉取进度走 SSE。 */
export function ModelManager({ activePresetId }: { activePresetId?: string }) {
  const [whisper, setWhisper] = useState<WhisperModelsResult | null>(null);
  const [llm, setLlm] = useState<LlmModelsResult | null>(null);
  const [dlPct, setDlPct] = useState<Record<string, number>>({}); // whisper 模型名 -> 进度
  const [pullName, setPullName] = useState('');
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
  // 激活预设变化（本地 ollama ↔ 云模型）时，重新判断是否显示 LLM 模型管理
  useEffect(() => {
    refresh();
  }, [activePresetId]);

  function clearDl(name: string) {
    setDlPct((p) => {
      const n = { ...p };
      delete n[name];
      return n;
    });
  }

  function download(name: string) {
    setErr(null);
    setDlPct((p) => ({ ...p, [name]: 0 }));
    const es = new EventSource(whisperDownloadUrl(name));
    es.addEventListener('progress', (e) => {
      const pct = (JSON.parse((e as MessageEvent).data) as { pct: number }).pct;
      setDlPct((p) => ({ ...p, [name]: pct }));
    });
    es.addEventListener('done', () => {
      es.close();
      clearDl(name);
      refresh();
    });
    es.addEventListener('error', (e) => {
      es.close();
      clearDl(name);
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

  return (
    <div className="model-mgr">
      {err && <div className="alert err">{err}</div>}

      <div className="model-section">
        <h4 className="block-h">🎙 whisper 转写模型</h4>
        <p className="muted">下载/切换本地 whisper.cpp 模型，切换后新录音即时生效。</p>
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
            </label>
            <div className="model-ops">
              {dlPct[m.name] != null ? (
                <span className="model-prog">{Math.round((dlPct[m.name] ?? 0) * 100)}%</span>
              ) : m.installed ? (
                m.active ? (
                  <span className="preset-badge">● 使用中</span>
                ) : (
                  <button className="ghost" onClick={() => removeWhisper(m.name)} disabled={whisper?.packaged}>
                    删除
                  </button>
                )
              ) : (
                <button className="ghost" onClick={() => download(m.name)} disabled={whisper?.packaged}>
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
        {whisper?.packaged && <p className="muted">桌面版自带模型为只读，仅可切换。</p>}
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
          {llm.models.length === 0 && !llm.error && <p className="muted">尚无模型，输入名称拉取。</p>}

          <div className="rec-controls model-pull">
            <input
              value={pullName}
              onChange={(e) => setPullName(e.target.value)}
              placeholder="如 qwen2.5:7b-instruct"
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
