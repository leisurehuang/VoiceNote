import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { checkHealth, config } from './config.js';
import { init as initSessions } from './store/sessionStore.js';
import { registerSessionRoutes } from './routes/sessions.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : { level: 'info' },
  });

  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes },
  });

  // 健康检查 / 依赖自检
  app.get('/api/health', async () => checkHealth());

  // 会话相关路由（上传/列表/详情/处理/SSE/重新摘要/导出/删除）
  await registerSessionRoutes(app);

  // 生产模式：托管前端构建产物（packages/frontend/dist），单进程单端口
  if (existsSync(config.frontendDist)) {
    await app.register(fastifyStatic, { root: config.frontendDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html'); // SPA 回退
    });
  }

  return app;
}

async function main() {
  initSessions();

  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    const health = await checkHealth();
    app.log.info(
      { health },
      `Voice Notes 后端已启动：http://localhost:${config.port} （依赖全部就绪：${health.ok}）`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
