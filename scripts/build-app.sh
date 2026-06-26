#!/usr/bin/env bash
# 手动把应用打包成 Voice Notes.app + .dmg（不依赖 electron-builder / app-builder-bin）。
# 思路：拷贝 Electron 自带的 Electron.app → 改名 → 注入 app 代码 + resources → 改 Info.plist
# → ad-hoc 重签 → hdiutil 生成可拖拽安装的 dmg。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -e "console.log(require('$ROOT/packages/desktop/package.json').version)")"
ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
STAGE="$ROOT/packages/desktop/release/build"
OUT="$ROOT/packages/desktop/release"
APP_NAME="Voice Notes"
APP="$STAGE/$APP_NAME.app"
RES="$ROOT/resources"

[[ -d "$ELECTRON_APP" ]] || { echo "找不到 Electron.app：$ELECTRON_APP（先 npm install）"; exit 1; }
[[ -d "$RES/bin" ]] || { echo "找不到 resources（先跑 assemble-resources.sh）"; exit 1; }

echo "==> [1/6] 拷贝 Electron.app → $APP_NAME.app"
rm -rf "$STAGE" "$OUT"
mkdir -p "$STAGE"
cp -R "$ELECTRON_APP" "$APP"

echo "==> [2/6] 注入 app 代码（main.cjs + package.json）"
APP_RES="$APP/Contents/Resources"
rm -f "$APP_RES/default_app.asar"   # 移除 Electron 默认演示应用，确保加载我们的 app/
mkdir -p "$APP_RES/app/src"
cat > "$APP_RES/app/package.json" <<EOF
{ "name": "voice-notes", "version": "$VER", "main": "src/main.cjs" }
EOF
cp "$ROOT/packages/desktop/src/main.cjs" "$APP_RES/app/src/main.cjs"

echo "==> [3/6] 拷贝 resources → Contents/Resources/vn（自包含二进制+模型）"
rm -rf "$APP_RES/vn"
cp -R "$RES" "$APP_RES/vn"

echo "==> [4/6] 改 Info.plist（名称/标识/版本）"
PLIST="$APP/Contents/Info.plist"
plset() { /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST" 2>/dev/null; }
plset CFBundleName "$APP_NAME"
plset CFBundleDisplayName "$APP_NAME"
plset CFBundleIdentifier com.voicenotes.app
plset CFBundleShortVersionString "$VER"
plset CFBundleVersion "$VER"
chmod +x "$APP/Contents/MacOS/"*

echo "==> [5/6] ad-hoc 重签（arm64 上未签名的二进制无法运行）"
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "  （codesign --deep 有警告，继续）"

echo "==> [6/6] 生成可拖拽安装的 .dmg"
mkdir -p "$OUT"
DMG_SRC="$STAGE/dmg"
mkdir -p "$DMG_SRC"
cp -R "$APP" "$DMG_SRC/"
ln -sf /Applications "$DMG_SRC/Applications"
DMG="$OUT/$APP_NAME-$VER-arm64.dmg"
hdiutil create -volname "$APP_NAME" -fs HFS+ -srcfolder "$DMG_SRC" -ov -format UDZO "$DMG" >/dev/null

echo "==> 完成"
du -sh "$APP" "$DMG"
echo "    app: $APP"
echo "    dmg: $DMG"
