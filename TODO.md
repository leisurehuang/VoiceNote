# Voice Notes · 待办与路线图

> **v0.3.0 已完成**：摘要/逐字稿就地编辑、全文搜索、术语表、视频拖入、待办抽取、进度真实化、详情页 tab 化、整理中动效、侧栏三段布局、实时录音 busy 泄漏修复、desktop dev 自动重建、模型管理 UI（whisper/ollama 下载切换）、设置页 tab 化。

---

## 🔬 待验证（需人工确认）

- [ ] **搜索 / 待办端到端可用性**：代码已实现，并起临时后端实测两条新路由均正常（`POST /api/sessions/:id/todos` 返回「会话不存在」、`GET /api/search` 返回 `[]`，证明路由注册无误）。此前报的「搜不到 / not found」根因是**后端进程跑旧代码**——重启后端（dev 重跑 `npm run dev`；生产需 `npm run build -w @voice-notes/backend && npm start`）后，需确认实际可用。

---

## ⏭️ 已规划 · 本轮主动跳过

- [ ] **说话人分离（diarization）**：纯 Node + whisper.cpp 无法做真正的声纹识别，纯 JS 生态无成熟方案。
  - 真方案需引入 **Python pyannote sidecar**（类似现有 ollama sidecar），会显著加重本地启动 / Docker / 桌面打包，偏离「纯 Node 一键起」的轻量定位。
  - 弱版本（基于 `EnergyVad` 切段、按时序标注「说话人 A/B」）准确性不足、易误导，暂不做。
  - **待决策**：是否接受引入 Python 栈以换取真 diarization。
- [ ] **测试框架**：全仓库零自动化测试，仅手动 smoke 脚本（`scripts/smoke-*.mjs`）。建议引入 vitest 覆盖纯逻辑：
  - `pipeline/whisper.ts` 的 `parseSegmentLine` / `parseWhisperJson`
  - `pipeline/orchestrator.ts` 状态机与错误兜底
  - `store/sessionStore.ts` 的原子写、`search`、`readTodos`
  - `pipeline/summarize.ts` 的 `extractTodos` JSON 容错解析

---

## 💡 未来候选（未排期，待讨论）

- [ ] **标签 / 分类 / 收藏**：会话增多后的组织手段（当前仅按时间倒序列表 + 全文搜索）。
- [ ] **待办导出**：结构化待办一键导出到提醒事项 / 日历。
- [ ] **URL / 纯文本导入**：粘贴视频 URL 或纯文本直接走摘要（复用现有 LLM 能力，无需录音）。
- [ ] **摘要阶段进度细化**：`summarizeStage` 目前用固定锚点（0.7 / 0.98），难反映真实进度（可在 LLM 流式 token 数 / 转写长度上做粗估）。
- [ ] **会话打包导入/导出**：把单个 session 目录打包成 zip，便于备份与跨机迁移（契合本地优先定位，不做云同步）。
