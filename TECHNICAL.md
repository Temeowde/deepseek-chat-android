# 技术说明

构建、调试和维护这份代码时需要注意的东西。

## 构建流程

`assemble.sh` 做五件事：

1. **编译 smali** — `apktool b --no-res` 把 `src/smali*/` 汇编成 dex
2. **编译图标** — `aapt2 compile` + `link` 处理 `wicon/res/`
3. **编译资源表** — `aapt2 link` 处理 `dec2/res/`，用 `stable-ids.txt` 锁定资源 ID
4. **组装** — python 的 zipfile 把资源、dex、前端打进一个 APK
5. **对齐签名** — `zipalign -p 4` + `apksigner`

### 资源 ID 必须固定

`dec2/stable-ids.txt` 列出了所有资源及其 ID（`0x7f010000` ~ `0x7f040001`）。smali 里的 `R$string`、`R$drawable` 等类直接引用这些数字，ID 一变就会取错资源。

新增资源时，先在 `dec2/res/values/public.xml` 里分配一个未占用的 ID，同步写进 `stable-ids.txt`。

### aapt2 版本

当前用的 aapt2 是 2.19（对应 API 30）。它不认识 API 31 之后新增的属性，例如 `android:dataExtractionRules` 会让 `link` 报 `attribute not found`。

要使用更新的资源特性，需要换新版 aapt2，但新版会拒绝把旧格式的 `resources.arsc` 作为 `-I` 输入，得额外处理平台包。`AndroidManifest.xml` 目前没有用到 API 31 的属性。

### resources.arsc 必须以 STORED 方式打包

zip 压缩过的 `resources.arsc` 会导致真机 `INSTALL_FAILED (-124)`「该安装包与您的系统不兼容」。`assemble.sh` 里对这一个条目单独设了 `ZIP_STORED`。

## 前端资源

`cb/assets/chat/` 是 chat-demo 的构建产物，被 WebView 以 `file:///android_asset/chat/index.html` 加载。

### 改动后必须重命名

WebView 对 `file://` 资源有强缓存，**内容改了但文件名没变，加载的还是旧版本**。

改完任何被 `index.html` 引用的文件（`main.*.js`、`*.css` 等），要重算 sha256 前 8 位当文件名，并更新 `index.html` 里的引用：

```bash
cd cb/assets/chat
python3 - <<'PY'
import glob, hashlib, shutil, re
p = glob.glob('static/js/main.*.js')[0]
h = hashlib.sha256(open(p,'rb').read()).hexdigest()[:8]
if p != f'static/js/main.{h}.js':
    shutil.move(p, f'static/js/main.{h}.js')
    s = open('index.html', encoding='utf-8').read()
    s = re.sub(r'main\.[0-9a-f]{8}\.js', f'main.{h}.js', s)
    open('index.html', 'w', encoding='utf-8').write(s)
PY
```

同理适用于 `brand.*.css` 等自建文件。注意改之前确认目录里没有残留的旧同名文件，否则 `glob[0]` 可能抓到错的那个。

### 动画与合成层

遮罩类元素（`.drawerMask-*`）不能用 `contain: strict`，尺寸包含会让它塌成 0，侧栏点不开。长列表用 `content-visibility: auto` 配合 `contain-intrinsic-size` 即可。

## 数据存储

对话、附件都存在 WebView 的 IndexedDB 里，路径 `/data/data/com.temeowde.dschat/app_webview/`。卸载 App 会一并删除。

API Key 加密后存在 SharedPreferences。

## 已知限制

对话界面底部提示文字下方约有 20 CSS px 无法消除的空白。这是 WebView 视口底边与屏幕物理底边的差值（状态栏 + 导航栏高度），CSS 无法越过。要彻底解决需让 Activity 开启 edge-to-edge，但底部手势条会盖住那行文字。

## 后续可做

- 侧栏支持手指跟手拖拽（现在是点击触发的滑入动画）
- 会话导出回 DeepSeek 官方格式
- 主题色支持自定义
