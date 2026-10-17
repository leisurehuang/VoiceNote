import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { listLlmModels, llmPullUrl, setLlmActive, deleteLlmModel } from '../api/client';
import type { LlmModelsResult } from '../api/types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ProgressBar } from './ui/ProgressBar';
import { toast } from './ui/Toast';

const DEFAULT_LLM_MODEL = 'qwen2.5:7b-instruct';

/**
 * 本地 Ollama 模型管理：列表/拉取/切换/删除（拉取进度走 SSE）。
 * 仅当激活预设的 baseUrl 指向本地 Ollama 时渲染（由父组件传入 activePresetId，
 * 变化时重新拉取 /api/models/llm，其 local 字段反映当前激活预设是否本地）。
 */
export function OllamaModels({ activePresetId }: { activePresetId?: string }) {
  const [llm, setLlm] = useState<LlmModelsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pullName, setPullName] = useState('');
  const [pullPct, setPullPct] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);

  async function refresh() {
    try {
      setLlm(await listLlmModels());
    } catch {
      /* ignore */
    }
  }

  // 激活预设变化（本地 ollama ↔ 云模型）时，重新判断是否显示本区块
  useEffect(() => {
    void refresh();
  }, [activePresetId]);

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
      toast(`已切换到 ${name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '切换失败');
    }
  }

  async function removeLlm(name: string) {
    setErr(null);
    try {
      await deleteLlmModel(name);
      await refresh();
      toast(`已删除 ${name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
    }
  }

  if (!llm?.local) return null;

  return (
    <div className="model-section">
      <h4 className="block-h">
        <Package size={13} aria-hidden />
        LLM 模型（Ollama）
      </h4>
      <p className="muted">
        激活预设使用本地 Ollama 时在此管理：下载/切换模型，对激活预设即时生效。
      </p>
      {err && <div className="alert err">{err}</div>}
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
              <Badge tone="accent">使用中</Badge>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => removeLlm(m.name)}>
                删除
              </Button>
            )}
          </div>
        </div>
      ))}
      {llm.models.length === 0 && !llm.error && (
        <p className="muted">
          尚无模型。首次使用建议拉取 {DEFAULT_LLM_MODEL}（约 4.7GB，一次即可）。
        </p>
      )}

      <div className="rec-controls model-pull">
        <input
          value={pullName}
          onChange={(e) => setPullName(e.target.value)}
          placeholder={DEFAULT_LLM_MODEL}
          disabled={pulling}
        />
        <Button
          variant="primary"
          loading={pulling}
          onClick={pull}
          disabled={pulling || !pullName.trim()}
        >
          拉取
        </Button>
      </div>
      {pullPct != null && <ProgressBar value={pullPct} />}
    </div>
  );
}
