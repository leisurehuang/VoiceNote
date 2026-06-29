import { useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../api/types';
import { fmtMs } from '../format';

interface Props {
  segments: TranscriptSegment[];
  /** 当前播放到的高亮句子下标（-1 表示无）。 */
  activeIndex?: number;
  /** 点击某句时回调（用于 seek 音频）。提供后句子可点击。 */
  onSeek?: (ms: number) => void;
  /** 保存人工编辑后的逐字稿。提供后出现「编辑逐字稿」入口。 */
  onSaveTranscript?: (segments: TranscriptSegment[]) => Promise<void>;
}

export function TranscriptView({ segments, activeIndex = -1, onSeek, onSaveTranscript }: Props) {
  const refs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TranscriptSegment[]>([]);
  const [saving, setSaving] = useState(false);

  // 当前句变化时滚到视口中央（编辑态下暂停跟随，避免抢占光标/滚动）
  useEffect(() => {
    if (editing || activeIndex < 0) return;
    refs.current[activeIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex, editing]);

  async function save() {
    if (!onSaveTranscript) return;
    setSaving(true);
    try {
      await onSaveTranscript(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function editAt(i: number, text: string) {
    setDraft((cur) => cur.map((seg, j) => (j === i ? { ...seg, text } : seg)));
  }

  if (!segments.length && !editing) return <p className="muted">（无逐字稿）</p>;

  return (
    <div className="transcript">
      {editing
        ? draft.map((s, i) => (
            <p key={i} className="tedit">
              <b className="ts">[{fmtMs(s.startMs)}]</b>
              <textarea value={s.text} onChange={(e) => editAt(i, e.target.value)} rows={2} />
            </p>
          ))
        : segments.map((s, i) => (
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

      {onSaveTranscript && (
        <div className="transcript-actions">
          {editing ? (
            <>
              <button className="big" onClick={save} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button className="ghost" onClick={() => setEditing(false)} disabled={saving}>
                取消
              </button>
            </>
          ) : (
            <button
              className="ghost"
              onClick={() => {
                setDraft(segments.map((s) => ({ ...s })));
                setEditing(true);
              }}
            >
              编辑逐字稿
            </button>
          )}
        </div>
      )}
    </div>
  );
}
