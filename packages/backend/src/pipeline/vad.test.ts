import { describe, expect, it } from 'vitest';
import { EnergyVad } from './vad.js';

/** 造 20ms（320 采样）的块：amp=0 为静音，其余为定幅「语音」。 */
function chunk(amp: number): Int16Array {
  const a = new Int16Array(320);
  if (amp) a.fill(amp);
  return a;
}

/** 按毫秒造音频序列（20ms 一块）。 */
function seq(parts: Array<[ms: number, amp: number]>): Int16Array[] {
  const out: Int16Array[] = [];
  for (const [ms, amp] of parts) for (let t = 0; t < ms; t += 20) out.push(chunk(amp));
  return out;
}

const LOUD = 20000; // RMS ≈ 0.61，远超默认阈值 0.015

describe('EnergyVad', () => {
  it('起声→静音收声：切出一句，时间戳覆盖语音区间', () => {
    const cuts: Array<[number, number]> = [];
    const vad = new EnergyVad({ sampleRate: 16000 });
    vad.onutterance = (_p, s, e) => cuts.push([s, e]);
    for (const c of seq([
      [1000, LOUD],
      [1000, 0],
    ]))
      vad.feed(c);
    expect(cuts.length).toBe(1);
    const [s, e] = cuts[0]!;
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(300); // 起声判定最多吃掉 speechOnMs(250ms)
    expect(e).toBeGreaterThan(1500); // 含 700ms 收声静音
    expect(e).toBeLessThan(2100);
  });

  it('太短的噪声（<minMs 350ms）直接丢弃', () => {
    const cuts: number[] = [];
    const vad = new EnergyVad({ sampleRate: 16000 });
    vad.onutterance = () => cuts.push(1);
    // 起声需要连续 250ms 高能，200ms 高能 + 静音 → 从未起声
    for (const c of seq([
      [200, LOUD],
      [500, 0],
      [1000, LOUD],
      [500, 0],
    ]))
      vad.feed(c);
    expect(cuts.length).toBe(0);
  });

  it('连续说话超 15s 强制切句', () => {
    const cuts: Array<[number, number]> = [];
    const vad = new EnergyVad({ sampleRate: 16000 });
    vad.onutterance = (_p, s, e) => cuts.push([s, e]);
    for (const c of seq([[32000, LOUD]])) vad.feed(c);
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    // 每句时长都不超过 maxMs + 一个喂入块（切句判定在块尾部）
    for (const [s, e] of cuts) expect(e - s).toBeLessThanOrEqual(15400);
  });

  it('flush() 把还在攒的半句切出来', () => {
    const cuts: Array<[number, number]> = [];
    const vad = new EnergyVad({ sampleRate: 16000 });
    vad.onutterance = (_p, s, e) => cuts.push([s, e]);
    for (const c of seq([[1000, LOUD]])) vad.feed(c); // 无收声静音，一直 speaking
    expect(cuts.length).toBe(0);
    vad.flush();
    expect(cuts.length).toBe(1);
    expect(cuts[0]![1]).toBeGreaterThanOrEqual(1000);
  });

  it('静音全程不产生任何句', () => {
    const vad = new EnergyVad({ sampleRate: 16000 });
    vad.onutterance = () => {
      throw new Error('不应切句');
    };
    for (const c of seq([[3000, 0]])) vad.feed(c);
    vad.flush();
  });
});
