#!/usr/bin/env bash
# 下载 Windows 平台所需的二进制文件
# 用途：为 Windows 打包准备 ffmpeg、ollama 等依赖

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/resources/bin/windows"

echo "==> 准备 Windows 二进制文件"
mkdir -p "$BIN_DIR"

# ==================== ffmpeg ====================
echo "==> [1/3] 下载 ffmpeg (Windows)"
FFMPEG_VERSION="7.1"
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
FFMPEG_ZIP="$BIN_DIR/ffmpeg.zip"

if [ ! -f "$BIN_DIR/ffmpeg.exe" ]; then
  echo "  下载 ffmpeg..."
  curl -L -o "$FFMPEG_ZIP" "$FFMPEG_URL"
  unzip -j "$FFMPEG_ZIP" "ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe" -d "$BIN_DIR/"
  unzip -j "$FFMPEG_ZIP" "ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe" -d "$BIN_DIR/"
  rm "$FFMPEG_ZIP"
  echo "  ✓ ffmpeg.exe"
  echo "  ✓ ffprobe.exe"
else
  echo "  ✓ ffmpeg.exe (已存在)"
fi

# ==================== ollama ====================
echo "==> [2/3] 下载 ollama (Windows)"
OLLAMA_VERSION="v0.32.6"
OLLAMA_URL="https://github.com/ollama/ollama/releases/download/${OLLAMA_VERSION}/ollama-windows-amd64.zip"
OLLAMA_ZIP="$BIN_DIR/ollama.zip"

if [ ! -f "$BIN_DIR/ollama.exe" ]; then
  echo "  下载 ollama..."
  curl -L -o "$OLLAMA_ZIP" "$OLLAMA_URL"
  unzip -j "$OLLAMA_ZIP" -d "$BIN_DIR/"
  rm "$OLLAMA_ZIP"
  echo "  ✓ ollama.exe"
else
  echo "  ✓ ollama.exe (已存在)"
fi

# ==================== whisper.cpp ====================
echo "==> [3/3] whisper-cli (Windows)"
echo "  需要从 Windows 系统编译，或使用预编译版本"
echo "  选项："
echo "    1. 在 Windows 上编译："
echo "       git clone https://github.com/ggerganov/whisper.cpp.git"
echo "       cd whisper.cpp"
echo "       cmake -B build -DCMAKE_BUILD_TYPE=Release"
echo "       cmake --build build --config Release"
echo "    2. 从 CI 获取（推荐）"
echo "       使用 GitHub Actions 构建产物"
echo ""
echo "  当前状态：待实现"

# ==================== 完成 ====================
echo ""
echo "==> Windows 二进制文件准备完成"
ls -lh "$BIN_DIR"/*.exe 2>/dev/null || echo "  (暂无 .exe 文件)"
