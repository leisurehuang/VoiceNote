## Purpose

提供跨平台桌面应用打包能力，使 VoiceNote 可以在 Windows、Linux 和 macOS 上以原生安装格式分发。

## ADDED Requirements

### Requirement: Windows 打包支持
系统 MUST 能够生成 Windows NSIS 安装程序和 portable zip 格式。

#### Scenario: 成功构建 Windows 安装程序
- **WHEN** 开发者在 Windows 或 macOS 上运行构建命令
- **THEN** 系统生成 `.exe` 安装程序
- **AND** 安装程序包含所有必需的依赖和资源
- **AND** 双击安装程序可以正常安装应用

#### Scenario: 成功构建 Windows portable 版本
- **WHEN** 开发者运行 Windows portable 构建命令
- **THEN** 系统生成无需安装的 zip 压缩包
- **AND** 解压后双击可执行文件可直接运行应用

### Requirement: Linux 打包支持
系统 MUST 能够生成 Linux AppImage 格式分发包。

#### Scenario: 成功构建 Linux AppImage
- **WHEN** 开发者在 Linux 上运行构建命令
- **THEN** 系统生成 `.AppImage` 单文件分发包
- **AND** AppImage 包含所有运行时依赖
- **AND** 添加可执行权限后可直接运行

### Requirement: macOS 打包支持
系统 MUST 能够生成 macOS .dmg 磁盘映像。

#### Scenario: 成功构建 macOS DMG
- **WHEN** 开发者在 macOS 上运行构建命令
- **THEN** 系统生成 `.dmg` 磁盘映像
- **AND** DMG 包含应用束和所有资源
- **AND** 拖拽到 Applications 文件夹即可安装

#### Scenario: macOS ARM64 构建
- **WHEN** 开发者在 Apple Silicon Mac 上构建
- **THEN** 系统生成 arm64 架构的原生应用

### Requirement: 构建工具统一
系统 MUST 使用 electron-builder 作为统一的跨平台构建工具。

#### Scenario: 迁移到 electron-builder
- **WHEN** 开发者运行构建命令
- **THEN** 系统使用 electron-builder 替代现有自制脚本
- **AND** 构建配置以声明式方式定义在 electron-builder.yml

#### Scenario: 构建配置可读
- **WHEN** 开发者查看 electron-builder.yml
- **THEN** 配置清晰列出所有平台的构建设置
- **AND** 包含应用图标、名称、版本等元信息

### Requirement: CI 构建矩阵
系统 MUST 支持通过 GitHub Actions 实现多平台并行构建。

#### Scenario: GitHub Actions 构建触发
- **WHEN** 开发者推送 tag 或创建 release
- **THEN** CI 自动在对应平台的 runner 上构建
- **AND** 生成该平台的安装包作为构建产物

#### Scenario: 多平台并行构建
- **WHEN** CI 工作流运行
- **THEN** Windows、Linux、macOS 构建任务并行执行
- **AND** 每个任务使用对应的操作系统 runner

### Requirement: 智能依赖降级
系统 MUST 在构建时检测依赖并提供降级策略。

#### Scenario: Ollama 依赖缺失
- **WHEN** 构建时检测到 Ollama 二进制缺失
- **THEN** 系统提供下载链接或自动下载
- **AND** 构建继续进行，添加降级说明

#### Scenario: Whisper 模型缺失
- **WHEN** 构建时检测到 Whisper 模型文件缺失
- **THEN** 系统跳过该模型打包并添加警告
- **AND** 应用运行时可从网络下载

## REMOVED Requirements

### Requirement: 自制构建脚本
**Reason**: electron-builder 提供标准化跨平台支持，自制脚本维护成本高
**Migration**: 使用 `npm run desktop:dist` 替代 `bash scripts/build-app.sh`
