# 分阶段部署计划（2026-10-02 优化批次）

> 配套文档：`optimization-plan-2026-10.md`（任务书）、`vocab-audit-checklist.md`（VE 清单）。
>
> **目标**：把 29 个改动项切成若干个**可以各自独立验证、各自独立回滚**的发布，
> 而不是攒成一个巨大的 PR 一次性上线。
>
> **依据**：`docs/release.md`（上线与回滚规程）、`AGENTS.md`（不可破坏的行为）、
> `package.json` 的 `check` 脚本（CI 与本地共用的验收入口）。

---

## 0. 每个阶段共同的发布动作

无论哪个阶段，上线动作都一样（`docs/release.md`）：

1. 改 `public/version.json` 的 `version`（**唯一**版本来源，Vite 会注入并保留旧客户端桥接标记）
2. 本地跑满 `npm run check`（= `check:data` + `test` + `build` + `test:build` + `test:e2e` + `test:release`）
3. 合到 main → `deploy.yml` 自动跑同一套 `npm run check`，绿灯才上传 dist
4. 上线后必须跑 `npm run verify:public -- https://letuluvme-hub.github.io/vocab-expedition-wy8/`
5. 确认旧存档（`wy8a_rogue_v1`）保留、纪念卡保留、单文件可下载
6. 记录回滚点：给每次发布打 tag（见 `docs/release.md` 的回滚规程）

### 版本号约定

沿用现有的 `YYYY.MM.DD-<slug>` 格式，每个阶段一个：

| 阶段 | 建议版本号 |
|---|---|
| 阶段 1 | `2026.10.02-audit-batch1` |
| 阶段 2 | `2026.10.02-gameplay-tuning` |
| 阶段 3 | `2026.10.02-numeric-perf` |
| 阶段 4 | `2026.10.02-test-hardening` |
| 阶段 5 | 逐项单独发（见各条） |

---

## 阶段 1 · 零行为变化 + 两处用户可见修复

**版本**：`2026.10.02-audit-batch1`
**风险**：低
**为什么先发这一批**：这一批里没有任何一处会改变玩法数值或存档格式，
但已经修掉了「假阳性测试」「CI 跑两遍」「没有任何全局错误兜底」三个**基础设施问题**，
以及两个用户实机看到的界面 bug。先把它发出去，后面几批出问题时才好定位是哪一批引入的。

| 项 | 内容 | 对玩家的可见变化 |
|---|---|---|
| VE-08 | 修 `audio-settings.test.js:269` 的恒真假阳性测试 | 无（测试改动） |
| VE-14 | `ci.yml` 不再在 push main 时重复跑全套 | 无（CI 改动） |
| VE-16 | `ci.yml` 补 `concurrency` | 无（CI 改动） |
| VE-20 | 7 处 `.filter(x=>x.id===id)[0]` 收敛成 `src/data/lookup.js` | 无（纯重构） |
| VE-17 | 新增 `src/services/error-guard.js`：全局异常兜底 + 可复制现场 | **出异常时**多一条提示条 |
| VE-11a | `playwright.config.js` 的 `webServer.url` 指向入口路径 + 超时提到 45s | 无（测试基础设施） |
| VE-12 | 删除冗余断言（约 15%） | 无（测试改动） |
| C1 | 结算页两个按钮文案改成说清后果 | **文案变** |
| C3 | 磨砺石限购卡面实时刷新 + 买满置灰 | **卡面变** |

### VE-11a：e2e 为什么会假失败（本批附带查出的既有缺陷）

审计跑到这里时，`npm run test:e2e` **稳定挂 4 个用例，复跑仍挂**。按计划要求
"复跑确认是 flake 再动手"——结果它不是 flake，是真实缺陷。实测定位：

| 请求 | 耗时 |
|---|---|
| 根 `GET /` | **0.32s** |
| 入口 `GET /vocab-expedition-wy8/` 第一次 | **31.66s** |
| 入口 第二次 | 3.04s |
| 入口 第三次 | 0.07s |

