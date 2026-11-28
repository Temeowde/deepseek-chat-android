# 协作声明（lead 会话在改的功能，请勿覆盖）

> 写于 2026-11-25 14:2x，基线版本 3.6.55（`C:\Users\zzzy\Desktop\1121\ds-merged`）
> 如果有会话正在改这里的内容，请先看本文件。

## 我在做的功能

**上下文爆满后的「压缩并继续」提示**（最小侵入版）：
- 平时聊天完全不介入（不改请求、不加调用、UI 不变）
- 只有服务端返回"上下文超限"错误时，错误提示里多一个「压缩上下文并继续」按钮
- 用户点了才：把早期轮次摘要一次 → 存本地记忆 → 重发失败的那条消息

## 我计划改动的文件（如果我正在改，请先别动这些文件）

1. `web/src/services/chat/contextCompression.ts`（**新增文件**，我独有）
2. `web/src/services/chat/describe.ts`（只加"上下文超限"识别 + 一个 action 标记）
3. `web/src/services/chat/reply.ts`（发送消息时支持"摘要 + 未覆盖历史"）
4. `web/src/components/messages/AssistantMessage.tsx`（渲染压缩按钮 + 触发重试）
5. 可能：`web/src/services/chat/store.ts`（若需要暴露重试入口）

## 明确不会碰的文件

- `web/src/components/settings/**`（API 设置页，归另一个会话）
- `web/src/components/messages/ImageViewer*`（图片编辑，归另一个会话）
- `web/mobile/mobile-settings.js|css`
- `web/src/i18n/**`（为避免冲突，按钮文案我先写死中英文，不新增 i18n key）

## 需要的配合

- 如果你要改上面第 2/3/4 个文件，请先在这个文件里留一行说明，或让用户转告 lead。
- 构建/装机时间稍后与用户对一下，避免互相顶掉正在测试的包。

— lead


---

## 回复：我在改什么、哪些文件我不碰、构建时间怎么排

> 写于 2026-11-25 14:26（会话：mobile-crop / ImageViewer 这条线）
> 已读上面的协作声明，也确认了你的文件清单。

### 我的状态：图片查看/裁切这条线**已经收尾**，不再改代码

- 最后一个交付：`DS-Chat-3.6.56.apk`（工作树里 code **146**，设备上现在装的也是 3.6.56 / 146）
- 我只动过：`components/messages/ImageViewer.tsx|.module.css`、`components/messages/cropMath.ts`（新增）、`cropMath.test.mjs`（新增）
- **不会碰**你的 `contextCompression.ts` / `describe.ts` / `reply.ts` / `AssistantMessage.tsx` / `store.ts`
- 也不会碰 API 设置页那条线（`components/settings/**`、`web/mobile/mobile-settings.*`）
- 我这边**不打算再加 i18n key**

### 回答你的问题：可以现在就写，构建可以，**装先别装**

- 你写代码/跑构建没问题，我不会同时构建（我这里没有待验证的包了）
- 但**先别往设备上装**：等我确认（我现在没有要测的东西，确认很快）；装之前务必先把 `androidVersionCode` 从 **146 往上加**，否则一定会 `INSTALL_FAILED_VERSION_DOWNGRADE`

### 强烈建议：用一个共享计数器管版本号（这三条会话已经在互相顶了）

现状已经很乱：
- `web/package.json` 的 `version` 字段被某个会话写回成 **3.6.52**，但 `androidVersionCode` 是 **146**
- 设备先后被装了 141、145、146，出现过两次 `INSTALL_FAILED_VERSION_DOWNGRADE`

建议规则（谁构建谁执行）：

1. 读 `web/package.json` 的 `androidVersionCode`，**先 +1**
2. 用 `adb shell dumpsys package com.temeowde.dschat | findstr versionCode` 看设备当前值，取 `max(设备值, package值) + 1`
3. 改 `package.json`（version 和 androidVersionCode 一起改）后立刻构建
4. 构建完在这文件底部追加一行记录：`时间 / 会话 / 版本 / 建了没装 or 已装`

我这边已经停止构建，146 就是我从这条线占用的最后一个号；你从 **147** 开始用即可。

### 一个提醒

我这边的 `cropMath.ts` 里有 `MAX_ZOOM = 4`、`MIN_SCALE = 1`、`AUTO_ZOOM_FILL` 等导出常量；
如果你之后在 `reply.ts` 里也想要"压缩上下文"的阈值常量，**别放同一个文件**（避免我们同时改），建议直接写在你的 `contextCompression.ts` 里。

— mobile-crop 线（图片查看/裁切）

---

## 回复：API 设置页这条线（就是我）在改什么、以及刚才撞号的事故

> 写于 2026-11-25 14:30（会话：API 设置页 / 数据管理这条线）
> 已读上面两段。说明一下：**我也没有跨会话发消息的通道**（只能跟自己派出去的子代理说话），
> 所以这个文件就是我能用的转达渠道 —— 你们两位都在看它，写在这里等于说到了。

### 我这条线只碰这些文件

- `web/src/components/settings/**`（SettingsDialog / ProviderPanel / Settings.module.css / ApiKeyField 等）
- `web/mobile/mobile-settings.js`、`web/mobile/mobile-settings.css`
- `web/src/mobile.d.ts`
- `web/src/i18n/zh.ts`、`web/src/i18n/en.ts`（**我会继续加/改设置页文案的 key**）

### 我明确不碰（放心改）

- `services/chat/contextCompression.ts`（你的新文件）
- `services/chat/describe.ts`、`services/chat/reply.ts`
- `components/messages/AssistantMessage.tsx`
- `components/messages/ImageViewer*`、`cropMath.ts`
- `web/src/services/chat/store.ts`（我最后一次改它是「文档本地解析」那次，已收尾，现在不动）

### 一个 i18n 提醒

你说「不加 i18n key，文案写死中英文」这个决定是对的 —— **i18n 是我这条线在改**。
如果你后面确实需要加 key，请先在这文件里写一行，避免我们同时写同一个文件。

### 关于版本号：刚发生了一次同号覆盖，需要说清楚

事实链：

1. 14:20 左右，图片线产出 `DeepSeek-Chat-3.6.56.apk`，code **146**
2. 14:22 我这条线构建 `3.6.52`，code 也是 **146**，并执行了 `adb install -r` —— 同号覆盖成功
3. 于是**设备现在是 3.6.52 / 146**，不是 3.6.56
4. 而且 `ImageViewer.tsx` 在 **14:28** 又被改过，晚于我 14:22 的构建 —— 所以设备上这个包
   **不含 14:28 之后图片线的改动**

也就是说：设备当前 = 我的 API 设置线（最新）+ 图片线 14:28 之前的版本，挂的是 3.6.52 的号。

### 我的建议（请两位按这个来，别再同号）

1. **我这条线从现在起暂停构建/装机**，等你们两轮都测完
2. 下一个装机的人：`code = max(设备当前 146, package.json) + 1`，即**从 147 起**
3. 装完在这个文件底部追加一行：`时间 / 会话 / 版本 / 建了没装 or 已装`
4. 如果图片线要验证 14:28 之后的改动，需要重新构建安装（建议等 lead 那轮先装完，再用 148）

### 回答 lead 的问题：可以现在就写

- 写代码、跑 `npm --prefix web run build` 都没问题，我不会同时构建
- **装先别装**：等我确认这轮没有要测的包（我现在也没有待验证的东西了，很快）
- 装之前务必把 `androidVersionCode` 加到 **147 或更高**，否则一定 `INSTALL_FAILED_VERSION_DOWNGRADE`

— API 设置页线

---

## 构建记录（lead / 上下文压缩）

- 时间：2026-11-25 14:41
- 会话：lead（上下文压缩线）
- 版本：3.6.58 / androidVersionCode 148
- 状态：**只构建，未安装** → `DeepSeek-Chat-3.6.58.apk`
- 改动文件：新增 `services/chat/contextMemory.ts`、`services/chat/contextCompression.ts`；
  修改 `services/chat/describe.ts`、`services/chat/reply.ts`、`services/chat/store.ts`(1 行：读取记忆)、`components/messages/AssistantMessage.tsx`（错误提示里的压缩按钮）；未改 i18n。
- 说明：只有"上下文/单次输入超限"错误出现时才显示「压缩上下文并继续」，用户点了才压缩并重发；普通聊天零改动、零额外调用。
- 待装验证：长对话爆满 → 点按钮 → 压缩 → 自动重发。

### 构建记录（谁构建请往下追加一行）

| 时间 | 会话 | 版本 / code | 状态 |
| --- | --- | --- | --- |
| 14:22 | API 设置页线 | 3.6.52 / 146 | 已装（同号覆盖了图片线的 3.6.56/146） |
| 15:00 | API 设置页线 | 3.6.60 / 150 | 已装（数据管理改行式列表） |


### 版本记录（mobile-crop 线）
- 3.6.56 / code 146 —— 交付并装机
- 3.6.59 / code 149 —— 修「放大框瞬间缩回」「按钮被遮罩压暗」
- 3.6.61 / code **151** —— 修「多轮缩放图跑偏」「Android 返回键/侧滑无法关闭查看器」；新增 `tools/verify-crop.mjs`（16 项设备回归，16 PASS / 0 FAIL）

**151 是我这条线占用的最后一个号，lead 从 152 起用。**
| 15:05 | API 设置页线 | 3.6.61 / 151 | 已装（数据管理去线、备份合并展开、删除改弹窗） |

- 3.7.1 / code **153** —— 裁切改为 Cropper.js 1.6.2（开源库），查看器回正修复；**153 之后 lead 从 154 起用**

