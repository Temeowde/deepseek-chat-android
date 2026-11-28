# DeepSeek Chat

DeepSeek Chat 是一款非官方 DeepSeek Android 客户端。可以登录自己的官方账号同步会话，也可以使用自备的 API Key 继续聊天；聊天记录保存在本机，并支持自动备份到手机公共目录，卸载重装也不会丢。

## 下载

**[下载 v4.6.22 APK](https://github.com/Temeowde/deepseek-chat-android/releases/download/v4.6.22/DeepSeek-Chat-4.6.22.apk)** · [所有版本](https://github.com/Temeowde/deepseek-chat-android/releases) · [更新记录](CHANGELOG.md)

支持 Android 8.0 及以上。在侧栏底部打开设置，填写在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建的 API Key；也可以在侧栏底部的账号行登录官方账号，同步官方会话。

> 登录官方账号只用于同步官方会话历史。发送消息走 DeepSeek 开放平台，需要单独配置 API Key，两者是分开的。

## 主要功能

- **官方账号同步**。登录自己的官方账号后，官方 App 里的会话会同步到本地列表，打开会话时自动刷新；侧栏支持下拉刷新。官方额度用完时，可以在同一条对话里用 API 接着聊。
- **本地备份与恢复**。默认开启；首次启动/升级时会说明并申请「所有文件访问权限」（只用于读写 `/sdcard/DS-Chat` 的备份，不会读其它文件）。约每 2 分钟检查一次，有改动的会话增量备份到手机公共目录（通常几百 KB），并定期刷新一份完整备份。支持扫描本机备份、按时间点恢复、恢复前确认与进度显示；卸载重装后也能找回。
- **导入与导出**。支持导入网页版对话 ZIP、导入本机备份、合并本地历史；导出支持**只选部分对话**（搜索标题、按最近更新/消息最多排序），文件名可读（如 `对话导出-2026-11-28-1638-2个对话.zip`），默认写到 `/sdcard/DS-Chat`，完成后可直接分享到微信/QQ。大文件分块读写，导出完成也会登记到系统「最近文件」并可一键打开文件管理器。
- **自定义 API**。内置 DeepSeek 官方接口，也支持自定义兼容 OpenAI 格式的服务商（可配置多个供应商与模型），在设置 → 数据管理 → 自定义 API 里切换。
- **朗读**。回答支持朗读，接入官方 4 个朗读音色（贝壳、白浪、海星、暗潮），切换音色时可试听。
- **用量与上下文**。每轮回答后可查看「本轮消耗额度」：缓存命中/未命中、输入与输出 token、金额估算，以及截止本轮的上下文占用率（按 API 实际上限 1,048,576 计算）。
- **搜索与整理**。按标题、提问或回答搜索历史，直接定位到匹配消息。置顶、重命名和批量整理会话；修改提问或重新生成时可切换回答分支，也可停止生成后继续回答。
- **阅读与分享**。切换会话时保留阅读位置。查看联网搜索引用、展开表格和导出 CSV，也可将选中的问答分享为文本或长图。
- **启动保护**。启动失败/超时/WebView 版本过低/渲染进程崩溃时显示可操作的错误卡片（重新加载、复制诊断信息），不再只剩白屏；启动阶段的后台同步、补正文、重复清理和首次备份都做了延后与分片，旧手机不会一进界面就卡死。
- **输入与设置**。支持相册最近图片、拍照、文件和语音输入。可调节主题、界面语言、字体、正文大小、思考内容折叠和朗读音色。

## 构建

需要 JDK 17、Node.js 22 及以上、Android SDK（build-tools 35 与 platform 35）。所有依赖都放在仓库里，不依赖系统级安装。

```powershell
# Android SDK 路径：默认读 ANDROID_HOME / ANDROID_SDK_ROOT，也可显式指定
$env:ANDROID_SDK = 'D:\AndroidToolchain\sdk'

# 签名：默认使用 ~/.android/debug.keystore（androiddebugkey / android）
# 换成自己的密钥：
# $env:KEYSTORE='path/to/release.keystore'; $env:KS_ALIAS='release'; $env:KS_PASS='密码'

powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

产物：`DeepSeek-Chat-4.6.22.apk`

安装：

```bash
adb install -r DeepSeek-Chat-4.6.22.apk
```

Linux / macOS 下可以继续使用 `assemble.sh`（需要 python3）。

## 项目结构

```
src/smali/            Java 代码（smali 汇编格式）
src/smali_classes2/
src/java/             Android 附件、显示偏好、官方账号、本地备份、分享和来源阅读页
dec2/                 资源与 AndroidManifest
web/src/              可编辑的 React / TypeScript 聊天前端
web/mobile/           手机交互、样式和图标
wicon/                图标矢量
tools/                smali.jar 及其依赖（构建用，已随仓库提供）
tools/dev/            开发期真机调试脚本（不参与构建）
build.ps1             Windows 构建脚本
assemble.sh           Linux / macOS 构建脚本
tests/                离线回归和仅供调试的真机测试音源
```

前端可以单独运行 `npm --prefix web ci --ignore-scripts` 和 `npm --prefix web run build`。构建自动生成带内容哈希的资源及入口，输出到 `web/dist/`，随后被打进 APK，WebView 通过 `file:///android_asset/chat/index.html` 加载。详见 [技术说明](TECHNICAL.md)。

## 许可

见 [LICENSE](LICENSE)。
