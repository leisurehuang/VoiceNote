/** 极简能量 VAD：按 RMS 把连续 PCM 切成一句句。无第三方依赖。
 *  - 起声：RMS ≥ 阈值持续 speechOnMs → 开始一句
 *  - 收声：RMS < 阈值持续 silenceOffMs → 结束一句（回调 onutterance）
 *  - 太短（<minMs）当噪声丢弃；太长（>maxMs）强制切句
 *  时间戳基于已喂入的样本数（采样率换算），相对本路会话起点。
 */
export interface VadOpts {
  threshold?: number; // RMS 0..1
  speechOnMs?: number;
  silenceOffMs?: number;
  minMs?: number;
  maxMs?: number;
  sampleRate?: number;
}

function rms(chunk: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) {
    const s = chunk[i]! / 32768;
    sum += s * s;
  }
  return chunk.length ? Math.sqrt(sum / chunk.length) : 0;
}

export class EnergyVad {
  private threshold: number;
  private speechOnSamples: number;
  private silenceOffSamples: number;
  private minSamples: number;
  private maxSamples: number;
  private sampleRate: number;

  private mode: 'idle' | 'speaking' = 'idle';
  private uttChunks: Int16Array[] = [];
  private clock = 0; // 已喂入总样本数
  private uttStart = 0;
  private runSpeech = 0; // idle 态连续高能样本
  private runSilent = 0; // speaking 态连续静音样本

  onutterance?: (pcm: Int16Array, startMs: number, endMs: number) => void;

  constructor(opts: VadOpts = {}) {
    this.sampleRate = opts.sampleRate ?? 16000;
    this.threshold = opts.threshold ?? 0.015;
    this.speechOnSamples = Math.round(((opts.speechOnMs ?? 250) / 1000) * this.sampleRate);
    this.silenceOffSamples = Math.round(((opts.silenceOffMs ?? 700) / 1000) * this.sampleRate);
    this.minSamples = Math.round(((opts.minMs ?? 350) / 1000) * this.sampleRate);
    this.maxSamples = Math.round(((opts.maxMs ?? 15000) / 1000) * this.sampleRate);
  }

  feed(chunk: Int16Array): void {
    const n = chunk.length;
    const loud = rms(chunk) >= this.threshold;
    this.clock += n;

    if (this.mode === 'idle') {
      if (loud) this.runSpeech += n;
      else this.runSpeech = 0;
      if (this.runSpeech >= this.speechOnSamples) {
        this.mode = 'speaking';
        this.uttChunks = [chunk];
        this.uttStart = this.clock - n;
        this.runSilent = 0;
      }
      return;
    }

    // speaking
    this.uttChunks.push(chunk);
    if (!loud) this.runSilent += n;
    else this.runSilent = 0;

    if (this.runSilent >= this.silenceOffSamples) {
      this.endUtterance();
      return;
    }
    if (this.clock - this.uttStart >= this.maxSamples) {
      this.endUtterance();
    }
  }

  /** 结束时调用，把还在攒的半句 flush 出来。 */
  flush(): void {
    if (this.mode === 'speaking') this.endUtterance();
  }

  private endUtterance(): void {
    const startMs = (this.uttStart / this.sampleRate) * 1000;
    const endMs = (this.clock / this.sampleRate) * 1000;
    const chunks = this.uttChunks;
    this.mode = 'idle';
    this.uttChunks = [];
    this.runSpeech = 0;
    this.runSilent = 0;

    const samples = this.clock - this.uttStart;
    if (samples < this.minSamples || chunks.length === 0) return; // 太短，丢弃

    const len = chunks.reduce((a, c) => a + c.length, 0);
    const pcm = new Int16Array(len);
    let o = 0;
    for (const c of chunks) {
      pcm.set(c, o);
      o += c.length;
    }
    this.onutterance?.(pcm, startMs, endMs);
  }
}
