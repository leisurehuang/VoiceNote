#!/usr/bin/env bash
# 下载 Linux 平台所需的二进制文件
# 用途：为 Linux 打包准备 ffmpeg、ollama 等依赖

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/resources/bin/linux"

echo "==> 准备 Linux 二进制文件"
mkdir -p "$BIN_DIR"

# ==================== ffmpeg ====================
echo "==> [1/3] 下载 ffmpeg (Linux)"
FFMPEG_URL="https://github.com/gyan-dev/ffmpeg-linux-builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"
FFMPEG_TAR="$BIN_DIR/ffmpeg.tar.xz"

if [ ! -f "$BIN_DIR/ffmpeg" ]; then
  echo "  下载 ffmpeg..."
  curl -L -o "$FFMPEG_TAR" "$FFMPEG_URL"
  tar -xf "$FFMPEG_TAR" --strip-components=1 -C "$BIN_DIR/" --wildcards "*/ffmpeg" "*/ffprobe"
  rm "$FFMPEG_TAR"
  chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
  echo "  ✓ ffmpeg"
  echo "  ✓ ffprobe"
else
  echo "  ✓ ffmpeg (已存在)"
fi

# ==================== ollama ====================
echo "==> [2/3] 下载 ollama (Linux)"
OLLAMA_VERSION="v0.32.6"  # 使用固定版本，可从 GitHub API 获取最新
OLLAMA_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-linux-amd64.tar.zst"
OLLAMA_TAR="$BIN_DIR/ollama.tar.zst"

if [ ! -f "$BIN_DIR/ollama" ]; then
  echo "  下载 ollama..."
  curl -L -o "$OLLAMA_TAR" "$OLLAMA_URL"
  tar -xzf "$OLLAMA_TAR" -C "$BIN_DIR/"
  rm "$OLLAMA_TAR"
  chmod +x "$BIN_DIR/ollama"
  echo "  ✓ ollama"
else
  echo "  ✓ ollama (已存在)"
fi

# ==================== whisper.cpp ====================
echo "==> [3/3] whisper-cli (Linux)"
echo "  将从源码编译 whisper.cpp..."

# 检查是否需要编译
if [ ! -f "$BIN_DIR/whisper-cli" ]; then
  echo "  编译中..."
  WHISPER_BUILD_DIR="$ROOT/.build/whisper"
  WHISPER_REPO="$ROOT/.deps/whisper.cpp"

  # 克隆仓库（如不存在）
  if [ ! -d "$WHISPER_REPO" ]; then
    echo "    克隆 whisper.cpp..."
    git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$WHISPER_REPO"
  fi

  # 编译
  mkdir -p "$WHISPER_BUILD_DIR"
  cd "$WHISPER_BUILD_DIR"
  cmake "$WHISPER_REPO" \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_SERVER=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DCMAKE_BUILD_TYPE=Release

  cmake --build . -j"$(nproc)"

  # 复制二进制
  cp "$WHISPER_BUILD_DIR/bin/whisper-cli" "$BIN_DIR/"
  chmod +x "$BIN_DIR/whisper-cli"
  echo "  ✓ whisper-cli"
else
  echo "  ✓ whisper-cli (已存在)"
fi

# ==================== 完成 ====================
echo ""
echo "==> Linux 二进制文件准备完成"
ls -lh "$BIN_DIR" 2>/dev/null
