# DeepSeek Chat

DeepSeek Chat 是一款使用自备 DeepSeek API Key 的非官方 Android 客户端。可导入 DeepSeek 网页版导出的对话，聊天记录保存在本机。

## 下载

**[下载 v3.0.0 APK](https://github.com/Temeowde/deepseek-chat-android/releases/download/v3.0.0/DeepSeek-Chat-3.0.0.apk)** · [所有版本](https://github.com/Temeowde/deepseek-chat-android/releases) · [更新记录](CHANGELOG.md)

支持 Android 8.0 及以上。在侧栏底部打开设置，填写在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 创建的 API Key。配置前也可以浏览、搜索和导入本地历史。

## 主要功能

- **搜索与备份**。按标题、提问或回答搜索历史，直接定位到匹配消息。支持导入网页版对话 ZIP、合并本地历史，以及导出备份。
- **会话管理**。置顶、重命名和批量整理会话。修改提问或重新生成时可切换回答分支，也可停止生成后继续回答。
- **阅读与分享**。切换会话时保留阅读位置。支持朗读回答、查看联网搜索引用、展开表格和导出 CSV，也可将选中的问答分享为文本或长图。
- **输入与设置**。支持相册、拍照、文件和语音输入。可调节主题、界面语言、正文字号、思考内容折叠和朗读音色。

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

产物：`DeepSeek-Chat-3.0.0.apk`

安装：

```bash
adb install -r DeepSeek-Chat-3.0.0.apk
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
