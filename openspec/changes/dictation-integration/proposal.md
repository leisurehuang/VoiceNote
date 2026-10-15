# Proposal: 集成 typefree 听写能力（跨平台）

## Overview

把 macOS 专属语音输入工具 [typefree](https://github.com/leisurehuang/typefree) 的核心能力，以**重新实现**（非代码搬移）的方式集成进 Voice Notes 桌面端，覆盖 Windows / Linux / macOS 三平台：

1. **核心听写**：全局快捷键（切换式）→ 录音 → ASR → AI 润色 → 自动粘贴到当前光标处，带底部浮窗反馈
2. **语音翻译口令**：句首/句尾「用英文」等口令 → 输出直接翻译
3. **术语纠错**：误写→正写替换表，输出前自动纠正
4. **听写历史**：本机 JSONL 保存，设置页查看/复制/删除
5. **托盘常驻**：关窗驻留，听写持续可用

## Background

typefree（Swift/AppKit，GPL-3.0）的「按住说话→AI 整理→打进光标处」体验优秀但仅限 macOS。Voice Notes 已具备全部底层管线（三引擎 ASR 分发、OpenAI 兼容 LLM、设置热切换），且桌面端已是跨平台 Electron——缺的只是全局触发、录音、粘贴注入与听写专用管线。

## Goals

- 三平台一致的「快捷键说话→光标处出成稿」体验，零新增原生 npm 依赖
- 复用现有转写引擎与 LLM 预设（用户无需为听写单独配模型）
- 口令检测、术语纠错为纯规则逻辑，可单测

## Non-Goals

- 问 AI 浮窗（后续可选）
- 鼠标长按说话、粘贴后自动学词（强依赖 macOS AX API，跨平台不可行；纠错表改为手动维护）
- 真按住式（松手结束）触发——Electron globalShortcut 无 keyUp 事件，引入 uiohook-napi 原生模块的三平台 CI 风险大于收益

## Proposed Approach

- **后端**新增 `POST /api/dictation`（PCM16 → 临时 wav → `transcribeUtteranceWithEngine` → 口令检测 → 润色 → 纠错 → 历史），配置入 `settings.json` 的 `dictation` 节
- **桌面** `packages/desktop/src/dictation/`：manager（状态机 + globalShortcut 切换式 + 录音中临时注册 Esc 取消）、隐藏录音窗（getUserMedia + AudioWorklet 降采样，ScriptProcessor 兜底）、胶囊浮窗（不抢焦点）、paster（clipboard + osascript/SendKeys/xdotool 平台粘贴，失败降级「已复制」）
- **前端**设置页新增「语音输入」tab：开关、快捷键、润色/口令开关、纠错表、历史管理
- 润色 prompt 按功能要点**新写**（typefree 基底为 GPL-3.0，本项目 MIT，不逐字复制）

## Success Criteria

- `npm run typecheck` 通过；`scripts/test-dictation-logic.ts`（口令/纠错/语言判定）与 `scripts/smoke-dictation.mjs`（接口冒烟）全绿
- macOS 真机：快捷键录音→浮窗反馈→TextEdit 等应用光标处出现整理后文字；Esc 取消；托盘驻留
- 三平台 CI 打包不受影响（无新原生依赖、无新外部二进制）

Status: implemented（2026-10-15）
