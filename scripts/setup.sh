#!/usr/bin/env bash
# 安装 Voice Notes 依赖：whisper-cpp / ffmpeg / whisper 模型 / Ollama 摘要模型。
set -euo pipefail

MODEL_DIR="${WHISPER_MODEL_DIR:-$HOME/.voice-notes-models}"
MODEL_NAME="${WHISPER_MODEL_NAME:-ggml-large-v3-turbo.bin}"
MODEL_URL_BASE="${WHISPER_MODEL_URL_BASE:-https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b-instruct}"

echo "==> [1/4] brew install whisper-cpp ffmpeg"
brew install whisper-cpp ffmpeg
WHISPER_PREFIX="$(brew --prefix whisper-cpp)"
echo "    whisper-cli: $WHISPER_PREFIX/bin/whisper-cli"

echo "==> [2/4] 下载 whisper 模型 ($MODEL_NAME)"
mkdir -p "$MODEL_DIR"
MODEL_FILE="$MODEL_DIR/$MODEL_NAME"
if [[ -f "$MODEL_FILE" ]]; then
  echo "    已存在，跳过"
else
  echo "    从 $MODEL_URL_BASE 下载（支持断点续传）……"
  # 先试镜像，失败回退官方源
  if ! curl -L --fail -C - --retry 5 --retry-delay 3 -o "$MODEL_FILE" \
        "$MODEL_URL_BASE/$MODEL_NAME"; then
    echo "    镜像失败，尝试 huggingface.co 官方源……"
    curl -L --fail -C - --retry 5 --retry-delay 3 -o "$MODEL_FILE" \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"
  fi
fi
echo "    模型: $MODEL_FILE"

echo "==> [3/4] 启动 Ollama 并拉取摘要模型 ($OLLAMA_MODEL)"
if ! pgrep -x ollama >/dev/null 2>&1; then
  echo "    启动 ollama serve（后台）……"
  nohup ollama serve >/tmp/ollama.log 2>&1 &
  sleep 4
fi
ollama pull "$OLLAMA_MODEL"

echo "==> [4/4] 完成"
cat <<EOF

依赖就绪。现在：
  cp .env.example .env       # 按需改 WHISPER_MODEL 路径（已是默认）
  npm install
  npm run dev                # 前端 http://localhost:5173  后端 :3000

模型档位（改 .env 的 WHISPER_MODEL 即可切换，重新跑本脚本时设 WHISPER_MODEL_NAME）：
  ggml-large-v3-turbo.bin   ~1.5GB  默认，质量接近 large、速度快（推荐）
  ggml-large-v3.bin         ~3.0GB  中文最好，更慢更占内存
  ggml-small.bin            ~466MB  最快，嘈杂环境偏弱
EOF
