import { useEffect, useRef } from 'react';
import type { TranscriptSegment } from '../api/types';
import { fmtMs } from '../format';

interface Props {
  segments: TranscriptSegment[];
  /** 当前播放到的高亮句子下标（-1 表示无）。 */
  activeIndex?: number;
  /** 点击某句时回调（用于 seek 音频）。提供后句子可点击。 */
  onSeek?: (ms: number) => void;
}

export function TranscriptView({ segments, activeIndex = -1, onSeek }: Props) {
  const refs = useRef<(HTMLParagraphElement | null)[]>([]);

  // 当前句变化时滚到视口中央（依赖 activeIndex，仅句子切换时触发，不抖动）
  useEffect(() => {
    if (activeIndex < 0) return;
    refs.current[activeIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex]);

  if (!segments.length) return <p className="muted">（无逐字稿）</p>;
  return (
    <div className="transcript">
      {segments.map((s, i) => (
        <p
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className={i === activeIndex ? 'active' : undefined}
          onClick={onSeek ? () => onSeek(s.startMs) : undefined}
          style={onSeek ? { cursor: 'pointer' } : undefined}
        >
          <b className="ts">[{fmtMs(s.startMs)}]</b> {s.text}
        </p>
      ))}
    </div>
  );
}
