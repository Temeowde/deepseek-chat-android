# DeepSeek Chat 交接文档（v3.1.0）

2026 年 11 月 20 日整理。以标签 `v3.1.0` 为基线。仓库：`https://github.com/Temeowde/deepseek-chat-android`。

## 这是什么

一个非官方 DeepSeek Android 客户端，目标场景是：

- 平时用官方 App 的免费额度；
- 官方额度用完时，在这个 App 里**打开同一条官方会话**，用自己配置的 API Key 接着聊；
- 额度恢复后回到官方 App 继续。

包名 `com.temeowde.dschat`，当前版本 `3.1.0`，`versionCode` 为 `31`。

## 必须知道的限制

1. **API 续聊不会写回官方服务器。** 官方没有「写入对话」的接口。我们在本地会话里用 API 聊的内容只存在手机 IndexedDB 里，回到官方 App 时官方模型看不到这几轮。
2. **唯一补齐方式**是手动把上下文粘贴回官方 App。曾考虑过用官方协议自己发消息（技术上可行），工作量和风控风险都大得多，未做。
3. **官方接口是非公开接口**（`chat.deepseek.com/api/v0/...`），官方改版或风控可能让它失效。登录走官方网页/密码接口，令牌只存在本机。

## 架构

```
MainActivity（smali 外壳，WebView 加载 file:///android_asset/chat/index.html）
 ├─ AndroidBridge（JS 桥，smali）  ← 暴露给网页的 window.DeepSeekAndroid
 │   ├─ getApiKey / setApiKey …        原有：API Key（Keystore 加密）
 │   └─ officialLogin / officialHasToken / officialLogout
 │       officialRequest / officialPasswordLogin     新增：官方账号通道
 ├─ OfficialAccount.java（新增）   令牌加解密、带令牌请求 /api/v0/、异步回传
 ├─ LoginActivity.java（新增）     官方网页登录，轮询 localStorage.userToken
 └─ 其他原有类：附件选择、分享、来源阅读、显示偏好
```

前端（`web/src`）：

```
services/official/bridge.ts   网页侧桥封装，id + Promise 的请求/回传
services/official/sync.ts     会话列表同步、消息拉取与时间合并、头像昵称
services/chat/store.ts        打开官方会话时先出缓存再刷新；setOfficialLoader
services/chat/db.ts           saveSummary：只登记摘要在侧栏显示
```

官方会话在本地用 `off_<官方 id>` 作为 id，消息 id 用 `o_<官方 message_id>`，与本地 API 消息区分。

### 同步流程

1. 回到前台（原生 `onResume` 派发 `app-resume` 事件）或侧栏下拉刷新 → `syncOfficialSummaries()`；
2. 打开官方会话 → `loadOfficialSession()` 调 `/api/v0/chat/history_messages`；
3. 官方消息按服务器顺序，本地 API 消息按 `createdAt` 插入到对应位置；
4. 401/403 或 `INVALID_TOKEN` → 清空本机令牌，界面回到未登录。

## 本轮（v3.1.0）做了什么

**功能**

- 官方账号登录：密码登录（原生，无验证码）与官方网页登录（短信验证码，可能弹安全验证）。
- 官方会话列表与消息同步、下拉刷新、头像昵称同步。
- 在官方会话里用 API 续聊。

**界面对齐官方**（均按官方 2.8.0 截图取色/量尺寸）

- 背景 `#ffffff`、用户气泡 `rgb(237,243,254)`、开关开启态 `#edf3fe` / `#426efe`。
- 输入框：26px 圆角、无描边、柔和阴影；占位文字 `rgb(185,186,187)`；发送键圆形蓝底。
- 顶栏三个图标统一 1.75px 描边，并按墨迹大小分别校准（22 / 18.6 / 20.2px）。
- 欢迎语 19px/700，文案「欢迎回来，想从哪里开始？」；底部「回答由 AI 生成，仅供参考」且首页不显示。
- 去掉顶栏分隔线、回复左侧竖线、抽屉投影；抽屉改用 300ms `cubic-bezier(.4,0,.2,1)`。

