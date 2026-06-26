import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../api/types';
import { fmtMs } from '../format';

const STAGE_LABEL: Record<string, string> = {
  uploaded: '已上传，排队中…',
  converting: '转码中（ffmpeg）…',
  transcribing: '语音转写中（whisper）…',
  summarizing: '生成摘要中（LLM）…',
  done: '完成',
  error: '出错',
};

export function ProgressView({ id, onDone }: { id: string; onDone: () => void }) {
  const [stage, setStage] = useState('uploaded');
  const [progress, setProgress] = useState(0);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const es = new EventSource(`/api/sessions/${id}/events`);
    const parse = (e: Event) => JSON.parse((e as MessageEvent).data);
    es.addEventListener('meta', (e) => {
      const m = parse(e);
      setStage(m.status);
      setProgress(m.progress ?? 0);
      if (m.status === 'error') setFailed(m.error ?? '处理失败');
    });
    es.addEventListener('stage', (e) => {
      const d = parse(e);
      if (d.stage) setStage(d.stage);
    });
    es.addEventListener('segment', (e) => {
      const d = parse(e);
      setSegments((prev) => [...prev, d.segment]);
    });
    es.addEventListener('summary-token', (e) => {
      const d = parse(e);
      setSummary((prev) => prev + d.token);
    });
    es.addEventListener('done', () => {
      if (!doneRef.current) {
        doneRef.current = true;
        setTimeout(onDone, 700);
      }
    });
    es.addEventListener('failed', (e) => setFailed(parse(e).error ?? '处理失败'));
    return () => es.close();
  }, [id, onDone]);

  return (
    <div className="card">
      <h3>{failed ? '⚠️ 处理失败' : '⏳ 处理中'}</h3>
      {failed ? (
        <div className="alert err">{failed}</div>
      ) : (
        <>
          <div className="stage">{STAGE_LABEL[stage] ?? stage}</div>
          <div className="bar">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </>
      )}
      {segments.length > 0 && (
        <div className="stream">
          <h4>逐字稿（实时）</h4>
          <div className="transcript">
            {segments.map((s, i) => (
              <p key={i}>
                <b className="ts">[{fmtMs(s.startMs)}]</b> {s.text}
              </p>
            ))}
          </div>
        </div>
      )}
      {summary && (
        <div className="stream">
          <h4>摘要（实时）</h4>
          <pre className="summary-stream">{summary}</pre>
        </div>
      )}
    </div>
  );
}