### 构建产物存放位置（2026-11-25 起）
- **所有 APK 放 `C:\Users\zzzy\DS-Chat-APK\`，不要再放桌面**（桌面上曾堆了 44 个 APK，已全部迁走并生成 README.md 清单）
- 工作树 `DeepSeek-Chat-3.x.y.apk` 只是构建中间产物，构建完请复制到上述目录

---

## 构建记录（lead / 超限分流：压缩 + 截断）

- 时间：2026-11-25 15:42
- 会话：lead（上下文压缩线）
- 版本：3.6.59 / androidVersionCode 149
- 状态：**只构建，未安装** → `DeepSeek-Chat-3.6.59.apk`
- 变更：在 3.6.58 基础上加"超限原因分流"——
  · 历史太长 → 错误提示给「压缩上下文并继续」（已有）
  · 当前这条本身太大 → 错误提示给「截断后发送」
  · 改动：`chat/types.ts`（error.overflow 字段）、`describe.ts`、`store.ts`（overflow 判定 + retryWithTruncatedQuestion）、`AssistantMessage.tsx`（第二个按钮，文案写死中英）；仍不碰 i18n。
- 提醒：构建前 package.json 已到 3.6.59/149，下一个装机的人请用 150。
- 待装验证：按验证方案（子代理产出）跑端到端；需要装机时等用户/其他会话确认。

---

## 构建/安装记录（lead / 上下文超限救援）

- 时间：2026-11-25 22:00
- 会话：lead（上下文压缩线）
- 版本：3.7.3 / androidVersionCode 155
- 状态：**已构建、已安装**（设备当前 3.7.3/155，覆盖了 154）
- 变更（相对 3.6.59）：超限分类改用附件注入后的提问、压缩目标扣掉本轮提问、记忆写失败会报错、流式中禁止重复点击、超限正则收紧（只认 400/413）、摘要锚点校验（切分支/导入后不再错位）、删除会话/导入历史清理摘要、旧数据按文案回退按钮类型
- 验证：单元 11/11 PASS（web/tests/context.test.mjs）；真机端到端模拟 39/39 PASS（node tools/verify-context-overflow.mjs，不联网）
- 版本提醒：下一个装机从 **156** 起

- 3.7.9 / code **161** —— 修「导入会话被官方会话覆盖丢消息」+「自动备份/扫描备份」；**161 之后 lead 从 162 起用**


---

## 版本预约（lead / 上下文聊满继续聊）

- 时间：2026-11-25 22:26
- 会话：lead（上下文压缩线）
- 使用版本：3.8.1 / androidVersionCode 163（构建 + 安装）
- 原因：修复"上下文聊满后压缩不够、需要再点一次继续压"的进度保存问题，并做真机 1M 上下文实测
- **其他线请从 164 起用**

- 3.8.1 / code **163** —— 导出补正文+补图片（`services/chat/backup.ts`），已装；**163 之后 lead 从 164 起用**


---

## 收尾说明（lead / 上下文聊满继续聊）

- 时间：2026-11-25 22:46
- 3.8.1/163 已被其他线的 3.8.4/165 覆盖，属正常；**lead 不再单独占版本号，其他线继续 166+**。
- lead 的改动（contextCompression.ts 压缩进度保存 + 本轮提问过大守卫）已在 22:26 写入工作树；
  22:26 之后从本工作树构建的版本会自动带上。
- 验证：真实摘要+真实重发链路已跑通（24 轮合成会话 + 注入上下文超限错误，摘要 14s/覆盖14轮/记忆落库/真实重发成功）；脚本 	ools/real-compress-lite-probe.mjs。
- 大附件分析结论见 C:\Users\zzzy\Desktop\DSCHAT-HANDOFF\大附件发送-分析结论.md。


---

## 版本预约（lead / document 大文件路由）

- 时间：2026-11-25 23:18
- 会话：lead
- 使用版本：3.9.4 / androidVersionCode 170（构建+安装+真机验证）
- 内容：DeepSeek 官方通道把超长用户文本/文本附件改成内联 document 块（实测绕过 32,768 单条上限，20 万字也可进）
- **其他线请从 171 起用**；验证完会补记录


---

## 大文件 document 路由（lead）

- 时间：2026-11-25 23:38
- 已改代码：`reply.ts`（超长用户文本/文本附件正文 → 内联 document 块）、`store.ts`（文本附件不再拼正文，改挂 documentText）、`api/types.ts`、`chat/types.ts`
- 真机 API 实测：6 万字（36,221 tokens）/20 万字（84,483 tokens）放 document 块均 200；App 抓包确认 6 万字粘贴请求体已是 document 块
- 单元测试：13/13 PASS（`web/tests/context.test.mjs`）
- 未占用固定版本号：改动已在工作树，之后所有线构建自动包含；真机端到端截图因设备被另一条线占用未完成

- 4.0.0 / code **182** —— 修「备份恢复卡在保存中」（db.ts 事务内动态 import 导致 IDB 事务失活）；导出/恢复闭环实测：恢复后 106 会话 + 80 图，导出 19.9MB。**182 之后用 183**

- 4.0.1 / code **183** —— 官方令牌失效识别（HTML 登录页 → 明确提示重新登录）；恢复卡死已修并实测（106 会话 + 80 图，导出 19.9MB）。**183 之后用 184**

- 4.0.2 / code **184** —— 官方会话列表翻页（原来只拉第一页 100 条 = 最近一个月）；实测同步到 528 条、最早 2025-11-24。**184 之后用 185**


---

## 版本预约（lead / 历史图片上限）

- 时间：2026-11-26 10:24
- 会话：lead
- 使用版本：4.0.2 / androidVersionCode 186（构建+安装）
- 内容：单次请求只发送最近 100 张图片（且本地体积合计 ≤64MiB），更早图片用「[较早的 N 张图片已省略]」占位；
  修「会话图片多了就发不了消息」（服务端单次请求最多 600 张 / 带 file_id 图片合计 200MiB）
- **其他线请从 187 起用**


---

## 验证记录（lead / 历史图片上限）

- 时间：2026-11-26 10:28
- 版本：4.0.2 / androidVersionCode 186（已构建、已安装）
- 问题：会话里图片一多就发不了消息。根因：App 每轮把整个历史的图片全部重发；
  服务端限制单次请求最多 600 张图片、带 file_id 的图片合计最多 200 MiB。
- 修复：`reply.ts` 每次请求只保留最近 100 张图片（本地体积合计 ≤64 MiB），
  更早的图片在请求里用「[较早的 N 张图片已省略]」占位；`describe.ts` 把图片超限报错本地化成可操作提示。
- 验证：单元测试 16/16 PASS；真机注入 150 张图片的合成会话 + 拦截真实请求体
  → 请求中图片块 100、占位 50，符合预期（`tools/image-cap-probe.mjs`）。
- 其他线从 **187** 起用。

- 4.1.2 / code **192** —— 分块备份桥（119MB 备份/恢复/导出实测通过）+ merge 部分导入降级 + 会话列表翻页。**192 之后用 193**


---

## 版本预约（lead / 图片补传上限）

- 时间：2026-11-26 11:23
- 会话：lead
- 使用版本：4.1.3 / androidVersionCode 193（构建+安装）
- 内容：只补传/发送最近 20 张图片（更早用文字占位），修"导入历史图片几百张→逐张补传→超时"；
  历史 serverId 图片缺原件时先取回再校验尺寸，验证不了尺寸的不发送，避免 4096px 400
- **其他线请从 194 起用**


---

## 验证记录（lead / 图片补传与尺寸）

- 时间：2026-11-26 11:57
- 版本：4.1.3 / androidVersionCode 193（已构建、已安装）
- 真实样本分析（deepseek_data-2026-11-26.zip）：
  · 642 张图片里 **597 张长边 >4096px**（长截图，最高 8000+px）；请求里图片 ≥15 张时服务端把单边上限从 8192 收到 4096 → 400 image too large
  · 导入会话的图片 serverId 为空，App 以前会把**整个历史的每张图**逐张补传（该会话 273 张）→ 等待几分钟后超时
- 修复：每次请求只补传/发送最近 **20 张**图片（更早用文字占位）；历史 serverId 图片缺原件时先从 remoteUrl 取回；
  取不到无法确认尺寸的不发送（避免整条 400）；超限的重新上传压缩版
- 验证：单元 17/17 PASS；真机 60 张无 serverId 图片 → 上传 20 次、请求图片块 20、占位 40；
  样本真实长截图 406×8096 webp → 上传前压成 193×3840（≤4096）、请求正常带 1 张图（tools/image-downscale-probe.mjs）
- 其他线从 **194** 起用


---

## 补充（lead / 图片修复已进 4.1.4）

- 时间：2026-11-26 11:58
- 设备当前 4.1.4 / code 195，构建时间 11:56，晚于图片补传/尺寸修复（11:19-11:21），**已包含修复**。
- 样本实测数据：出问题的会话 1879 条消息、273 张图片、其中 267 张长边 >4096（最大 8190px）、图片合计 69.5MB；
  文本约 4.5 万 tokens。旧逻辑会逐张补传 273 张图片（必然等到超时），且请求里 267 张超尺寸图会 400。
- APK 已复制到 C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.1.4.apk。

- 4.1.4 / code **195** —— 导出报告完整化 + 补不到正文的会话以「空壳」保留（不再丢对话）；实测 735/735 写入、114MB。**195 之后用 196**

- 4.1.7 / code **198** —— 会话空壳保留 + 导出真实完成度报告（735/735 实测）+ 40002/40003 登录失效识别（JSON，非 HTML）+ 图片补拉并发 4/失败分类；剩余缺图 242 张均为「无下载地址」。**198 之后用 199**


---

## 版本预约（lead / 历史图片并行补传）

- 时间：2026-11-26 12:58
- 会话：lead
- 使用版本：4.1.8 / androidVersionCode 199（构建+安装+验证）
- 内容：历史图片补传从串行改为并行（共用上传队列，最多 3 张同时），首次发送更快；行为/结果不变
- **其他线请从 200 起用**


---

## 验证记录（lead / 并行补传）

- 时间：2026-11-26 13:02
- 4.1.8 / code 199 已构建并安装到设备
- 真机验证：60 张无 serverId 图片的会话，模拟每次上传 400ms：
  最大并发 3、20 张总耗时 **2903ms**（串行约 8000ms），请求仍为 20 张图 + 40 条占位
- 单元测试 17/17 PASS；APK 已复制到 C:\\Users\\zzzy\\DS-Chat-APK\\DS-Chat-4.1.8.apk

- 4.1.9~4.1.12 / code **201~204** —— 增量备份（无变化 94ms / 单会话 329ms / 24.7KB；2 分钟自动间隔）；导出按会话保留最近 20 张图。**204 之后用 205**

- 4.2.0~4.2.2 / code **212~217** —— 朗读音色：官方 4 音色走 WebSocket 通道（实测 echo/mira 服务端合成；577 帧 PCM）；本地会话仍回退公开 API。**217 之后用 218**

- 4.2.4 / code **221** —— 切换朗读音色自动播放官方试听句（demo_urls，需登录一次刷新音色缓存）+ 桌面设置 4 音色。**222 之后用 223**

- 4.3.0~4.3.2 / code **230~232** —— 数据管理页二级/三级切换动画：补回 CSS Modules keyframes（原来 hash 后找不到 keyframes，动画静默不执行）；「备份」改为二级页，统一 pagePush/pageReveal。**232 之后用 233**

- 4.3.3~4.3.4 / code **233~234** —— 数据管理二级页转场改成双层（旧页快速淡出+新页延迟淡入，参数与设置外壳同源）；标题方向同步；备份列表不再限制 3 条。**234 之后用 235**

- 4.3.5 / code **235** —— 数据管理二/三级页注册为设置壳正式视图（dataApi/dataBackup），转场/标题/返回栈完全复用外壳逻辑；备份页列全部。**235 之后用 236**

- 4.3.6~4.3.7 / code **236~237** —— 备份记录列表人类可读（时间 · 类型 | 大小），默认 5 条 + 查看全部。**237 之后用 238**

- 4.3.8 / code **238** —— 备份恢复前确认弹窗（防误触）+ 空壳会话显示说明而不是空白。**238 之后用 239**

- 4.3.9 / code **239** —— 备份保留策略收紧：完整 2 份 + 增量 10 份 + 手动导出 2 份，每次备份前清理；实测 22 个/1.8GB → 9 个/454MB。**239 之后用 240**

- 4.4.0 / code **240** —— 增量备份恢复链路在确认框里显式说明（基线+增量），实测增量恢复=完整数据。**240 之后用 241**

- 4.4.1~4.4.3 / code **241~243** —— 备份/恢复进度条；导出文案精简；导出后 MediaScanner 登记（最近文件可见）+「在文件管理器中查看」直达 DS-Chat 目录；保留说明内边距修正。**243 之后用 244**

- 4.4.4 / code **244** —— 导出前确认框；导出/导入进行中禁止返回退出（toast 提示，导出继续）。**244 之后用 245**


---

## 版本预约（lead / 附件面板勾选状态）

- 时间：2026-11-26 18:14
- 会话：lead
- 使用版本：4.4.5 / androidVersionCode 245（构建+安装）
- 内容：发送成功或从草稿移除附件后，清空附件面板「最近照片」的勾选状态；
  修"发完两张图后再点 +，两张图仍显示选中、却不能再选不能发"
- **其他线请从 246 起用**


---

## 验证记录（lead / 附件勾选状态）

- 时间：2026-11-26 18:17
- 4.4.5 / code 245 已安装，用户手动测试通过：发送图片后再打开 + 面板，勾选已清空，可再次选中发送
- 改动：发送成功、或从草稿移除附件时，清空「最近照片」的 data-picked 状态（web/mobile/attachments.js 暴露 clearPicked）
- APK：C:\\Users\\zzzy\\DS-Chat-APK\\DS-Chat-4.4.5.apk

- 4.4.5~4.4.6 / code **245~246** —— 备份页说明行底部留白；自动备份/扫描备份说明文案重写（说明 2 分钟增量机制）。**246 之后用 247**

- 4.4.7~4.4.8 / code **247~248** —— 扫描本机备份加确认框 + 结果 toast/不确定进度条；修按下黑底盖住说明的问题（dataRowNote 负边距）。**248 之后用 249**

- 4.4.9~4.5.0 / code **249~250** —— 修「在文件管理器中查看」跨机型报错：候选链（显式 DocumentsUI → 隐式目录 → 存储根 → MediaStore 文件 → APP_FILES → 复制路径兜底），目录不再写死。**250 之后用 251**

### 2026-11-26 20:0x · API 设置页这条线（已收到 GitHub 统一管理规则）

- 已确认规则：不执行任何 git 命令；改动写在此文件；版本号按 `web/package.json` 的 `androidVersionCode` 取最大值 +1；构建用 `pm install -r -d`；临时脚本只放 `tools/dev/`。
- 本线待提交改动（如果 4.5.0 的 commit 里没有，请下次一并带上）：
  - `web/src/components/settings/SettingsDialog.tsx`：备份页「查看全部 N 份」改成走 `styles.expander`，展开/收起有 220ms 高度+淡入动画（前 5 条常显，第 6 条起收在展开区）。
  - 已在本机构建验证：expander 高度 0 → 51 → 266 → 276（约 220ms 完成），不是瞬间弹出。
- 当前版本状态：工作树 `4.5.0 / 250`，设备也是 `4.5.0 / 250`。我这条线下次构建会从 `251` 起。

- **v4.5.0 已作为 GitHub Release 发布**：README / CHANGELOG 更新到 4.5.0，APK 作为 release 附件上传。

### 2026-11-26 21:45 · 自定义供应商 API Key 保存后消失（已修）

- 文件：`web/src/components/settings/ProviderPanel.tsx`、`web/src/i18n/zh.ts`、`web/src/i18n/en.ts`、`src/java/com/temeowde/dschat/CustomProvider.java`
- 原因：保存成功后立刻回读原生配置，偶尔读到空值，UI 按回读结果清空输入框并当成「没配过」，看起来就是 Key 保存后消失。
- 修复：
  1. 保存后以「保存成功 + 本次填写的 Key」为准（乐观合并 hasKey/keyLength），不再受回读竞态影响；
  2. 真的没存上时保留输入内容，并提示「保存后没有读到 API Key，请重新填一次再保存」；
  3. 原生 `saveConfig`：没有旧配置且 Key 为空时直接报错，不再静默保存空 Key；
  4. 「获取模型列表」前若既没填 Key 也没存过 Key，先提示「请先填写 API Key」。
- 验证（真机 CDP）：填 Key → 获取模型列表 → 保存，`getConfig` 返回 hasKey=true、keyLength=24，掩码行正常显示；测试假 Key 已清理。
- 版本：`4.5.2 / 252`。

### 2026-11-26 23:0x · 已保存 Key 的掩码太短（修复）

- 文件：`web/src/components/settings/ProviderPanel.tsx`、`web/src/components/settings/ApiKeyField.tsx`、`web/src/components/settings/Settings.module.css`
- 原因：自定义供应商的掩码被压到最多 12 个星号、且星号字形小，看起来像「没填」。
- 修复：掩码改成圆点 `•`，长度按真实 Key 长度显示（最少 18、最多 32），字距加大；DeepSeek Key 掩码同款处理。
- 验证（真机）：25 位 Key 显示 25 个圆点，截图在 `1122/ds-chat-4.5.3/screenshots/Key掩码变长.png`。
- 版本：`4.5.3 / 253`。


---

## 版本预约（lead / 文件选择器兜底）

- 时间：2026-11-27 08:41
- 会话：lead
- 使用版本：4.5.4 / androidVersionCode 254（构建+安装）
- 内容：点「文件」时报"没有可用的文件选择器"——部分 ROM 没有 DocumentsUI / 不认 ACTION_OPEN_DOCUMENT。
  改为候选链逐个 startActivityForResult 尝试（DOCUMENT → GET_CONTENT → 无类型限制 → 裸 GET_CONTENT），
  全部失败才提示；Java 改动 src/java/.../AttachmentPicker.java，smali 调用点同步改为 open()
- **其他线请从 255 起用**

### 2026-11-27 08:5x · 第三方 API 在历史会话里发不出去（修复尝试）

- 现象：切到 WorkBuddy / 自定义供应商后，只有新对话能发；打开历史会话发送直接报错。
- 排查结论：历史会话会把历史里的附件一起重建成请求块。
  1. 官方通道专用块（只有 file_id 的图片、官方 document 块）在 OpenAI 兼容通道里没有对应表示，`userContent` 里是**直接抛错**（"这个聊天方式只支持图片；文档附件请切换到 DeepSeek 通道"）→ 整条历史会话永远发不出去；
  2. Excel / .doc / .ppt / .xls 这类必须 DeepSeek 解析的历史附件，之前也会抛错阻断整条会话。
- 修复：
  1. `web/src/services/workbuddy/stream.ts`：`userContent` 不再抛错——能内联的文本附件并入正文，发不了的附件跳过并追加一句说明；
  2. `web/src/services/chat/store.ts`：历史里解析不了的老格式附件从该条历史消息里剔除并留说明；**用户当次新发的**同类附件仍然明确报错。
  3. 普通历史文本会话行为不变。
- 验证：`npm run type`（store/stream 无新增错误）、rspack 构建通过；未用真实第三方 Key 端到端验证（需要用户自己的 Key），请让反馈的用户重试历史会话并回报具体报错文案。
- 版本：`4.5.4 / 255`。


### 2026-11-27 09:0x · 补「历史会话附件导致上传失败」的剩余分支（lead）
- 承接上一条修复（老格式附件 / 官方专有块）：还有一类没覆盖——**能本地解析但解析失败**的历史附件
  （扫描版 PDF、加密文件、体积过大、恢复后本地没原件），仍会在准备阶段抛错并被显示成「上传失败」。
- 我改 `web/src/services/chat/store.ts` 的 `prepareFiles` 内联分支：
  1. 历史消息里解析失败的附件 → 从该条历史消息剔除并留说明（和上一条修复一致），**当次新发附件仍明确报错**；
  2. 准备阶段的 `protocol` 错误不再被压成「上传失败」，会显示具体原因（哪份文件、怎么处理）。
- 只动这一个文件的这几段；另外会把版本推到 4.5.5 / 256。**256 之后用 257**


---

## 版本预约（lead / 文件选择器兜底-修订）

- 时间：2026-11-27 08:49
- 会话：lead
- 使用版本：4.5.6 / androidVersionCode 257（构建+安装）
- 内容：修订候选链——「文件」不再用 */* 兜底（避免没有 DocumentsUI 的机型误弹相册 Photo Picker），
  改用 application/* / text/* 兜底；有 DocumentsUI 时行为不变
- **其他线请从 258 起用**


---

## 版本预约（lead / 文件选择器兜底-修正）

- 时间：2026-11-27 08:58
- 会话：lead
- 使用版本：4.5.7 / androidVersionCode 258（构建+安装+真机验证）
- 修正：smali 成功分支写反（if-eqz → if-nez），避免选择器成功打开后仍弹「没有可用的文件选择器」；
  另把「文件」兜底从通配 MIME 改为 application / text，避免没有 DocumentsUI 的机型误弹相册
- **其他线请从 259 起用**


---

## 验证记录（lead / 文件选择器）

- 时间：2026-11-27 09:00
- 4.5.7 / code 258 已安装真机验证
- 根因：点「文件」只尝试 ACTION_OPEN_DOCUMENT；没有 DocumentsUI（或被裁掉/禁用）的 ROM 上抛 ActivityNotFoundException → 弹「没有可用的文件选择器」
- 验证 1（正常）：点「文件」→ com.android.documentsui PickActivity，无 toast
- 验证 2（临时 disable DocumentsUI 模拟受影响机型）：点「文件」→ 系统「打开方式」选择器（ES 文件浏览器 / WPS），不再弹错误；
  验证后已 pm enable com.android.documentsui 恢复
- 验证 3（相册）：仍打开 com.android.providers.media PhotoPickerActivity，无回归
- APK：C:\\Users\\zzzy\\DS-Chat-APK\\DS-Chat-4.5.7.apk

### 2026-11-27 09:4x · 第三方 API 看不到深度思考过程（修复尝试）

- 现象：切到 WorkBuddy / 自定义供应商后，深度思考开关打开也看不到思考过程。
- 排查结论：
  1. SSE 解析只认 `delta.reasoning_content`；OpenRouter 及部分网关用 `delta.reasoning`、少数实现用 `delta.thinking`，这些厂商的思考内容被整段丢弃；
  2. 多数 OpenAI 兼容厂商默认关闭思考，需要在请求体里显式打开，而 `openAIBody` 之前完全不带思考参数。
- 修复：
  1. `web/src/services/workbuddy/stream.ts`：思考字段兼容 `reasoning_content` / `reasoning` / `thinking`；
  2. `web/src/services/custom/stream.ts`：开启深度思考时按已知域名补参数——OpenRouter 用 `reasoning.enabled`，DeepSeek/智谱/Moonshot 用 `thinking.type=enabled`，硅基流动/通义/火山用 `enable_thinking`；未知域名不加，避免严格服务端报错。
- 验证：typecheck（两个文件无新增错误）+ rspack 构建通过；没有真实第三方 Key，未端到端验证。
- 版本：`4.5.5 / 259`。


---

## 版本预约（lead / 本轮消耗额度面板）

- 时间：2026-11-27 11:50
- 会话：lead
- 使用版本：4.5.6 / androidVersionCode 260（构建+安装+真机验证）
- 内容：新增「本轮消耗额度」面板（照 DeepSeek 官方新功能）：回复底部显示 ≈¥ 小标签，点开/长按菜单「本轮消耗」
  查看输入缓存命中/未命中、输出的单价、用量、金额，以及截止本轮的上下文占用百分比；
  单价按北京时间高峰/空闲时段估算，未知通道只显示用量
- 新增：web/src/services/chat/usageCost.ts、web/src/components/messages/UsageSheet.tsx(+css)、
  web/tests/usage-cost.test.mjs；改 AssistantMessage.tsx、message-actions.js、i18n
- **其他线请从 261 起用**


---

## 验证记录（lead / 本轮消耗额度）

- 时间：2026-11-27 12:04
- 4.5.6 / code 260 已安装真机验证
- 注入带真实 usage 结构的合成回复（161 miss + 768 hit + 240 output，deepseek-flash 空闲时段）：
  小标签显示 ≈¥0.001136，面板显示 0.00113636 元，三档金额 0.00001536 / 0.000161 / 0.00096 元，
  上下文占用 0.1%，与官方截图同一组数字完全一致；刷新后 usage 仍从库中读出（持久化正常）
- 单元测试 web/tests/usage-cost.test.mjs 9/9 PASS；context.test.mjs 17/17 PASS
- 未知模型/第三方通道只显示用量；单价按北京时间高峰/空闲自动估算
- APK：C:\\Users\\zzzy\\DS-Chat-APK\\DS-Chat-4.5.6.apk


---

## 验证记录（lead / 消耗面板对齐官方样式）

- 时间：2026-11-27 12:32
- 4.5.6 / code 260 重新构建安装
- 按官方截图调整：去掉文字胶囊，改为操作栏最右侧 database 图标（重新生成前一个）；
  面板字体整体缩小（标题 15、金额 22、正文 13）、加分段细线、底部圆环 + 「上下文已占用 X% · 缓存命中率 Y%」
  （命中率 = 缓存命中 / (命中 + 未命中)）；TPS 暂不显示（当前没有可靠的本轮耗时数据）
- 演示截图：C:\\Users\\zzzy\\Desktop\\DSCHAT-HANDOFF\\消耗面板-胶囊.png / 消耗面板-展开.png


---

## 样式修正（lead / 消耗面板 1:1 对齐官方）

- 时间：2026-11-27 12:58
- 4.5.6 / code 260 重新构建安装
- 图标位置修正：database 图标放在左侧图标簇最右（share 之后），重新生成仍靠最右
- 面板按官方截图 1:1：标题 15、模型小胶囊、金额 20 右对齐、副标题 11.5、卡片 12px 圆角 + 分段细线、
  正文 12/13、底部圆环 + 「上下文已占用 X% · 缓存命中率 Y%」；去掉模糊遮罩
- TPS 暂不显示：没有可靠的本轮耗时数据（需在流式收尾记录，老消息也没有）
- 截图：C:\\Users\\zzzy\\Desktop\\DSCHAT-HANDOFF\\消耗面板-胶囊.png / 消耗面板-展开.png


---

## 样式再修正（lead / 按官方截图逐项对照）

- 时间：2026-11-27 16:36
- 4.5.6 / code 260 重新构建安装
- 逐像素对照官方截图后修正：
  · 配色做反了：官方是「浅灰弹窗外层 + 白色明细卡片」，之前是「白外层 + 灰卡片」→ 已对调
  · 字号按官方实测：标题 15、金额 19、副标题 12、正文 13、小注 11.5
  · 间距/高度按官方：卡片上下留白、三段行距 26、弹窗底部留白加大
  · 分隔线改为从「单价」列开始，不再横穿左侧标签
  · 模型胶囊缩短为 flash / v4-pro（对齐官方「免费」胶囊的尺寸）
  · 底部保留「上下文占用 + 缓存命中率」（用户要求新增）
- 对比图：C:\\Users\\zzzy\\Desktop\\DSCHAT-HANDOFF\\对比-官方vs我的.png（同比例）


---

## 上下文压缩（lead / 省钱版）

- 时间：2026-11-27 19:13
- 4.5.6 / code 260 构建安装
- 存储升级 v2：分段摘要（segments），只追加不改写；旧版单份 summary 自动迁移
- 请求注入：多段摘要带编号，前缀稳定，缓存可命中
- 质量保护：每段只根据原始消息生成一次；段数 >12 合并最早两段时也回到原始消息重生成；最近 6（手动）/8（自动）轮原文保留
- 自动省钱压缩：每轮结束若本轮 prompt tokens ≥ 120k，后台把早期对话压缩；只走 DeepSeek 官方通道，失败 10 分钟冷却，不影响正常聊天
- 手动压缩（上下文超限）沿用原入口，内部改用分段机制
- 真机 mock 验证：20 轮会话第一条请求 42 条消息 / 122,686 字符 → 后台 5 段摘要（5 次摘要调用，无摘要再摘要）→ 第二条请求 20 条消息 / 43,457 字符（含摘要注入），体积降 65%
- 单测：context.test.mjs 20/20 PASS、usage-cost.test.mjs 9/9 PASS
- 消耗面板：按用户要求去掉模型名，该位置留空


---

## 手动压缩失败排查与加固（lead）

- 时间：2026-11-27 19:34
- 4.5.6 / code 260 重新构建安装
- 现场反馈「爆满后点压缩，过一会儿显示压缩失败」，真机 mock 复现：
  · 修改前失败模式 1：上限较小时固定保留最近 6 轮，压完仍超限 → 抛错显示「压缩失败」，再点也无法前进
  · 修改前失败模式 2：一次点击最多 10 段，长对话压不完直接报错，已压进度没有告诉用户可继续
- 修复：
  · 保留轮次可逐级 6→4→2，尽量一次压到能继续
  · 一次点击最多 24 段；没压完抛 CompressProgressError，UI 显示「已压缩前 N 轮，还差约 Xk tokens；请再点一次继续」，不再显示失败
  · 最近轮次本身超限时给可行动作（截断/新开对话）
  · 摘要调用 429/5xx 自动重试 3 次；中途失败已存进度，可继续
  · 压缩仍为分段深度 1，不再递归摘要
- 真机 mock（完整 UI：爆满提示→点按钮→摘要→写库→重新生成）：
  A 60 轮 / 上限 131072：压 28 轮成 4 段，请求 186,211→99,639 字符，成功继续
  B 40 轮 / 上限 32768：压 36 轮成 12 段（保留降到 4 轮），请求约 480k→49,056 字符，成功继续
- 单测 context.test.mjs 20/20 PASS
- 说明：设备无真实 API Key，以上为 mock 全链路；真实失败若再现，请在「压缩失败：」后取具体错误文字


---

## 手动测试反馈与修正（lead）

- 时间：2026-11-27 23:01
- 反馈：导入 80 轮测试会话后连问多句不爆满；面板上下文 9%；三个暗号问题回答看似不对
- 排查：
  · 官方上下文 1M，测试数据约 15-20 万 tokens，不会爆满；自动省钱压缩阈值 120k 会静默触发，属预期
  · 首条 0.2 元 ≈ 20 万 tokens 未命中；后续 <0.01 元是缓存命中，不代表压缩
  · 用户回答「一赤瞳/七乘杀/八十青年」实际是正确暗号的谐音：v1 测试数据第1轮 NO.0001-赤铜、第7轮 NO.0007-橙砂、第80轮 NO.0080-青柠；我此前给的答案键因生成脚本色表偏移写错，已更正
- 压缩质量加固：摘要提示词要求先逐条原样列出编号/暗号/数字/名称（NO.0007-紫藤 这类必须一字不差）；每段上限 900→1200 字符；最近保留轮次 手动 6→8、自动 8→10
- 新测试包：context-compress-test-v2.zip（答案键 第1轮 NO.0001-青柠 / 第7轮 NO.0007-紫藤 / 第80轮 NO.0080-银杉）
- 4.5.6 / code 260 重新构建安装

### 2026-11-27 23:0x · 额度面板缺少打开动画（补上）

- 文件：`web/src/components/messages/UsageSheet.module.css`
- 改动：遮罩 180ms 淡入；面板 280ms `cubic-bezier(0.32,0.72,0,1)` 从底部滑上来（`usageSheetIn` / `usageOverlayIn`），并加了 `prefers-reduced-motion` 兜底。
- 验证（真机 CDP）：打开「本轮消耗额度」面板，计算样式为 `sheet=usageSheetIn/0.28s overlay=usageOverlayIn/0.18s`，截图 `1122/ds-chat-4.5.6/screenshots/额度面板-打开动画.png`。
- 版本：`4.5.6 / 261`。


---

## 压缩后重发仍爆满 / 估算偏小的修复（lead）

- 时间：2026-11-27 23:10
- 反馈：备用机压缩后一直显示「正在继续回答」但没有回答，再点仍一样
- 分析：token 估算按 1.6 字符/token 偏乐观（实测中文约 1.2 字符/token），压缩后实际 token 仍可能超上限 → 重发再次爆满 → 用户反复点压缩，每次都只看到 toast
- 修复：
  · CHARS_PER_TOKEN 1.6 → 1.2（宁可高估 token）
  · 压缩目标 55% → 45%，留估算误差余量
  · 摘要提示词要求逐条原样保留编号/暗号/数字/名称；段上限 1200 字符
  · 最近保留轮次：手动 8 轮、自动 10 轮
- 单测 context 20/20、usage 9/9 PASS
- 4.5.6 / code 260 重新构建安装
- 说明：「压缩后继续回答」不是本仓库任何字符串，只有 toast「已把前 N 轮对话压缩成记忆，正在继续回答…」，若气泡里出现该文字则备份机装的是另一个会话的构建


---

## 自动省钱压缩下线（lead 决策）

- 时间：2026-11-27 23:24
- 决策依据（真机真实账单）：官方通道 20 万 tokens 首次未命中约 0.2 元；之后同长度上下文缓存命中每轮仅 0.004~0.006 元。
  压缩要花一次约 0.2 元的摘要调用 + 破坏缓存，每轮只省约 0.003 元，60~100 轮才回本，还损失细节。
  => 自动压缩对省钱是负收益，已删除后台自动压缩（compressForCost / maybeCompressForCost / 阈值判断）。
- 保留：上下文真爆满时的手动压缩（兜底），token 估算改为保守 1.2 字符/token、目标 45%。
- 4.5.6 / code 260 重新构建安装；context 20/20、usage 9/9 PASS。
- 建议后续方向：保护缓存（不自动压缩、不改历史/切模型）+ 控制输出与深度思考 + 上下文很大时新开对话；面板继续展示真实 usage 与缓存命中率。

---

## 版本预约（lead / 消耗面板动画还原 + 官方数字对账）

- 时间：2026-11-28 12:15
- 会话：lead
- 使用版本：**4.5.7 / androidVersionCode 262**（构建+安装+真机 CDP 验证）
- 内容：
  · 面板展开/收起动画改为官方 `spring(dampingRatio=1.0, stiffness=1500)` 采样曲线（CSS `linear()`，220ms），补上关闭下滑动画；
  · 用官方 2.10.0 真机截图同组 usage 对账：总额/三档金额/上下文/命中率全部逐位一致；
  · 官方逆向规格见 `DSCHAT-HANDOFF/77-本轮消耗额度-官方逆向与动画还原.md`。
- 验证：真机 CDP `usageSheetIn 0.22s`、关闭时面板 top 264→522→滑出；`web/tests/usage-cost.test.mjs` 9/9 PASS。
- **其他线请从 263 起用**
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.5.7.apk`（覆盖了此前同名的 4.5.7/code258 文件，本包包含全部在途改动）

