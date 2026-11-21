# 交接说明

## 基本信息

- 项目：非官方 DeepSeek Android 客户端，包名 `com.temeowde.dschat`，版本 3.1.0（versionCode 31）
- 仓库：`C:\Users\zzzy\Desktop\1121\deepseek-chat-android`
- 远端：`https://github.com/Temeowde/deepseek-chat-android`，开发分支 `release-v3.1.0`
- 技术栈：smali 外壳 + Java 辅助类 + React/rspack 前端，跑在 WebView 里

## 构建

```powershell
$env:ANDROID_SDK = 'D:\AndroidToolchain\sdk'
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

产物 `DeepSeek-Chat-3.1.0.apk`，约 2.09 MB。工具链（JDK17 / Node22 / Android SDK 35）已在本机就绪，`tools/` 里带了 smali.jar，无需额外下载。

签名用 `%USERPROFILE%\.android\debug.keystore`（androiddebugkey / android），与已发布版本同签名，可直接覆盖安装。

## 目录速查

| 路径 | 内容 |
|---|---|
| `src/smali`、`src/smali_classes2` | 外壳与桥接（MainActivity 在这里） |
| `src/java/com/temeowde/dschat` | 原生辅助类：附件、官方账号、显示偏好、字体、相册 |
| `dec2/` | AndroidManifest 与资源表 |
| `web/src/` | React 前端主体 |
| `web/mobile/` | 手机端脚本、样式、图标（`ui-icons/` 是官方 APK 提取的矢量） |
| `wicon/` | 启动图标 |
| `tools/assemble.mjs` | APK 打包（Node 实现，无外部依赖） |

前端单独构建：`npm --prefix web ci --ignore-scripts` 然后 `npm --prefix web run build`。

## 测试设备

- 小米 25102RKBEC（Android 17，1200×2608，density 3）— adb `38467c23`
- Realme RMX3560（Android 14，1080×2412，density 3）— adb `WWI7YPJBFQEE7DHY`
- adb：`D:\AndroidToolchain\sdk\platform-tools\adb.exe`，必须带 `-s`
- 两台都登录了官方账号，可用作真机验证

安装方式：`adb push <apk> /data/local/tmp/x.apk` 然后 `pm install -r -d /data/local/tmp/x.apk`。**不要卸载**，会丢登录态和 API Key。

## 已知限制

1. API 续聊的内容只存在本机 IndexedDB，不会写回官方服务器。
2. 官方账号与 API Key 是两套独立凭证：登录官方账号只同步会话历史，发消息仍需要 API Key。
3. 官方接口是非公开接口（`chat.deepseek.com/api/v0/...`），官方改版可能失效。
4. 公开 TTS 接口只支持 `stella` / `tide` 两个音色，另外两个只在界面列出、朗读时回退。

## 改代码时注意

- `dec2/stable-ids.txt` 固定了资源 ID，新增资源要同步分配。
- CSS 存在 `!important` 覆盖关系（`web/mobile/brand.css` 与组件样式），改首页样式时两处都要看。
- 不要把令牌、含令牌的截图、用户聊天记录提交到仓库。
