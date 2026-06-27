import { useEffect, useRef } from 'react';
import { useRealtime } from '../hooks/useRealtime';
import { Waveform } from './Waveform';
import { fmtMs } from '../format';

export function RealtimeView({ onDone }: { onDone: (id: string) => void }) {
  const { recording, finalizing, segments, error, analyserRef, start, stop } = useRealtime({ onDone });
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新句子进来自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments]);

  return (
    <div className="card record-card">
      <h3>⚡ 实时转写</h3>
      {error && <div className="alert err">{error}</div>}

      {!recording ? (
        <div className="record-idle">
          <div className="mic-pulse">
            <span className="mic-dot">⚡</span>
          </div>
          <button className="big" onClick={start}>
            开始实时转写
          </button>
        </div>
      ) : (
        <div className="recording-ui">
          <Waveform analyserRef={analyserRef} />
          <div className="rec-controls">
            <span className="timer rec">{finalizing ? '整理中…' : '● 实时转写中'}</span>
            <button className="big danger" onClick={stop} disabled={finalizing}>
              {finalizing ? '整理中…' : '结束并整理'}
            </button>
          </div>
          <div className="realtime-transcript" ref={scrollRef}>
            {segments.length === 0 ? (
              <p className="muted">开始说话，停顿后约 1–2 秒这里会逐句出现文字…</p>
            ) : (
              segments.map((s, i) => (
                <p key={i}>
                  <b className="ts">[{fmtMs(s.startMs)}]</b>
                  {s.text}
                </p>
              ))
            )}
          </div>
        </div>
      )}
      <p className="muted">边说边出字（句子级）；结束后自动生成摘要与标题。</p>
    </div>
  );
}
