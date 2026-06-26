# Voice Notes · 语音转笔记 / 会议纪要

一个**本地运行**的 Web 应用：浏览器录音或上传音频 → 本地 whisper.cpp 转写 → 本地 Ollama 生成中文摘要 → 查看逐字稿与摘要、导出 Markdown。全程不联网、数据不出本机，适合个人/小范围使用。

## 功能

- 🎙️ **浏览器录音**：实时录制（Chrome 产出 webm、Safari 产出 m4a，自动适配）。
- 📁 **上传音频**：拖拽 / 选择 mp3、m4a、wav、webm、aiff 等，带上传进度。
- 🔁 **三段流水线**：ffmpeg 转码（16kHz 单声道 wav）→ whisper.cpp 转写（逐字逐句实时流式）→ Ollama 生成结构化摘要（token 实时流式）。
- ⚡ **实时进度**：SSE 推送，转写和摘要边出边看。
- 📝 **查看 / 导出**：逐字稿带时间戳；摘要可「自定义提示重新生成」；一键复制或下载 Markdown。
- 🩺 **依赖自检**：首页显示 ffmpeg / whisper-cli / 模型 / Ollama 是否就绪。

## 快速开始

```bash
# 1. 装系统依赖、下模型、拉 LLM（首次，需联网）
npm run setup        # brew install whisper-cpp ffmpeg + 下载 turbo 模型 + ollama pull

# 2. 装项目依赖
npm install

# 3a. 开发模式（前端热更新 http://localhost:5173，后端 :3000）
npm run dev

# 3b. 或生产模式（单进程 http://localhost:3000）
npm run build && npm start
```

打开浏览器访问对应地址即可。生产模式下后端单进程同时托管前端和 API。

## 环境要求

- macOS（Apple Silicon 推荐，M 系列跑 whisper 很快；本机实测 M4 / 16GB）。
- Node.js 22+、Homebrew。
- 外部依赖由 `npm run setup` 自动安装：
  - `whisper-cpp`（keg-only，路径见下）、`ffmpeg`
  - Whisper 模型 `ggml-large-v3-turbo.bin`（~1.5GB，默认走 hf-mirror 镜像）
  - Ollama 模型 `qwen2.5:7b-instruct`（~4.7GB）

> `setup.sh` 用 hf-mirror.com 下载模型（国内更稳）；也可手动用任何方式下载 `.bin` 后在 `.env` 指向它。

## 配置（`.env`）

复制 `.env.example` 为 `.env`，绝大多数情况下用默认值即可：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 后端端口 |
| `WHISPER_MODEL` | `~/.voice-notes-models/ggml-large-v3-turbo.bin` | 模型文件，可换成 large-v3 / small |
| `WHISPER_LANGUAGE` | auto | 固定中文可设 `zh`，跳过自动检测 |
| `WHISPER_PROMPT` | 以下是普通话的句子。 | 解码预热，偏置中文输出 |
| `OLLAMA_BASE_URL` | http://localhost:11434/v1 | OpenAI 兼容端点，可换成任意云 API |
| `OLLAMA_MODEL` | qwen2.5:7b-instruct | 摘要模型 |

**换云 LLM**：把 `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_API_KEY` 改成 DeepSeek、通义、OpenAI 等的值即可，无需改代码。

## 模型档位

| 模型 | 大小 | 说明 |
|---|---|---|
| `ggml-large-v3-turbo.bin` | ~1.5GB | **默认**，质量接近 large、速度快 |
| `ggml-large-v3.bin` | ~3.0GB | 中文最好，更慢更占内存 |
| `ggml-small.bin` | ~466MB | 最快，嘈杂环境偏弱 |

切换只需改 `.env` 的 `WHISPER_MODEL`（或重跑 `WHISPER_MODEL_NAME=xxx npm run setup`）。

## 架构

