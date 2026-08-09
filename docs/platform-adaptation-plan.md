# VoiceNote 全平台适配实施计划

## 📋 决策摘要

### 平台目标
- **目标平台**：Windows + macOS + Linux 桌面应用
- **架构**：各平台原生架构（Windows x64, macOS arm64, Linux x64）
- **打包格式**：
  - Windows：NSIS 安装程序 + portable zip
  - Linux：AppImage
  - macOS：.dmg（现有 arm64，预留 Intel 扩展性）

### 依赖策略
- **whisper.cpp**：CI 编译 CPU 版本
- **ffmpeg**：预编译静态二进制（官方构建站）
- **Ollama**：智能降级（系统优先 → 内置下载）
- **模型**：slim 模式，首启动下载

### 构建工具
- **完全迁移到 electron-builder**
- 单文件 `electron-builder.yml` 配置
- 预留签名配置（不花钱）

### 发布策略
- **GitHub Release**：发布 slim 版本（~1.5GB）
- **外部 CDN**：完整版 + 增量更新
- **自动更新**：electron-updater 从 GitHub Releases
- **CI 矩阵**：macOS arm64 + Windows x64 + Linux x64

### 实施优先级
**M1: Windows 可运行** → **M2: Linux 可运行** → **M3: 完善 macOS**

---

## 🔧 技术实施细节

### 1. whisper.cpp 跨平台编译

```yaml
# .github/workflows/build-all-platforms.yml
whisper-build:
  strategy:
    matrix:
      include:
        - os: macos-latest
          target: aarch64-apple-darwin
        - os: windows-latest
          target: x86_64-pc-windows-msvc
        - os: ubuntu-latest
          target: x86_64-unknown-linux-gnu
  steps:
    - uses: actions/checkout@v4
      with:
        repository: 'ggerganov/whisper.cpp'
        depth: 1
    - run: |
        cmake -B build -DBUILD_SHARED_LIBS=OFF \
          -DWHISPER_BUILD_SERVER=OFF \
          -DWHISPER_BUILD_TESTS=OFF \
          -DCMAKE_BUILD_TYPE=Release
        cmake --build build -j$(nproc)
        # 上传构建产物
```

### 2. ffmpeg 静态二进制来源

| 平台 | 来源 | URL |
|------|------|-----|
| Windows | BtbN | https://github.com/BtbN/FFmpeg-Builds/releases |
| Linux | gyan | https://github.com/gyan-dev/ffmpeg-linux-builds |
| macOS | brew (现有) | `$(brew --prefix ffmpeg)` |

### 3. electron-builder.yml 配置结构

```yaml
# electron-builder.yml
appId: com.voicenotes.app
productName: Voice Notes
directories:
  buildResources: resources
  output: packages/desktop/release

# macOS
mac:
  target:
    - target: dmg
      arch:
        - arm64
        # - x64 # 预留，暂不构建
  category: public.app-category.utilities
  icon: build/icon.icns

# Windows
win:
  target:
    - target: nsis
      arch:
        - x64
    - target: portable
      arch:
        - x64
  icon: build/icon.ico

# Linux
linux:
  target:
    - target: AppImage
      arch:
        - x64
  icon: build/icons
  category: Audio

# 通用
files:
  - "**/*"
  - "!**/*.ts"
  - "!**/*.map"
  - "!**/*.md"

asar: true
asarUnpack:
  - "resources/bin/**"  # 二进制不打包进 asar

afterPack: scripts/after-pack.cjs
afterSign: scripts/after-sign.cjs  # 预留签名位置

# 更新配置
publish:
  provider: github
  owner: leisurehuang
  repo: VoiceNote
```

### 4. Ollama 智能降级逻辑

```typescript
// packages/desktop/src/main.cjs
async function ensureOllama() {
  const systemOllama = await findSystemOllama();
  if (systemOllama) {
    log.info('使用系统 ollama:', systemOllama);
    return systemOllama;
  }

  const bundledOllama = path.join(getResourcesPath(), 'bin', 'ollama');
  if (fs.existsSync(bundledOllama)) {
    log.info('使用内置 ollama');
    return bundledOllama;
  }

  // 下载内置版
  log.info('下载 ollama...');
  await downloadOllama();
  return bundledOllama;
}
```

### 5. CI 构建矩阵

