# DeepSeek Chat

DeepSeek 官方开源前端 [chat-demo](https://github.com/deepseek-ai/chat-demo) 的 Android 封装，用你自己的 API Key。

## 特性

- **历史对话导入** — 直接导入 DeepSeek 官方 App 导出的 zip，几百 MB 也在十几秒内完成
- **对话搜索** — 侧栏顶部搜索框，输入即筛选
- **动画流畅** — 侧边栏打开关闭动画流畅不掉帧

## 环境要求

- Android 8.0（API 26）及以上
- 一个 DeepSeek API Key，从 [开放平台](https://platform.deepseek.com/api_keys) 获取

## 构建

需要 Android build-tools（`aapt2` / `zipalign` / `apksigner`）、`android.jar`、[apktool](https://github.com/iBotPeaches/Apktool)、python3、JDK。

```bash
# 生成签名密钥
keytool -genkeypair -keystore release.keystore -alias release \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <密码> -keypass <密码> -dname "CN=Local Build"

# 编辑 assemble.sh 开头的路径与密钥信息，然后
bash assemble.sh
```

产物：`DeepSeek-Chat-2.0.0.apk`

安装：

```bash
adb install -r -t DeepSeek-Chat-2.0.0.apk
```

## 项目结构

```
src/smali/            Java 代码（smali 汇编格式）
src/smali_classes2/
dec2/                 资源与 AndroidManifest
cb/assets/chat/       Web 前端（chat-demo 构建产物）
wicon/                图标矢量
assemble.sh           构建脚本
```

前端资源改动后需要重命名文件（内容哈希）并更新 `index.html` 引用，WebView 会缓存 `file://` 资源。详见 [TECHNICAL.md](TECHNICAL.md)。

## 许可

前端部分源自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT），版权声明见 [LICENSE](LICENSE)。
