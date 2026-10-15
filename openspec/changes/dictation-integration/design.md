# Design: dictation-integration

## Context

Electron `globalShortcut` 只有 press 回调、没有 keyUp，无法直接复刻 typefree 的「按住说话」；文字注入、全局鼠标监听在三个平台也没有统一原生 API。方案必须在「体验贴近」与「三平台零风险」间取舍。

## Goals / Non-Goals

见 proposal.md。核心约束：不引入原生 npm 模块（robotjs/nut-js/uiohook），不改 CI 矩阵与资源组装脚本。

## Decisions

### D1 触发方式：切换式快捷键 + 录音中临时注册取消键

- `globalShortcut.register(shortcut, toggle)`：idle 时按下→开始录音，recording 时按下→结束出字，processing 忽略。
- 取消键（默认 `Escape`）**仅在录音期间注册**、结束即注销——等价于 typefree 用 CGEventTap 吞 Esc 的效果，且不长期占用全局按键。
- 备选：uiohook-napi 真按住式。否决：三平台 CI 需 electron-rebuild，且 AppImage/NSIS 体积与签名链路都要重验。

### D2 录音：隐藏 BrowserWindow + AudioWorklet（ScriptProcessor 兜底）

- 主进程无 WebAudio；隐藏窗口 `getUserMedia → AudioWorklet`（与前端实时转写同款降采样内核）→ 200ms 批量 IPC。
- `autoplay-policy=no-user-gesture-required` 保证无手势也能启动 AudioContext；`setPermissionRequestHandler` 只放行自家 file:// 页的 media 请求。
- file:// 下 AudioWorklet blob 加载失败时退回 ScriptProcessor（哑音输出驱动）。

### D3 文字注入：clipboard + 各 OS 内置工具模拟粘贴，降级「已复制」

- mac `osascript keystroke "v" using command down`（需辅助功能，缺权限时浮窗一键跳系统设置）
- Win PowerShell `SendKeys('^v')`（管理员窗口受 UIPI 限制→降级）
- Linux `xdotool key ctrl+v`（Wayland 常无→降级）
- 粘贴前快照文本剪贴板，250ms 后还原；非文本格式不强还原（已知取舍）
- 备选：robotjs/@nut-tree。否决：原生模块三平台重编译 + Electron ABI 跟随成本。

### D4 后端管线：单端点 `POST /api/dictation`

- body 为 16kHz 单声道 PCM16（octet-stream，Fastify 需 `addContentTypeParser`）；复用 `transcribeUtteranceWithEngine`（whisper/sherpa/云 API 三引擎热切）。
- **静音门限**（整段峰值 <300 ≈ -40dBFS）直接返回 `silent`：既挡误触，也挡 whisper 对纯静音的幻觉输出（实测静音会被转成 "Thank you."）。
- 润色失败回退识别原文并在响应中带 `polishError`（浮窗提示「已输入（AI 整理失败，用的是识别原文）」），不阻断输入。
- 历史存 `data/dictation/history.jsonl`，整文件重写裁剪（人一次一条，频率足够低）。

### D5 口令检测与术语纠错：纯规则、可单测

- 口令只认句首/句尾；句尾先剥语气词与连接标点（真实 ASR 会在句尾补「。」——集成测试发现并修复）；否定词保护；剥后正文 ≥3 有效字符；拉丁口令句尾须标点分隔（防「I am learning English.」误报）。
- `applyTermCorrections`：长变体优先、单遍扫描不重叠、拉丁变体整词边界、仅大小写差异统一为正写。

### D6 配置与热更新

- 全部进 `settings.json` 的 `dictation` 节（enabled/shortcut/cancelShortcut/polish/translationCommands/fixedOutputLanguage/termCorrections/historyLimit），老文件缺字段 fail-open 全默认。
- 桌面主进程经 `GET /api/settings` 拉取注册快捷键；前端保存后经 preload IPC `dictation-settings-changed` 通知热重载（无需重启）。

### D7 托盘常驻

- 主窗口 `close` 拦截为 `hide`（`isQuitting` 区分真退出）；托盘菜单：显示主窗口 / 开始·停止听写 / 退出。托盘图标随 `src/dictation/assets/` 打包（buildResources 不会进 app）。

## Risks / Trade-offs

- macOS 首次使用需两项系统授权（麦克风、辅助功能）——README 与浮窗均给指引；未签名 app 重装后 TCC 可能要求重新授权。
- Wayland 下全局快捷键与 xdotool 均可能不可用 → 托盘菜单兜底 + 「已复制」降级。
- 切换式相比按住式多一次按键——typefree 用户可感知的差异，文档明示。