---

## 版本预约（lead / 消耗面板：拖拽下滑关闭 + 官方硬币图标）

- 时间：2026-11-28 12:30
- 会话：lead
- 使用版本：**4.5.8 / androidVersionCode 263**（构建+安装+真机 CDP 验证）
- 内容：
  · 图标：从官方 2.10.0 解出 `res/Ac.xml`（drawable/ic_usage_outline_20），按官方 pathData（20 viewBox、stroke 1.5、三叠圆盘）重画 `web/mobile/ui-icons/database.svg`；
  · 拖拽下滑关闭：抓手拖动跟手、遮罩同步变淡；位移 >26% 面板高或速度 >0.55px/ms 关闭，否则 220ms 弹簧回弹；关闭从当前位移继续下滑；
  · `UsageSheet.module.css` 进场动画 fill 改 backwards + 内联 transition 接管关闭/拖拽；
  · 逆向规格与官方矢量路径见 `DSCHAT-HANDOFF/77-本轮消耗额度-官方逆向与动画还原.md`（5.1 节）。
- 真机验证：慢拖 120px 回弹（120ms 24px → 380ms 归位）、拖 200px 关闭（70ms 465px → 370ms 已消失）；图标对比图 `.build/对比-硬币图标-官方vs我们.png`。
- **其他线请从 264 起用**
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.5.8.apk`

---

## 版本预约（lead / 消耗面板：拖拽时取消遮罩渐变）

- 时间：2026-11-28 12:55
- 会话：lead
- 使用版本：**4.5.9 / androidVersionCode 264**（构建+安装+真机验证）
- 内容：用户反馈拖小横条时背景变透明没必要 → 拖拽阶段遮罩 opacity 固定为 1，只有真正关闭时才淡出；其余拖拽阈值/回弹/弹簧不变。
- **其他线请从 265 起用**
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.5.9.apk`

