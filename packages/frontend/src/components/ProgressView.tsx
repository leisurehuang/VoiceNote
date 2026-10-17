import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, X } from 'lucide-react';
import type { TranscriptSegment } from '../api/types';
import { fmtMs } from '../format';
import { speakerColor, speakerLabel } from '../speakers';
import { Button } from './ui/Button';
import { ProgressBar } from './ui/ProgressBar';
import { Spinner } from './ui/Spinner';
import { cn } from '../cn';

/** 流水线阶段(与后端 SessionStatus 对应),处理页顶部以此展示四步指示器。 */
const STEPS = [
  { id: 'uploaded', label: '上传' },
  { id: 'converting', label: '转码' },
  { id: 'transcribing', label: '转写' },
  { id: 'summarizing', label: '摘要' },
] as const;

type StepState = 'done' | 'active' | 'todo' | 'error';

export function ProgressView({
  id,
  onDone,
  onBack,
}: {
  id: string;
  onDone: () => void;
  onBack?: () => void;
}) {
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

  const stageIdx = STEPS.findIndex((s) => s.id === stage);
  const stepState = (i: number): StepState => {
    if (failed) return i < stageIdx ? 'done' : i === stageIdx ? 'error' : 'todo';
    if (stage === 'done' || stageIdx > i) return 'done';
    return stageIdx === i ? 'active' : 'todo';
  };

  return (
    <div className="card">
      <h3>{failed ? '处理失败' : '处理中'}</h3>

      <ol className="steps">
        {STEPS.map((s, i) => {
          const state = stepState(i);
          return (
            <li
              key={s.id}
              className={cn('step', `step-${state}`)}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="step-marker" aria-hidden>
                {state === 'done' ? (
                  <Check size={11} />
                ) : state === 'error' ? (
                  <X size={11} />
                ) : state === 'active' ? (
                  <Spinner size={10} />
                ) : (
                  i + 1
                )}
              </span>
              <span className="step-label">{s.label}</span>
            </li>
          );
        })}
      </ol>

      {failed ? (
        <>
          <div className="alert err">
            <CircleAlert size={14} aria-hidden />
            <span>{failed}</span>
          </div>
          <div className="rec-controls">
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                返回新建
              </Button>
            )}
          </div>
        </>
      ) : (
        <ProgressBar value={stage === 'done' ? 1 : progress} />
      )}

      {segments.length > 0 && (
        <div className="stream">
          <h4>逐字稿（实时）</h4>
          <div className="transcript">
            {segments.map((s, i) => (
              <p key={i}>
                {s.speaker != null && (
                  <span
                    className="spk"
                    style={{ color: speakerColor(s.speaker), borderColor: speakerColor(s.speaker) }}
                  >
                    说话人 {speakerLabel(s.speaker)}
                  </span>
                )}
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
