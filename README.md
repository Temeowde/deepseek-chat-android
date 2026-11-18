# DeepSeek Chat (Android)

把 DeepSeek 官方开源的 [chat-demo](https://github.com/deepseek-ai/chat-demo) Web 前端封装成原生 Android 客户端，并针对手机做了大量改造——移动端布局、历史对话导入、长列表性能、图标与首页样式。

用你自己的 API Key，外观和交互对齐官方 App，可以把官方 App 导出的历史对话完整导入。

| | |
|---|---|
| 应用名 | DeepSeek Chat |
| 包名 | `com.deepseek.chatbot`（沿用初版，见下） |
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
# 1. 准备底包（提供 classes.dex，WebView 壳的启动代码在这里）
#    这是一个已编译好的 chat-demo Android 壳，重命名为 base.apk 放到根目录
#    README 末尾「底包从哪来」一节有说明

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

## 关于包名

包名 `com.deepseek.chatbot` 沿用初版标识，**未做改动**。Android 的包名就是应用唯一标识，改了等于换一个 App，已存的对话数据（IndexedDB）不会迁移过来。应用名、主题名、界面文案都是新的。

## 底包从哪来

构建需要一个预先编译好的 Android 壳 APK，它提供 `classes.dex`（WebView 初始化、文件选择器、分享等原生能力）和 `assets/chat/` 的原始前端。仓库里不放这个文件，因为：

- 它是二进制，不适合进 git
- 它有自己的发布渠道

获取方式：GitHub 上有若干现成的 chat-demo Android 壳，从 Releases 拿一个 V1.0 级别的版本，重命名为 `base.apk` 即可。任何「加载 `file:///android_asset/chat/index.html` 的 WebView Activity」都能当底包。

如果找不到，本项目本质上是「WebView + 一个加载 `file:///android_asset/chat/index.html` 的 Activity」，自己用 Android Studio 写一个 30 行的壳也能替代，`AndroidManifest.xml` 和资源结构见 `dec2/`。

## 许可

上游 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 是 MIT，本仓库的 `cb/assets/chat/` 即其构建产物改造而来，完整版权声明见 [LICENSE](LICENSE)。

本仓库只包含修改部分（前端资源 + 构建脚本 + 图标 + 文档），**不含底包 APK 与签名密钥**。
