import { createReadStream, existsSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { config, SESSION_RUNNING_STATUSES } from '../config.js';
import { runPipeline } from '../pipeline/orchestrator.js';
import { summarize, extractTodos } from '../pipeline/summarize.js';
import * as store from '../store/sessionStore.js';
import type { SessionDetail, TranscriptSegment } from '../store/sessionStore.js';

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** 拼装导出用的 Markdown（标题 + 元信息 + 摘要 + 逐字稿）。 */
export function buildExportMarkdown(d: SessionDetail): string {
  const lines: string[] = [];
  lines.push(`# ${d.title}`);
  lines.push('');
  lines.push(`> ${d.createdAt} · 时长 ${d.durationMs ? fmtMs(d.durationMs) : '未知'} · 来源：${d.sourceKind === 'record' ? '录音' : '上传'}`);
  lines.push('');
  if (d.summary && d.summary.trim()) {
    lines.push('## 摘要', '');
    lines.push(d.summary.trim(), '');
  }
  lines.push('## 逐字稿', '');
  for (const seg of d.transcript) {
    lines.push(`**[${fmtMs(seg.startMs)}]** ${seg.text}`);
  }
  return lines.join('\n');
}

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  // 创建会话：multipart 字段 audio（文件）+ 可选 title / sourceKind。
  // 用 req.parts() 遍历，兼容「字段在文件之前/之后」两种顺序（前端固定先发字段更稳）。
  app.post('/api/sessions', async (req, reply) => {
    let id: string | null = null;
    const fields: Record<string, string> = {};
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          const val = String(part.value);
          fields[part.fieldname] = val;
          // 若 title 字段在文件之后到达，补更新标题
          if (part.fieldname === 'title' && id) {
            store.update(id, { title: val.trim() || '未命名' });
          }
        } else if (part.type === 'file' && part.fieldname === 'audio' && !id) {
          id = await store.createFromUpload({
            stream: part.file,
            filename: part.filename ?? 'audio',
            mimeType: part.mimetype ?? 'application/octet-stream',
            sourceKind: fields.sourceKind === 'record' ? 'record' : 'upload',
            title: fields.title?.trim() || '未命名',
          });
        }
      }
    } catch (e) {
      req.log.error({ err: e }, '创建会话失败');
      return reply.code(500).send({ error: '保存上传文件失败' });
    }
    if (!id) return reply.code(400).send({ error: '缺少音频文件（multipart 字段名 audio）' });
    return reply.code(201).send({ id });
  });

  // 列表
  app.get('/api/sessions', async () => store.list());

  // 全文搜索：标题 + 摘要 + 逐字稿
  app.get('/api/search', async (req) => store.search((req.query as { q?: string }).q ?? ''));

  // 详情（含逐字稿 + 摘要）
  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = store.getDetail(id);
    if (!detail) return reply.code(404).send({ error: '会话不存在' });
    return detail;
  });

  // 触发流水线（异步）
  app.post('/api/sessions/:id/process', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = store.get(id);
    if (!meta) return reply.code(404).send({ error: '会话不存在' });
    if (SESSION_RUNNING_STATUSES.has(meta.status)) {
      return reply.code(409).send({ error: '该会话正在处理中' });
    }
    void runPipeline(id);
    return reply.code(202).send({ id, status: 'processing' });
  });

  // SSE：实时推送处理进度 / 流式逐字稿（event: meta/stage/segment/done/failed）
  app.get('/api/sessions/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const em = store.emitter(id);
    const meta = store.get(id);
    if (!em || !meta) return reply.code(404).send({ error: '会话不存在' });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('meta', meta); // 连接即回放当前状态

    const onMeta = (m: unknown) => send('meta', m);
    const onStage = (s: unknown) => send('stage', s);
    const onSegment = (s: unknown) => send('segment', s);
    const onDone = (d: unknown) => send('done', d);
    const onFailed = (e: unknown) => send('failed', e);
    const onSummaryToken = (t: unknown) => send('summary-token', t);
    em.on('meta', onMeta);
    em.on('stage', onStage);
    em.on('segment', onSegment);
    em.on('done', onDone);
    em.on('failed', onFailed);
    em.on('summary-token', onSummaryToken);

    const ping = setInterval(() => raw.write(': ping\n\n'), 15000);

    req.raw.on('close', () => {
      clearInterval(ping);
      em.off('meta', onMeta);
      em.off('stage', onStage);
      em.off('segment', onSegment);
      em.off('done', onDone);
      em.off('failed', onFailed);
      em.off('summary-token', onSummaryToken);
      try {
        raw.end();
      } catch {
        /* 连接已关闭 */
      }
    });

    return reply;
  });

  // 重新生成摘要（可选自定义 system prompt / model）
  app.post('/api/sessions/:id/resummarize', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = store.get(id);
    if (!meta) return reply.code(404).send({ error: '会话不存在' });
    const segments = store.readTranscript(id);
    if (!segments.length) return reply.code(409).send({ error: '尚无逐字稿，无法生成摘要' });

    const body = (req.body ?? {}) as { systemPrompt?: string; model?: string };
    const transcript = segments.map((s) => s.text).join('\n');
    // 自定义提示是在默认 system prompt 基础上追加「额外要求」，而非整体替换
    const custom = body.systemPrompt?.trim();
    const systemPrompt = custom ? `${config.llm.summarySystemPrompt}\n\n额外要求：${custom}` : undefined;
    await store.update(id, { status: 'summarizing', stage: '重新生成摘要', error: null });

    void (async () => {
      try {
        const { text, model } = await summarize(transcript, {
          systemPrompt,
          model: body.model,
          onToken: (delta) => store.emitter(id)?.emit('summary-token', { token: delta }),
        });
        store.writeSummary(id, text, model);
        await store.update(id, { status: 'done', stage: '完成', error: null });
        store.emitter(id)?.emit('done', { id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await store.update(id, { status: 'error', stage: '出错', error: msg });
        store.emitter(id)?.emit('failed', { id, error: msg });
      }
    })();

    return reply.code(202).send({ id, status: 'resummarizing' });
  });

  // 编辑摘要正文（人工修订）；标 model='manual' 与 LLM 生成区分
  app.put('/api/sessions/:id/summary', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: '会话不存在' });
    const { summary } = (req.body ?? {}) as { summary?: string };
    if (typeof summary !== 'string') return reply.code(400).send({ error: '缺少 summary' });
    store.writeSummary(id, summary, 'manual');
    return { ok: true };
  });

  // 编辑逐字稿（人工修订）；清洗仅保留合法字段，并触发 meta 广播
  app.put('/api/sessions/:id/transcript', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: '会话不存在' });
    const { segments } = (req.body ?? {}) as { segments?: TranscriptSegment[] };
    if (!Array.isArray(segments)) return reply.code(400).send({ error: '缺少 segments' });
    const clean: TranscriptSegment[] = [];
    for (const s of segments) {
      if (s && typeof s.text === 'string') {
        clean.push({ text: s.text, startMs: Number(s.startMs) || 0, endMs: Number(s.endMs) || 0 });
      }
    }
    store.writeTranscript(id, clean);
    store.update(id, {}); // 触发 updatedAt + meta 广播
    return { ok: true };
  });

  // 抽取待办事项（LLM 结构化，持久化到 todos.json）
  app.post('/api/sessions/:id/todos', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: '会话不存在' });
    const segments = store.readTranscript(id);
    if (!segments.length) return reply.code(409).send({ error: '尚无逐字稿，无法抽取待办' });
    const transcript = segments.map((s) => s.text).join('\n');
    try {
      const todos = await extractTodos(transcript);
      store.writeTodos(id, todos);
      return { todos };
    } catch (e) {
      return reply.code(500).send({ error: e instanceof Error ? e.message : '抽取待办失败' });
    }
  });

  // 读取已抽取的待办（未抽取过返回空数组）
  app.get('/api/sessions/:id/todos', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: '会话不存在' });
    return { todos: store.readTodos(id) };
  });

  // 导出为 Markdown
  app.get('/api/sessions/:id/export.md', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = store.getDetail(id);
    if (!detail) return reply.code(404).send({ error: '会话不存在' });
    const utf8Name = encodeURIComponent(`${detail.title || 'voice-notes'}.md`.slice(0, 80));
    reply.header('Content-Type', 'text/markdown; charset=utf-8');
    // 头必须是 ASCII：filename 给兜底名，filename* 给真实 UTF-8 文件名（RFC 5987）
    reply.header('Content-Disposition', `attachment; filename="voice-notes.md"; filename*=UTF-8''${utf8Name}`);
    return buildExportMarkdown(detail);
  });

  // 音频播放：流式返回 16kHz audio.wav（与逐字稿时间轴对齐），支持 Range 以便原生 <audio> 拖动 seek
  app.get('/api/sessions/:id/audio', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.get(id)) return reply.code(404).send({ error: '会话不存在' });
    const path = store.audioPath(id);
    if (!existsSync(path)) return reply.code(404).send({ error: '无音频' });
    const total = statSync(path).size;
    reply.header('Content-Type', 'audio/wav');
    reply.header('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (!range) {
      reply.header('Content-Length', total);
      return reply.code(200).send(createReadStream(path));
    }
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m) {
      reply.header('Content-Range', `bytes */${total}`);
      return reply.code(416).send();
    }
    let start = parseInt(m[1]!, 10);
    const endStr = m[2];
    let end = endStr ? parseInt(endStr, 10) : total - 1;
    if (start >= total) {
      reply.header('Content-Range', `bytes */${total}`);
      return reply.code(416).send();
    }
    if (end >= total) end = total - 1;
    reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
    reply.header('Content-Length', end - start + 1);
    return reply.code(206).send(createReadStream(path, { start, end }));
  });

  // 音频下载：上传会话给原始 source.<ext>；实时会话无原始文件，回退 audio.wav
  app.get('/api/sessions/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = store.get(id);
    if (!meta) return reply.code(404).send({ error: '会话不存在' });
    const isRealtime = meta.sourceKind === 'record' && meta.sourceName === 'realtime';
    const path = isRealtime ? store.audioPath(id) : store.sourcePath(id);
    if (!existsSync(path)) return reply.code(404).send({ error: '无源文件' });
    const contentType =
      isRealtime || meta.mimeType === 'audio/realtime'
        ? 'audio/wav'
        : meta.mimeType || 'application/octet-stream';
    const rawName = isRealtime ? `${(meta.title || 'realtime').slice(0, 60)}.wav` : meta.sourceName;
    const utf8Name = encodeURIComponent(rawName.slice(0, 120));
    reply.header('Content-Type', contentType);
    reply.header(
      'Content-Disposition',
      `attachment; filename="audio"; filename*=UTF-8''${utf8Name}`,
    );
    return reply.send(createReadStream(path));
  });

  // 删除
  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = store.remove(id);
    if (!ok) return reply.code(404).send({ error: '会话不存在' });
    return { ok: true };
  });
}
