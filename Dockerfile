# Voice Notes 服务端镜像（后端 + 前端 dist + whisper.cpp(CPU) + ffmpeg + turbo 模型）。
# 摘要用 Ollama，通过 docker-compose 作为 sidecar（OLLAMA_BASE_URL 指向它）。
# 多阶段：构建前端/后端、编译 whisper.cpp，运行镜像精简。

# ---------- 1) 构建前端 dist + 后端单文件 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/frontend/package.json packages/frontend/
COPY packages/backend/package.json packages/backend/
COPY packages/desktop/package.json packages/desktop/
# --ignore-scripts：跳过 electron 的二进制下载（构建用不到），esbuild 仍可用（平台二进制走 optionalDependencies）
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/frontend packages/frontend
COPY packages/backend packages/backend
RUN npm run build -w @voice-notes/frontend \
 && npm run bundle:backend

# ---------- 2) 编译 whisper.cpp（CPU，静态） ----------
FROM debian:bookworm-slim AS whisper
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git \
 && cd whisper.cpp \
 && cmake -B build -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" \
 && cp build/bin/whisper-cli /usr/local/bin/whisper-cli

# ---------- 3) 运行镜像 ----------
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /repo/resources/app/backend.cjs ./backend.cjs
COPY --from=build /repo/packages/frontend/dist ./frontend-dist
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli

# whisper turbo 模型（HF 失败自动换 hf-mirror）
RUN mkdir -p /models \
 && (curl -fL --retry 8 --retry-delay 5 -C - -o /models/ggml-large-v3-turbo.bin \
       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin \
     || curl -fL --retry 8 --retry-delay 5 -C - -o /models/ggml-large-v3-turbo.bin \
       https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin) \
 && ls -lh /models/ggml-large-v3-turbo.bin

ENV PORT=3000 \
    WHISPER_CLI=/usr/local/bin/whisper-cli \
    WHISPER_MODEL=/models/ggml-large-v3-turbo.bin \
    FFMPEG=ffmpeg \
    FFPROBE=ffprobe \
    DATA_DIR=/data \
    FRONTEND_DIST=/app/frontend-dist \
    OLLAMA_BASE_URL=http://ollama:11434/v1 \
    OLLAMA_MODEL=qwen2.5:7b-instruct \
    NODE_ENV=production

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "backend.cjs"]
