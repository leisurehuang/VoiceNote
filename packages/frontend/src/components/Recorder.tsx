import { useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { uploadAudio } from '../api/client';
import { useRecorder } from '../hooks/useRecorder';
import { Waveform } from './Waveform';
import { Button } from './ui/Button';

function fmt(s: number): string {
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

export function Recorder({
  onCreated,
  onBusyChange,
}: {
  onCreated: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { recording, seconds, error, start, stop, analyserRef } = useRecorder();
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  // 录音/上传进行中时通知父组件：禁止切走，否则组件卸载会终止或丢失录音
  useEffect(() => {
    onBusyChange?.(recording || busy);
  }, [recording, busy, onBusyChange]);

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
      <h3>
        <Mic size={15} aria-hidden />
        浏览器录音
      </h3>
      {(error || uploadErr) && <div className="alert err">{error ?? uploadErr}</div>}

      {!recording ? (
        <div className="record-idle">
          <div className="mic-pulse" aria-hidden="true">
            <span className="mic-dot" />
          </div>
          <Button variant="primary" onClick={start} disabled={busy}>
            开始录音
          </Button>
        </div>
      ) : (
        <div className="recording-ui">
          <Waveform analyserRef={analyserRef} />
          <div className="rec-controls">
            <span className="timer rec">
              <span className="dot-live" aria-hidden />
              REC {fmt(seconds)}
            </span>
            <Button variant="danger" onClick={handleStop} disabled={busy}>
              停止并转写
            </Button>
          </div>
        </div>
      )}
      <p className="muted">录音在浏览器本地完成，上传到本机后端转写。</p>
    </div>
  );
}
