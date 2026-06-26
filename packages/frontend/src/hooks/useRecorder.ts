import { useCallback, useRef, useState } from 'react';

export interface RecorderResult {
  blob: Blob;
  mimeType: string;
  ext: string;
}

/** 跨浏览器选一个 MediaRecorder 支持的音频格式。 */
function pickMime(): { mimeType: string; ext: string } {
  const candidates = [
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
    { mimeType: 'audio/mp4', ext: 'm4a' },
    { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
  ];
  if (typeof MediaRecorder !== 'undefined') {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
    }
  }
  return { mimeType: '', ext: 'webm' };
}

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const mimeRef = useRef(pickMime());

  const stop = useCallback((): Promise<RecorderResult | null> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec) {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        const type = mimeRef.current.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        resolve({ blob, mimeType: type, ext: mimeRef.current.ext });
      };
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      rec.stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = mimeRef.current;
      const rec = mime.mimeType
        ? new MediaRecorder(stream, { mimeType: mime.mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recRef.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法访问麦克风，请检查权限');
    }
  }, []);

  return { recording, seconds, error, start, stop };
}
