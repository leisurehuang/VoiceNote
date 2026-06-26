#!/usr/bin/env bash
# 组装桌面打包所需的自包含资源到 resources/。打包前运行（模型大，可重复运行、增量跳过）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/resources"
NODE="${NODE:-node}"

MODEL_TAG="${MODEL_TAG:-qwen2.5:7b-instruct}"
# ollama manifest 路径是 library/<model>/<tag>，即把 tag 里的 ':' 换成 '/'
TAG_PATH="library/${MODEL_TAG/:/\/}"
WHISPER_MODEL_SRC="${WHISPER_MODEL:-$HOME/.voice-notes-models/ggml-large-v3-turbo.bin}"
OLLAMA_MODELS_SRC="${OLLAMA_MODELS_SRC:-$HOME/.ollama/models}"

mkdir -p "$RES/bin/libs" "$RES/models" "$RES/app" "$RES/ollama-models/blobs" "$RES/ollama-models/manifests"

echo "==> [1/7] 后端单文件 + 前端 dist"
( cd "$ROOT" && npm run bundle:backend )
( cd "$ROOT" && npm run build -w @voice-notes/frontend )
rm -rf "$RES/app/frontend-dist"
cp -R "$ROOT/packages/frontend/dist" "$RES/app/frontend-dist"

echo "==> [2/7] ollama 二进制（仅系统框架依赖，直接拷）"
cp -fL "$(command -v ollama)" "$RES/bin/ollama"
chmod +x "$RES/bin/ollama"

echo "==> [3/7] whisper-cli + ffmpeg + ffprobe（Node 收拢 dylib + 重签）"
rm -rf "$RES/bin/libs"
rm -f "$RES/bin/whisper-cli" "$RES/bin/ffmpeg" "$RES/bin/ffprobe"
mkdir -p "$RES/bin/libs"
WHISPER_PREFIX="$(brew --prefix whisper-cpp)"
bundle_bin() {
  local name="$1" src="$2"
  echo "    - 收拢 $name 的动态库…"
  "$NODE" "$ROOT/scripts/bundle-dylibs.mjs" "$src" "$RES/bin/$name" "$RES/bin/libs" \
    || { echo "    ✗ $name 收拢失败"; exit 1; }
}
bundle_bin whisper-cli "$(realpath "$WHISPER_PREFIX/bin/whisper-cli")"
bundle_bin ffmpeg     "$(realpath "$(command -v ffmpeg)")"
bundle_bin ffprobe    "$(realpath "$(command -v ffprobe)")"
chmod +x "$RES/bin/whisper-cli" "$RES/bin/ffmpeg" "$RES/bin/ffprobe"

echo "==> [5/7] whisper 模型 turbo (~1.5GB)"
[[ -f "$WHISPER_MODEL_SRC" ]] || { echo "找不到 whisper 模型：$WHISPER_MODEL_SRC"; exit 1; }
if [[ -f "$RES/models/ggml-large-v3-turbo.bin" ]]; then echo "    已存在，跳过"; else cp -f "$WHISPER_MODEL_SRC" "$RES/models/ggml-large-v3-turbo.bin"; fi

echo "==> [6/7] $MODEL_TAG 模型（从 $OLLAMA_MODELS_SRC 抽取 ~4.7GB）"
MANIFEST="$OLLAMA_MODELS_SRC/manifests/registry.ollama.ai/$TAG_PATH"
[[ -f "$MANIFEST" ]] || MANIFEST="$(find "$OLLAMA_MODELS_SRC/manifests" -ipath "*$TAG_PATH*" -type f | head -1)"
[[ -f "$MANIFEST" ]] || { echo "找不到 $MODEL_TAG 的 manifest（确认已 ollama pull）"; exit 1; }
REL="${MANIFEST#$OLLAMA_MODELS_SRC/manifests/}"
mkdir -p "$RES/ollama-models/manifests/$(dirname "$REL")"
cp -f "$MANIFEST" "$RES/ollama-models/manifests/$REL"
python3 - "$MANIFEST" "$OLLAMA_MODELS_SRC/blobs" "$RES/ollama-models/blobs" <<'PY'
import json, os, shutil, sys
manifest, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(open(manifest))
digests = set()
cfg = data.get("config", {}).get("digest", "")
if cfg.startswith("sha256:"): digests.add(cfg.split(":", 1)[1])
for layer in data.get("layers", []):
    d = layer.get("digest", "")
    if d.startswith("sha256:"): digests.add(d.split(":", 1)[1])
copied = skipped = 0
for h in sorted(digests):
    name = "sha256-" + h
    dest = os.path.join(dst, name)
    s = os.path.join(src, name)
    if not os.path.exists(s):
        print("    缺 blob:", name); continue
    if os.path.exists(dest):
        skipped += 1; continue
    shutil.copy(s, dest); copied += 1
    print(f"    blob {name} ({os.path.getsize(s) // 1048576} MB)")
print(f"    新拷贝 {copied}，已存在跳过 {skipped}")
PY

echo "==> [7/7] 完成。校验 + 体积："
du -sh "$RES" 2>/dev/null
echo "--- dylib 本地化校验（不应再出现 /opt/homebrew）---"
otool -L "$RES/bin/whisper-cli" | grep -iq homebrew && echo "⚠️ whisper-cli 仍有 homebrew 依赖" || echo "✓ whisper-cli 干净"
otool -L "$RES/bin/ffmpeg"      | grep -iq homebrew && echo "⚠️ ffmpeg 仍有 homebrew 依赖"  || echo "✓ ffmpeg 干净"
echo "--- 重签校验 ---"
codesign -v "$RES/bin/whisper-cli" >/dev/null 2>&1 && echo "✓ whisper-cli 签名 OK" || echo "⚠️ whisper-cli 签名未通过（ad-hoc，运行时仍可用）"
