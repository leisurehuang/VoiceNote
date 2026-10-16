import { useEffect, useRef, useState, type RefObject } from 'react';
import { fmtMs } from '../format';

/** 播放倍速档位（点击循环切换）。 */
const RATES = [1, 1.25, 1.5, 2];

/**
 * 详情页底部播放条：圆形播放键 + 细进度条（可点/拖 seek）+ mono 时间码 + 倍速。
 * 音频元素由本组件渲染（隐藏），ref 由父组件传入用于逐字稿联动。
 */
export function PlayerBar({
  audioRef,
  src,
  downloadUrl,
  onTimeUpdate,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  src: string;
  downloadUrl: string;
  /** 透传音频 timeupdate（详情页用于逐字稿播放高亮联动）。 */
  onTimeUpdate?: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 详情切换会话时重置本地状态
  useEffect(() => {
    setPlaying(false);
    setCur(0);
    setDur(0);
  }, [src]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  function cycleRate() {
    const el = audioRef.current;
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
    setRate(next);
    if (el) el.playbackRate = next;
  }

  function seekTo(v: number) {
    const el = audioRef.current;
    if (!el || !Number.isFinite(v)) return;
    el.currentTime = v;
    setCur(v);
  }

  return (
    <div className="player-bar" ref={wrapRef}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        style={{ display: 'none' }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          setCur(e.currentTarget.currentTime);
          onTimeUpdate?.();
        }}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDur(e.currentTarget.duration || 0)}
      />
      <button className="player-toggle" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        className="player-track"
        type="range"
        min={0}
        max={dur || 0}
        step={0.1}
        value={Math.min(cur, dur || 0)}
        onChange={(e) => seekTo(Number(e.target.value))}
        aria-label="播放进度"
        disabled={!dur}
      />
      <time className="player-time">
        {fmtMs(cur * 1000)} / {dur ? fmtMs(dur * 1000) : '--:--'}
      </time>
      <button className="player-rate" onClick={cycleRate} title="播放倍速">
        {rate}×
      </button>
      <a className="player-dl" href={downloadUrl} download title="下载音频">
        ↓
      </a>
    </div>
  );
}
