import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import {
  listWhisperModels,
  whisperDownloadUrl,
  whisperDownloadFromUrl,
  setWhisperActive,
  deleteWhisperModel,
} from '../api/client';
import type { Settings, WhisperModelsResult } from '../api/types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ProgressBar } from './ui/ProgressBar';

/** 进度跟踪 + EventSource 生命周期（目录下载与 URL 下载共用）。 */
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

/** whisper.cpp 转写模型管理：目录下载/切换/删除 + URL 下载 + 本地路径。下载进度走 SSE。 */
export function WhisperModels({
  settings,
  persist,
}: {
  settings: Settings;
  persist: (next: Settings) => Promise<boolean>;
}) {
  const [whisper, setWhisper] = useState<WhisperModelsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 自定义模型文件路径
  const [pathDraft, setPathDraft] = useState('');
  const [pathMsg, setPathMsg] = useState<string | null>(null);
  // 自定义 URL 下载
  const [dlUrl, setDlUrl] = useState('');
  const [dlName, setDlName] = useState('');
  const [customPct, setCustomPct] = useState<number | null>(null);
  const { pct: dlPct, start: startDl } = useSseDownload();

  async function refresh() {
    try {
      setWhisper(await listWhisperModels());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    setPathDraft(whisper?.activePath ?? '');
  }, [whisper?.activePath]);

  async function saveModelPath() {
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

  const anyWhisperInstalled = (whisper?.models ?? []).some((m) => m.installed);

  return (
    <div className="model-section">
      <h4 className="block-h">
        <Package size={13} aria-hidden />
        whisper 转写模型
      </h4>
      <p className="muted">下载/切换本地 whisper.cpp 模型，切换后新录音即时生效。</p>
      {err && <div className="alert err">{err}</div>}
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
            {m.builtin && <Badge>内置</Badge>}
          </label>
          <div className="model-ops">
            {dlPct[m.name] != null ? (
              <span className="model-prog">{Math.round((dlPct[m.name] ?? 0) * 100)}%</span>
            ) : m.installed ? (
              m.active ? (
                <Badge tone="accent">使用中</Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeWhisper(m.name)}
                  disabled={!m.deletable}
                >
                  删除
                </Button>
              )
            ) : (
              <Button variant="ghost" size="sm" onClick={() => downloadCatalog(m.name)}>
                下载
              </Button>
            )}
          </div>
          {dlPct[m.name] != null && (
            <ProgressBar value={dlPct[m.name] ?? 0} className="model-progressbar" />
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
        <Button variant="primary" onClick={downloadCustom} disabled={!dlUrl.trim()}>
          下载
        </Button>
      </div>
      {customPct != null && <ProgressBar value={customPct} />}
      {customPct != null && <span className="model-prog">{Math.round(customPct * 100)}%</span>}

      <div className="rec-controls model-pull">
        <input
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          placeholder="或使用本地模型文件路径（…/ggml-xxx.bin）"
        />
        <Button variant="primary" onClick={() => void saveModelPath()}>
          使用该路径
        </Button>
      </div>
      {pathMsg && <p className="muted">{pathMsg}</p>}
      <p className="muted">缓存目录：{whisper?.dir ?? '…'}</p>
    </div>
  );
}