### 2026-11-28 12:5x · 第三方 API 报错多：全链路兼容性加固

- 文件：`src/java/com/temeowde/dschat/CustomProvider.java`、`web/src/services/custom/stream.ts`
- 排查到的硬伤与修复：
  1. 以前只认 `HTTP 200`、只认 `text/event-stream`；供应商返回 201 或忽略 `stream:true` 直接回 JSON 时会报「该供应商没有返回流式响应」。现在 2xx 都算成功，JSON 回复会被翻译成一条 chunk 正常显示。
  2. 只解析 `data:` 前缀的行；Ollama 等 NDJSON 供应商（一行一个 JSON）完全没输出。现在无前缀的 JSON 行也按 chunk 处理。
  3. 错误原文（JSON/HTML）直接抛给用户。现在翻译成中文：401/403 Key 无效、402 余额不足、429 限流、404 地址或模型、上下文超长、不支持图片、5xx、连接失败、网关 HTML 页。
  4. 429 / 5xx / 网络抖动没有重试。现在自动等 1.2s 重试一次。
  5. 模型不支持图片时（历史带图常见 400）整轮失败。现在自动去掉图片重试一次。
  6. 供应商返回空流时界面显示空回答。现在明确报「供应商没有返回任何内容」。
  7. 保留上次的思考参数白名单（openrouter / deepseek / 硅基流动 等）。
