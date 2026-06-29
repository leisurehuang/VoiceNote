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
  // 实时音量分析（供波形可视化）
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const teardownAnalysis = useCallback(() => {
    try {
      audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  const stop = useCallback(
    (): Promise<RecorderResult | null> => {
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
          teardownAnalysis();
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
    },
    [teardownAnalysis],
  );

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('录音需要安全上下文（HTTPS 或 localhost）。请通过 https 访问，或改用「上传音频」。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      // 建分析链路（不影响 MediaRecorder 录制）
      try {
        const Ctx: typeof AudioContext =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser); // 不连到 destination，避免回授
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      } catch {
        /* 可视化可选，失败不阻塞录音 */
      }

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

  return { recording, seconds, error, start, stop, analyserRef };
}
