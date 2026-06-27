import { useEffect, useRef, type RefObject } from 'react';

/** 实时镜像柱状波形：从 AnalyserNode 读频域数据，画成上下对称的柱条，随声音起伏。 */
export function Waveform({ analyserRef }: { analyserRef: RefObject<AnalyserNode | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    resize();

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      const rr = Math.min(r, w / 2, h / 2);
      ctx!.beginPath();
      ctx!.moveTo(x + rr, y);
      ctx!.arcTo(x + w, y, x + w, y + h, rr);
      ctx!.arcTo(x + w, y + h, x, y + h, rr);
      ctx!.arcTo(x, y + h, x, y, rr);
      ctx!.arcTo(x, y, x + w, y, rr);
      ctx!.closePath();
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const analyser = analyserRef.current;
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      if (!analyser) return;

      if (!bins || bins.length !== analyser.frequencyBinCount) {
        bins = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(bins);

      // 柱条数随宽度自适应（约每 9px 一根）
      const N = Math.max(24, Math.min(96, Math.floor(w / dpr / 9)));
      const usable = Math.floor(bins.length * 0.62); // 语音能量主要在低频段
      const barW = w / N;
      const gap = barW * 0.32;
      const mid = h / 2;

      for (let i = 0; i < N; i++) {
        // 用对数映射让低频展开更自然，取该区间内最大值
        const a = Math.floor(Math.pow(i / N, 1.4) * usable);
        const b = Math.floor(Math.pow((i + 1) / N, 1.4) * usable);
        let peak = 0;
        for (let k = a; k <= b && k < bins.length; k++) peak = Math.max(peak, bins[k] ?? 0);
        const v = peak / 255; // 0..1
        const amp = Math.max(v, 0.03);
        const barH = amp * (h * 0.46);
        const x = i * barW + gap / 2;
        const bw = barW - gap;
        ctx!.fillStyle = v > 0.6 ? '#4da3ff' : 'rgba(10,132,255,0.6)';
        roundRect(x, mid - barH, bw, barH * 2, bw / 2);
        ctx!.fill();
      }
    };
    draw();

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [analyserRef]);

  return <canvas ref={canvasRef} className="waveform" />;
}
