import { useEffect, useRef, useState } from 'react';
import { getSession, resummarize, updateSummary, updateTranscript, extractTodos, getTodos, audioUrl, sourceUrl } from '../api/client';
import type { SessionDetail as Detail, TranscriptSegment, TodoItem } from '../api/types';
import { TranscriptView } from './TranscriptView';
import { SummaryView } from './SummaryView';
import { ExportBar } from './ExportBar';

export function SessionDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [extracting, setExtracting] = useState(false);

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
    setTodos([]);
    getSession(id)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : '加载失败'));
    getTodos(id)
      .then((t) => alive && setTodos(t))
      .catch(() => {
        /* 未抽取过则无待办，忽略 */
      });
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

  // 人工编辑摘要 / 逐字稿后写回，并刷新详情
  async function handleSaveSummary(text: string) {
    await updateSummary(id, text);
    setDetail(await getSession(id));
  }
  async function handleSaveTranscript(segs: TranscriptSegment[]) {
    await updateTranscript(id, segs);
    setDetail(await getSession(id));
  }

  // 让模型从逐字稿抽取结构化待办（持久化到 todos.json）
  async function handleExtractTodos() {
    setExtracting(true);
    try {
      setTodos(await extractTodos(id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '抽取待办失败');
    } finally {
      setExtracting(false);
    }
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
      <div className="segmented detail-tabs">
        <button
          className={tab === 'summary' ? 'seg active' : 'seg'}
          onClick={() => setTab('summary')}
        >
          📝 摘要
        </button>
        <button
          className={tab === 'transcript' ? 'seg active' : 'seg'}
          onClick={() => setTab('transcript')}
        >
          💬 逐字稿
        </button>
      </div>

      {/* 中间内容区独立滚动；顶部 tab 与底部导出栏固定 */}
      <div className="detail-body">
      {/* 两个 tab 常驻 DOM、用 display 切换：音频不随 tab 卸载，播放进度与摘要编辑态都保留 */}
      <section className={tab === 'summary' ? 'block' : 'block hidden'}>
        {detail.transcript.length > 0 && (
          <div className="todos-box">
            <div className="todos-head">
              <h3 className="block-h">✅ 待办事项</h3>
              <button className="ghost" onClick={handleExtractTodos} disabled={extracting}>
                {extracting ? '提取中…' : todos.length ? '重新提取' : '提取待办'}
              </button>
            </div>
            {todos.length > 0 ? (
              <ul className="todos-list">
                {todos.map((t, i) => (
                  <li key={i}>
                    <span className="todo-text">{t.text}</span>
                    {t.owner && <span className="todo-meta">负责人：{t.owner}</span>}
                    {t.due && <span className="todo-meta">时限：{t.due}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">点「提取待办」让模型从逐字稿抽取结构化待办（含负责人、时限）。</p>
            )}
          </div>
        )}
        <SummaryView
          summary={detail.summary}
          summarizing={summarizing}
          onResummarize={handleResummarize}
          onSaveSummary={handleSaveSummary}
        />
        {err && <div className="alert err">{err}</div>}
      </section>

      <section className={tab === 'transcript' ? 'block' : 'block hidden'}>
        {detail.hasAudio && (
          <div className="audio-sticky">
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
          </div>
        )}
        <TranscriptView
          segments={detail.transcript}
          activeIndex={activeIndex}
          onSeek={handleSeek}
          onSaveTranscript={handleSaveTranscript}
        />
      </section>
      </div>

      <ExportBar id={id} />
    </div>
  );
}
