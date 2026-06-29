import type { FastifyInstance } from 'fastify';
import { applyPreset, applyGlossary, getSettings, saveSettings, type Settings } from '../store/settingsStore.js';

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  // 读取配置（apiKey 明文返回，本地工具便于回显）
  app.get('/api/settings', async () => getSettings());

  // 保存整个配置（presets + activePresetId）；若存在激活预设则应用到 config.llm
  app.put('/api/settings', async (req, reply) => {
    const body = req.body as Settings;
    if (!body || !Array.isArray(body.presets)) {
      return reply.code(400).send({ error: '请求体格式错误' });
    }
    try {
      const saved = saveSettings(body);
      const active = saved.presets.find((p) => p.id === saved.activePresetId);
      if (active) applyPreset(active);
      applyGlossary(saved.glossary); // 术语表运行时即时注入 whisper/摘要 prompt
      return saved;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : '保存失败' });
    }
  });

  // 测试连接：GET {baseUrl}/models（OpenAI 兼容），不写盘
  app.post('/api/settings/test', async (req, reply) => {
    const { baseUrl, apiKey } = (req.body ?? {}) as { baseUrl?: string; apiKey?: string };
    if (!baseUrl) return reply.code(400).send({ ok: false, error: '缺少 baseUrl' });
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2500),
        headers: { Authorization: `Bearer ${apiKey ?? ''}` },
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '连接失败' };
    }
  });
}
