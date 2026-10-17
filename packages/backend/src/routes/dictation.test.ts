import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// config.ts 在模块初始化时读 env —— 先设 DATA_DIR 再动态 import，隔离真实数据目录
const tmp = mkdtempSync(join(tmpdir(), 'vn-route-'));
process.env.DATA_DIR = tmp;

const transcribeMock = vi.fn();
vi.mock('../pipeline/transcribe.js', () => ({
  transcribeUtteranceWithEngine: (...args: unknown[]) => transcribeMock(...args),
}));

const { registerDictationRoutes } = await import('./dictation.js');
const { getSettings, saveSettings } = await import('../store/settingsStore.js');

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** 「语音 + 收声静音」PCM：800ms 高幅 + 800ms 静音 → VAD 切出一句。 */
function speechPcm(): Buffer {
  const loud = Math.round(0.8 * 16000);
  const n = loud + 800 * 16;
  const pcm = new Int16Array(n);
  pcm.fill(20000, 0, loud);
  return Buffer.from(pcm.buffer);
}

const silence = (sec: number) => Buffer.alloc(16000 * 2 * sec);

let app: Awaited<ReturnType<typeof Fastify>>;

beforeAll(async () => {
  app = Fastify();
  await registerDictationRoutes(app);
  await app.ready();
  // 关闭润色（避免测试触达 LLM），保留其余成稿链路
  const s = getSettings();
  s.dictation.polish = false;
  saveSettings(s);
});

async function post(url: string, body?: Buffer) {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: body ? { 'content-type': 'application/octet-stream' } : {},
    payload: body,
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe('POST /api/dictation/stream', () => {
  it('完整链路：start → chunk(语音) → finish 出稿并记历史', async () => {
    transcribeMock.mockReset();
    transcribeMock.mockResolvedValue([{ text: ' 你好世界 ', startMs: 0, endMs: 700 }]);
    const { body: start } = await post('/api/dictation/stream/start');
    const id = start.streamId as string;

    const chunk = await post(`/api/dictation/stream/${id}/chunk`, speechPcm());
    expect(chunk.status).toBe(200);
    expect(chunk.body).toMatchObject({ ok: true, samples: speechPcm().length / 2 });

    const fin = await post(`/api/dictation/stream/${id}/finish`);
    expect(fin.status).toBe(200);
    expect(fin.body).toMatchObject({ transcript: '你好世界', text: '你好世界', silent: false });
    expect(fin.body.durationMs).toBeGreaterThan(1400);

    const hist = await app.inject({ method: 'GET', url: '/api/dictation/history' });
    const entries = hist.json().entries as Array<{ text: string }>;
    expect(entries[0]!.text).toBe('你好世界');
  });

  it('纯静音 → silent，不调转写引擎', async () => {
    transcribeMock.mockReset();
    const { body: start } = await post('/api/dictation/stream/start');
    const id = start.streamId as string;
    await post(`/api/dictation/stream/${id}/chunk`, silence(1));
    const fin = await post(`/api/dictation/stream/${id}/finish`);
    expect(fin.status).toBe(200);
    expect(fin.body).toMatchObject({ silent: true, text: '' });
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('时长不足 250ms → 400', async () => {
    const { body: start } = await post('/api/dictation/stream/start');
    const id = start.streamId as string;
    await post(`/api/dictation/stream/${id}/chunk`, Buffer.alloc(3200)); // 100ms
    const fin = await post(`/api/dictation/stream/${id}/finish`);
    expect(fin.status).toBe(400);
  });

  it('cancel 后 finish → 404；重复 finish → 404', async () => {
    const { body: start } = await post('/api/dictation/stream/start');
    const id = start.streamId as string;
    await post(`/api/dictation/stream/${id}/cancel`);
    expect((await post(`/api/dictation/stream/${id}/finish`)).status).toBe(404);

    const { body: s2 } = await post('/api/dictation/stream/start');
    await post(`/api/dictation/stream/${s2.streamId}/chunk`, silence(1));
    await post(`/api/dictation/stream/${s2.streamId}/finish`);
    expect((await post(`/api/dictation/stream/${s2.streamId}/finish`)).status).toBe(404);
  });

  it('转写失败且无任何文本 → 500 带原因', async () => {
    transcribeMock.mockReset();
    transcribeMock.mockRejectedValue(new Error('engine down'));
    const { body: start } = await post('/api/dictation/stream/start');
    const id = start.streamId as string;
    await post(`/api/dictation/stream/${id}/chunk`, speechPcm());
    const fin = await post(`/api/dictation/stream/${id}/finish`);
    expect(fin.status).toBe(500);
    expect(String(fin.body.error)).toContain('engine down');
  });
});
