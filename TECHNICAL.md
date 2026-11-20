# 技术说明

构建、调试和维护这份代码时需要注意的东西。

## 构建流程

`assemble.sh` 先通过 npm 锁文件从 `web/` 编译聊天前端，然后构建 Android 外壳：

1. **编译原生代码** — `apktool b --no-res` 把 `src/smali*/` 汇编成 dex；`javac`、`d8` 把 `src/java/` 的附件选择器、显示偏好与分享接口编为第三个 dex
2. **编译图标** — `aapt2 compile` + `link` 处理 `wicon/res/`
3. **编译资源表** — `aapt2 link` 处理 `dec2/res/`，用 `stable-ids.txt` 锁定资源 ID
4. **组装** — python 的 zipfile 把资源、dex、前端打进一个 APK
5. **对齐签名** — `zipalign -p 4` + `apksigner`

### 资源 ID 必须固定

`dec2/stable-ids.txt` 列出了所有资源及其 ID（`0x7f010000` ~ `0x7f040001`）。smali 里的 `R$string`、`R$drawable` 等类直接引用这些数字，ID 一变就会取错资源。

新增资源时，先在 `dec2/res/values/public.xml` 里分配一个未占用的 ID，同步写进 `stable-ids.txt`。

### aapt2 版本

早期构建用的 aapt2 是 2.19（对应 API 30）。它不认识 API 31 之后新增的属性，例如 `android:dataExtractionRules` 会让 `link` 报 `attribute not found`。本轮真机包已用 Android SDK build-tools 35.0.1、平台 `android-35/android.jar` 和 Apktool 2.11.1 完整重编 dex 和资源。

要使用更新的资源特性，需要换新版 aapt2，但新版会拒绝把旧格式的 `resources.arsc` 作为 `-I` 输入，得额外处理平台包。`AndroidManifest.xml` 目前没有用到 API 31 的属性。

### resources.arsc 必须以 STORED 方式打包

zip 压缩过的 `resources.arsc` 会导致真机 `INSTALL_FAILED (-124)`「该安装包与您的系统不兼容」。`assemble.sh` 里对这一个条目单独设了 `ZIP_STORED`。

## 前端资源

现在编辑 `web/src/`（React / TypeScript）及 `web/mobile/`（本项目的手机组件与样式）。`web/dist/` 是打包输入。`cb/assets/chat/` 保留为迁移前的对照，不再参与构建。两种构建在 APK 中的入口都是 `file:///android_asset/chat/index.html`，没有更改 IndexedDB 数据库名、表结构或正式包名。

### 匹配可编辑源码

官方 `deepseek-ai/chat-demo` 是静态聊天前端，不是官方 Android 客户端源码。本仓库前端的版本标记是 `0.1.1`；更接近当前 Android 实现的参考是社区项目 `chuhongliang2001/DeepSeek-Chatbot` 的 `c5aac51eed91f98ede847676238cfd84e863d120`。它的 `web/src/` 有 React/TypeScript 源码，`app/src/main/java/` 有原生外壳。

以本仓库 `a9d3ef6` 为基线，161 个前端文件中有 151 个与该上游的相对路径和 Git blob 相同。在未修改上游的独立检出中，锁文件安装后构建出的 155 个文件，路径和字节与上游自带的 155 个文件全部一致。这个数字只用于确认源头，不代表与官方 App 的功能相似度。然后才对比本地的入口、主脚本和两个历史备份模块，把差异迁回组件、存储层和手机适配代码。去除了上游的悬浮角色和启动即弹密钥设置行为。

### 从源码构建

```bash
npm --prefix web ci --ignore-scripts --include=optional
npm --prefix web run type
npm --prefix web run build
```

Node.js 22.12+；本次复现使用 Node 24.16.0 和 npm 11.13.0。`web/mobileAssets.ts` 自动为单独加载的脚本和样式生成内容哈希，控制它们在 React 前后的加载顺序；不要手改哈希或压缩文件。自动化浏览器回归默认跑新构建，设置 `CHAT_ASSETS=cb/assets/chat` 可以重复跑旧版。

### 动画与合成层

遮罩类元素（`.drawerMask-*`）不能用 `contain: strict`，尺寸包含会让它塌成 0，侧栏点不开。长列表用 `content-visibility: auto` 配合 `contain-intrinsic-size` 即可。

长对话追问用 `python tests/android-reading.py --adb adb --verify-continuity --verify-edit --verify-followup --artifacts .build/compose-proof/recheck` 复验。备用机上分别从聊天底部和历史中段发送追问，输入法收起后以离线测试流一次追加 35 段正文。修改前列表单帧移动 510 CSS px，修改后经过 22 或 27 个中间位置，首段停在列表顶部下方 16 CSS px。已有的手动阅读位置、返回底部、历史切换和修改提问回归同时通过。

