import { useEffect, useState } from 'react';
import { getSession, resummarize } from '../api/client';
import type { SessionDetail as Detail } from '../api/types';
import { TranscriptView } from './TranscriptView';
import { SummaryView } from './SummaryView';
import { ExportBar } from './ExportBar';
import { fmtDate, fmtMs } from '../format';

export function SessionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getSession(id)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [id]);

  async function handleResummarize(customPrompt?: string) {
    setSummarizing(true);
    setErr(null);
    try {
      await resummarize(id, customPrompt ? { systemPrompt: customPrompt } : {});
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const d = await getSession(id);
        if (d.status === 'done') {
          setDetail(d);
          break;
        }
        if (d.status === 'error') {
          setErr(d.error ?? '摘要失败');
          break;
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '摘要失败');
    }
    setSummarizing(false);
  }

  if (err && !detail) {
    return (
      <div className="card">
        <div className="alert err">{err}</div>
        <button className="ghost" onClick={onBack}>
          ← 返回
        </button>
      </div>
    );
  }
  if (!detail) return <div className="card"><p className="muted">加载中…</p></div>;

  return (
    <div>
      <div className="detail-head">
        <button className="ghost" onClick={onBack}>
          ← 返回
        </button>
        <h2>{detail.title}</h2>
        <span className="muted">
          {fmtDate(detail.createdAt)} · {detail.durationMs ? fmtMs(detail.durationMs) : '未知时长'} ·{' '}
          {detail.sourceKind === 'record' ? '录音' : '上传'}
        </span>
      </div>

      <div className="card">
        <h3>📝 摘要</h3>
        <SummaryView
          summary={detail.summary}
          summarizing={summarizing}
          onResummarize={handleResummarize}
        />
        {err && <div className="alert err">{err}</div>}
      </div>

      <div className="card">
        <h3>💬 逐字稿</h3>
        <TranscriptView segments={detail.transcript} />
      </div>

      <ExportBar id={id} />
    </div>
  );
}
