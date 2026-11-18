# DeepSeek Chat 2.0.0 — 交接文档

把这份文档连同整个工作区交给下一个 Agent，就能继续开发。所有路径都是绝对路径。

---

## 1. 这个项目是什么

基于第三方开源项目 `chuhongliang2001/DeepSeek-Chatbot` V1.0（其上游是 DeepSeek 官方开源的 [`deepseek-ai/chat-demo`](https://github.com/deepseek-ai/chat-demo)，MIT 协议）二次修改的 Android 客户端。

**核心目标**：外观和交互对齐 DeepSeek 官方 App，但用用户自己的 API Key，并且能把官方 App 导出的历史对话完整导入。

| 项 | 值 |
|---|---|
| 应用名 | `DeepSeek Chat` |
| 包名 | `com.deepseek.chatbot` |
| versionName / versionCode | `2.0.0` / `20` |
| minSdk / targetSdk | 26 / 35 |
| 签名 | 工作区根目录的 `deepseek-demo.keystore`，alias `deepseekdemo`，密码均为 `deepseekdemo` |
| 产物 | `/root/workspace/gh/DeepSeek-Chat-2.0.0.apk`（约 2.1 MB） |
| 用户归档 | `/sdcard/Download/DSH-Go/DeepSeek-Chat-2.0.0/` |

**手机上同时装着另一个包 `com.deepseek.chat.api`**（早期自研壳，源码 `/root/workspace/dsapp`），已废弃，用户尚未确认是否卸载。不要动它。

**用户数据**：678 个会话 / 1294 个附件已导入成功，存在 App 的 IndexedDB 里。**覆盖安装不会丢**，卸载重装会丢。

---

## 2. 工作区结构

```
/root/workspace/gh/
├── assemble.sh                    一键构建脚本（改完代码跑这个）
├── deepseek-demo.keystore         ★ 签名密钥，必须跟着走（换签名必须卸载重装，会丢 678 个会话）
├── DeepSeekChatbot-V1.0.apk       原版底包，提供 classes.dex / classes2.dex 和其它 assets
├── DeepSeek-Chat-2.0.0.apk        构建产物
├── cb/assets/chat/                ★ 前端资源（所有 WebView 侧改动的唯一真源）
│   ├── index.html                 入口，引用下面这些带哈希的文件
│   ├── brand.<hash>.css           首页 logo / 文案 / 搜索框 / 对话页底距 / caveat
│   ├── search.<hash>.js           侧栏搜索的过滤逻辑
│   ├── import-progress.<hash>.js  导入进度浮层
│   ├── drawer-perf.<hash>.css     侧栏列表性能优化
│   ├── drawer-perf.<hash>.js      占位（空文件）
│   ├── whale.svg                  品牌鲸鱼（当前未被引用）
│   └── static/
│       ├── js/main.<hash>.js      ★ 主 bundle（大量改动在这里）
│       ├── js/async/925.<hash>.js ★ 导入逻辑 chunk
│       ├── css/main.47f573b0.css  官方样式（未改动，覆写都在 brand.css）
│       └── media/                 图标字体等
├── dec2/                          ★ apktool 解码的资源（改 app_name 用）
│   ├── AndroidManifest.xml
│   ├── res/values/strings.xml     app_name = "DeepSeek Chat"
│   ├── res/values/public.xml      资源 ID 白名单
│   ├── stable-ids.txt             保证资源 ID 不变的映射表
│   └── linked.apk                 aapt2 link 产物（构建中间物）
└── wicon/                         图标矢量工程
    ├── res/drawable/ic_launcher.xml  ★ 图标源文件
    └── ext/res/drawable/ic_launcher.xml  编译后的二进制（assemble.sh 自动生成）
```

---

## 3. 构建

```bash
bash /root/workspace/gh/assemble.sh
```

依赖（本机已装好）：

| 工具 | 路径 |
|---|---|
| aapt2 / zipalign / apksigner | `/usr/lib/android-sdk/build-tools/debian/` |
| android.jar (API 30) | `/root/sdk/android-11/android.jar` |
| apktool | `/root/workspace/tools/apktool.jar`（只在需要重新解码资源时用） |
| python3 | 系统自带 |

脚本五步：编译图标 → 重编资源表 → 组装 → zipalign → 签名。

**安装**（手机端）：

```bash
cp DeepSeek-Chat-2.0.0.apk /data/local/tmp/
pm install -r -t /data/local/tmp/DeepSeek-Chat-2.0.0.apk
```

---

## 4. 全部改动清单

### 4.1 WebView 前端（`cb/assets/chat/`）

#### A. `static/js/main.<hash>.js`

| # | 改动 | 具体做法 |
|---|---|---|
| 1 | 移除 Q 版吉祥物 | 渲染调用 `n?(0,a.jsx)(sL,{}):null` → `null`；同时删掉 `static/media/mascot-*.webp` |
| 2 | 应用名 | i18n 表 `appName` 两处 → `"DeepSeek"`；`<title>` 同步 |
| 3 | 首页左上角去品牌 | `void 0===t?(0,a.jsxs)("div",{className:lB.wk,...}):` → `void 0===t?null:` |
| 4 | 首页居中鲸鱼 | 在 `lZ.O$`（greeting）的 children 里插入 `(0,a.jsx)("div",{className:"ds-welcome-logo"})`，并把 greeting 从 jsx 改成 jsxs 数组 |
| 5 | 侧栏顶部改搜索框 | `sp.JB` 那个 div（含 `sp.xD` 图标 + appName）→ `<input className="ds-search-input" placeholder="搜索对话内容…">` |

定位技巧：`grep -o 'welcomeMessageChat250808' ` 找首页，`grep 'className:sp.JB'` 找侧栏头部。

#### B. `static/js/async/925.<hash>.js`（导入逻辑）

| # | 改动 | 具体做法 |
|---|---|---|
| 6 | 修复历史对话导入失败 | 原代码硬性要求附件条目紧跟在所属会话 json 之后：`s && e.startsWith("chat_sessions/"+current+"/_files/")`。DeepSeek 导出的 zip 是「所有会话在前、所有附件在后」，所以必然 `backupIncomplete`。改成按会话 id 注册表判断：`if(n.has(/^chat_sessions\/([^/]+)_files\//.exec(e)?.[1]??""))` |
| 7 | 导入卡死（解析目录几分钟） | 每个 zip 条目都 `blob.slice().arrayBuffer()`，在 `content://` 流上是数千次 JNI 往返。改成 8 MB 窗口缓存 `__dsWin`/`__dsC`，目录只解析一次并记忆化 `__dsIdx`/`__dsI` |
| 8 | 导入进度上报 | 每处理若干条写 `window.__dsImportProgress={done,total,path}`，阶段标记 `{stage:"read"\|"index"}` |

#### C. `brand.<hash>.css`（覆写样式）

```css
.ds-welcome-logo { width:40px; height:30.6px; margin:0 auto 17px;
                   background-image:url("data:image/png;base64,..."); }  /* 官方渐变鲸鱼，裁到边界 */
.greeting-_1f155 { flex-direction:column !important;
                   font-size:20px !important; line-height:28px !important;
                   letter-spacing:-.4px !important; font-weight:500 !important; }
.caveat-_1f155 { display:none !important; }        /* 只隐藏主页那行，对话页保留 */
.welcome-_1f155 { padding-bottom:8px !important; }
.inputContainer-_5fa77 { padding-bottom:0 !important; }  /* 对话页底部 20px 多余内边距 */
.caveat-_5fa77 { padding-bottom:2px !important; margin-bottom:0 !important; }
.ds-search-input { /* 侧栏搜索框，含内联 SVG 放大镜图标 */ }
.ds-search-hidden { display:none !important; }
```

首页尺寸是像素级对齐官方截图的：

```
鲸鱼宽 / 屏宽       9.70%   （官方 9.58%）
图标底到文字顶 / 屏宽  5.85%   （官方 5.92%）
```

#### D. `search.<hash>.js`

侧栏搜索：监听 `.ds-search-input` 的 `input`/`compositionend`，给不匹配的 `.item-ff6fc9` 加 `.ds-search-hidden`，全空的 `.section-ac14ac` 连标题一起隐藏。用 `MutationObserver` + `setInterval` 兜住 React 重渲染。Esc 清空。

#### E. `import-progress.<hash>.js`

三阶段进度浮层：读取 MB%、解析目录、写入条目。关键是有 `settled` 标志——原来 `render()` 每 120ms 被调一次，到 100% 时每次都新建 `setTimeout`，堆了几千个定时器导致 UI 假死、必须重启。

#### F. `drawer-perf.<hash>.css`

```css
.list-ac14ac { contain: layout paint; overscroll-behavior: contain; }
.list-ac14ac > .section-ac14ac { content-visibility: auto; contain-intrinsic-size: auto 320px; }
/* drawer 加 will-change: transform / backface-visibility: hidden，阴影 48px→24px */
```

改完实测 `dumpsys gfxinfo`：`Janky frames: 0 (0.00%)`。

### 4.2 图标（`wicon/res/drawable/ic_launcher.xml`）

白底 + 蓝鲸 + 右下角斜切三角 + 白色 C：

```xml
<vector width="108dp" height="108dp" viewportWidth="468" viewportHeight="468">
  <path fillColor="#FFFFFFFF" pathData="M0,0h468v468H0z"/>                    <!-- 白底 -->
  <group translateX="-30.3" translateY="-33.3">
    <path fillColor="#FF4D6BFE" pathData="…官方鲸鱼 pathData…"/>              <!-- 鲸鱼占 74.7% -->
  </group>
  <path fillColor="#FF4D6BFE" pathData="M 293 468 L 468 293 L 468 468 Z"/>   <!-- 斜切三角 -->
  <path fillColor="#FFFFFFFF" pathData="…C 字形…"/>                            <!-- 白 C -->
</vector>
```

**鲸鱼 pathData 来自官方 APK**：`/root/workspace/gh/dec2/original/res/drawable-anydpi/ic_launcher_foreground.xml`（如果没有，从 `/sdcard/Download/DSH-Go/_official_base.apk` 重新解，或从官方 App 安装目录拿 base.apk 用 apktool 解）。

**比例是怎么算的**（踩过坑，别再用坐标数字估）：

```
鲸鱼 pathData 的贝塞尔控制点会超出实际绘制范围，用正则抓数字算边界是错的
正确做法：cairosvg 渲染成 PNG，用 numpy 找蓝色像素的 bbox
实测鲸鱼在 512 视口内 x:90~439（宽 349）
目标占图标 74.5% → viewport = 349/0.745 = 468.5
居中平移 = (viewport/2 - 鲸鱼中心x, 同 y) = (-30.3, -33.3)
```

**C 角标的参数演进**（用户逐轮微调出来的，改动前先看这段）：

| 轮次 | 三角边长 L | C 外径 | C 中心 | 结果 |
|---|---|---|---|---|
| 1 | 205 | 40 | 重心 | 太大 |
| 2 | 230 | 42 | 重心 | 太大 |
| 3 | 155 | 27 | 重心 | 偏小，C 被圆角切 |
| 4 | 190 | 32 | 内切圆心 | C 仍被切 |
| 5 | 175 | 24 | 内切圆心 | C 仍被切 |
| **6（当前）** | **175** | **24** | **内切圆心再上移 15 → (416.7, 401.7)** | 用户接受 |

**圆角裁切的计算公式**（关键，别再试错）：

```
系统圆角半径 Rc = 视口 × 0.25 = 117，圆心 Oc = (468-117, 468-117) = (351,351)
C 的右下点 (cx + R·0.707, cy + R·0.707) 到 Oc 的距离必须 < Rc

L=155 → C 外径上限 15.7
L=170 → 上限 22.0
L=175 → 上限 24.0     ← 当前，卡在上限，所以必须上移
L=190 → 上限 30.2
```

### 4.3 资源与应用名（`dec2/`）

改 `app_name` 必须重编 `resources.arsc`，流程：

1. `java -jar /root/workspace/tools/apktool.jar d -f -s DeepSeekChatbot-V1.0.apk -o dec2`
2. 改 `dec2/res/values/strings.xml` 的 `app_name`
3. 用 `dec2/res/values/public.xml` 生成 `stable-ids.txt`（保证 8 个资源 ID 全部不变，否则 dex 里的 R 引用会错乱）
4. `aapt2 compile --dir res -o res.zip`
5. `aapt2 link --stable-ids stable-ids.txt --version-code 20 --version-name 2.0.0`
6. 用 link 产物替换原包的 manifest/res/arsc，保留 dex 与 assets

`assemble.sh` 已经把这套固化好了。

---

## 5. 必须知道的坑

### 5.1 WebView 死缓存（最常踩）

**任何 `file:///android_asset/` 下的资源被修改后，必须改文件名**，否则 WebView 用旧缓存，改了等于没改。

规则：**每次改完 `main.*.js` / `brand.*.css` / 任何被 `index.html` 引用的文件，都要重算 sha256 前 8 位当文件名，并同步改 `index.html` 里的引用。**

```bash
cd cb/assets/chat
python3 - <<'PY'
import glob, hashlib, shutil, re
p = glob.glob('static/js/main.*.js')[0]
h = hashlib.sha256(open(p,'rb').read()).hexdigest()[:8]
if p != f'static/js/main.{h}.js':
    shutil.move(p, f'static/js/main.{h}.js')
    s = open('index.html',encoding='utf-8').read()
    s = re.sub(r'main\.[0-9a-f]{8}\.js', f'main.{h}.js', s)
    open('index.html','w',encoding='utf-8').write(s)
    print('main ->', h)
PY
```

**另一个坑**：`brand.*.css` 一度同时存在两个文件（旧的没删），`glob[0]` 抓到旧的那个，改了半天没生效。改之前先 `ls brand*` 确认只有一个。

### 5.2 `resources.arsc` 必须 ZIP_STORED

被 zip 压缩过会报 `INSTALL_FAILED_...(-124)`「该安装包与您的系统不兼容」。`assemble.sh` 里已经处理。

### 5.3 aapt2 版本限制

本机 aapt2 是 2.19（对应 API 30），**不认识 `android:dataExtractionRules`（API 31 属性）**，编译会报 `attribute not found`。已经从这个项目的 manifest 里移除了，只影响 Android 12+ 的备份规则，不影响功能。

要用 API 31+ 的资源特性，得先换更新的 aapt2，但新的 aapt2 会拒绝加载旧的 `resources.arsc` 当 `-I` 输入，需要额外处理平台包。

### 5.4 不要用 `contain: strict` / 尺寸包含

在 `.drawerMask` 之类的遮罩元素上用 `contain: strict` 会把尺寸塌成 0，侧栏直接点不开。只能用 `layout paint`。每次改侧栏相关 CSS 都要实测能不能打开。

### 5.5 导入相关

- 用户原始导出：`/sdcard/Download/DLManager/deepseek_data-2026-11-18.zip`（505 MB / 1294 条目 / 678 会话 / 613 附件）
- 导入是覆盖式的，重复导入安全，但真机上要 1–2 分钟
- 回归测试可以跑 Node harness（需要自己重建，桩模块 3312/236/3519/9861，沙箱里要补 `setTimeout`）

### 5.6 手机操控

这台机器用 `mcp__phone__android_shell`（uid 2000，Shizuku 通道），**每条命令都要用户在手机上确认**。

- `cp` 和 `pm install` 必须分开发，串成一条会 `invalidArguments`
- 命令连续被拒两次就停下，不要自动重试
- 桌面图标有 MIUI 缓存，`pm install -r` 后不一定刷新，重启桌面或手机会生效
- 打开目标 App 时系统可能弹「DSH Go 想要打开 X」，需要 `handoff` 让用户点允许

---

## 6. 待办 / 可继续做的方向

### 6.1 未完成的小问题

| 项 | 说明 |
|---|---|
| 对话页底部还剩约 20 CSS px 空白 | 是 WebView 视口底部到屏幕物理底部的落差（状态栏+导航栏），纯 CSS 碰不到。要彻底解决得给 `MainActivity` 开 edge-to-edge 让 WebView 延伸进导航栏区域，但底部手势条会盖住那行字。也可以给 `inputContainer` 加负 margin 强行下移 8–10px，风险是被裁 |
| 桌面图标尺寸缓存 | 包内参数已经是鲸鱼 74.7%，但 MIUI 有时不刷新 |
| 旧包 `com.deepseek.chat.api` | 用户没确认是否卸载，保留中 |
| 首页文案 | 现在还是「今天有什么可以帮到你？」，官方是「欢迎回来，想从哪里开始？」。用户没要求改，问过一次没回 |

### 6.2 可以做的新功能

- **侧栏手指跟手拖拽**：现在是点击触发动画，没做成手指跟随。要改 `drawer-perf` 那套，加 `touchstart/touchmove` 计算 `translateX`。
- **跨对话长记忆**：参考 `OhMyDeepSeek-v0.5.1.apk` 的做法（这个 APK 还在工作区）。
- **导入导出**：现在只能导入，可以考虑把 App 内的会话导出回 DeepSeek 格式。
- **主题色跟随官方**：现在 `#4D6BFE` 是硬编码，官方 App 是渐变 `#5D78FE → #3E5FFE`。

---

## 7. 快速验证清单

改完东西，按这个顺序验一遍：

```bash
# 1. 构建
bash /root/workspace/gh/assemble.sh

# 2. 确认图标参数没被改坏
aapt dump xmltree DeepSeek-Chat-2.0.0.apk res/drawable/ic_launcher.xml | grep -E "viewport|translate"

# 3. 确认版本和名字
aapt dump badging DeepSeek-Chat-2.0.0.apk | grep -E "^package|application:"

# 4. 装到手机
cp DeepSeek-Chat-2.0.0.apk /data/local/tmp/
pm install -r -t /data/local/tmp/DeepSeek-Chat-2.0.0.apk

# 5. 手动验证：首页鲸鱼居中 → 左上角无图标 → 开侧栏有搜索框 → 搜"线性"能筛出两条
#    → 点进会话 → 底部提示行贴着导航栏 → 导入历史对话不卡死
```

---

## 8. 参考资料

原工作区里还有两个第三方 APK，为了减小交接包已经移除，需要研究的话自己下：

| 项目 | 用途 | 来源 |
|---|---|---|
| OhMyDeepSeek | 跨对话长记忆的实现参考 | GitHub 搜同名项目 |
| DeepSeekMemory | 另一个记忆方案 | GitHub 搜同名项目 |

原始前端构建产物在 `chat-demo-v0.1.1.zip`（官方 `deepseek-ai/chat-demo` 的 dist）。

## 9. 许可

上游 `deepseek-ai/chat-demo` 是 MIT，`chuhongliang2001/DeepSeek-Chatbot` 是其二次封装的 Android 壳。本项目在此基础上修改，**仅供个人使用，不要再分发**。`cb/assets/chat/LICENSE` 是原有的 MIT 许可文本。