`playwright.config.js` 的 `webServer.url` 写的是根 `/`，0.3s 就响应，Playwright 于是判定
"服务器就绪"并立刻放 4 个 worker 去打那条要 31 秒的入口路径，撞上 `timeout: 25_000`
→ 先到的用例必然 `page.goto: Test timeout exceeded`。**报错看起来像应用坏了，
其实是服务器没热。**

两条修法，都已落地：

1. `webServer.url` 改成 `http://127.0.0.1:4173/vocab-expedition-wy8/`（**入口**路径），
   `webServer.timeout` 提到 120s。
   佐证：`playwright.release.config.js:20` 一直就是这么写的，只有主配置漏了。
2. 全局 `timeout` 25s → 45s。dev 模式下浏览器要逐个拉约 100 个未打包的模块/样式文件，
   45s 是这条路径的真实成本；真挂住会跑满 45s × 用例数，不会被放过。

**证伪方式**：杀掉全部 node、确认 4173 端口零监听，让 Playwright 自己冷起服务器 ——
**这正是原本必挂的场景**，结果 `231 passed / 195 skipped / 0 失败`，与计划基线一致。

> 这条同时解释了计划里"pause-resume / round-cards 偶发失败"的同类现象：报错形态一样。
> **VE-11 剩下的一半**（`waitForTimeout` → `waitForFunction` / `expect.poll`）仍要做，
> 但先有了可信基线，之后的红绿才有意义。

### 上线前必须额外确认

- VE-17 新增了 `#errbar` 样式表 → 它已登记进 `styles.test.js` 的 `ADDED` **和**
  `extraction.test.js` 的 `ADDED_CSS`（两份独立副本，见 VE-12）。
  **踩过的坑**：只登记一处会让「原始七张逐字比对」恒假，报错是一整屏 CSS 文本。
- C1 的文案是**有意漂移**，`ui-modules.test.js` 的 legacy 对照必须做归一化 +
  单独断言新文案 + 加一条「`#oAgain` 文案不得含『复习』」防回退。
- C3 的真实陷阱：重画商店**不能丢 `fn` 闭包**。`publish()` 出去的是脱敏描述
  （没有 `fn`），恢复路径靠 `optionById` 反查动作。重画时若误用 `current()` 的
  options 重新绑回调，**所有购买按钮会失效**。

### 回滚

任一项出问题 → 打 tag 的 revert commit 走 main 即可，无存档格式变化、无数据迁移。

---

## 阶段 2 · 玩法数值（需要实机定标）

**版本**：`2026.10.02-gameplay-tuning`
**风险**：中
**前置**：**用户实机试玩并确认**。这一批的每一项都是"纸面推演不算数"的那一类。

| 项 | 内容 | 已拍板的决定 |
|---|---|---|
| C4 | 跳过扣 `max(70, 50%×当前生命)`；逃跑扣 `max(50, 50%×金币)`，金币 < 50 禁用按钮 | 地板提到 70（方案 b） |
| C2 | 关卡节点权重：营火 4.36 → 2.60，战斗 9.35 → 10.04 | 现在应用，实机后再调 |
| VE-07 | 把 `th`（11 类语义主题）显示出来 | 做出来，不删 |

### 这一批的三个雷

1. **C4 方向不能反**。`balance.js` 那段论证讲的就是"跳过变便宜 = 撤退比打完划算 =
   整个战斗设计崩塌"。**地板值必须 ≥ 现状的 50**。另外影分身的免费撤退
   （`combat.js` 的额度分支）**不要动**，`ghost.test.js` 应当原样通过。
2. **C4 的按钮文案必须显示真实数字**。`fight.js` 的文案现在是写死 `SKIP_HP_COST`，
   必须改成按当前状态算。而且代价要在**扣之前**算一次 —— `B.myHp` 与 `G.gold`
   都会在结算过程中被改，文案与实扣会不一致。
