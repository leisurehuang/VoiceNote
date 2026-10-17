/**
 * 逐句转写器：连续 PCM → EnergyVad 切句 → 临时 WAV → 当前引擎转写 → 回调结果。
 * 供实时转写（/api/realtime WebSocket 会话）与听写流（/api/dictation/stream HTTP 分段）
 * 共用，保证两条链路的切句粒度、串行转写与错误语义一致。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import type { TranscriptSegment } from '../store/sessionStore.js';
import { transcribeUtteranceWithEngine } from './transcribe.js';
import { writeWav } from '../util/wav.js';
import { EnergyVad, type VadOpts } from './vad.js';

export interface UtteranceResult {
  /** 本流内第几句（从 1 递增）。 */
  index: number;
  /** 相对流起点的起止毫秒。 */
  startMs: number;
  endMs: number;
  segments: TranscriptSegment[];
}

export interface UtteranceTranscriberOpts {
  /** 临时 wav 落盘目录。 */
  workDir: string;
  /** 临时文件名前缀（多实例并存时需保证不冲突）。 */
  filePrefix: string;
  /** VAD 参数覆盖。 */
  vad?: VadOpts;
  /** 每句转写完成回调（在串行队列内执行，可安全追加共享状态）。 */
  onUtterance?: (u: UtteranceResult) => void | Promise<void>;
  /** 队列错误回调（每次失败都会调；转写队列继续，不中断后续句）。 */
  onError?: (message: string) => void;
}

/** VAD 喂入粒度上限：大批量喂入按 320ms 拆开，小包原样通过（不改变实时链路行为）。 */
const MAX_FEED_SAMPLES = 5120;

export class UtteranceTranscriber {
  /** 各句转写文本（顺序即说话顺序；供听写拼接成稿）。 */
  texts: string[] = [];
  /** 队列内首个错误（听写 finish 时无任何文本则上报）。 */
  error: string | null = null;
  private canceled = false;
  private seq = 0;
  private chain: Promise<void> = Promise.resolve();
  private vad: EnergyVad;

  constructor(private opts: UtteranceTranscriberOpts) {
    this.vad = new EnergyVad({ sampleRate: 16000, ...opts.vad });
    this.vad.onutterance = (pcm, startMs, endMs) => {
      this.enqueue(() => this.transcribe(pcm, startMs, endMs));
    };
  }

  /** 喂入 PCM（任意块大小；内部按需拆成 ≤320ms 粒度）。 */
  feed(pcm: Int16Array): void {
    for (let o = 0; o < pcm.length; o += MAX_FEED_SAMPLES) {
      this.vad.feed(pcm.subarray(o, Math.min(o + MAX_FEED_SAMPLES, pcm.length)));
    }
  }

  /** 结束时调用：把还在攒的半句切出来。 */
  flush(): void {
    this.vad.flush();
  }

  /** 排空串行队列（错误已被捕获，不会 reject）。 */
  async waitIdle(): Promise<void> {
    await this.chain;
  }

  /** 取消：队列中未跑的句直接跳过。 */
  cancel(): void {
    this.canceled = true;
  }

  private enqueue(fn: () => Promise<void>): void {
    this.chain = this.chain.then(fn).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (!this.error) this.error = msg;
      this.opts.onError?.(msg);
    });
  }

  private async transcribe(pcm: Int16Array, startMs: number, endMs: number): Promise<void> {
    if (this.canceled) return;
    const n = ++this.seq;
    const wavPath = join(this.opts.workDir, `${this.opts.filePrefix}${n}.wav`);
    let segments: TranscriptSegment[];
    try {
      mkdirSync(this.opts.workDir, { recursive: true });
      writeWav(wavPath, pcm);
      segments = await transcribeUtteranceWithEngine(wavPath, {
        language: config.whisper.language,
        durationMs: Math.max(0, endMs - startMs),
      });
    } finally {
      try {
        rmSync(wavPath, { force: true });
      } catch {
        /* ignore */
      }
    }
    for (const s of segments) {
      const t = s.text.trim();
      if (t) this.texts.push(t);
    }
    await this.opts.onUtterance?.({ index: n, startMs, endMs, segments });
  }
}