设置子页前进和返回时保留离场页面直到动画完成。真机测得返回后恢复设置列表 73 CSS px 的位置，外观面板随遮罩一起退场。历史搜索在统一的历史列表上展开到全宽。真机已验证系统返回先收键盘，继续返回时恢复普通历史面板和 128 CSS px 的列表位置，也已验证从正文匹配直接打开对应会话。浏览器复验见 `tests/mobile-settings.py` 和 `tests/drawer-gestures.py`。

## 数据存储

对话、附件都存在 WebView 的 IndexedDB 里，路径 `/data/data/com.temeowde.dschat/app_webview/`。卸载 App 会一并删除。

API Key 加密后存在 SharedPreferences。自动朗读只在独立的 `chat_ui` 偏好中存一个布尔值，不随对话导出。在 Android 上不能仅靠 WebView 的 `localStorage` 保存这个开关：真机上点完立即强停会丢最近一次修改。原生桥在自己的线程上提交该布尔值，网页环境才回退到 `localStorage`。

### 首屏和密钥回归

无密钥时，原生入口直接进入聊天页；前端挂载时只初始化本地会话。在发送、上传或开始语音等需要联网的操作上保留密钥检查。修改入口时要同时检查原生 Activity 和前端首次挂载，避免设置页再次抢占首屏。

2026-11-19 在 RMX3560（1080 × 2412，480 dpi）以同一测试签名覆盖安装，未清除数据。下列步骤已在真机通过：

1. 未配置密钥时强制停止并重新启动，看到欢迎页；点开历史侧栏，按系统返回后回到首页。
2. 输入一条草稿，弹出、收起软键盘；点发送时才打开密钥设置。关闭设置，草稿仍在。
3. 从该设置输入临时密钥，通过校验。发送算术测试消息，页面显示回复 `43`。
4. 强制停止并重新启动，从历史侧栏点回这条对话，原问题与回复均可恢复，未重新发送。

这些步骤验证的是行为，不代表视觉已经一致。早期对照中，不弹键盘时同机官方 Android 2.8.0 首页背景为 `#ffffff`，当时的测试版为 `#fafafc`；欢迎图案上缘分别为 1023 和 1058 个物理像素。后续版本已补上右上角的自动朗读和新对话按钮。不要把密钥、填有密钥的截图或用户历史加入测试资料。

### 2026-11-19 功能验收

**主流程动效版 `2.0.0-motion`**：RMX3560、Android 14、WebView 117，使用并排 QA 包和离线虚构会话。键盘弹出时，原包的可视高度从 756 CSS px 一次跳到 454；同机最终包的一次逐帧采样记录到 22 个不同高度，系统返回收键盘为 15 个，首条消息发送后收键盘为 11 个。这些是不同的高度值，不是帧率。首页和会话共用顶栏及输入节点；首发、保留独立草稿、回到上一会话的阅读位置、向上读流式回答及设置两级返回均通过。减少动态效果另用 Chromium 验证了首页、抽屉和设置；未实测 Android 11 以下的旧键盘路径。离线测试没有接入官方会话，也没有使用付费凭据。

真机复验：`python tests/android-reading.py --adb adb --verify-continuity --artifacts .build/motion-proof/recheck`。只面向 `com.temeowde.dschat.sourceqa`，生成普通截图和四列帧记录（经过毫秒、视口高度、输入框上缘、顶栏上缘）。

