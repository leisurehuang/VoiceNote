import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptSegment } from '../api/types';

// AudioWorklet 处理器源码：把麦克风原始采样线性降采样到 16kHz，按 320 样本（~20ms）成块，
// 以 Int16 transferable 推回主线程。用 Blob 内联，免去单独 worklet 文件（dev/打包通用）。
const WORKLET_SRC = `class P extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.p=0;this.o=[]}process(i){const d=i[0]&&i[0][0];if(!d)return true;const n=d.length;while(this.p<n-1){const k=Math.floor(this.p),f=this.p-k,s=d[k]+(d[k+1]-d[k])*f;this.o.push(s<-1?-1:s>1?1:s);this.p+=this.r}this.p-=n;if(this.p<0)this.p=0;while(this.o.length>=320){const c=this.o.splice(0,320),a=new Int16Array(320);for(let j=0;j<320;j++)a[j]=Math.round(c[j]*32767);this.port.postMessage(a,[a.buffer])}return true}}registerProcessor('pcm-capture',P);`;
const WORKLET_URL =
  typeof URL !== 'undefined' && typeof Blob !== 'undefined'
    ? URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }))
    : '';

export function useRealtime({ onDone }: { onDone?: (id: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [liveSummary, setLiveSummary] = useState('');
  const [summaryStreaming, setSummaryStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const acRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const idRef = useRef<string | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // 立刻停止音频采集（断 worklet、关 AudioContext、停麦），不动 WebSocket
  const stopCapture = useCallback(() => {
    try {
      nodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      acRef.current?.close();
    } catch {
      /* ignore */
    }
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    nodeRef.current = null;
    acRef.current = null;
    streamRef.current = null;
    analyserRef.current = null; // 波形组件检测到 null 后停止起伏
  }, []);

  const closeSocket = useCallback(() => {
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    wsRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    stopCapture();
    closeSocket();
  }, [stopCapture, closeSocket]);

  const start = useCallback(async () => {
    setError(null);
    setSegments([]);
    setLiveSummary('');
    setSummaryStreaming(false);
    setFinalizing(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;

      const ac = new AudioContext();
      acRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      analyserRef.current = analyser;

      await ac.audioWorklet.addModule(WORKLET_URL);
      const node = new AudioWorkletNode(ac, 'pcm-capture');
      src.connect(node);
      node.port.onmessage = (e) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(e.data as Int16Array);
      };
      nodeRef.current = node;

      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/realtime`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(JSON.stringify({ type: 'start' }));
      ws.onmessage = (ev) => {
        let m: {
          type: string;
          id?: string;
          segment?: TranscriptSegment;
          delta?: string;
          summary?: string;
          error?: string;
        };
        try {
          m = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        if (m.type === 'ready' && m.id) idRef.current = m.id;
        else if (m.type === 'segment' && m.segment) {
          setSegments((s) => [...s, m.segment!]);
        } else if (m.type === 'summary-start') {
          setLiveSummary('');
          setSummaryStreaming(true);
        } else if (m.type === 'summary-token' && m.delta != null) {
          setLiveSummary((s) => s + m.delta!);
        } else if (m.type === 'summary-done' && m.summary != null) {
          setLiveSummary(m.summary);
          setSummaryStreaming(false);
        } else if (m.type === 'summary-error') {
          setSummaryStreaming(false); // 保留上一次 liveSummary
        } else if (m.type === 'done') {
          const id = m.id || idRef.current;
          closeSocket(); // 音频在 stop() 时已停，这里只关连接
          setRecording(false);
          setFinalizing(false);
          if (id) onDoneRef.current?.(id);
        } else if (m.type === 'error') {
          setError(m.error ?? '转写出错');
        }
      };
      ws.onerror = () => setError('实时连接错误');
      wsRef.current = ws;
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法启动实时转写');
      cleanup();
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    stopCapture(); // 点「结束」立刻停麦，整理期间不再收音
    setFinalizing(true);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }));
  }, [stopCapture]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { recording, finalizing, segments, liveSummary, summaryStreaming, error, analyserRef, start, stop };
}
