# 远征次数与通关次数计数

对应 `docs/product-backlog.md` 任务 A.1。本文只记录**计数**，
不含跳过代价、影分身限制、击杀必须整词、暂停快照等后续项。

## 语义（唯一口径）

| 计数 | 字段 | +1 的唯一条件 | 明确不 +1 的情况 |
|---|---|---|---|
| 远征次数 | `DB.runs` | 玩家真正开始一轮新的远征 | 恢复/读档、重复触发（连点）、结算画面重绘、页面刷新 |
| 通关次数 | `DB.wins` | 本轮远征真打赢 BOSS 并结算 | 逃跑、跳过、失败、重复结算、迟到回调、本轮已通关后的第二次 BOSS 胜利（返回 `'ignored'`） |

两个计数都**幂等**：同一个 run 对象最多各 +1 一次。既有存档里的历史总数
原样保留，不回填、不折算、不按当前玩法重算。

## 唯一计数入口

计数逻辑集中在 `src/domain/run.js`，其他地方只调用，不再自己 `++`：

- `registerRunStart(db, run, { restored })` —— 远征次数入口。`restored: true`
  表示恢复：`db.runs` 不动，但仍把 `run.countedStart` 置 true，即**占住**这一轮的
  计数名额。于是「先恢复、后被当成新开一轮再调一次」的顺序也不会把这条 run
  记成新的一次远征。幂等依据只有 `run.countedStart`，与调用顺序、时间窗无关。
- `registerRunWin(db, run)` —— 通关次数入口。幂等依据 `run.clearedRun`。
- `isDuplicateRunStart(run)` —— 判据：当前 run 存在且还没有 `result`
  （即这一轮还没结算），说明这次「新开一轮」是上一次调用的重复触发。

`run.id` 只是诊断标识（日志里说清是哪一次远征），**不是**计数幂等的依据；
幂等依据是 run 级标记 `countedStart` / `clearedRun`。

接线只有一处：`src/app/runtime.js` 的 `newRun()` 调用 `registerRunStart`，
`finishBattleNode()` 的 BOSS 胜利分支调用 `registerRunWin`。

## 重复触发的闸门为什么放在 UI 层

`startRun()`（内部强制重开，测试探针与将来的恢复流程用）不做重复判定；
`startRunFromUi()`（玩家点「开始远征 / 再来一次 / 下一单元」）才拦。

判据是**状态而不是时间窗**。曾经先试过 400ms 时间窗（和 `ADV_LOCK_MS` 同风格），
真实浏览器里立刻暴露误伤：`放弃这次远征 → 立刻重开`、`打完 → 立刻下一单元`
都会被当成连点吃掉，E2E `abandoning an expedition mid-run` 与
`double-clicking next unit` 直接失败。状态判据只挡真正的连点。

## 已证实的根因与不变式加固

用真实 Chrome（`playwright.config.js` 的 executablePath）在 Vite 页面上复现，
不是读源码推断。

### 1. 远征次数被连点重复计数（已修）

`newRun()` 里原本直接 `DB.runs++`，而三个按钮都直接调 `newRun()`，
没有任何重复触发判定。E2E 用 `el.click(); el.click();` 在同一轮里派发两次 click
事件（一次用户操作意图、两次事件派发），修复前：

```
P1 double #startRun -> { runs: 2 }     // 只点了一次「开始远征」，计数 +2
```

修复前 `tests/e2e/counting.spec.js` 的三条连点用真实浏览器复现：
`double-clicking start` 读到 2（应为 1）。

### 2. 同一轮第二次 BOSS 结算不再是一次通关（已修）

`finishBattleNode` 的幂等只靠 `battle.finished`——那是**战斗对象**的标记。
同一轮里如果出现第二个 BOSS 战斗对象，它没有 `finished`，于是再 +1：

```
W4 two boss settlements in one run -> [ { wins: 1 }, { wins: 2 } ]
```

即一轮远征记了两次通关。修复前 E2E 读到 `wins [1, 2]`（应为 `[1, 1]`）。
真实地图每轮只有一个 BOSS 节点，玩家按现有玩法**走不到**第二次结算，
所以这条只能靠注入第二个战斗对象才复现 —— 它是**不变式加固**，不是已证实的
玩家可达根因。但计数判据不该依赖「地图恰好只有一个 BOSS」这种巧合，
所以仍然在 domain 层挡住了。

当前守卫位置也在这一轮补正：修复「第二次结算」时，`registerRunWin` 的
`clearedRun` 已经挡住了 `wins` 的二次 +1，但 `finishBattleNode` 仍然会走完整个
BOSS 胜利分支 —— 再 +30 回血、把节点标 `done`、返回 `'boss-win'`，让
`runtime.finishNode` 再安排一次结算。现在改成**在任何副作用之前**返回
`'ignored'`，语义也更准：这一轮已经通关过，第二次根本不是一次通关。

### 3. 同一轮重复结算会被 `battle.finished` 挡住（原本已正确，保留）

同一个战斗对象重复 `finishNode()` 返回 `'ignored'`，`wins` 不变。这条原本就对，
新测试把它固定下来，防止以后重构时丢掉。

## 验证方式

