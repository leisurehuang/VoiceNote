## 1. electron-builder 基础配置

- [x] 1.1 创建 `electron-builder.yml` 配置文件
- [x] 1.2 配置 Windows 目标（NSIS + portable）
- [x] 1.3 配置 Linux 目标（AppImage）
- [x] 1.4 配置 macOS 目标（DMG）
- [x] 1.5 添加应用图标路径配置
- [x] 1.6 配置发布更新设置（publish）

## 2. 依赖安装与脚本调整

- [x] 2.1 安装 electron-builder 到 devDependencies
- [x] 2.2 更新 `package.json` 中的 build scripts
- [x] 2.3 添加 `npm run desktop:dist` 命令
- [x] 2.4 保留 `assemble-resources.sh`（资源准备不变）
- [x] 2.5 更新 `scripts/before-pack.cjs`（平台检测）
- [x] 2.6 更新 `scripts/after-pack.cjs`（macOS 重签名）

## 3. 平台特定依赖处理

- [x] 3.1 添加 Windows ffmpeg/whisper 二进制下载脚本
- [x] 3.2 添加 Linux ffmpeg/whisper 二进制下载脚本
- [x] 3.3 macOS 保持现有的 `bundle-dylibs.mjs` 逻辑
- [x] 3.4 添加平台检测到 `assemble-resources.sh`

## 4. 自动更新实现

- [x] 4.1 创建 `packages/desktop/src/autoUpdater.cjs` 模块
- [x] 4.2 实现更新检测逻辑（checkForUpdates）
- [x] 4.3 实现下载和安装逻辑
- [x] 4.4 在主进程中注册 autoUpdater
- [x] 4.5 渲染进程添加更新 UI 组件
- [x] 4.6 实现"跳过版本"功能

## 5. CI/CD 配置

- [x] 5.1 创建 `.github/workflows/build-all-platforms.yml`
- [x] 5.2 配置构建矩阵（macOS/Windows/Linux）
- [x] 5.3 添加 artifact 上传步骤
- [x] 5.4 配置 GitHub Releases 发布
- [x] 5.5 添加构建触发条件（tag push）

## 6. 资源打包验证

- [ ] 6.1 验证 Windows 构建包含所有依赖
- [ ] 6.2 验证 Linux AppImage 可直接运行
- [ ] 6.3 验证 macOS DMG 可安装
- [ ] 6.4 测试 slim 版本构建
- [ ] 6.5 验证各平台双击运行

## 7. 自动更新测试

- [ ] 7.1 发布测试版本到 GitHub Releases
- [ ] 7.2 测试更新检测功能
- [ ] 7.3 测试下载和安装流程
- [ ] 7.4 测试"跳过版本"功能
- [ ] 7.5 验证更新失败回退

## 8. 文档更新

- [x] 8.1 更新 README.md 构建说明
- [x] 8.2 添加各平台构建文档
- [x] 8.3 更新 CLAUDE.md 桌面打包部分
- [x] 8.4 添加自动更新使用说明

## 9. 清理工作

- [x] 9.1 删除旧的 `build-app.sh` 脚本
- [x] 9.2 清理不再使用的构建文件
- [x] 9.3 验证 `npm run desktop:dev` 仍正常工作