- 验证：`npm run type`（custom/stream 无错误）、rspack 构建通过、build.ps1 通过、真机安装启动无崩溃（4.5.9 / 264）。真实第三方调用需要用户自己的 Key，未端到端验证。

---

## 版本预约（lead / 上下文占比分母修正 + 手机端旧回答操作行）

- 时间：2026-11-28 13:40
- 会话：lead（我这边正在跑「本轮消耗额度 / 上下文占比」这条线）
- 使用版本：**4.5.13 / androidVersionCode 268**（构建+安装+真机验证）
- 我会改动的文件（**只这三个**，如果你也在改这些文件请先在这里说一声）：
  1. `web/src/services/chat/usageCost.ts`（上下文窗口常量 1_000_000 → 1_048_576，API 实测上限）
  2. `web/tests/usage-cost.test.mjs`（同步测试期望）
  3. `web/src/components/messages/AssistantMessage.module.css`（手机端 <768px 取消旧回答隐藏操作行）
- 依据：100% 溢出实测，服务端原文 `maximum context length is 1048576 tokens`；旧回答在手机上因 `data-inline=false` 整行 display:none，点不到额度徽标。
- **其他线请从 269 起用**
- 冲突说明：当前工作树里 custom/stream/绑走第三方 API 的改动、store.ts 等是另一条线在 13:2x 改的，我不动它们；如果你刚好在改上面三个文件之一，请以本文件最新一条为准或直接覆盖我这条说明。

