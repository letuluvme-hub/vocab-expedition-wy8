# P0-2：主页显示远征拼对记录

基线：`ab4546eb2056a358bac00d01dfb5ada1c34ed35f`。本次只调整主页展示与既有默写入口，不改掌握、解锁、伤害、成长数值或存档格式。

## 展示口径

- 新增“远征拼对”：`DB.mastered` 与六个教材单元的全部 259 条词汇取交集，按既有 `canonicalMasteryKeys` 的 trim + lowercase 身份去重。自定义独有词不计入总数；不剥掉短语空格、连字符等分隔符。
- 原统计“已掌握”改名“默写掌握”，仍读取原来的 `DB.dictationMastered`。不会把远征记录转换成正式默写证据。
- 单元已有远征逐词记录时，显示“远征 x/y · 默写 a/b”。自定义词表只在自己的单元卡展示记录，不影响教材统计或解锁。锁定状态与点击闸门保持原样；只有旧通关凭据、没有逐词记录时，保留原有通关说明。
- 知识成长注明只算每日默写里零错误、未用提示、未揭示答案的教材词。旁边的“进入每日默写”按钮复用现有 `open()`，进入原来的热身/正式默写流程，不创建新模式。

## 验收

先失败：新增 6 项单元测试全部失败，新增 3 项真实 Chromium 用例全部失败。关键失败是新档真实拼完首场战斗后已有 4 条 `mastered` 记录，但主页不存在远征统计。

实现后：新增单测 6/6、浏览器用例 3/3 通过。新档零错误拼完真实首战、领奖回地图、暂停保存回主页后，远征大于 0，Unit 1 显示双进度，默写仍为 0，Unit 2 仍锁定，知识成长仍为 +0；刷新后保留两份原始记录。另验证就近按钮确实进入现有默写页面，320px 三处展示没有横向溢出。

变异测试：临时把新增统计改读 `DB.dictationMastered`，教材交集测试因实际 0、预期 2 而失败（退出码 1）；随后立即逐字恢复目标文件。这证明断言实际加载了改动后的展示模块。

完整验证使用本 worktree、独立 4291 端口与 `reuseExistingServer: false`，不复用其他 worktree 的服务。临时 Playwright 配置只替换绝对路径、端口和已安装 Chromium 路径，不进入提交。

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm run check:data` | 259 词；六单元分别为 45/55/29/50/41/39 | 0 |
| `npm test` | 1207 passed，0 failed | 0 |
| `npm run build` | 网站与离线单文件均生成成功 | 0 |
| `npm run test:build` | 3 passed，0 failed，含生产探针排除检查 | 0 |
| `npm run test:e2e -- --config=/tmp/vocab-home-progress-playwright.config.mjs --workers=3` | 291 passed，255 skipped，0 failed（5.7 分钟） | 0 |
| `npm run test:e2e -- --config=/tmp/vocab-home-progress-playwright.config.mjs --workers=2` | 最终复核 291 passed，255 skipped，0 failed（10.9 分钟），包含 400ms 夹具修正 | 0 |
| `npm run test:release -- --config=/tmp/vocab-home-progress-release.config.mjs` | 6 passed，0 failed（15.6 秒），HTTP 与 file:// 发布物均验证 | 0 |

首次全量为 287 passed、255 skipped、4 failed，退出码 1。其中 3 条旧主页用例禁止出现“每日默写”，与本次明确的成长说明和就近入口冲突，现仅为 `masteryGrowthHost` 设精确例外；其余主页结构、折叠状态和远征主入口断言保留。另一条旧存档难度用例的实时倒计时在机器并发下落到 2893ms，低于原断言 3600ms；测试和产品代码均未改动，定向复跑和上述完整复跑均通过。

另同步两处经整合者授权的测试环境修正：400ms 商店离开夹具改在真实 click 的一次性捕获监听中设置 `advAt`，确保命中原本要验证的去重分支；发布验证对 HTTP 与 file:// 都授予剪贴板读写权限，避免真实读取卡在未处理的浏览器授权提示。两处均保留原有行为断言，不修改运行时，也不 mock 剪贴板。

冻结七张样式表、259 词数据、runtime、domain、存档服务和版本号均未修改。`git diff --check` 通过。浏览器自动化不代表 iOS/Android 真机声音或工具栏高度验收。

## 改动文件

- `index.html`
- `src/ui/components/mastery-growth.js`
- `src/ui/screens/title.js`
- `src/ui/screens/daily-dictation.js`
- `tests/unit/home-expedition-progress.test.js`
- `tests/unit/campaign-ui.test.js`
- `tests/unit/extraction.test.js`
- `tests/unit/mastery-growth-ui.test.js`
- `tests/unit/ui-modules.test.js`
- `tests/e2e/home-expedition-progress.spec.js`
- `tests/e2e/home-atlas-layout.spec.js`
- `tests/e2e/pause-resume.spec.js`
- `tests/release/smoke.spec.js`
- `docs/feature-home-expedition-progress.md`

本地 `node_modules` 软链、临时 Playwright 配置、浏览器报告和截图不属于交付文件，不应提交。
