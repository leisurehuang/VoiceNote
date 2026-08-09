# macOS 构建迁移对比

## 旧方式 (build-app.sh)
- 使用自制 bash 脚本
- 拷贝 Electron.app → 重命名 → 注入资源
- 手动修改 Info.plist
- 使用 sips 生成图标
- iconutil 打包 .icns
- codesign ad-hoc 签名
- hdiutil 生成 .dmg

## 新方式 (electron-builder)
- 声明式配置 (electron-builder.yml)
- 自动处理所有平台特定步骤
- 内置图标处理
- 内置签名配置
- 自动生成 DMG

## 配置文件对应关系

| 旧脚本 | electron-builder 配置 |
|--------|----------------------|
| `CFBundleName` | `productName` |
| `CFBundleIdentifier` | `appId` |
| `CFBundleVersion` | `version` (from package.json) |
| `CFBundleIconFile` | `mac.icon` |
| DMG 布局 | `dmg.contents` |
| 签名 | `mac.hardenedRuntime` + `entitlements` |

## 预留 Intel x64 支持

当前仅构建 arm64 版本。如需添加 Intel 支持，取消注释 electron-builder.yml 中的：
```yaml
mac:
  target:
    - target: dmg
      arch:
        - arm64
        - x64  # 取消注释此行
```

或构建 Universal Binary（体积会翻倍）：
```yaml
mac:
  target:
    - target: universal
      arch:
        - x64
        - arm64
```

## 验证步骤

在 macOS 上运行：
```bash
# 旧方式
bash scripts/build-app.sh

# 新方式
npm run dist -w @voice-notes/desktop
```

比较产物：
- 产物位置：`packages/desktop/release/`
- 检查 .dmg 体积
- 检查 .app 内容结构
- 测试安装和运行

---

*创建时间: 2026-08-09*