| 功能 | 已验证 | 范围 |
| --- | --- | --- |
| 附件 | 真机三个入口可唤起对应系统界面；取消不丢草稿。随同一条消息发送 TXT 和 PNG，回复正确读出两份附件各自的验证码。拍照成功路径另测：不同 UID 的测试相机通过临时 URI 写入 960 × 400 JPEG，返回不含 data 的 `RESULT_OK`；图片在草稿中尺寸正确，随消息发送，模型准确读回仅存在图中的随机六码。 | 测试相机无相机权限，不采集现场；不代表验收了实体镜头成像、相机进程被系统回收或所有厂商相机。测试包已卸载，原会话 ID 集合不变。 |
| 语音权限 | 真机短按输入区打开键盘；切换语音模式不申请权限，长按才弹系统权限框。点「不允许」后可切回文字，真实输入 `314` 并删除。 | 麦克风权限保持未授予，没有采集现场声音。 |
| 语音发送 | 真机触屏上滑后音轨结束，转写请求 0 次、消息 0 条；正常松手后转写 1 次，页面只新增一问一答。「八加五等于多少？请只回答数字。」得到 `13`。 | 用合成 WAV 替换调试 WebView 的输入音源，录音编码、线上转写、发送均走应用原实现；不代表已验收物理麦克风的拾音质量。 |
| 自动朗读 | 真机开启后仅新回复 `17` 发起一次 TTS 请求（200），PCM 音源在运行的 AudioContext 中播放并结束。关闭后下一条回复 `20` 未触发 TTS。最终包分别验证了开、关后立即强停再冷启，均能恢复正确状态。 | 测试输出用零增益静音，未做主观听感验收。导航、退后台、关闭开关会撤销正在等待的自动朗读；不会因为打开旧历史而触发。 |
| 语音与朗读联测 | 在重编原生代码的真机包中，用同一段合成算术题复验：上滑取消无请求；正常松手后 ASR 和 TTS 各返回一次 200，页面只有一问一答 `13`。 | 未动用真麦克风；验收后恢复默认静音。 |
| 历史侧栏手势 | 旧包横拖时面板位置没有变化。修订后真机上 304 CSS px 宽的抽屉慢拖约 60 px，手指还未抬起时已露出约 60 px，遮罩同步；短拖回弹、横滑开合、纵滑不误开、系统返回收起均通过。 | 隔离移动浏览器另测多种取消情形、搜索框不抢横滑和拖到一半返回。未测量各机型帧率，不宣称与官方动画曲线完全一致。 |
| 历史备份 | 在电脑隔离环境验证了历史包导入和重载。另用两份虚构会话做导入、重载、导出，在第二个空环境中从导出件重复往返。两条回答分支及选中项、思考片段、PNG 原始字节和 TXT 元数据均相符。 | 没有在备用机上覆盖历史。另用虚构 ZIP 实测 Android 原生保存到「下载/DeepSeek Chat」，校验值一致。没有验证官方客户端反向导入本应用的导出件。 |
| 会话管理 | 真机长按两条专建的虚构会话，改名、置顶冷启动后仍在；多选删除取消时记录保留，确认时只删除所选两条。测试前后原有会话 ID 集合一致。 | 隔离浏览器另验批量取消置顶、单条删除以及备份往返保留置顶标记（含只有索引有标记的备份）。 |
| 手机设置 | 真机取消外观选择未生效；确认外观、修改音色、字号、思考折叠和切换英文后强停重启，均保留；验收后恢复原偏好。 | 隔离测试另验字号改变正文、折叠的思考可手动打开、缺少密钥时不丢草稿。当前只提供中英文与跟随系统；不对接官方账号或官方更新服务。 |