**修复**

- 键盘展开时打开侧栏不收起键盘 → `openMobileSider()` 里 blur。
- 「按住说话」报错 → 清单补 `MODIFY_AUDIO_SETTINGS`（日志报 `Requires MODIFY_AUDIO_SETTINGS and RECORD_AUDIO`）。
- 首页欢迎语长按弹出选中菜单 → `user-select: none`（注意 `web/mobile/brand.css` 里有 `!important` 覆盖，改样式时两处都要动）。
- 官方会话只同步第一条 → 原来仅在本地无缓存时才请求服务器，改为每次打开都拉取。

## 构建

先在 WSL/Linux 准备工具链（仓库外，不提交）：

```bash
# 便携 JDK（华为云镜像较快）
curl -L -o jdk.tar.gz https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_linux-x64_bin.tar.gz
tar xzf jdk.tar.gz

# Android build-tools 35
curl -L -o bt.zip https://dl.google.com/android/repository/build-tools_r35_linux.zip

# smali 2.5.2 及其依赖（Maven 阿里云镜像）
# smali.jar + dexlib2/util/antlr-runtime/stringtemplate/jcommander/antlr/guava
```

环境变量（示例）：

```bash
export JAVA_HOME=<jdk 目录>
export PATH="$JAVA_HOME/bin:<unzip 兜底脚本目录>:$PATH"
export BT=<build-tools/android-15 目录>
export ANDROID_JAR=<platforms/android-35/android.jar>
export SMALI_CP=<smali.jar 及依赖的冒号分隔 classpath>
export KEYSTORE=<签名库>
export KS_ALIAS=androiddebugkey
export KS_PASS=android
bash assemble.sh
```

说明：

- `assemble.sh` 已改为优先用 `SMALI_CP` 调 `org.jf.smali.Main` 汇编，不设时回退 apktool。
- 系统没有 `unzip` 时需要一个 python 兜底脚本（`assemble.sh` 的 `unpack_dex` 只在 apktool 分支用到）。
- 正式包签名与 v3.0.0 一致（Android 调试证书，SHA-256 `66:B0:89:...:AC:EB`），可直接覆盖安装、不丢数据。

## 测试机与现状

- 备用机 RMX3560（Android 14，1080×2412），已装官方 App 2.8.0、正式包与 QA 包。
- ADB：`/mnt/d/AndroidToolchain/sdk/platform-tools/adb.exe`。
- 已验证：登录、会话列表同步、打开官方会话、在官方会话里用 API 续聊、头像昵称、下拉刷新、底部入口进入设置。
- **未完成验证**：消息同步的延迟（曾观察到十几秒）、按住说话的实际录音、部分动画手感。

## 已知问题 / 下一步

1. **同步延迟**：原生 `OfficialAccount.request` 里加了耗时日志（tag `DSOFFICIAL`，只含路径/状态码/耗时/长度），稳定复现后看日志判断是网络还是线程调度。
2. **登录频繁**：同一账号在多设备反复登录会触发官方风控，表现为所有端一起掉线，需重新登录。
3. **动画无法逐帧比对**：该机型 `screenrecord` 段错误，可用 scrcpy `--record` 替代，再用 ffmpeg 拆帧量时长与缓动。
4. **文字排版**：字体已按设备默认（OPPO Sans）对齐，与官方一致；小米设备上是小米兰亭，观感差异属于系统差异。
5. 后续可做：返回官方时的「上下文交接」复制、深色主题配色核对、更多机型的键盘与手势回归。

## 注意

- 不要把令牌、含令牌的截图、用户聊天记录提交到仓库。
- `web/mobile/brand.css` 和组件 CSS 存在 `!important` 覆盖关系，改首页样式时两处都要检查。
- `dec2/stable-ids.txt` 固定了资源 ID，新增资源要同步分配。
