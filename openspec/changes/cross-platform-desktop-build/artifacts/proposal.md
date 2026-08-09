# Proposal: Cross-Platform Desktop Build

## Overview
实现 VoiceNote 桌面应用的全平台适配，支持 Windows、Linux 和 macOS 三个平台的打包分发。

## Background
当前项目仅支持 macOS arm64 打包，使用自制脚本（`build-app.sh`、`assemble-resources.sh`）。需要扩展到全平台支持。

## Goals
- Windows: NSIS 安装程序 + portable zip
- Linux: AppImage 格式
- macOS: 保持现有 .dmg 支持，预留 Intel 扩展
- 迁移到 electron-builder 统一构建工具
- 实现跨平台自动更新

## Non-Goals
- 不做 Universal Binary（macOS Intel + arm64）
- 不包含移动端（iOS/Android）
- 不做代码签名（预留配置）

## Proposed Approach
1. 迁移到 electron-builder
2. 配置三平台构建目标
3. CI 构建矩阵（GitHub Actions）
4. 智能降级策略（依赖检测 + fallback）

## Success Criteria
- 各平台双击即可运行
- 自动更新正常工作
- 冒烟测试通过
- 文档完整

---

**Status**: Draft - Ready for review
