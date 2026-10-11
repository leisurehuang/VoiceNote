import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import {
  applyPreset,
  applyGlossary,
  applyTranscriptionEngine,
  applySherpaSettings,
  applyWhisperModelPath,
  applyAsrApi,
  getSettings,
  saveSettings,
  type Settings,
} from '../store/settingsStore.js';

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  // 读取配置（apiKey 明文返回，本地工具便于回显）
  app.get('/api/settings', async () => getSettings());

  // 保存整个配置（presets + activePresetId + whisperModelPath）；保存后即时应用到运行时
  app.put('/api/settings', async (req, reply) => {
    const body = req.body as Settings;
    if (!body || !Array.isArray(body.presets)) {
      return reply.code(400).send({ error: '请求体格式错误' });
    }
    const modelPath = typeof body.whisperModelPath === 'string' ? body.whisperModelPath.trim() : '';
    if (modelPath && !existsSync(modelPath)) {
      return reply.code(400).send({ error: `whisper 模型文件不存在：${modelPath}` });
    }
    if (
      body.transcriptionEngine === 'api' &&
      (!body.asrApi?.baseUrl?.trim() || !body.asrApi?.model?.trim())
    ) {
      return reply.code(400).send({ error: '云端转写引擎需要填写 Base URL 和模型名' });
    }
    try {
      const saved = saveSettings(body);
      const active = saved.presets.find((p) => p.id === saved.activePresetId);
      if (active) applyPreset(active);
      applyGlossary(saved.glossary); // 术语表运行时即时注入 whisper/摘要 prompt
      applyTranscriptionEngine(saved.transcriptionEngine); // 转写引擎即时切换
      applySherpaSettings(saved.sherpa);
      applyAsrApi(saved.asrApi); // 云端转写配置即时生效
      if (modelPath) applyWhisperModelPath(saved.whisperModelPath);
      return saved;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : '保存失败' });
    }
  });

  // 测试连接：GET {baseUrl}/models（OpenAI 兼容），不写盘；带 model 时顺带校验模型可用性
  app.post('/api/settings/test', async (req, reply) => {
    const { baseUrl, apiKey, model } = (req.body ?? {}) as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };
    if (!baseUrl) return reply.code(400).send({ ok: false, error: '缺少 baseUrl' });
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2500),
        headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      if (!model?.trim()) return { ok: true };
      // 校验模型在端点的模型列表里（部分云服务不暴露列表，仅提示不阻断）
      try {
        const j = (await res.json()) as { data?: { id?: string }[] };
        const ids = (j.data ?? []).map((m) => m.id ?? '');
        const want = model.trim();
        const hit =
          ids.includes(want) || ids.some((id) => id.split(':')[0] === want.split(':')[0]);
        return hit
          ? { ok: true }
          : { ok: true, warning: `连接成功，但端点模型列表中未见「${want}」，请确认模型名` };
      } catch {
        return { ok: true };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '连接失败' };
    }
  });
}
