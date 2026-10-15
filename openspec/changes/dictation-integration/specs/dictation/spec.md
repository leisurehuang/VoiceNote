# spec/dictation — 语音听写

## ADDED Requirements

### Requirement: 全局快捷键听写

桌面端注册可配置的全局快捷键（默认 `Ctrl+Alt+D`，Electron accelerator 格式），采用**切换式**交互：空闲时按下开始录音，录音中再按结束并出字，录音期间临时注册取消键（默认 `Escape`）可放弃本次录音。录音期间展示不抢焦点的浮窗（音量、状态、取消入口）。单次录音最长 3 分钟自动结束。

#### Scenario: 快捷键听写全链路

- **WHEN** 用户在任意应用按全局快捷键，说话，再按一次
- **THEN** 录音经当前激活转写引擎识别、（开启时）AI 润色、术语纠错后，自动粘贴到当前焦点输入框；浮窗显示「已输入」
- **AND** 粘贴失败时（权限/平台限制）文字保留在剪贴板，浮窗提示手动粘贴

#### Scenario: 取消与静音

- **WHEN** 录音中按取消键，或录到的音频整段峰值 <300（≈-40dBFS）
- **THEN** 本次录音被丢弃或直接返回 `silent`，不产生任何输入、不写历史（静音门限同时防止 whisper 对静音的幻觉输出）

### Requirement: 翻译口令

听写文本的**句首或句尾**命中口令（如「用英文」「翻译成日语」，内置 英/日/韩/中 + 法/德/西）时，剥掉口令，正文按润色规则整理后整体翻译成目标语言输出。口令由程序规则识别：句尾先剥语气词与连接标点；口令前紧邻否定词不生效；剥后正文有效字符 ≥3；拉丁口令在句尾须有标点分隔。设置可关闭口令，或固定输出语言（免口令恒翻译）。

#### Scenario: 句尾口令

- **WHEN** 识别文本为「今天晚上一起吃饭吧，用英文。」
- **THEN** 剥口令得正文「今天晚上一起吃饭吧」，输出英文译文，响应含 `targetLanguage:"en"`

### Requirement: 术语纠错

设置中维护「正写 + 误写列表」；听写输出（润色后或原文）经过纠错替换：长误写优先、单遍扫描不重叠、含拉丁字母/数字的误写整词匹配（前后不能是字母数字）、仅大小写不同的命中统一为正写。

### Requirement: 听写历史

每次成功出字在本机 `data/dictation/history.jsonl` 追加一条（id/时间/原文/成稿/时长/目标语言），超出上限（默认 500）裁最旧。设置页可查看最近历史、复制成稿、单删、清空。

### Requirement: 配置与热更新

听写配置存于 `settings.json` 的 `dictation` 节（enabled/shortcut/cancelShortcut/polish/translationCommands/fixedOutputLanguage/termCorrections/historyLimit），旧配置文件缺失该节时按全默认处理。桌面端启动时拉取配置注册快捷键；前端保存后通知桌面端热重载快捷键，无需重启。润色复用当前激活的 LLM 预设；识别复用当前激活的转写引擎。

### Requirement: 托盘常驻

桌面端创建系统托盘（显示主窗口 / 开始·停止听写 / 退出）。关闭主窗口驻留托盘（听写继续可用），仅托盘或应用菜单退出时真正结束进程。

### Requirement: 后端接口

- `POST /api/dictation`：body 为 16kHz 单声道 PCM16 字节流；返回 `{id, transcript, text, targetLanguage?, durationMs, silent, polishError?}`；时长 <250ms 返回 400；润色失败回退识别原文并带 `polishError`，不阻断输入。
- `GET /api/dictation/history?limit=`、`DELETE /api/dictation/history/:id`、`DELETE /api/dictation/history`。