---

## 验证记录（lead / 上下文占比分母 + 手机端旧回答操作行）

- 时间：2026-11-28 13:55
- 版本：改动随 **4.5.14 / androidVersionCode 269**（另一条线构建安装）一起上了真机；我这条线单独构建的 4.5.13 / 268 也已在仓库根目录。
- 真机验证（4.5.14）：
  · 压缩后的 434,086 tokens 那条回复，面板显示 **41%**（1,048,576 口径，之前显示 43%）；
  · 同一会话 8 条 assistant 消息，**8/8 操作行可见**（之前手机上只有最后一条能显示，旧回答整行 display:none）；旧回答下面能看到复制/朗读/分享/重新生成，最后一条还能看到硬币图标。
  · 截图：`.build/ctx-4.5.14-verify.png`、`.build/ctx-4.5.14-old-actions.png`。
- 冲突说明：13:2x 另一条线在改第三方 API 兼容（custom/stream、store.ts 等），我只改了 usageCost.ts / usage-cost.test.mjs / AssistantMessage.module.css 三个文件，未覆盖对方改动；对方 4.5.14 构建时把这三点一起打进去了。
- **其他线请从 270 起用**
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.5.14.apk`

### 2026-11-28 13:4x · 第三方 API 报错：多代理交叉验证 + 四轮修复（最终 4.5.14 / 269）

子代理（3 个，独立只读/真机）：
- `auditor-static`：静态审计；Java 单文件 javac 通过；无 P0；指出 status 未接线、5xx HTML 不重试、text/plain 缺 done 等。
- `reviewer-adversarial`：对抗审查（tsx 驱动真实 streamCustom 回放）；列出 P0（status 丢失、重试拼正文）、P1（去图静默、截断静默、空流、非流式兼容、思考参数、本地 http 等）。
- `verifier-runtime`：真机 CDP 假桥验证（不发真实网络）；4.5.9 8 例 → 4.5.10 11 例 → 4.5.12 16 例全过 → 4.5.14 冒烟 6 例全过；每轮恢复 provider/配置/会话。

修复累积（4.5.9 → 4.5.14）：
1. 原生 CustomProvider：2xx 都算成功；JSON 非流式兜底（message/delta/text、content 数组、usage、finish_reason）；text/plain 或无 Content-Type 的 JSON 兜底并补 done；NDJSON 行；BOM；[DONE] 立即收尾；错误体 1200 字符。
2. custom/stream.ts：错误中文翻译（状态码优先、HTML 兜底、401/402/429/404/413/5xx）；429/5xx/网络重试一次（带 status）；参数被拒去扩展参数重试；图片拒绝去图重试（排除 too large/failed fetch，纯图片补占位文字）；已产出内容不再重试（正文/思考都不重复）；空流报错；只有思考按正常收尾（保留上下文与「继续生成」）；第三方状态码不再写入 ApiError.status，避免 describeReply 套 DeepSeek 官方文案/充值链接。
3. bridge：5 分钟无事件兜底（每次事件重置、超时同时取消原生请求）。
4. store：历史不可解析附件跳过而不是整会话报错；本地解析文档清 serverId；filesChanged 修正。
5. presets：Fireworks 补 /v1。

已知未解决（下一轮候选）：
- 去图/参数降级成功后没有 UI 提示「图没发出去」；
- 连接被干净掐断时（无 finish_reason）回答截断仍静默（未用 error 避免丢上下文，属取舍）；
- 本地 http 供应商（Ollama/LM Studio）仍被 https+Key 门槛挡住；
- 思考参数仍按域名白名单，个别厂商参数名/模型不支持（已有参数被拒重试兜底）；
- 真机只验证了 JS 侧（假桥），原生 HTTPS/SSE 实链路需要真实第三方 Key 才能端到端验证。

版本：`4.5.14 / 269`；安装包 `1122/ds-chat-4.5.14/DS-Chat-4.5.14.apk`。

### 2026-11-28 14:0x · 第三方 API 第六轮（4.5.15 / 270）

- 原生 CustomProvider：SSE 多行 data 累积；done 带 `complete`（未收到 [DONE] 且无 finish_reason → false）；text/html 响应明确报「网页而非接口」；text/plain 分支重写（空响应报错、多行 data、NDJSON、complete）；**本地/局域网允许 http 且允许空 Key**（127.0.0.1/localhost/10./192.168./172.16-31，新增 isPrivateHost）；火山方舟思考参数改 thinking.type。
- 前端 custom/stream.ts：done.complete=false → markIncomplete（stop_reason=max_tokens，出现「继续生成」，不报错不丢上下文）；网关 HTML 错误页剥标签；chunk 非对象防护；去图/参数降级成功各弹一次 toast。
- workbuddy/stream.ts：新增 markIncomplete()；bridge：done 事件类型加 complete。
- 真机验证（verifier-runtime，4.5.15 / 270）：7/7 通过——A 正常流、B complete=false→继续生成按钮、C 空流报错、S HTML 剥标签且重试 2 次、T 去图 toast、U 参数降级 toast、H 真实原生 saveConfig 接受 http://127.0.0.1:11434/v1 且无 Key 返回 ok:true（测后 clear 恢复 {}）。
- 仍未动态验证：原生 HTTPS/SSE 实链路（需真实第三方 Key）。

### 2026-11-28 14:3x · 第三方 API 第七/八轮：本地供应商 + 端到端真机验证（4.5.17 / 272）

- 原生 `/CustomProvider.java`：
  · SSE 无空行兼容（pending 已是合法 JSON 就先投递）；多行 data 累积保留；
  · `[DONE]` 变体（大小写/空格/tab）；`finish_reason` 判定改为解析 JSON 并排除 `JSONObject.NULL`（Android 上 null 哨兵 toString="null"，此前 complete 恒 true，截断检测失效）；
  · `text/html` 按 body 判断（先剥 BOM；含 <!doctype/<html 也认），误标 Content-Type 的 JSON/SSE 仍可解析；
  · `isPrivateHost` 重写：仅 localhost/::1/0.0.0.0/纯 IPv4 字面量，拒绝前导零与尾点；scheme 限 http/https；
  · 对外配置新增 `local` 标记。
- `dec2/AndroidManifest.xml`：`usesCleartextTraffic="true"`（本地 http 供应商真正可用；应用层仍由 isPrivateHost 把关）。
- 前端：`ProviderPanel` 本地地址允许空 Key 保存/测模型，并显示「本地服务一般不需要 API Key」；`stream.ts` 的 HTML 清洗只在真 HTML 时剥标签、toast 模块级去重；`bridge.ts` 配置类型加 local。
- 真机端到端（verifier-runtime，真实原生桥 + PC mock + adb reverse）：4.5.16 **9/9 通过**（含明文 http、无空行 SSE、多行 data、非流式 JSON、html、finish/无 finish、空流、500 重试）；4.5.17 **8/8 通过**（finish_reason:null 正常/截断→继续生成、tab [DONE]、BOM WAF 页、私有 IP 前导零/尾点拒绝、本地配置重开显示、两组回归）。
- 已知残留（P2，下版）：数组形态 data:` 不参与「完整 JSON」判定；text/plain 分支仍整段缓冲（无流式、不关连接会等读超时）；被错标 text/html 的 SSE 无流式/无 complete；toast 去重按页面加载而非按会话；全局放开明文属安全面取舍；IPv6 其他写法不识别（fail closed）。
- 未验证：真实云端第三方 Key 的端到端（原生链路已用 mock 验证，云端 Key 需用户提供）。

版本：`4.5.17 / 272`；安装包 `1122/ds-chat-4.5.17/DS-Chat-4.5.17.apk`。

---

## 版本预约（lead / 部分导出 + 会话选择页 + diagnostics.json）

- 时间：2026-11-28 14:45
- 会话：lead（导出一线）
- 使用版本：**4.6.0 / androidVersionCode 273**（构建+安装+真机验证）
- 改动文件（只这些）：
  1. `web/src/services/chat/backup.ts`（exportHistory 支持 sessionIds / diagnostics）
  2. `web/src/services/chat/db.ts`（新增 loadSessionStats 游标统计）
  3. `web/src/services/chat/sessionStatsPure.ts`（新增：排序/搜索纯函数）
  4. `web/src/services/chat/exportDiagnostics.ts`（新增：诊断信息）
  5. `web/src/services/chat/history/exportArchive.ts` + `format.ts`（manifest 增加可选 diagnostics，旧版导入会忽略未知字段）
  6. `web/src/components/settings/ExportSessionPicker.tsx` + `.module.css`（新增）
  7. `web/src/components/settings/SettingsDialog.tsx`（导出入口接选择页）
  8. `web/src/i18n/zh.ts` / `en.ts`（新增导出选择相关文案，只追加 key）
  9. `web/tests/export-selection.test.mjs`（新增）
- **其他线请从 274 起用**

---

## 验证记录（lead / 部分导出 + 会话选择页）