```
voice-notes/
├── packages/backend/   Fastify + TS：API、流水线、SSE、文件存储
│   └── src/
│       ├── pipeline/   ffmpeg.ts / whisper.ts / summarize.ts / orchestrator.ts
│       ├── store/      sessionStore.ts（文件系统，每会话一个目录）
│       ├── routes/     sessions.ts（含 SSE、导出、重新摘要）
│       └── config.ts   env + 依赖自检 + /api/health
├── packages/frontend/  Vite + React + TS：录音/上传/进度/详情/列表
└── scripts/            setup.sh / fetch-model.mjs / 冒烟测试
```

- **存储**：无数据库。每个会话是 `data/sessions/<id>/` 一个目录（`meta.json` + 源音频 + `audio.wav` + `transcript.json` + `summary.md`）。服务重启会自动把「运行中」的会话重置为可重跑。
- **进度**：whisper/LLM 输出经 SSE（`/api/sessions/:id/events`）实时推送 `segment` / `summary-token` 事件。
- **可插拔 LLM**：后端只调一个 OpenAI 兼容 `/chat/completions`。

## 常见问题

- **录音没声音/权限**：浏览器需授权麦克风；Safari 用系统设置 → 隐私 → 麦克风。
- **摘要失败「无法连接 LLM」**：先 `ollama serve` 启动 Ollama。
- **首页提示缺依赖**：运行 `npm run setup`。
- **模型下载慢/失败**：`setup.sh` 默认用 hf-mirror；也可手动下载后改 `.env` 的 `WHISPER_MODEL` 指向文件。

## 开发

```bash
npm run dev          # 同时起 vite(5173) 和后端(3000)，vite 代理 /api
npm run typecheck    # 前后端类型检查
npm run build        # 构建前端到 packages/frontend/dist
```

冒烟测试（需后端在跑）：

```bash
node scripts/smoke-m2.mjs            # 上传/转码/删除
node scripts/smoke-m3.mjs <音频>      # SSE 转写 + 摘要全链路
node scripts/verify-prod.mjs         # 生产模式自检
```

## 桌面应用（Mac .app / .dmg）

可打包成**双击即用的自包含 Mac 应用**（Electron 原生窗口，arm64）。所有依赖——whisper-cli、ffmpeg、Ollama、whisper 模型、qwen2.5:7b——全部打进 app，拷到别的 Apple Silicon Mac 无需安装任何东西。

### 打包步骤

```bash
npm install                 # 装 electron 等
bash scripts/assemble-resources.sh   # 组装 resources/（二进制+模型，~6GB，首次较慢）
npm run desktop:dist        # 产出 packages/desktop/release/Voice Notes-0.1.0-arm64.dmg
```

- `assemble-resources.sh`：esbuild 后端单文件 + 前端 dist、拷 ollama、用 `bundle-dylibs.mjs` 收拢 whisper-cli/ffmpeg 的动态库并 ad-hoc 重签、拷 turbo 模型、从 `~/.ollama` 抽取 qwen 模型。
- `build-app.sh`（由 `desktop:dist` 调用）：拷 Electron 自带 `Electron.app` → 注入 app 代码 + resources → 改 Info.plist → 重签 → `hdiutil` 生成可拖拽安装的 dmg。（不依赖 electron-builder，规避其原生辅助下载问题。）

产物：

```
packages/desktop/release/Voice Notes-0.1.0-arm64.dmg   (~5.9GB)
```

### 分发须知

- **架构**：仅 Apple Silicon（arm64）。Intel Mac 无法运行。
- **未签名**（无 Apple 开发者账号）：收件人首次打开会被 Gatekeeper 拦，两种放行方式：
  - 右键 app →「打开」→ 确认；或
  - 终端执行 `xattr -cr "/Applications/Voice Notes.app"`
- **体积**：约 5.9GB（两个模型占大头）。可通过不打包 qwen、改成首次启动 `ollama pull` 来瘦身（需改 assemble 脚本，首跑需联网）。
- 启动日志在 `~/Library/Application Support/voice-notes/main.log`，排查问题看这里。

### 桌面开发模式

```bash
npm run desktop:dev   # 用系统 brew 装的 whisper/ffmpeg/ollama，弹原生窗口联调
```
