import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