| 消息长按与回答分支 | 对照同机官方 2.8.0 的提问、回答菜单和工具栏。复刻版真机从原回答只选中一段，用系统剪贴板粘贴验证；修改提问后取消未改变原文；喜欢状态冷启动后保留。对测试问题重新生成得到 `17`，冷启动后旧版、新版都可切回。 | 评价仅保存在本机，不上报官方。未实现官方账号的举报处理；不把这个动作伪装为已提交。 |
| 修改旧提问、停止与续写 | 三种前端（未修改的上游源码、本地旧版、新源码构建）均通过同一组离线验收：修改首轮提问后，原来的第二轮仍可切回；再次打开会话仍保留选择。检查请求只含当前分支；停止后重新打开并续写，原回答 ID 不变，正文无重复。 | 用真实界面、SSE 解析与 IndexedDB，不连接模型服务。 |
| 新源码包：Android 分享 | RMX3560 上选择一条虚构提问，通过系统面板交给不同 UID 的接收应用。对方读出的纯文本和 720 × 246 PNG 分别与所选文字和预览图片的 SHA-256 一致。 | 已验证 Android 的文本和图片授权；不代表对官方分享链接、社交平台发布或其他厂商分享面板的验收。 |
| 新源码包：系统键盘与长回答 | 同机键盘打开时视觉视口从 756 缩到 454 CSS px，输入框仍可见，返回后恢复 756，草稿不丢。离线流输出 75 段时上滑阅读，追加 25 段后阅读位置仍为 2557 px；回到底部又能跟随输出，停止按钮中断了该流。 | 真实 WebView、系统键盘和触摸滚动。内容为虚构的本地流，不需用户的导出文件或联网凭据。 |
| 历史合并 | 离线浏览器验证大文件导入与重复导入。合成归档验证分支、草稿、置顶、附件冲突回滚和覆盖恢复。 | RMX3560 的 QA 包通过合成归档的导入、合并、重导及分支切换。 |
| 长对话阅读 | RMX3560 在 678 个虚构会话中冷开一段 538 条消息的对话。一次旧版采样约 1.60 秒定位到最新回复，新版四次采样约 0.17 到 0.24 秒。新版首屏渲染最近 16 条消息。 | 真机验证连续向前翻页、切换会话后保留第一条可见消息及偏移、向后翻页和回到底部。浏览器另验从旧页发送时能够到达新回复并传入最近对话。 |
| 对话历史搜索 | RMX3560 用触屏和真实键盘搜索，在长回复中定位命中段落并收起键盘。同一对话反复定位，命中旧版本时打开对应分支。678 个合成会话共 10,884 条消息的离线查询采样约为 0.33 至 0.54 秒。 | 浏览器回归覆盖桌面定位、标题匹配、查询中的草稿及生成中的分支保护。 |
| 正文引用与搜索结果 | 对照同机官方 2.8.0 的 26 来源回答。在隔离 QA 包中，点第 5 或 17 个角标均只列出 5、17；末尾入口列出 1 至 26。在第 17 条打开网页并按系统返回，列表滚动仍为 1427 CSS px，该行仍在视口 y=361；再按返回，聊天仍为 690 px。 | 桌面悬停预览、窄屏、键盘/触摸开合、短长面板的高度差和焦点恢复另用离线浏览器回归。对照数据与回归数据不同，未宣称截图像素级一致。 |
| 来源阅读与长思考 | 独立、非导出的 SourceReader 不注册聊天 JavaScript 桥，禁用文件/内容访问。测试域名加载失败时，点重试后由 QA 调试端提供可读文档。另用真实 HTTPS 加载 DeepSeek 官网，核实页面标题、正文及网页中无聊天桥；关闭回到聊天，外部打开实测进入 Via。在真机展开长思考后点向下按钮，距底部不足 3 CSS px。 | 生产 APK 不带模拟响应；阅读页遵守应用的网络安全策略，不放宽明文 HTTP 或证书校验。折叠仍由用户偏好控制。 |
| 表格与长代码 | 在 RMX3560 的隔离测试包中从展开页分享 `table_20261119.csv`。独立应用以 `text/csv` 和临时只读权限读取文件，174 字节的哈希与合成表格一致。退出分享后表格仍展开，按系统返回保留聊天位置和按钮焦点。 | 320、360 CSS px 的浏览器回归覆盖表格和长代码横滑、较大字号、表格原位及展开复制、完整代码行复制、Escape 和侧栏手势。CSV 覆盖中文、引号、逗号、空单元格和公式样式文本。 |
| 联网搜索状态 | 离线流覆盖搜索进行中、空结果、明确报错、停止未完成搜索、收到部分结果后停止。停止生成后保留已有来源，已报错的工具调用继续显示失败。 | 通过发送、停止和打开来源列表的正常入口验证。提示文案以本客户端为准。 |

回归测试从仓库根目录运行：

```sh
node --test tests/history-search.test.cjs tests/read-aloud.test.cjs
# 需 Python Playwright 和 Chromium，可用 --browser 指定本机 Chrome。
python tests/history-roundtrip.py
python tests/history-reading.py
python tests/history-search.py
python tests/drawer-gestures.py
python tests/session-management.py
python tests/mobile-settings.py
python tests/message-actions.py
python tests/conversation-flow.py
python tests/search-sources.py
python tests/search-status.py
python tests/markdown-formatting.py
```

`tests/voice-fixture.js` 仅用于复刻版调试 WebView 的空对话：`installVoiceFixture(base64Wav)` 安装合成音轨，`window.__voiceQA.state()` 检查轨道、ASR 次数和消息计数；在 `finally` 调用 `window.__voiceQA.restore()`。只提供测试 WAV，不连接麦克风或扬声器；联网部分要使用自己的测试 Key。这些测试文件不进入 APK。

`tests/camera-fixture/` 是单独构建和安装的测试 APK。拍照测试替换系统相机调用，不读取真实镜头；分享测试使用它作为接收方。详见该目录的 README，含隔离 QA 包及真机测试命令。普通 APK 不包含测试接收方、假响应或测试凭据。

来源与长思考的真机复验只面向并排安装的 QA 包（不操作正式包或官方会话）：

```sh
python tests/android-sources.py --adb adb --serial <device-serial> --artifacts .build/source-proof
# 追加两项可选实网/系统检查：阅读公开 HTTPS 页面、一次性调用默认浏览器。
python tests/android-sources.py --adb adb --serial <device-serial> --live --external
```

