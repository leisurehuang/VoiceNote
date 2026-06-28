import { useEffect, useRef, useState } from 'react';
import { getSession, resummarize, audioUrl, sourceUrl } from '../api/client';
import type { SessionDetail as Detail } from '../api/types';
import { TranscriptView } from './TranscriptView';
import { SummaryView } from './SummaryView';
import { ExportBar } from './ExportBar';

export function SessionDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  // 音频播放进度 → 高亮当前逐字稿句子
  function handleTimeUpdate() {
    const el = audioRef.current;
    const segs = detail?.transcript;
    if (!el || !segs) return;
    const tMs = el.currentTime * 1000;
    let idx = -1;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg && seg.startMs <= tMs) idx = i;
      else break;
    }
    setActiveIndex(idx);
  }

  // 点击逐字稿某句 → 跳转音频（只定位，不自动播放）
  function handleSeek(ms: number) {
    const el = audioRef.current;
    if (el) el.currentTime = ms / 1000;
  }

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setErr(null);
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
      <div className="content">
        <div className="alert err">{err}</div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="content">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  return (
    <div className="content detail">
      <section className="block">
        <h3 className="block-h">📝 摘要</h3>
        <SummaryView
          summary={detail.summary}
          summarizing={summarizing}
          onResummarize={handleResummarize}
        />
        {err && <div className="alert err">{err}</div>}
      </section>

      {detail.hasAudio && (
        <section className="block audio-bar">
          <h3 className="block-h">▶ 音频</h3>
          <audio
            ref={audioRef}
            src={audioUrl(id)}
            controls
            preload="metadata"
            onTimeUpdate={handleTimeUpdate}
          />
          <a className="ghost" href={sourceUrl(id)} download>
            下载音频
          </a>
        </section>
      )}

      <section className="block">
        <h3 className="block-h">💬 逐字稿</h3>
        <TranscriptView
          segments={detail.transcript}
          activeIndex={activeIndex}
          onSeek={handleSeek}
        />
      </section>

      <ExportBar id={id} />
    </div>
  );
}
