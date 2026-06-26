import type { TranscriptSegment } from '../api/types';
import { fmtMs } from '../format';

export function TranscriptView({ segments }: { segments: TranscriptSegment[] }) {
  if (!segments.length) return <p className="muted">（无逐字稿）</p>;
  return (
    <div className="transcript">
      {segments.map((s, i) => (
        <p key={i}>
          <b className="ts">[{fmtMs(s.startMs)}]</b> {s.text}
        </p>
      ))}
    </div>
  );
}