上一轮用过反向突变（逐个破坏判据，确认测试真的加载了被改的代码而非碰巧通过）。
本轮不做变异大循环，改用「先 RED 后 GREEN」固定两个新守卫：
新增/改写的 4 条单测在修复前全部失败（`node --test` 退出码 1），
修复后 27/27 通过（退出码 0）；counting E2E 同一条在修复前 hp 断言读到 90
而非 100（第二次 +30 回血），修复后通过。

上一轮的反向突变结果：

| 突变 | 观察值 | 结果 |
|---|---|---|
| 去掉 `registerRunStart` 的 `countedStart` 幂等 | 同一条 run 注册 3 次 → `runs=3` | CAUGHT |
| 去掉 `registerRunWin` 的 `clearedRun` 幂等 | 同轮两次 BOSS 结算 → `wins=2` | CAUGHT |
| 去掉 `startRunFromUi` 的重复触发闸门 | 连点开始远征 → `runs=2` | CAUGHT |
| 让 `restored: true` 也计数 | 恢复一次 → `runs=10`（应为 9） | CAUGHT |

全部 CAUGHT，源码已还原（`git diff` 确认只剩授权改动）。

## 测试

上一轮全量验证命令与真实结果（Windows，`"C:/Program Files/nodejs/node.exe"`，
完整日志 `%TEMP%/npm-check-counting.log`，`npm run check` 真实退出码 **0**）：

| 阶段 | 结果 |
|---|---|
| `npm run check:data` | 通过 |
| `npm test`（unit） | 165 tests / 165 pass / 0 fail / 0 skipped（基线 140 + 新增 25） |
| `npm run build` | 通过 |
| `npm run test:build` | 2 tests / 2 pass / 0 fail |
| `npm run test:e2e` | 54 listed / **44 passed / 0 failed / 10 skipped** |
| `npm run test:release` | 2 tests / 2 passed |

10 个 skip 全部是既有 `test.skip(testInfo.project.metadata.target==='legacy')`
模式：本次新增 8 条（counting.spec）+ 既有 2 条（lifecycle.spec）。它们是不变式守卫，
不是旧版行为基线，所以不跑归档页面；除此之外没有任何测试被跳过或漏跑。

E2E 覆盖：连点三个入口各只记一次、同轮两次 BOSS 只记一次、
真实打赢 +1 通关、刷新不重计、放弃后重开各记一次、
历史总数（41/17）在新一轮与通关后正确累加、跳过 BOSS 只记次数不记通关。

本轮只跑了受影响范围，真实结果：

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --test tests/unit/counting.test.js`（修复前） | **1** | 27 tests / 4 fail |
| `playwright test tests/e2e/counting.spec.js -g "two BOSS victories" --project=new`（修复前） | **1** | 1 failed，`hp` 读到 90（应为 100），即第二次 +30 回血 |
| `node --test tests/unit/counting.test.js`（修复后） | **0** | 27 tests / 27 pass / 0 fail |
| `playwright test tests/e2e/counting.spec.js`（修复后） | **0** | 8 passed（new）+ 8 skipped（legacy 不变式守卫） |
| `node --test tests/unit/*.test.js`（修复后，全 unit） | **0** | 167 tests / 167 pass / 0 fail |

本轮未跑 `check:data` / `build` / `test:build` / `test:e2e` 全量 / `test:release`
（改动只涉及 `src/domain/run.js` 的计数分支，不影响构建产物）。

## 未验证 / 剩余风险

- **没有跑 iPhone/安卓真机**：连点在移动端触摸上更容易发生（双击缩放、按钮回弹），
  真机上是否还有别的重复触发路径未验证。
- **`restored` 目前没有调用方**：远征跨刷新恢复属于 backlog 任务 5，
  那时才会有真正的恢复入口。现在只是把口径固定下来，避免将来加恢复时顺手 +1；
  本轮把「恢复占住 countedStart 名额」也固定成契约，恢复接入后直接可用。
- **UI 层重复触发闸门的未来路径风险（当前不可达，仅记录不处理）**：
  `isDuplicateRunStart` 判据是「当前 run 存在且没有 result」。将来若加入
  快照恢复或后台自动续关，可能出现「没有在跑的 run，但玩家的新开意图仍被误判」
  或相反的情况。**不要**为此改成时间窗 —— 时间窗会误伤
  「放弃 → 立刻重开」「打完 → 立刻下一单元」这类正常操作（已实测失败）。
  真出问题时应扩展状态判据本身。
- **`db.runs | 0` 的 32 位边界不是本任务主风险，记录不处理**：`| 0` 把计数转成
  int32，超过 2^31-1 会变负、累计到 2^32 会绕回。个人使用量级下不可能到达，
  且改掉会改变历史存档的读取语义，所以保留既有 `| 0`、不新增大数测试。
- **`DB.wins` 与「单元通关 / 全轮通关」仍是同一个指标**：backlog A.1 要求解锁机制
  落地后拆成独立语义。本次未拆，因为那依赖任务 7 的连续轮次主线。
- **`db.best` 仍在 BOSS 胜利时写死 `Math.max(db.best, 9)`**，属于「最好层数」
  的既有行为，本次未改，也未加测试。
- **单文件离线导出（`dist/index.html`）的计数行为未单独验证**：`npm run build` 与
  `npm run test:build` 通过，但离线 file:// 页面没有专门的计数 E2E。
- **历史存档里已有的错误计数无法追溯修正**：按要求不篡改历史统计。
  如果线上已有玩家因连点带着偏高的 `runs`，本次修复不会回退这些数字。