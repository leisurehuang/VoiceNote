# Tasks: dictation-integration

## 后端

- [x] `pipeline/outputLanguage.ts`：内置语言/触发词表，句首/句尾口令检测（否定词保护、语气词与标点剥离、正文≥3字、拉丁口令边界）
- [x] `pipeline/dictation.ts`：中文/英文双润色 prompt（新写，非 GPL 逐字复制）、中英混说语言判定、`applyTermCorrections`、`polishDictation`（复用 postChat）
- [x] `store/dictationStore.ts`：history.jsonl 追加/列表/单删/清空，超限裁最旧
- [x] `store/settingsStore.ts`：`dictation` 节（parse/清洗/默认值 fail-open）
- [x] `routes/dictation.ts`：octet-stream parser、PCM→wav→转写、静音门限、口令、润色（失败回退）、纠错、历史；GET/DELETE 历史路由
- [x] `pipeline/summarize.ts`：导出 `postChat`
- [x] `index.ts` 注册路由

## 前端

- [x] `api/types.ts` / `api/client.ts`：DictationSettings / DictationHistoryEntry 与 API 封装
- [x] `electron.d.ts`：isDesktop / platform / dictationSettingsChanged
- [x] `components/DictationSettingsView.tsx` + SettingsView「语音输入」tab：开关/快捷键（accelerator 校验）/润色/口令/固定语言/纠错编辑器/历史管理；保存后 IPC 通知桌面热重载
- [x] styles.css 听写设置样式

## 桌面

- [x] `dictation/recorder.html` + `recorder-preload.cjs`：隐藏录音窗（AudioWorklet 降采样 + ScriptProcessor 兜底、批量 IPC、电平上报、麦克风错误上报）
- [x] `dictation/overlay.html` + `overlay-preload.cjs`：胶囊浮窗（波形/状态/取消按钮/辅助功能引导）
- [x] `dictation/paster.cjs`：平台粘贴模拟 + 剪贴板还原 + 降级语义（ax/no_tool/error）
- [x] `dictation/manager.cjs`：idle→recording→processing 状态机、停止回执后再上传（1.5s 兜底）、Esc 临时注册、最长 3 分钟自动结束、快捷键注册/热重载/冲突通知
- [x] `main.cjs`：托盘常驻（close→hide、isQuitting）、权限放行（media 仅 file://）、autoplay-policy、初始化听写、`dictation-settings-changed` IPC
- [x] `preload.cjs`：isDesktop/platform/dictationSettingsChanged
- [x] 托盘图标入 `src/dictation/assets/`（buildResources 不进 app 包）
- [x] `electron-builder.yml`：mac `NSMicrophoneUsageDescription`

## 验证与文档

- [x] `scripts/test-dictation-logic.ts`：口令/纠错/语言判定纯逻辑单测（30 用例，含真实 ASR 尾标点形态）
- [x] `scripts/smoke-dictation.mjs`：接口冒烟（静音门限、过短 400、历史 CRUD、settings 字段）
- [x] 真实语音 E2E（macOS say 合成 + whisper + Ollama）：口语润色、翻译口令（中文→英文）
- [x] 桌面 dev 引导验证：托盘创建、快捷键注册、无报错
- [x] README / CLAUDE.md 更新；版本 0.8.0
