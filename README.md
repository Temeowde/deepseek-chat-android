# DeepSeek Chat

基于 DeepSeek 开源前端 [chat-demo](https://github.com/deepseek-ai/chat-demo) 及社区 Android 封装的非官方客户端。使用你自己的 API Key，对话保存在本机，不会自动同步官方账号的历史。

## 下载

[下载 v2.1.0 安装包](https://github.com/Temeowde/deepseek-chat-android/releases/download/v2.1.0/DeepSeek-Chat-2.1.0.apk) · [首版 v2.0.0](https://github.com/Temeowde/deepseek-chat-android/releases/tag/v2.0.0) · [所有版本](https://github.com/Temeowde/deepseek-chat-android/releases)

每个发布页都附有 APK 和更新说明。[更新记录](CHANGELOG.md)

## 特性

- **历史备份** — 可导入官方网页版导出的 ZIP，也可导出本地历史。备份包含本地图片原件，普通文档只保留文件信息。导入默认合并到本地历史，保留已有对话和草稿。需要用备份替换本地历史时，可单独确认覆盖。
- **对话搜索** — 按标题、提问或回答正文筛选本地历史。点正文命中可直接回到对应消息，命中旧版本时进入对应分支。搜索不需要 API Key。
- **联网搜索来源** — 点回答中的引用编号，只看属于这句话的来源；点回答末尾的网页数量，可浏览完整列表。手机上点一条来源在应用内阅读，按返回保留列表位置；也可交给系统浏览器打开。
- **长回答阅读** — 长对话先显示最近的消息，向上翻阅时分批加载更早的消息。切换会话后回到原来的阅读位置，点输入框上方的向下按钮可回到最新内容。
- **表格与代码** — 手机可复制表格、展开查看和通过系统分享面板导出 CSV。长代码可以横滑阅读和整段复制。
- **消息操作** — 长按提问可复制、选择部分文字、修改或分享；长按回答还可重新生成、朗读或标记喜欢／不喜欢。重新生成会保留旧回答，可切换版本，评价只存在本机。
- **选择分享内容** — 可逐条勾选当前分支的问答，复制文本、生成长图或打开 Android 分享面板。不会创建官方公开链接，也不会自动发送给联系人。
- **历史侧栏** — 可点击打开或随手指横拖开合；长按会话可改名、置顶、取消置顶或删除，也能多选后批量操作。置顶状态随备份保留。
- **附件** — 加号可打开拍照、相册或文件入口。真机已验证拍照返回的 JPEG 能进入草稿并随问题发送，也可在同一条消息中发送图片和文本文档。
- **语音** — 短按输入区可打字；长按说话，松手发送，上滑取消。右上角的扬声器可开启新回答的自动朗读，默认关闭；也可单独朗读一条回答。
- **手机设置** — 从侧栏底部进入，可调外观、界面语言、正文字号、思考内容自动折叠和朗读音色；重启后保留。这里也可配置 API Key 和管理本地备份。

## 环境要求

- Android 8.0（API 26）及以上
- 浏览首页和本地历史不用配置 API Key。发送消息、上传附件或使用语音时，需要自己的 DeepSeek API Key，可从 [开放平台](https://platform.deepseek.com/api_keys) 获取。

## 构建

需要 Android build-tools（`aapt2` / `zipalign` / `apksigner`）、`android.jar`、[apktool](https://github.com/iBotPeaches/Apktool)、python3、JDK，以及 Node.js 22.12 或更高版本和 npm。

```bash
# 生成签名密钥
keytool -genkeypair -keystore release.keystore -alias release \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <密码> -keypass <密码> -dname "CN=Local Build"

# 设置签名密码后构建（使用自己的本地密钥）
read -rs KS_PASS && export KS_PASS
bash assemble.sh
```

产物：`DeepSeek-Chat-2.1.0.apk`

安装：

```bash
adb install -r DeepSeek-Chat-2.1.0.apk
```

## 项目结构

```
src/smali/            Java 代码（smali 汇编格式）
src/smali_classes2/
src/java/             Android 附件、显示偏好、分享和来源阅读页
dec2/                 资源与 AndroidManifest
web/src/              可编辑的 React / TypeScript 聊天前端
web/mobile/           手机交互、样式和图标
cb/assets/chat/       迁移前的静态版本，供比对
wicon/                图标矢量
assemble.sh           构建脚本
tests/                离线回归和仅供调试的真机测试音源
```

前端可以单独运行 `npm --prefix web ci --ignore-scripts` 和 `npm --prefix web run build`。构建自动生成带内容哈希的资源及入口，输出到 `web/dist/`。`assemble.sh` 将其装入 APK，WebView 继续通过原来的地址加载。详见 [技术说明](TECHNICAL.md)。

## 许可

前端部分源自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT），上游版权声明保留在 [web/LICENSE](web/LICENSE)、[web/LICENSE.community](web/LICENSE.community) 和 [web/NOTICE](web/NOTICE)。
