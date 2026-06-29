# 贡献指南

欢迎为 Voice Notes 贡献代码或反馈问题！🎉

## 反馈问题 / 功能建议

请在 [Issues](https://github.com/leisurehuang/VoiceNote/issues) 提交，尽量附上：
- 复现步骤、预期与实际表现；
- 后端终端日志、设置页显示的版本；
- 浏览器与系统信息。

## 提交 Pull Request

1. Fork 仓库并 `git clone` 到本地。
2. 新建分支：`git checkout -b feat/xxx`（功能）或 `fix/xxx`（修复）。
3. 本地开发：`npm run dev`（前后端联调，详见 README）。
4. 提交前务必通过类型检查：`npm run typecheck`。
5. 推送分支并向 `main` 发起 PR，描述改动与动机。

## 约定

- 后端为 NodeNext + strict TypeScript（相对 import 需带 `.js`）；前端为 React + TypeScript。
- 注释与 UI 文案保持中文，与现有风格一致。
- 引入新的运行时依赖前，请先在 Issue 讨论。

## 行为准则

请保持友善、尊重，对所有贡献者友好。
