# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Voice Notes 是一个**本地优先**的语音转笔记应用。浏览器录音或上传音频 → 本地 `whisper.cpp` 转写 → OpenAI 兼容 LLM（默认 Ollama `qwen2.5:7b-instruct`）生成结构化中文摘要 → 查看逐字稿与摘要、导出 Markdown。UI、代码注释、LLM system prompt 均为中文——改动面向用户的文案时请保持中文。

## 常用命令

```bash
npm run setup            # 首次：brew install whisper-cpp ffmpeg + 下载 turbo 模型 + ollama pull
npm install
npm run dev              # 开发：后端 tsx watch(:3000) + vite(:5173，把 /api 含 WS 代理到 :3000)
npm run build            # 构建前端 → packages/frontend/dist
npm start                # 生产：单个 Fastify 进程(:3000)同时托管 API 和前端构建产物
npm run typecheck        # 先后端再前端跑 tsc --noEmit
npm run bundle:backend   # esbuild 后端 src/index.ts → resources/app/backend.cjs（桌面打包用）
npm run desktop:dev      # Electron 开发窗口，用系统 brew 装的 whisper/ffmpeg/ollama
```

冒烟测试（需后端在跑；这些脚本并非自动化测试，而是手动 Node 脚本）：
```bash
node scripts/smoke-m2.mjs            # 上传/转码/删除
node scripts/smoke-m3.mjs <音频>      # SSE 转写 + 摘要全链路
node scripts/verify-prod.mjs         # 生产模式自检
```

桌面 `.dmg` 打包：先 `bash scripts/assemble-resources.sh`，再 `npm run desktop:dist` → `packages/desktop/release/`。

**没有测试框架、没有 linter**——`npm run typecheck` 是唯一的静态校验关卡。全仓库 ESM（`"type": "module"`）。

## Monorepo 结构

npm workspaces，三个包：
- `packages/backend` — Fastify + TypeScript（核心；`dist/` 由 `tsc` 产出）
- `packages/frontend` — Vite + React 18 + TypeScript
- `packages/desktop` — Electron 外壳；`src/main.cjs` fork 后端并打开原生窗口

## 后端架构（需要读多个文件才能理解的部分）

**存储 = 文件系统，无数据库。** `store/sessionStore.ts` 是真相源。每个会话是 `data/sessions/<id>/` 一个目录，含 `meta.json`、原始 `source.<ext>`、16kHz 单声道 `audio.wav`、`transcript.json`、`summary.md`。内存里用 `Map<id, {meta, emitter}>` 索引；`meta` 是真相，每次变更都**原子落盘**（先写 `.tmp` 再 rename）。每个会话还独占一个 `EventEmitter`——SSE/WebSocket 的实时推送就靠它扇出（`store.emitter(id)`）。

启动时 `sessionStore.init()` 扫描历史会话，把停在「运行中」状态的重置为 `error`（避免崩溃后留下僵尸会话）。`config.ts` 里的 `SESSION_RUNNING_STATUSES` 定义了哪些状态算「运行中」。

**两条输入路径共用同一套转写内核：**
- **批处理**（`POST /api/sessions` → `POST /:id/process`）：`pipeline/orchestrator.ts` 串行跑三阶段——`convertStage`（ffmpeg→wav）、`transcribeStage`（whisper）、`summarizeStage`（LLM），进度经 SSE（`/api/sessions/:id/events`）推送。`runPipeline` **绝不能抛错**：任何阶段失败都捕获并落成 `error` 态，前端可重试。
- **实时**（`routes/realtime.ts` 里的 `GET /api/realtime` WebSocket）：浏览器流式上传 16kHz PCM；`pipeline/vad.ts`（`EnergyVad`）切分成句；每句用**同一个** `transcribeWavFile()` 转写并追加进逐字稿。**滚动增量摘要**并行运行（按阈值门控，用一个 promise `chain` 串行化，避免 whisper/摘要并发竞态）。收到 `stop` 时 `finalize()` 拼接全部 PCM → `audio.wav`，并跑一次高质量终版摘要。

