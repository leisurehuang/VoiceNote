import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 构建时从根 package.json 读版本号内联，dev/build 均生效，不依赖运行时读文件
const here = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(
  readFileSync(resolve(here, '..', '..', 'package.json'), 'utf8'),
) as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期把所有 /api 请求（含 WebSocket）代理到 Fastify 后端
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