3. **C2 与 VE-02 都动 `map.js`**。VE-02 要把 `MAP_ROWS` 参数化，
   所以这两项**不要排在相邻阶段**，否则同一个文件连续被两个 PR 改。

### 实机定标清单（`docs/playtest-checklist.md`）

- 一局打完，看营火是不是还是太多、战斗是不是太密
- 低血时点跳过，确认是战败而不是被保命
- 金币 400 时点逃跑，确认扣的是 200 且按钮文案写着 200
- 影分身在场时点跳过，确认是免费且不扣血

---

## 阶段 3 · 数值正确性 + 性能

**版本**：`2026.10.02-numeric-perf`
**风险**：中到高
**为什么这一批要一起发**：VE-01 改伤害上限会连锁影响 `foe-stats.js` 的敌人血量公式，
VE-02 又依赖同一套公式。**拆开发布等于把一个自洽的改动切成两半上线**，
中间那个版本的血量与伤害是不自洽的。

| 项 | 内容 | 风险来源 |
|---|---|---|
| VE-01 | `hitDmg` 的 140 硬上限改成随深度增长 | 直接改伤害 |
| VE-02 | BOSS 血量锚点从"第 9 层"解绑到实际地图深度 | 直接改血量 |
| VE-03 | 修掉把上面这个 bug 钉成预期的断言 | 测试改动 |
| VE-11 | e2e 固定 sleep → `waitForFunction` / `expect.poll` | 测试改动 |
| VE-04 | `renderFight` 从"全量重建"改成"增量 patch" | DOM 结构 |
| VE-05a | 快照里的 `run.pool` 改成 `bookId + unit` 引用 | **存档格式** |

### 这一批必须过的验收

- 深层（floor 20 / 50 / 200）`hitDmg` 对 plain 与 stone 产出**不同值**
- 浅层 floor 1–9 的伤害**逐位不变**
- BOSS 血量 ≥ 同层最强普通怪与精英（`MAP_ROWS` 参数化后仍成立）
- VE-04：按键后 `#fBank` 的**同一批节点对象引用不变**（这一条能证伪，
  详见 `optimization-plan-2026-10.md` 的 VE-04 验收）
- 320px / 390px 布局与点击热区不变、键盘焦点不丢

### ⚠️ VE-05a 是本批唯一的存档格式改动

- `SNAPSHOT_SCHEMA_VERSION` 要 1 → 2，且 `decodeSnapshot` 必须**继续接受 v1**
  （否则所有在线玩家的进行中远征直接作废）
- 自定义词表（unit 0）没有稳定来源，仍需落盘或用内容哈希寻址
- 存档是外部输入：引用寻址一旦解析不回教材表，必须 fail closed 而不是画个空池子

### 这一批**不做**的

- **VE-05b（写前自检降频）不做。** `runtime.js` 的 `commit(force)` 是刻意设计成
  "动作跑完就落盘"来换"刷新绝不丢中途态"的。降频不能简单加 debounce，
  必须先有人能明确写出"状态事实"与"中途可丢态"的边界。

---

## 阶段 4 · 测试与产物验证

**版本**：`2026.10.02-test-hardening`
**风险**：低（不碰运行时）
**收益**：把省下来的 e2e 时间换成真正的覆盖

| 项 | 内容 |
|---|---|
| VE-18 | legacy 双跑收缩成 20–30 条 parity 断言 |
| VE-10 | 生产产物（含 288KB 单文件）行为冒烟：打完一词 / 暂停恢复 / 存档往返 |
| VE-13 | `runtime.js` / `voice-lines.js` / `custom-words` / `effects` / `math.clamp` 覆盖 |
| VE-09 | 把审计点名的 5 处字符串匹配断言改成真实 DOM 行为断言 |

