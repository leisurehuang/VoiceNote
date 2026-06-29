import { useEffect, useRef } from 'react';
import { useRealtime } from '../hooks/useRealtime';
import { Waveform } from './Waveform';
import { renderMarkdown } from '../api/markdown';
import { fmtMs } from '../format';

export function RealtimeView({
  onDone,
  onBusyChange,
}: {
  onDone: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { recording, finalizing, segments, liveSummary, summaryStreaming, error, analyserRef, start, stop } =
    useRealtime({ onDone });
  const scrollRef = useRef<HTMLDivElement>(null);

  // 录音/整理进行中时通知父组件：禁止切走，否则 WS 关闭会终止录音
  useEffect(() => {
    onBusyChange?.(recording || finalizing);
    // 卸载时务必复位 busy：整理完成会切到详情视图导致本组件被卸载，
    // 此时上面的 effect 不会再 re-run；若不在 cleanup 里兜底复位，
    // 父级 busy 会卡在 true，左侧导航（列表/新建/设置）被永久禁用。
    return () => onBusyChange?.(false);
  }, [recording, finalizing, onBusyChange]);

  // 新句子进来自动滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, liveSummary]);

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
          {finalizing ? (
            <div className="finalizing">
              <div className="finalizing-pulse">
                <span className="finalizing-dot">⚙️</span>
              </div>
              <div className="finalizing-text">
                <span className="finalizing-title">正在整理…</span>
                <span className="finalizing-sub">生成逐字稿与高质量摘要</span>
              </div>
            </div>
          ) : (
            <Waveform analyserRef={analyserRef} />
          )}
          <div className="rec-controls">
            <span className="timer rec">{finalizing ? '整理中…' : '● 实时转写中'}</span>
            <button className="big danger" onClick={stop} disabled={finalizing}>
              {finalizing ? '整理中…' : '结束并整理'}
            </button>
          </div>
          {(liveSummary || summaryStreaming) && (
            <div className="live-summary">
              <h4>
                实时摘要
                {summaryStreaming && <span className="live-dot">●</span>}
              </h4>
              {liveSummary ? (
                <div
                  className="markdown summary-wrap"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(liveSummary) }}
                />
              ) : (
                <p className="muted">生成中…</p>
              )}
            </div>
          )}
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
      <p className="muted">边说边出字与实时摘要；结束后生成高质量终版摘要与标题。</p>
    </div>
  );
}