## 已知限制

对话界面底部提示文字下方约有 20 CSS px 无法消除的空白。这是 WebView 视口底边与屏幕物理底边的差值（状态栏 + 导航栏高度），CSS 无法越过。要彻底解决需让 Activity 开启 edge-to-edge，但底部手势条会盖住那行文字。

## 后续可做

### 常用功能优先

- 真机已验证：无密钥进入首页、配置密钥发送纯文本并显示回复、新建对话、重启后恢复历史。
- 历史搜索已验证：输入只在消息正文出现的短语能找到原会话并点开；无匹配会显示空状态；重新从首页进入侧栏，完整历史仍在。它读取本地会话，不读取附件二进制或联网。
- 在更多 Android 版本和屏幕尺寸上核对系统分享、返回及长内容手势。
- 动画优先保证不挡操作、开合顺畅、系统返回正确。完整功能可用后再做视觉细调。

历史搜索规则用 `node --test tests/history-search.test.cjs` 验证。正文命中和定位可用 `python tests/history-search.py` 复现。

### 其他改进

- 核对大列表下的侧栏手势性能及其他屏幕尺寸
- 核对更多官方导出格式版本；现已验证 V3 ZIP 在本应用内往返
- 主题色支持自定义

## 官方账号通道

v3.1.0 新增。用于把官方 App 的会话同步到本地，并在额度用完时用 API 续聊。

### 组成

- `src/java/com/temeowde/dschat/OfficialAccount.java`：令牌用 AndroidKeyStore（AES/GCM）加密存 `SharedPreferences("official_account")`；提供 `GET /api/v0/...` 与密码登录，结果通过 `window.__officialBridgeDeliver(id, payload)` 回到网页。路径限制在 `/api/v0/` 前缀内。
- `src/java/com/temeowde/dschat/LoginActivity.java`：加载 `https://chat.deepseek.com/`，每 800ms 轮询 `localStorage.userToken`，用 `/api/v0/users/current` 校验通过后才保存。
- `MainActivity$AndroidBridge.smali`：新增 `officialLogin`、`officialHasToken`、`officialLogout`、`officialRequest`、`officialPasswordLogin`，全部标注 `@JavascriptInterface`。
- `web/src/services/official/bridge.ts`：网页侧封装，用自增 id 与 Promise 匹配响应。
- `web/src/services/official/sync.ts`：会话列表（`fetch_page`）、消息（`history_messages`）、头像昵称（`users/current`）。
- `web/src/services/chat/store.ts`：`setOfficialLoader` 与「先缓存后刷新」的加载顺序。

### 数据结构

接口统一返回 `{ code, data: { biz_code, biz_data } }`。

- 会话：`biz_data.chat_sessions[]`，字段 `id`、`title`、`updated_at`（秒）、`pinned`。
- 消息：`biz_data.chat_messages[]`，正文在 `fragments` 里：`REQUEST` 是用户输入，`RESPONSE` / `TEMPLATE_RESPONSE` 是回答，`THINK` 是思考；消息还有 `message_id`、`parent_id`、`role`、`inserted_at`。

本地映射：会话 id `off_<官方 id>`，消息 id `o_<官方 message_id>`。合并时官方消息保持服务器顺序，本地 API 消息按 `createdAt` 插入。

### 失效处理

`401`、`403` 或响应体含 `INVALID_TOKEN` / `code:40003` 时清空本机令牌。注意：账号在别处反复登录会触发官方风控，表现是所有端同时掉线，这不是本应用的 bug。

### 登录方式

- 密码：`POST /api/v0/users/login`，字段 `mobile|email`、`password`、`device_id`、`os`，不需要验证码。
- 短信/网页：走官方网页登录，可能弹出安全验证（依赖第三方指纹脚本，国内网络下可能空白）。

## 构建环境（v3.1.0 起）

`assemble.sh` 支持 `SMALI_CP` 环境变量：设置时用 `org.jf.smali.Main` 直接汇编 `src/smali` 与 `src/smali_classes2`，不再需要 apktool；未设置时回退到原来的 apktool 流程。

smali 2.5.2 在 Maven 上的 `smali` 包没有 Main-Class，需要一并提供 `dexlib2`、`util`、`antlr-runtime`、`stringtemplate`、`jcommander`、`antlr` 与 `guava`。

Windows 上只有 `.exe` 形式的 build-tools，WSL 里需要 Linux 版 build-tools 与便携 JDK；JDK 可从华为云镜像获取（比 GitHub Releases 稳定）。