### VE-12 的优先级已经变了（实测出来的）

本批做 VE-20 时新增了一张样式表，`extraction.test.js` 的「原始七张逐字比对」**立刻恒假**
—— 因为 `styles.test.js` 的 `ADDED` 与 `extraction.test.js` 的 `ADDED_CSS` 是
**两份独立副本**，只登记一处，另一处就把新表算进 original。报错是一整屏 CSS 文本，
看不出真实原因（本次排查花了几分钟才定位）。

也就是说 VE-12 里「CSS 作用域检查 ×3 重复」这一项的代价已经被现实验证过。
**建议把「合并那两份 ADDED 清单」提到本批之前做**，否则以后每加一张样式表都要付一次这个成本。
（已在本批临时把 `error-guard.css` 登记进两处，并在两处都写了警示注释。）

### VE-18 收缩前必须先写下一句话

**legacy 双跑到底在防什么？** 写进 `docs/architecture.md` 再删断言。
不写清楚的话，半年后没人敢删，也没人说得清删了会失去什么保护。
候选答案是"防止存档格式漂移"和"防止玩法数值无意改动"——两条都值得留几条断言。

### VE-10 的次生问题要一起修

`tests/e2e/game-harness.js` 的 `open()` 用 `expect.poll(() => !!window.__gameTest)` 等待。
**探针一旦消失，所有场景静默挂起超时而不是干净失败** —— 这类"绿色的失败"
比红色更贵。

---

## 阶段 5 · 独立立项（每项单独发）

**这些不要与功能改动混做**。理由各不相同：

| 项 | 为什么必须独立 |
|---|---|
| VE-15 lint/format | 一次性会重排大量文件，混进功能 PR 就没法 review |
| VE-21 可访问性 | 改动面广（血条 / live region / 焦点管理 / aria-label），要单独验证 |
| VE-22 JS 侧 reduced-motion | 会改 `effects.js` 的粒子/飘字/震屏，要真机确认没有把反馈整个去掉 |
| VE-23 CSS 收敛 | 会大面积改视觉，而项目只做过 Chrome 自动化验证，**无真机验证** |
| VE-19 `runtime.js` 拆分 | 按 `AGENTS.md`「下一步提取原则」：一次只处理一个流程，保留结算顺序 |

### VE-15 的引入方式

先只加 ESLint flat config + Prettier + `.editorconfig`，**不改任何现有文件的格式**
（用 `--fix` 单独一个 commit），确认 CI 绿灯后再开新代码的强制。

---

## 回滚总则

- 每个阶段一个 tag，回滚 = revert 到上一个 tag 的状态
- 阶段 3 之前的任何一个阶段回滚都**不涉及存档迁移**
- 阶段 3 的 VE-05a 是唯一动存档格式的，回滚它必须保证 v1 快照仍能读
- `docs/release.md` 要求：回滚后要**重新验证公共网址的字节与真实浏览器**，
  不只看 workflow 绿灯

---

## 一条给后续 agent 的操作警告

**不要用 PowerShell 的 `Get-Content` / `Set-Content` 往返改本仓库的源文件。**

本次审计中，VE-08 的变异测试用
`$s = Get-Content f -Raw; ... ; Set-Content f $s -Encoding UTF8`
改 `src/app/runtime.js`，那次往返按**控制台默认编码解码**、再按 UTF-8 写回，
把文件里全部中文注释毁成了乱码，`node --check` 直接报 `Unterminated string`。

更危险的是它**当时没有让任何测试变红** —— 因为 `runtime.js` 没有被任何测试
`import`，只有几个测试把它当**文本**读。于是损坏潜伏了很久才在 build 时爆出来。

**正确做法**：改文件用编辑工具；必须脚本化时用 Node 的
`readFileSync(path, 'utf8')` / `writeFileSync(path, src, 'utf8')`，
并且**改完立刻 `node --check <file>`**。
