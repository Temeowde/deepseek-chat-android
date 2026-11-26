const fs = require('node:fs')
const path = 'C:/Users/zzzy/Desktop/1121/ds-merged/COORDINATION-lead.md'

const entry = `
### 2026-11-26 20:0x · API 设置页这条线（已收到 GitHub 统一管理规则）

- 已确认规则：不执行任何 git 命令；改动写在此文件；版本号按 \`web/package.json\` 的 \`androidVersionCode\` 取最大值 +1；构建用 \`pm install -r -d\`；临时脚本只放 \`tools/dev/\`。
- 本线待提交改动（如果 4.5.0 的 commit 里没有，请下次一并带上）：
  - \`web/src/components/settings/SettingsDialog.tsx\`：备份页「查看全部 N 份」改成走 \`styles.expander\`，展开/收起有 220ms 高度+淡入动画（前 5 条常显，第 6 条起收在展开区）。
  - 已在本机构建验证：expander 高度 0 → 51 → 266 → 276（约 220ms 完成），不是瞬间弹出。
- 当前版本状态：工作树 \`4.5.0 / 250\`，设备也是 \`4.5.0 / 250\`。我这条线下次构建会从 \`251\` 起。
`

fs.appendFileSync(path, entry, 'utf8')
console.log('appended, size =', fs.statSync(path).size)
