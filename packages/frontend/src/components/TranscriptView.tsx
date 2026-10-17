import { useEffect, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { TranscriptSegment } from '../api/types';
import { fmtMs } from '../format';
import { speakerColor, speakerLabel } from '../speakers';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';

interface Props {
  segments: TranscriptSegment[];
  /** 当前播放到的高亮句子下标（-1 表示无）。 */
  activeIndex?: number;
  /** 点击某句时回调（用于 seek 音频）。提供后句子可点击。 */
  onSeek?: (ms: number) => void;
  /** 保存人工编辑后的逐字稿。提供后出现「编辑逐字稿」入口。 */
  onSaveTranscript?: (segments: TranscriptSegment[]) => Promise<void>;
}

/** 相邻句停顿超过该值视为话题分段（毫秒）。 */
const PARAGRAPH_GAP_MS = 2000;
/** 单段最多句子数：长独白也定期断段，保证阅读节奏。 */
const PARAGRAPH_MAX_LINES = 8;

/** 把平铺的逐字稿按「停顿 >2s / 换说话人 / 超 8 句」聚成段落（阅读分组，只影响展示）。 */
export function groupParagraphs(segments: TranscriptSegment[]): number[][] {
  const paras: number[][] = [];
  segments.forEach((s, i) => {
    const prev = segments[i - 1];
    const cur = paras[paras.length - 1];
    const brk =
      i === 0 ||
      !prev ||
      !cur ||
      s.startMs - prev.endMs > PARAGRAPH_GAP_MS ||
      s.speaker !== prev.speaker ||
      cur.length >= PARAGRAPH_MAX_LINES;
    if (brk) paras.push([i]);
    else cur.push(i);
  });
  return paras;
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

  if (!segments.length && !editing)
    return <EmptyState icon={AudioLines} title="（无逐字稿）" hint="该会话没有可展示的转写文本" />;

  const paras = groupParagraphs(segments);

  return (
    <div className="transcript reader">
      {editing
        ? draft.map((s, i) => (
            <p key={i} className="tedit">
              {s.speaker != null && (
                <span
                  className="spk"
                  style={{ color: speakerColor(s.speaker), borderColor: speakerColor(s.speaker) }}
                >
                  说话人 {speakerLabel(s.speaker)}
                </span>
              )}
              <b className="ts">[{fmtMs(s.startMs)}]</b>
              <textarea value={s.text} onChange={(e) => editAt(i, e.target.value)} rows={2} />
            </p>
          ))
        : paras.map((idxs, pi) => (
            <div
              key={pi}
              className={
                't-para' + (activeIndex >= 0 && idxs.includes(activeIndex) ? ' playing' : '')
              }
            >
              {idxs.map((i) => {
                const s = segments[i];
                if (!s) return null;
                const first = idxs[0] === i;
                return (
                  <p
                    key={i}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    className={i === activeIndex ? 'active' : undefined}
                    onClick={onSeek ? () => onSeek(s.startMs) : undefined}
                    style={onSeek ? { cursor: 'pointer' } : undefined}
                  >
                    {first && s.speaker != null && (
                      <span
                        className="spk"
                        style={
                          {
                            color: speakerColor(s.speaker),
                            '--dot': speakerColor(s.speaker),
                          } as React.CSSProperties
                        }
                      >
                        说话人 {speakerLabel(s.speaker)}
                      </span>
                    )}
                    <time className="ts">{fmtMs(s.startMs)}</time>
                    {s.text}
                  </p>
                );
              })}
            </div>
          ))}

      {onSaveTranscript && (
        <div className="transcript-actions">
          {editing ? (
            <>
              <Button variant="primary" onClick={save} loading={saving}>
                保存
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                取消
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(segments.map((s) => ({ ...s })));
                setEditing(true);
              }}
            >
              编辑逐字稿
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