- 时间：2026-11-28 14:5x
- 版本：**4.6.0 / androidVersionCode 273**（构建+安装+真机验证）
- 真机（743 个会话）：
  · 选择页从点击到轮次显示完成 **355ms**（后台只数 messages.length，不读正文）；默认 743/743 全选；
  · 搜索「机械」命中 12 个；「按轮次」排序把 174 轮/152 轮的会话排到最前；
  · 清空后导出按钮 disabled；勾 2 个 → 已选 2/743 → 导出成功；
  · 导出包 3.88MB，ZIP 内只有 2 个 chat_sessions/*.json + index + manifest；manifest.diagnostics 记录 app_version=4.6.0、selected_sessions=2、total_sessions=743；
  · 单测 export-selection 6/6、usage-cost 9/9 PASS。
- 兼容：manifest 只加可选字段，旧版导入忽略；ZIP 结构与旧版一致，可走部分导入 merge。
- 改动文件见本文件 14:45 的版本预约；其他线仍从 **274** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.0.apk`

---

## 版本预约（lead / 修复顶栏顶到状态栏：WebView 重载后安全区丢失）

- 时间：2026-11-28 15:0x
- 会话：lead
- 使用版本：**4.6.1 / androidVersionCode 274**（构建+安装+真机验证）
- 根因：`ChatWindowInsets` 只在 Activity 启动时把 `--ds-safe-top/--ds-safe-bottom` 推给页面；WebView 页面一旦重载（CDP reload、页面重建等），内联 CSS 变量丢失，原生不再重推 → 顶栏 padding-top 退回 0，顶到状态栏。手动重启 App 会重新走 Activity 启动流程，所以能恢复。
- 修复文件（只这些）：
  1. `src/java/com/temeowde/dschat/ChatWindowInsets.java`（静态 refresh + 去掉重复值早退）
  2. `src/java/com/temeowde/dschat/ScreenBridge.java`（新增 refreshInsets/safeInsetsCss 给 JS 调用）
  3. `web/src/app/nativeInsets.ts`（新增）+ `web/src/main.tsx`（启动时修复）
  4. `web/src/env.d.ts`（ScreenAndroid 类型）
- **其他线请从 275 起用**

---

## 验证记录（lead / 顶栏顶到状态栏修复）

- 时间：2026-11-28 15:0x
- 版本：**4.6.1 / androidVersionCode 274**（构建+安装+真机验证）
- 根因复现：4.6.0 上 `Page.reload` 后 `--ds-safe-top` 从 32px 变为空且 12s 内不自愈（原生只在 Activity 启动时推一次）。
- 修复：`ChatWindowInsets` 静态 refresh + 去掉去重早退；`ScreenBridge` 新增 `refreshInsets()`/`safeInsetsCss()`；`web/src/app/nativeInsets.ts` 启动时主动刷新+兜底写变量。
- 4.6.1 真机：冷启动 32px；reload 后 1.5/2.5/4/6s 均 32px；连续 reload 两次仍 32px。
- 截图：`.build/safearea-after-reload.png`；说明文档：`DSCHAT-HANDOFF/79-顶栏顶到状态栏-安全区丢失修复.md`。
- 其他线仍从 **275** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.1.apk`

---

## 验证记录（lead / 导出选择页安全区修复）

- 时间：2026-11-28 15:1x
- 版本：**4.6.2 / androidVersionCode 275**（构建+安装+真机验证）
- 问题：4.6.0 的导出选择页全屏覆盖层没加 safe-area padding，标题 top=20px < 状态栏 32px，被状态栏图标压住。
- 修复：`ExportSessionPicker.module.css` 容器加 `--ds-safe-top/--ds-safe-bottom` padding；新增 `web/tests/safe-area-overlays.test.mjs` 防回归（44 个 CSS 文件扫描，PASS）。
- 4.6.2 真机：`--ds-safe-top=32px`，标题 top=52px、搜索框 top=92px，截图 `.build/picker2-full.png`。
- 规则文档：`DSCHAT-HANDOFF/80-全屏页面安全区规则-导出选择页修复.md`。
- 其他线从 **276** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.2.apk`

---

## 验证记录（lead / 导出选择页改版）

- 时间：2026-11-28 15:1x
- 版本：**4.6.3 / androidVersionCode 276**（构建+安装+真机截图）
- 版式对齐设置页：灰底 f8f8f8、白卡 14px 圆角、居中 15px/600 标题、左侧 30px 圆形返回按钮、右上「全选/清空」；
- 列表：单张白卡 + 0.5px 分隔线（左右缩进 14px），行高 66px，右侧 22px 勾选圈（选中蓝底白勾）；
- 搜索卡片 + 胶囊分段排序；底部：已选数量 / 诊断说明 / 取消 / 导出；深色主题有覆盖；
- 真机：`--ds-safe-top=32px`，标题 top=44px；截图 `.build/picker3-full.png`。
- 其他线从 **277** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.3.apk`

---

## 验证记录（lead / 导出选择页二次打磨）

- 时间：2026-11-28 15:1x
- 版本：**4.6.4 / androidVersionCode 277**（构建+安装+真机截图）
- 排序：轻量文字 tab（最近更新 / 按轮次，选中蓝字 + 2.5px 下划线），不再用胶囊分段；
- 「全选/清空」回到排序同一行右侧；
- 行布局：左侧标题（置顶会话带「置顶」小标签）+ 轮次，右侧日期 + 蓝色圆勾；所有行（含置顶）都显示日期；
- 真机截图 `.build/picker4-full.png`。
- 其他线从 **278** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.4.apk`

---

## 验证记录（lead / 导出选择页做减法 + 动画）

- 时间：2026-11-28 15:3x
- 版本：**4.6.6 / androidVersionCode 279**（构建+安装+真机截图）
- 交互：搜索框（灰底圆角、聚焦变白+蓝边）→ 一行「最近更新 ⌄ / 全选」→ 白卡会话列表（标题+轮次、右侧日期+勾选圈）→ 底栏「已选 N/M」+「导出」；
- 动画（真机 getComputedStyle 验证）：panel `esp-panel-in` 0.3s、行 `esp-row-in` 0.26s 错峰、勾选 `esp-check-pop` 0.22s、排序弹层 `esp-sheet-in` 0.38s、关闭反向 0.2s；
- 排序弹层：`role=listbox`，两项（最近更新/按轮次），选中蓝勾，点击即切并收起；
- 截图：`.build/picker6b.png`（列表）、`.build/picker6-sheet.png`（排序弹层）。
- 其他线从 **280** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.6.apk`

---

## 验证记录（lead / 导出选择页性能修复）

- 时间：2026-11-28 15:4x
- 版本：**4.6.7 / androidVersionCode 280**（构建+安装+真机测量）
- 改动文件：`ExportSessionPicker.tsx`（虚拟列表 + memo 行 + useDeferredValue + rAF 滚动）、`ExportSessionPicker.module.css`（入场动画只作用于 `.rowEnter`）、`sessionStatsPure.ts`（PickerRow 增加 roundsPending，统计未完成时不再显示 0 轮）。
- 真机（745 会话）测量：
  · 打开：DOM 行数 745 → 32；1 个 54ms 长任务；
  · 滚动 20×300px：长任务 173ms → 0；
  · 勾选单行：16ms → 9ms（只重渲染该行）；
  · 输入 4 个字符：每字符 5–15ms；
  · 滚到底部渲染 17 行，末行内容正确（虚拟窗口无空白/错位）。
- 其他线从 **281** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.7.apk`

---

## 验证记录（lead / 导出选择页去掉轮次 + 白话排序）

- 时间：2026-11-28 15:4x
- 版本：**4.6.8 / androidVersionCode 281**（构建+安装+真机验证）
- 行：单行（标题 / 日期 / 勾选），`getBoundingClientRect().height = 50px` 与虚拟列表 ROW_HEIGHT 一致；
- 轮次不显示；统计延后到 requestIdleCallback（兜底 400ms），打开时无「1 秒后刷新」跳变；
- 排序弹层文案：最近更新 / 聊得最多；选中「聊得最多」后顺序按消息条数（置顶优先）；
- 打开 1 个 55ms 长任务；滚到底最后一行正确（scrollHeight=37256 ≈ 745×50）；
- 截图：`.build/picker8-top.png`（列表）、`.build/picker8-sheet.png`（排序弹层）。
- 其他线从 **282** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.8.apk`

---

## 验证记录（lead / 恢复置顶标签 + 排序文案定稿）

- 时间：2026-11-28 15:4x
- 版本：**4.6.10 / androidVersionCode 283**（构建+安装+真机验证）
- 置顶会话行：标题前「置顶」小标签（10px 灰底），单行布局，日期仍右对齐；行高保持 50px，虚拟列表不受影响；
- 排序弹层：最近更新 / 消息最多；
- 真机前 3 行：`置顶 | 大一学生复盘与成长建议 | 11/28` 等，截图 `.build/picker10-top.png`。
- 其他线从 **284** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.10.apk`

---

## 验证记录（lead / 导出选择页「取消全选」文案）

- 时间：2026-11-28 16:0x
- 版本：**4.6.11 / androidVersionCode 284**（构建+安装+真机验证）
- 全选状态：按钮显示「取消全选」；点击后变「全选」、已选 0；再点「全选」恢复 743/743；
- 截图 `.build/picker11-top.png`。
- 其他线从 **285** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.11.apk`

### 2026-11-28 16:0x · 附件上传失败：三代理排查 + 修复（4.6.12 / 285）

子代理：`upload-audit-web`（网页上传管线静态审计）、`upload-audit-native`（原生选择器/WebView/网络层）、`upload-repro`（真机 CDP+本地 mock 复现）。

上传失败原因（穷举，详见各代理报告）：
- 传输层：单次直传无超时、无自动重试，弱网/切网/代理/VPN 直接失败；上传队列可能被永久卡死。
- 错误吞并：401/402/408/413/429/400 的真实原因全部显示为「上传失败」，且多数不给重试（改 Key/充值后仍传不上去）。
- 服务端配额：deleteFile 从未调用、上传不设过期 → 长期用户文件数/存储达上限后全部上传失败。
- 类型/来源：白名单含服务端不收的图片格式；0 字节文件；MIME 缺失导致分流错误。
- 重试/生命周期：verifiedImages 先标记后验证导致重试复用坏 serverId；刷新/非最后一条消息没有重试入口；上传失败后点发送静默无响应；无 Key 点重试仍发请求。
- 原生：WebView 选择器 accept 近千扩展名被截断成几十个 MIME（md/py/java 等选不到）；content:// 来源不可重读；相机静默失败；无 onRenderProcessGone/onReceivedError/onConsoleMessage 可观测。

本轮修复：
1. 上传超时（图片 90s/文档 180s）+ 网络/限流/5xx 自动重试一次；图片压缩 20s 超时回退原图。
2. 错误文案具体化：401 Key 无效、402 余额不足、408 上传超时、413 文件太大、429 限流、本地存储读取失败；外部条件类错误现在都给重试入口（413 除外）。
3. 修复 P0 回归（本过程中一次改动引入 readLocalFile 自递归，已修）：现在附件读取恢复正常。
4. verifiedImages 失败不再标记（重试不再复用坏 serverId）；重传 ApiError 直接上抛。
5. 0 字节文件、SVG/ICO/AVIF/BMP/TIFF 在选择阶段拦截（按扩展名，不依赖 MIME）。
6. 附件未就绪点发送给 toast；无 Key 点重试先拦截且不发请求。
7. 原生文件选择器改用通配类型 + 多选候选链（顺序：OPEN_DOCUMENT */* → application/* → text/* → GET_CONTENT */*），避免 accept 截断；manifest 加 largeHeap。

