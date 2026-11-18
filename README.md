# DeepSeek Chat (Android)

把 DeepSeek 官方开源的 [chat-demo](https://github.com/deepseek-ai/chat-demo) Web 前端封装成 Android 客户端，并做了一系列针对手机端的改造。

用你自己的 API Key，外观和交互对齐官方 App，可以把官方 App 导出的历史对话完整导入。

| | |
|---|---|
| 应用名 | DeepSeek Chat |
| 包名 | `com.deepseek.chatbot` |
| 版本 | 2.0.0 (versionCode 20) |
| minSdk / targetSdk | 26 / 35 |
| 体积 | 约 2.1 MB |

## 特性

- **历史对话导入**：直接吃 DeepSeek 官方 App 导出的 zip（实测 505 MB / 678 会话 / 1294 条目，12 秒导入完成）
- **对话搜索**：侧栏顶部搜索框，输入即时过滤
- **首页对齐官方**：居中鲸鱼图标 + 问候语的尺寸和间距是像素级对齐的
- **图标**：官方鲸鱼 + 右下角 C 角标
- **侧栏性能**：`content-visibility` + `contain` 优化长列表，实测 0 掉帧

## 已知问题

- 对话页底部提示行下方还有约 20 CSS px 回不去，那是 WebView 视口到屏幕物理底的落差（状态栏+导航栏），纯 CSS 碰不到
- MIUI 桌面的图标/应用名有缓存，覆盖安装后可能需要重启桌面

## 构建

需要 Android build-tools（aapt2 / zipalign / apksigner）、`android.jar`、apktool、python3。

```bash
# 1. 下载原版底包（提供 dex），放到仓库根目录
#    https://github.com/chuhongliang2001/DeepSeek-Chatbot 的 Releases 里的 V1.0
#    文件名需要是 DeepSeekChatbot-V1.0.apk

# 2. 准备签名密钥（换签名必须卸载重装，会丢数据）
keytool -genkeypair -keystore deepseek-demo.keystore -alias deepseekdemo \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass deepseekdemo -keypass deepseekdemo \
  -dname "CN=Local Build"

# 3. 构建
bash assemble.sh
```

`assemble.sh` 里三个路径是硬编码的，换机器要改开头几行。

## 改了什么

详细清单（含每处改动的代码片段、参数计算公式、踩过的坑）见 [HANDOFF.md](HANDOFF.md)。

| # | 改动 |
|---|---|
| 1 | 移除原项目的 Q 版吉祥物 |
| 2 | 应用名改 DeepSeek Chat |
| 3 | **修复历史对话导入**（原代码硬依赖 zip 条目顺序，DeepSeek 的导出格式必然触发 `backupIncomplete`） |
| 4 | 导入三阶段进度条 |
| 5 | **修复导入完成后卡死**（每帧新建 setTimeout，堆了几千个定时器） |
| 6 | 导入性能（zip 目录解析 8 MB 窗口缓存，从几分钟降到 12 秒） |
| 7 | 侧栏滑动掉帧优化 |
| 8 | 首页对齐官方样式（鲸鱼图标 + 文案，像素级） |
| 9 | 左上角去掉品牌图标 |
| 10 | 侧栏顶部改为对话搜索 |
| 11 | 官方鲸鱼图标 + C 角标 |

## 技术要点

这个项目的多数问题来自 **WebView 对 `file://` 资源的死缓存**：修改任何 `assets` 下的文件后必须改文件名（内容哈希），否则改了等于没改。

`resources.arsc` 必须 `ZIP_STORED`，压缩过会 `INSTALL_FAILED (-124)`。

详见 HANDOFF.md 第 5 节。

## 许可

上游 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 是 MIT；[chuhongliang2001/DeepSeek-Chatbot](https://github.com/chuhongliang2001/DeepSeek-Chatbot) 是其 Android 封装。

本仓库只包含修改部分（前端资源 + 构建脚本 + 图标），**不含原版 APK 与签名密钥**，需自行准备。
