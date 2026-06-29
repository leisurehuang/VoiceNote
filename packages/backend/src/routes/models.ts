import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import { config } from '../config.js';
import { listWhisper, downloadWhisper, deleteWhisper, applyWhisperModel } from '../pipeline/modelStore.js';
import { getSettings, saveSettings, applyPreset } from '../store/settingsStore.js';

/** OpenAI 兼容端点 /v1 → ollama 原生 base（/api/tags、/api/pull 在根，不在 /v1 下）。 */
function nativeBase(): string {
  return config.llm.baseUrl.replace(/\/v1\/?$/, '');
}

/** 仅本地 ollama（localhost / 127.0.0.1）才提供模型管理；云 provider 无「下载」概念。 */
function isLocalOllama(): boolean {
  try {
    const u = new URL(config.llm.baseUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function startSse(raw: ServerResponse): (event: string, data: unknown) => void {
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return (event, data) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function registerModelRoutes(app: FastifyInstance): Promise<void> {
  // ---------- whisper.cpp 模型 ----------
  app.get('/api/models/whisper', async () => listWhisper());

  // 下载（SSE 进度）：event: progress {pct} / done {name} / error {error}
  app.get('/api/models/whisper/download', async (req, reply) => {
    const name = (req.query as { name?: string }).name;
    if (!name) return reply.code(400).send({ error: '缺少 name' });
    reply.hijack();
    const raw = reply.raw;
    const send = startSse(raw);
    const em = downloadWhisper(name);
    em.on('progress', (pct: number) => send('progress', { pct }));
    em.on('done', (d: unknown) => send('done', d));
    em.on('error', (msg: unknown) => send('error', { error: String(msg) }));
    const finish = () => {
      try {
        raw.end();
      } catch {
        /* 连接已关闭 */
      }
    };
    em.on('done', finish);
    em.on('error', finish);
    req.raw.on('close', () => em.removeAllListeners());
    return reply;
  });

  app.put('/api/models/whisper/active', async (req, reply) => {
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name) return reply.code(400).send({ error: '缺少 name' });
    try {
      applyWhisperModel(name);
      return { ok: true, model: config.whisper.model };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/models/whisper/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      deleteWhisper(name);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ---------- ollama 模型（仅本地） ----------
  app.get('/api/models/llm', async () => {
    if (!isLocalOllama()) return { local: false, models: [], active: config.llm.model };
    try {
      const res = await fetch(`${nativeBase()}/api/tags`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { models?: { name: string }[] };
      const models = (j.models ?? []).map((m) => ({
        name: m.name,
        active: m.name === config.llm.model,
      }));
      return { local: true, models, active: config.llm.model };
    } catch (e) {
      return {
        local: true,
        models: [],
        active: config.llm.model,
        error: e instanceof Error ? e.message : '无法连接 ollama',
      };
    }
  });

  // pull（SSE 进度）：ollama /api/pull 流式 JSON lines，解析 completed/total
  app.get('/api/models/llm/pull', async (req, reply) => {
    const name = (req.query as { name?: string }).name;
    if (!name) return reply.code(400).send({ error: '缺少 name' });
    if (!isLocalOllama()) return reply.code(400).send({ error: '仅本地 ollama 支持模型下载' });
    reply.hijack();
    const raw = reply.raw;
    const send = startSse(raw);
    try {
      const res = await fetch(`${nativeBase()}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const j = JSON.parse(line) as {
              completed?: number;
              total?: number;
              status?: string;
              error?: string;
            };
            if (j.error) send('error', { error: j.error });
            else if (j.total && j.completed != null && j.total > 0)
              send('progress', { pct: j.completed / j.total });
            else if (j.status) send('status', { status: j.status });
          } catch {
            /* 偶发不完整 JSON，跳过 */
          }
        }
      }
      send('progress', { pct: 1 });
      send('done', { name });
    } catch (e) {
      send('error', { error: e instanceof Error ? e.message : String(e) });
    }
    try {
      raw.end();
    } catch {
      /* 已关闭 */
    }
    return reply;
  });

  app.delete('/api/models/llm/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!isLocalOllama()) return reply.code(400).send({ error: '仅本地 ollama 支持模型删除' });
    if (name === config.llm.model)
      return reply.code(400).send({ error: '不能删除当前使用的模型，请先切换' });
    try {
      const res = await fetch(`${nativeBase()}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 切换激活预设的 model（运行时即时生效）
  app.put('/api/models/llm/active', async (req, reply) => {
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name) return reply.code(400).send({ error: '缺少 name' });
    const s = getSettings();
    const active = s.presets.find((p) => p.id === s.activePresetId);
    if (!active) return reply.code(400).send({ error: '无激活预设，无法切换模型' });
    active.model = name;
    const saved = saveSettings(s);
    applyPreset(active); // 同步 config.llm.model + incrementalModel
    return { ok: true, active: name, presets: saved.presets };
  });
}