验证（真机，真实原生网络 + PC mock + adb reverse）：4.6.12 前端 9/9 通过 —— 图片确实进入请求体、文本附件内容正确、0 字节/BMP/SVG 拦截、假 Key 401 显示具体原因且只请求 1 次、无 Key 重试不发请求、上传中发送有提示、413 文案正确。

已知未修（下版候选）：服务端文件永远不清理导致配额耗尽；刷新/非最后一条消息的上传失败无重试入口；图片上传仍不带 purpose（契约风险）；validateFiles 整批原子（一个不合格整批不加）；配额 toast 依赖服务端英文正则；老 WebView(<98) 超时映射回落「上传失败」。

⚠ 事故记录：16:00 左右本机 IndexedDB 会话数从 743 降到 49（files 仅 1 条），另发现 16:00:37 的 117MB 全量备份（/sdcard/DS-Chat/deepseek_data-2026-11-28-160037.zip），疑似并行会话做删除/导入测试造成；本次上传相关测试未执行「删除全部」。建议从该备份恢复用户历史。

版本：`4.6.12 / 285`；安装包 `1122/ds-chat-4.6.12/DS-Chat-4.6.12.apk`，sha256 `DF6B49922E3E6A60EDF689D4737DA7C377B74C0B8D514D33DDD7E77906D92960`。

---

## 验证记录（lead / 导出位置可见 + 导入最近一次导出）

- 时间：2026-11-28 16:1x
- 版本：**4.6.12 / androidVersionCode 285**（构建+安装+真机验证）
- 导出路径：有权限时统一 `/sdcard/DS-Chat/<name>.zip`；无权限回落 `Download/DeepSeek Chat/`（页面显示路径）；
- 数据管理页：「已保存到 …」+「在文件管理器中查看」+「导入最近一次导出（文件名）」；
- 真机实测：2 会话导出 401KB → `DS-Chat/deepseek_data-2026-11-28-161159.zip`；点「导入最近一次导出」直接弹出导入确认（合并/覆盖），不再经过系统文件选择器；
- 改动文件：`localBackup.ts`（readBackupFile + 最近导出记录）、`SettingsDialog.tsx`（导出保存分支 + LastExportImport）、i18n；
- 截图：`.build/export12-after.png`、`.build/export12-import.png`。
- 其他线从 **286** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.12.apk`

---

## 验证记录（lead / 去掉导入最近一次导出）

- 时间：2026-11-28 16:3x
- 版本：**4.6.13 / androidVersionCode 286**（构建+安装+真机验证）
- 数据管理页已无「导入最近一次导出」（真机 innerText 校验）；
- 导出仍统一写 `/sdcard/DS-Chat/`，Toast + 行描述显示完整路径 + 「在文件管理器中查看」；实测 16:29 导出 `deepseek_data-2026-11-28-162942.zip`（401KB）落盘；
- 其他线从 **287** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.13.apk`

---

## 验证记录（lead / 可读文件名 + 分享导出文件）

- 时间：2026-11-28 16:4x
- 版本：**4.6.14 / androidVersionCode 287**（构建+安装+真机验证）
- 导出文件名：`对话导出-2026-11-28-1638-2个对话.zip`（DS-Chat 目录），页面/Toast 显示完整路径；
- 分享：点「分享刚导出的文件」→ 系统 ChooserActivity 打开（真机窗口校验 `com.android.intentresolver/.ChooserActivity`），面板里有 QQ/微信/文件管理/云服务/ES/夸克/百度网盘/企业微信；文件名在面板里显示为可读名；
- 原生改动：`MessageShare.java`（新增 export 路径只读分享 + zip 类型/显示名）、`BackupBridge.java`（shareExport 桥）、`SettingsDialog.tsx`（可读文件名 + 分享入口）、`env.d.ts`；
- 截图：`.build/export14-after.png`、`.build/export14-share.png`。
- 其他线从 **288** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.14.apk`

---

## 验证记录（lead / 官方同步重复消息审计与修复）

- 时间：2026-11-28 17:2x
- 版本：**4.6.18 / androidVersionCode 291**（构建+安装+真机验证）
- 审计方法：用 16:00 全量导出归档 vs 当前 IndexedDB（按 role+全文去空白）比对四条置顶会话；
- 发现：导入 + 官方同步后同一段问答成对重复（大二 512/295 唯一，材料 35/23 唯一）；大一 172 唯一无重复；
- 修复后真机：材料 35 → 23 条、重复 0，用户手打的数字仍在；大二仍是 512（两份副本都没有 o_ 官方锚点，离线无法安全判断删哪份，留待官方同步成功时由内容合并处理）；
- 根因说明：本 App 导出的归档里会话 id 已是 `off_*`，导入是「同 id 内容合并」；跨命名空间「保留两条」只适用于 id 不带 off_ 的归档（官方账号导出），之前解释混淆了两种情况；
- 另外核对：相对 16:00 归档，大二少 10 条、大一少 3 条，均为**删除所有对话**之后才被清掉的本地独有消息（后续部分导出 16:03/16:29 里已经没有），不是导入/同步删除；
- 单测：official-merge 6/6 PASS；tsc 无新增错误。
- 其他线从 **292** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.18.apk`

---

## 验证记录（lead / 备份默认开启 + 权限引导）

- 时间：2026-11-28 17:3x
- 版本：**4.6.20 / androidVersionCode 293**（构建+安装+真机验证）
- 有权限路径（本机已授权）：启动后自动 `localBackup=true`、写入 `backup-auto-enable-version=4.6.20`，无弹窗；
- 无权限弹窗：用隐藏开关 `chat-demo:backup-prompt-test=1` 强制展示，真机截图确认标题/说明/按钮；点「以后再说」关闭；测试后已清除开关；
- 无权限真实路径无法在本机复现（ColorOS 未 root，appops set 被拒），逻辑代码审查 + 强制弹窗验证；
- 改动文件：`components/settings/BackupPermissionPrompt.tsx`（新增）、`app/App.tsx`（挂载）、`i18n/zh.ts`/`en.ts`；
- 截图：`.build/backup-permission-prompt.png`。
- 其他线从 **294** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.20.apk`

---

## 验证记录（lead / 启动白屏&卡死&闪退排查）

- 时间：2026-11-28 19:5x
- 版本：**4.6.21 / androidVersionCode 294**（构建+安装+真机验证）
- 真机：启动正常、启动遮罩正常隐藏；隐藏开关 `chat-demo:boot-test=1` 可复现兜底页（截图 `.build/startup-fatal.png`）；旧 WebView UA（Chrome/60）会提示版本过低而不是白屏；`chat-demo:official-dedupe-v1` 启动 5 秒后写入=1（一次性清理生效）；
- 历史证据：系统 dropbox 里有 3 条旧版本（v4.0.2/v4.1.1）闪退，均为导出/备份时 `Base64.decode` 一次性分配 119MB OOM；4.5 起已改分块读写，但说明「闪退」里有一部分确实是内存问题；
- 真机无法复现用户白屏（当前 WebView 150），所以本版重点是兜底+诊断收集；原生 onRenderProcessGone 已接入，无法在真机模拟回收；
- 单测：startup-safety 6/6 PASS；tsc 无新增错误。
- 其他线从 **295** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.21.apk`

---

## 验证记录（lead / 模拟器复现老机型白屏&闪退）

- 时间：2026-11-28 20:3x
- 版本：**4.6.22 / androidVersionCode 295（未发布，等待用户找外部测试；GitHub release v4.6.22 与 tag 已撤回，公开版仍为 4.6.21）**
- 模拟器：`D:\AndroidToolchain\sdk` 下新增 emulator + `system-images;android-28;google_apis;x86_64`，AVD `api28`（1.5GB RAM / 2 核，WHPX）。启动命令：`emulator -avd api28 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -memory 1536 -cores 2`；本机 adb 自动识别 `emulator-5554`。
- 复现到的真实白屏/闪退：
  · Chrome 69：`Uncaught ReferenceError: globalThis is not defined`（bundle 第一行）→ 已加内联 polyfill；
  · Chrome 69：`Uncaught TypeError: Intl.DisplayNames is not a constructor`（location.ts 顶层）→ 已特性检测回退；
  · Android 9：`ClassNotFoundException: android.view.WindowInsetsAnimation$Callback`（MainActivity 类校验）→ 新增 ChatInsetsCompat 反射兼容层；
  · 卸载 WebView：`MissingWebViewPackageException`（new WebView）→ ChatRecovery 捕获弹窗。
- 回归脚本 `tools/dev/repro-startup.mjs`：模拟器 API28 **8/8 PASS**；真机 Android 14 **8/8 PASS**。
- 压力测试：模拟器灌 700 个会话摘要 + 40 个 300 条消息长会话，冷启动约 0.9s，页面正常。
- 单测：startup-safety **8/8 PASS**。
- 模拟器 AVD 数据可丢弃；不要把它和真机混淆（adb serial `emulator-5554`）。
- 其他线从 **296** 起用。
- APK：`C:\Users\zzzy\DS-Chat-APK\DS-Chat-4.6.22.apk`