两条路径都调用 `pipeline/whisper.ts::transcribeWavFile()`——唯一的 whisper-cli 封装（边解析 stdout 行做流式，结束后再读 JSON）。都调用 `pipeline/summarize.ts::postChat()`——唯一的 OpenAI 兼容 `/chat/completions` 客户端（流式 + 非流式）。

**LLM 可插拔、运行时可变。** 后端只对接一个 OpenAI 兼容的 `/chat/completions` 端点。`config.ts` 在启动时从 env 构造 `config.llm`，但 `store/settingsStore.ts` 会**运行时覆盖**它：应用内设置页把预设存进 `data/settings.json`；`applyPreset()` 直接改 `config.llm.{baseUrl,apiKey,model,incrementalModel}`——无需重启。每次摘要调用都在调用时读取 `config.llm`。**终版**和**增量**的 system prompt 是 `config.ts` 里的硬编码常量（`SUMMARY_SYSTEM_PROMPT`、`INCREMENTAL_SUMMARY_SYSTEM_PROMPT`）。

**两个 prompt 要知道**：终版摘要是严格的「会议纪要」prompt；增量是更快的滚动合并版，录音结束后会被终版覆盖。

### 后端易踩的坑
- **模块解析是 NodeNext** → 相对导入**必须**带 `.js` 后缀（如 `from '../config.js'`），即便源文件是 `.ts`。tsconfig 开了 `strict` + `noUncheckedIndexedAccess`。
- **绝不能对会话 `EventEmitter` emit `'error'` 事件**——Node 会把无监听的 `'error'` 当致命错误抛出。流水线改用 `'failed'`（见 `orchestrator.ts` 里的注释）。
- `config.ts` 手写了自己的 `.env` 解析器（不依赖 `dotenv`）；进程已有的环境变量优先于文件值。
- `runPipeline` 是 fire-and-forget（`void runPipeline(id)`）；路由立即返回 `202`。
- 实时 WS 的增量摘要状态只在内存里；只有终版摘要会落盘到 `summary.md`。

## 前端架构

Vite + React，**无路由库、无状态管理库**。`App.tsx` 持有一个 `View` 状态机（`new | processing | detail | settings`）加 `record | realtime | upload` 三个 tab。一个 `busy` 标志在录音、整理、上传期间**锁定模式/视图切换**（即「录音锁定」功能——没有充分理由别绕过它）。

SSE 在 `components/ProgressView.tsx` 消费；实时 WS 在 `hooks/useRealtime.ts` + `components/RealtimeView.tsx`；`SessionDetail` 驱动音频播放，逐字稿高亮跟随播放进度。API 调用集中在 `api/client.ts`；类型与后端的 `SessionMeta`/`HealthStatus` 对齐。

开发：vite 跑在 `:5173`，把 `/api`（含 WebSocket 升级）代理到 `localhost:3000`。

## 桌面打包

`packages/desktop/src/main.cjs` 是 Electron 主进程。它 **fork `backend.cjs`**（esbuild 打出的 bundle）到端口 `3100`，并在打包态另起一个自带 `ollama serve` 在 `11435`（避开系统常占的 `11434`）。`isPackaged` 靠检查自带 `vn/bin/ollama` 是否存在来判断——**而非** `app.isPackaged`，因为 app 代码放在 `Resources/app`（非 asar），`app.isPackaged` 不可靠。瘦身版检测到 qwen 缺失时，首启动会 `ollama pull` 并带进度 splash。

`scripts/assemble-resources.sh` 收拢全部资源（esbuild 后端、拷 ollama、用 bundle-dylibs 收拢 whisper-cli/ffmpeg 动态库并重签、拷模型）；`scripts/build-app.sh` 拿 Electron 自带的 `Electron.app` 注入资源/图标后生成 `.dmg`——刻意避开 `electron-builder`。仅支持 Apple Silicon（arm64）；app 未签名。

## 端口速查
- `3000` — 后端（开发 + 生产 web）
- `5173` — vite 开发服务器
- `3100` — Electron 下运行的后端
- `11434` — 系统 Ollama（开发）
- `11435` — Electron 自带的 Ollama
