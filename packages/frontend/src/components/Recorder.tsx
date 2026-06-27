import { useState } from 'react';
import { uploadAudio } from '../api/client';
import { useRecorder } from '../hooks/useRecorder';
import { Waveform } from './Waveform';

function fmt(s: number): string {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

export function Recorder({ onCreated }: { onCreated: (id: string) => void }) {
  const { recording, seconds, error, start, stop, analyserRef } = useRecorder();
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  async function handleStop() {
    setBusy(true);
    const res = await stop();
    if (res) {
      try {
        const id = await uploadAudio(res.blob, `录音-${fmt(seconds)}.${res.ext}`, {
          sourceKind: 'record',
        });
        onCreated(id);
      } catch (e) {
        setUploadErr(e instanceof Error ? e.message : '上传失败');
      }
    }
    setBusy(false);
  }

  return (
    <div className="card record-card">
      <h3>🎙 浏览器录音</h3>
      {(error || uploadErr) && <div className="alert err">{error ?? uploadErr}</div>}

      {!recording ? (
        <div className="record-idle">
          <div className="mic-pulse" aria-hidden="true">
            <span className="mic-dot" />
          </div>
          <button className="big" onClick={start} disabled={busy}>
            开始录音
          </button>
        </div>
      ) : (
        <div className="recording-ui">
          <Waveform analyserRef={analyserRef} />
          <div className="rec-controls">
            <span className="timer rec">● REC {fmt(seconds)}</span>
            <button className="big danger" onClick={handleStop} disabled={busy}>
              停止并转写
            </button>
          </div>
        </div>
      )}
      <p className="muted">录音在浏览器本地完成，上传到本机后端转写。</p>
    </div>
  );
}
