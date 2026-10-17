import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { TranscriptSegment } from '../store/sessionStore.js';

const transcribeMock = vi.fn();
vi.mock('./transcribe.js', () => ({
  transcribeUtteranceWithEngine: (...args: unknown[]) => transcribeMock(...args),
}));

const { UtteranceTranscriber } = await import('./utteranceTranscriber.js');

const workDir = mkdtempSync(join(tmpdir(), 'vn-utt-'));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** 造「语音+收声静音」的 PCM：loudMs 高幅 + 1200ms 静音 → 切出一句。
 *  尾静音需 ≥700ms 收声门限 + 320ms 喂入粒度余量。 */
function speech(loudMs: number, text: string): { pcm: Int16Array; text: string } {
  const n = Math.round((loudMs / 1000) * 16000) + 1200 * 16;
  const pcm = new Int16Array(n);
  pcm.fill(20000, 0, Math.round((loudMs / 1000) * 16000));
  return { pcm, text };
}

function seg(text: string): TranscriptSegment {
  return { text, startMs: 0, endMs: 500 };
}

describe('UtteranceTranscriber', () => {
  it('切句→转写→回调：texts 按说话顺序累积', async () => {
    transcribeMock.mockReset();
    const results: string[] = [];
    const t = new UtteranceTranscriber({
      workDir,
      filePrefix: 'a-',
      onUtterance: (u) =>
        void results.push(`${u.index}:${u.segments.map((s) => s.text.trim()).join('')}`),
    });
    transcribeMock.mockResolvedValueOnce([seg('你好')]).mockResolvedValueOnce([seg('second')]);
    t.feed(speech(600, '').pcm);
    t.feed(speech(600, '').pcm);
    await t.waitIdle();
    expect(results).toEqual(['1:你好', '2:second']);
    expect(t.texts).toEqual(['你好', 'second']);
    expect(t.error).toBeNull();
  });

  it('大块喂入内部按 320ms 拆分，切句行为不变', async () => {
    transcribeMock.mockReset();
    const t = new UtteranceTranscriber({ workDir, filePrefix: 'b-' });
    transcribeMock.mockResolvedValue([seg('x')]);
    t.feed(speech(1000, '').pcm); // 一次性喂 ~1.8s 的大块
    await t.waitIdle();
    expect(transcribeMock).toHaveBeenCalledTimes(1);
    expect(t.texts).toEqual(['x']);
  });

  it('转写抛错：error 记录、onError 上报、后续句不受影响', async () => {
    transcribeMock.mockReset();
    const errors: string[] = [];
    const t = new UtteranceTranscriber({
      workDir,
      filePrefix: 'c-',
      onError: (m) => void errors.push(m),
    });
    transcribeMock
      .mockRejectedValueOnce(new Error('engine boom'))
      .mockResolvedValueOnce([seg('ok')]);
    t.feed(speech(600, '').pcm);
    t.feed(speech(600, '').pcm);
    await t.waitIdle();
    expect(t.error).toBe('engine boom');
    expect(errors).toEqual(['engine boom']);
    expect(t.texts).toEqual(['ok']);
  });

  it('cancel()：队列中未跑的句被跳过', async () => {
    transcribeMock.mockReset();
    const t = new UtteranceTranscriber({ workDir, filePrefix: 'd-' });
    let resolveFirst: () => void;
    transcribeMock.mockImplementationOnce(
      () =>
        new Promise<TranscriptSegment[]>((r) => {
          resolveFirst = () => r([seg('first')]);
        }),
    );
    transcribeMock.mockResolvedValue([seg('never')]);
    t.feed(speech(600, '').pcm);
    t.feed(speech(600, '').pcm);
    await new Promise((r) => setTimeout(r, 0)); // 让第一句转写真正开跑
    t.cancel(); // 第一句在跑，第二句还在队列里
    resolveFirst!();
    await t.waitIdle();
    expect(t.texts).toEqual(['first']);
    expect(transcribeMock).toHaveBeenCalledTimes(1);
  });

  it('flush() 把尾句切出并完成转写', async () => {
    transcribeMock.mockReset();
    const t = new UtteranceTranscriber({ workDir, filePrefix: 'e-' });
    transcribeMock.mockResolvedValue([seg('tail')]);
    const loud = new Int16Array(16000); // 1s 连续语音，无收声静音
    loud.fill(20000);
    t.feed(loud);
    await t.waitIdle();
    expect(t.texts).toEqual([]);
    t.flush();
    await t.waitIdle();
    expect(t.texts).toEqual(['tail']);
  });
});
