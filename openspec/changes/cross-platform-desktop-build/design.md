## Context

当前桌面打包仅支持 macOS arm64，使用自制脚本 `build-app.sh` + `assemble-resources.sh`。这些脚本：
1. 假设 macOS 开发环境（调用 `brew --prefix`、`codesign`、`hdiutil` 等）
2. 手动处理 dylib 收拢和重签名
3. 仅生成 `.dmg` 格式

迁移到 electron-builder 可以利用其成熟的跨平台支持和自动更新功能，但需要重新组织资源配置和构建流程。

## Goals / Non-Goals

**Goals:**
- 统一使用 electron-builder 替代自制脚本
- 支持 Windows (NSIS + portable)、Linux (AppImage)、macOS (DMG)
- 集成 electron-updater 实现自动更新
- 保持自包含资源策略（二进制 + 模型内嵌）

**Non-Goals:**
- 不做代码签名（预留配置项，后续可添加证书）
- 不做 Universal Binary（仅原生架构）
- 不修改应用核心逻辑

## Decisions

### 1. 构建工具选择：electron-builder

**选择理由：**
- 原生支持三大平台的打包格式
- 内置 auto-update 集成（electron-updater）
- 社区成熟，文档完善
- 与现有 Electron 生态兼容性好

**替代方案：**
- `electron-forge`：功能类似但配置更复杂，生态不如 electron-builder 成熟
- 继续自制脚本：跨平台成本高，难以维护

### 2. 资源打包策略：自包含

**选择理由：**
- 用户无需额外安装 ffmpeg/whisper/ollama
- 离线可用，符合"本地优先"原则
- 减少用户配置错误

**权衡：**
- 安装包体积大（~7GB），需提供 slim 版本选项

### 3. 依赖处理方案

**macOS:**
- 继续使用 `bundle-dylibs.mjs` 收拢动态库
- electron-builder 的 `afterPack` hook 触发重签名

**Windows/Linux:**
- 预编译二进制直接打包
- 无需 dylib 处理

### 4. CI 构建矩阵

**选择 GitHub Actions 矩阵构建：**
- 使用 `runs-on: ${{ matrix.os }}` 并行构建
- 矩阵配置：`macos-latest`, `ubuntu-latest`, `windows-latest`

**替代方案：**
- Docker 容器：增加复杂度，原生 runner 足够

### 5. 自动更新实现

**选择 electron-updater + GitHub Releases：**
- 私有仓库可用自建服务器
- 增量更新支持（ differential update）

**发布流程：**
1. 推送 tag 触发 CI
2. 构建完成后上传到 GitHub Releases
3. 应用通过 `autoUpdater.checkForUpdates()` 检测

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| Windows 构建环境差异大 | 在 GitHub Actions 使用官方 windows runner |
| 依赖检测脚本可能失效 | 编写平台特定的检测逻辑，添加充足测试 |
| 更新服务器单点故障 | 支持配置多个更新源 |
| 首次迁移构建时间长 | 并行构建，缓存 node_modules |

## Migration Plan

1. **添加 electron-builder 配置**
   - 创建 `electron-builder.yml`
   - 配置三平台打包目标

2. **调整资源脚本**
   - `assemble-resources.sh` 保持不变（仍需准备资源）
   - 添加平台检测，跳过不兼容的资源

3. **添加 afterPack/beforeBuild hooks**
   - `scripts/before-pack.cjs`：平台检测和依赖验证
   - `scripts/after-pack.cjs`：macOS 重签名

4. **更新 package.json scripts**
   - `npm run desktop:dist` → electron-builder
   - 保留 `build-app.sh` 作为参考（后续删除）

5. **配置 CI workflow**
   - `.github/workflows/build-all-platforms.yml`
   - 矩阵构建 + artifact 上传

6. **集成自动更新**
   - 添加 `autoUpdater.cjs` 主进程模块
   - 渲染进程更新 UI

## Open Questions

1. **Slim 版本发布策略**
   - 是否在每次发布时同时提供 full 和 slim 两个版本？
   - 可通过环境变量控制，待产品决策

2. **模型版本管理**
   - 如何处理模型更新（whisper/ollama）？
   - 可在后续版本中实现应用内模型更新
