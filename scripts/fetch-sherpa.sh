#!/usr/bin/env bash
# 安装 sherpa-onnx（带说话人分离的本地 ASR 引擎）：预编译二进制 + 3 个 ONNX 模型。
# 可选依赖——只在设置页把「转写引擎」切到 sherpa-onnx 时才需要；默认仍用 whisper.cpp。
#
# 默认装到 ~/.voice-notes-models/sherpa-onnx/（与 whisper 模型同根，config.ts 默认路径即此）。
# 网络不通时：SHERPA_GH_MIRROR / SHERPA_HF_MIRROR 可覆盖（默认国内镜像）。
set -euo pipefail

SHERPA_DIR="${SHERPA_DIR:-$HOME/.voice-notes-models/sherpa-onnx}"
SHERPA_MODELS_DIR="${SHERPA_MODELS_DIR:-$SHERPA_DIR/models}"
SHERPA_VERSION="${SHERPA_VERSION:-v1.12.23}"
# GitHub 直连在国内常超时，默认走 ghproxy.net 代理；可改回 https://github.com/k2-fsa/sherpa-onnx/releases/download
GH_MIRROR="${SHERPA_GH_MIRROR:-https://ghproxy.net/https://github.com/k2-fsa/sherpa-onnx/releases/download}"
HF_MIRROR="${SHERPA_HF_MIRROR:-https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09/resolve/main}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64|x86_64) : ;;  # 用 universal2-shared（同时含 arm64 + x86_64 切片）
  *) echo "不支持的架构：${ARCH}（当前仅 macOS arm64 / x86_64 预编译包）"; exit 1 ;;
esac

mkdir -p "${SHERPA_DIR}" "${SHERPA_MODELS_DIR}"

echo "==> [1/4] 下载 sherpa-onnx 预编译二进制（${SHERPA_VERSION} / osx-universal2-shared）"
BIN_TARBALL="sherpa-onnx-${SHERPA_VERSION}-osx-universal2-shared.tar.bz2"
BIN_TARBALL_PATH="${SHERPA_DIR}/${BIN_TARBALL}"
if [[ -x "${SHERPA_DIR}/bin/sherpa-onnx-offline-speaker-diarization" ]]; then
  echo "    二进制已解压，跳过"
elif [[ -f "${BIN_TARBALL_PATH}" ]]; then
  echo "    发现已下载的 ${BIN_TARBALL}（手动下载？），直接解压……"
  tar xjf "${BIN_TARBALL_PATH}" -C "${SHERPA_DIR}" --strip-components=1
  rm -f "${BIN_TARBALL_PATH}"
else
  echo "    从 ${GH_MIRROR}/${SHERPA_VERSION}/${BIN_TARBALL} 下载……"
  curl -L --fail -C - --retry 5 --retry-delay 3 \
    -o "${BIN_TARBALL_PATH}" "${GH_MIRROR}/${SHERPA_VERSION}/${BIN_TARBALL}"
  # tarball 顶层是 sherpa-onnx-<ver>-osx-universal2-shared/，含 bin/ 与 lib/；strip 后落到 $SHERPA_DIR
  tar xjf "${BIN_TARBALL_PATH}" -C "${SHERPA_DIR}" --strip-components=1
  rm -f "${BIN_TARBALL_PATH}"
fi
DIAR_CLI="${SHERPA_DIR}/bin/sherpa-onnx-offline-speaker-diarization"
ASR_CLI="${SHERPA_DIR}/bin/sherpa-onnx-offline"
if [[ ! -x "${DIAR_CLI}" ]]; then
  echo "    ⚠️ 解压后未找到 ${DIAR_CLI}"
  echo "       该 release tarball 可能不含 CLI；请到 https://github.com/k2-fsa/sherpa-onnx/releases 查找含 bin/ 的 osx 包，"
  echo "       或设 SHERPA_VERSION 指向带 CLI 的版本。"
  ls -la "${SHERPA_DIR}/bin/" 2>/dev/null || true
  exit 1
fi
echo "    diarization: ${DIAR_CLI}"
echo "    asr:         ${ASR_CLI}"

echo "==> [2/4] 下载 pyannote 说话人分段模型（自带 VAD，~7MB）"
SEG_DIR="${SHERPA_MODELS_DIR}/sherpa-onnx-pyannote-segmentation-3-0"
SEG_TARBALL="sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
SEG_TARBALL_PATH="${SHERPA_DIR}/${SEG_TARBALL}"
if [[ -f "${SEG_DIR}/model.onnx" ]]; then
  echo "    已解压，跳过"
elif [[ -f "${SEG_TARBALL_PATH}" ]]; then
  echo "    发现已下载的 ${SEG_TARBALL}，直接解压……"
  tar xjf "${SEG_TARBALL_PATH}" -C "${SHERPA_MODELS_DIR}"
  rm -f "${SEG_TARBALL_PATH}"
else
  curl -L --fail -C - --retry 5 --retry-delay 3 -o "${SEG_TARBALL_PATH}" \
    "${GH_MIRROR}/speaker-segmentation-models/${SEG_TARBALL}"
  tar xjf "${SEG_TARBALL_PATH}" -C "${SHERPA_MODELS_DIR}"
  rm -f "${SEG_TARBALL_PATH}"
fi

echo "==> [3/4] 下载 3D-Speaker 说话人嵌入模型（~37MB）"
EMB_FILE="${SHERPA_MODELS_DIR}/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
if [[ -f "${EMB_FILE}" ]]; then
  echo "    已存在，跳过"
else
  node "${SCRIPT_DIR}/fetch-model.mjs" \
    "${GH_MIRROR}/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx" "${EMB_FILE}"
fi

echo "==> [4/4] 下载 Paraformer 中文 ASR 模型（int8 量化，~110MB）+ tokens"
ASR_DIR="${SHERPA_MODELS_DIR}/sherpa-onnx-paraformer-zh-2024-03-09"
mkdir -p "${ASR_DIR}"
for f in model.int8.onnx tokens.txt; do
  if [[ -f "${ASR_DIR}/${f}" ]]; then
    echo "    ${f} 已存在，跳过"
  else
    node "${SCRIPT_DIR}/fetch-model.mjs" "${HF_MIRROR}/${f}" "${ASR_DIR}/${f}"
  fi
done

echo "==> 完成"
cat <<EOF

sherpa-onnx 就绪。启动 npm run dev 后，在「设置 → 转写引擎」切到 sherpa-onnx 即可启用说话人分离。
默认路径已对齐（config.ts 默认指向 ${SHERPA_DIR}），无需手动配 .env。

如装到别处或想覆盖，设以下环境变量（写进 .env）：
  SHERPA_DIARIZATION_CLI=<diarization 二进制路径>
  SHERPA_ASR_CLI=<sherpa-onnx-offline 路径>
  SHERPA_SEGMENTATION_MODEL=<pyannote model.onnx>
  SHERPA_EMBEDDING_MODEL=<3dspeaker .onnx>
  SHERPA_ASR_MODEL=<paraformer model.int8.onnx>
  SHERPA_ASR_TOKENS=<paraformer tokens.txt>
  TRANSCRIPTION_ENGINE=sherpa        # 启动默认引擎（也可在设置页切）

已知差别：sherpa（Paraformer）仅支持中文识别，且不支持术语表偏置。
EOF