```yaml
# .github/workflows/build-all-platforms.yml
name: Build All Platforms

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      matrix:
        include:
          # macOS
          - os: macos-14
            platform: macos
            arch: arm64
            slim: true
          # Windows
          - os: windows-2022
            platform: windows
            arch: x64
            slim: true
          # Linux
          - os: ubuntu-22.04
            platform: linux
            arch: x64
            slim: true

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Build frontend
        run: npm run build -w @voice-notes/frontend

      - name: Build backend
        run: npm run bundle:backend

      - name: Download platform binaries
        run: |
          node scripts/download-binaries.mjs ${{ matrix.platform }}

      - name: Assemble resources
        run: |
          SLIM=1 node scripts/assemble-resources.cjs

      - name: Build with electron-builder
        run: npx electron-builder --${{ matrix.platform }}

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: voice-notes-${{ matrix.platform }}-${{ matrix.arch }}
          path: packages/desktop/release/*
```

---

## 📅 里程碑计划

### M1: Windows 可运行（2-3周）

**目标**：Windows 用户能下载安装并使用核心功能

**任务**：
1. ✅ electron-builder 基础配置
2. ✅ Windows 特定配置（icon.ico, NSIS 脚本）
3. ✅ whisper.cpp Windows 编译
4. ✅ ffmpeg Windows 静态二进制集成
5. ✅ Ollama Windows 适配
6. ✅ CI Windows 构建
7. ✅ 本地测试 + 冒烟测试

**验收**：
- Windows 10/11 能双击安装
- 录音、转写、摘要用例通过
- 自动更新能检测到新版本

---

### M2: Linux 可运行（2-3周）

**目标**：Linux 用户能下载 AppImage 并使用

**任务**：
1. ✅ Linux AppImage 配置
2. ✅ whisper.cpp Linux 编译
3. ✅ ffmpeg Linux 静态二进制集成
4. ✅ Ollama Linux 适配（systemd 检测）
5. ✅ CI Linux 构建
6. ✅ 本地测试 + 冒烟测试

**验收**：
- Ubuntu/Debian/Fedora 能运行 AppImage
- 功能与 Windows 一致
- 桌面集成（.desktop 文件、图标）

---

### M3: 完善 macOS（1-2周）

**目标**：将现有构建迁移到 electron-builder，完善体验

**任务**：
1. ✅ 迁移到 electron-builder
2. ✅ 现有功能验证
3. ✅ 预留 Intel 配置
4. ✅ 完善自动更新
5. ✅ 三平台统一测试

**验收**：
- macOS 构建与之前功能一致
- 自动更新在所有平台可用
- 文档完整

---

## 🚨 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| Ollama Windows 行为异常 | 高 | 中 | 充分测试 + 提供手动配置选项 |
| ffmpeg 静态二进制不兼容 | 中 | 低 | 多来源验证 + 提供编译 fallback |
| electron-builder 配置复杂 | 中 | 中 | 参考成熟项目配置 + 逐步迁移 |
| CI 构建时间长 | 低 | 高 | 缓存依赖 + 并行构建 |
| Windows 签名问题 | 中 | 低 | 预留配置 + 用户手动信任 |

---

## 🧪 测试策略

### 本地跨平台测试
```bash
# Docker 测试其他平台
docker run --rm -v $PWD:/workspace \
  -e DISPLAY=$DISPLAY \
  ubuntu:22.04 ./packages/desktop/release/Voice-Notes-*.AppImage

# Windows VM
# 使用 VirtualBox/VMware 运行 ISO
```

### 冒烟测试矩阵
```bash
# 各平台运行
node scripts/smoke-m3.mjs test-audio.wav

# 验证点：
# 1. 应用启动
# 2. 依赖检测通过
# 3. 录音功能
# 4. 转写成功
# 5. 摘要生成
# 6. 自动更新检测
```

---

## 📚 文档更新清单

- [ ] README.md：添加 Windows/Linux 下载链接
- [ ] README_LINUX.md：更新 AppImage 安装说明
- [ ] 新建：README_WINDOWS.md
- [ ] CLAUDE.md：更新构建说明（electron-builder）
- [ ] 新建：docs/troubleshooting-cross-platform.md
- [ ] 更新：CONTRIBUTING.md（跨平台开发指南）

---

## ✅ 验收标准（最终）

1. **可运行**：各平台双击即可运行
2. **自动更新**：electron-updater 正常工作
3. **冒烟测试**：所有核心功能通过
4. **文档完整**：各平台用户都有清晰指南
5. **CI 通过**：GitHub Actions 构建成功
6. **向后兼容**：现有 macOS 用户无缝升级

---

## 🚀 下一步行动

1. **创建实施任务列表**
2. **准备 electron-builder 配置文件**
3. **搭建 CI 构建矩阵框架**
4. **开始 M1：Windows 适配**

---

*生成时间：2026-08-09*
*状态：需求收集完成，待进入实施阶段*
