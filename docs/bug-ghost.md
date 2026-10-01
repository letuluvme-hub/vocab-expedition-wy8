# 影分身：免费撤退额度是每轮远征一次

对应 `docs/product-backlog.md` 任务 A.3（"影分身可无限使用"）。
本文只记录**影分身额度**，不含跳过代价本身（`docs/bug-skip.md`）。

## 语义（唯一口径）

| 情况 | 生命 | 结算 | 明确不做的事 |
|---|---|---|---|
| 有影分身 + **本轮未用** | 不变 | `finishNode` → 正常推进 | 不扣血、不记失败；仍走 `finishNode`，所以 BOSS 依然是失败 |
| 有影分身 + **本轮已用** | `B.myHp -= 50` | 与没有影分身时**完全一致** | **不**拒绝、**不**永久禁用跳过 |
| 没有影分身 | `B.myHp -= 50` | 同上 | —— |

用完额度后回落到普通跳过的固定 50 点生命代价（`SKIP_HP_COST`，仍是
「不够付就是战败」那套口径，见 `docs/bug-skip.md`），**不是**把跳过按钮永久禁用。

## 唯一事实来源：`run.ghostUsed`

旧实现把标记放在 `B.ghostUsed`（战斗对象），而 `startFight` **每场战斗都重建 B**，
于是额度每场重置 —— 每打一场就能白嫖一次免费撤退，影分身事实上是无限制的。

现在只有一个布尔字段，挂在 run 上：

```js
// src/domain/run.js — createRun
ghostUsed: false,     // 唯一初始化点：换一轮远征才重置
```

| 位置 | 职责 |
|---|---|
| `src/domain/run.js` `createRun` | **唯一**把额度置回 `false` 的地方 |
| `src/app/combat.js` `skipFight` | 读 `G.ghostUsed` 判额度，用掉就置 `true` |
| `src/ui/screens/fight.js` `renderFight` | 只读 `G.ghostUsed` 决定按钮文案与 tooltip |
| `src/app/runtime.js` `startFight` | 已**不再**创建 `B.ghostUsed`（避免两个不一致的来源） |

判定式：

```js
if (G && hasR('ghost') && !G.ghostUsed) {   // combat.js
  G.ghostUsed = true;
  B.over = true;
  finishNode();
  return true;
}
```

**只看 run，不看 B。** 所以：

- 换一场战斗（新 B 对象）不重置；
- 重复拿到影分身（`G.relics` 里出现第二个 `'ghost'`）也不重置；
- 只有 `createRun`（新一局）才重置。

布尔而不是次数（`ghostCharges = 1`）：语义就是「一次」，缺字段回落规则最简单。

## 免费撤退为什么也要先置 `B.over`

`skipFight` 开头是 `if (!B || B.over) return false;`。先置 `B.over = true`
再 `finishNode()`，连点的第二次调用就被这道闸门挡住 —— 额度只消耗一次、
节点只结算一次。旧的免费路径**没有**置 `B.over`，靠 `advance` 的 400ms
去重窗口兜底；现在不依赖那个时间窗。

`B.over` 不影响 `finishBattleNode`（它只看 `battle.finished`），
所以「免费撤退 + 正常推进」的语义不变。

## BOSS 跳过仍不通关

免费撤退走的是**同一个** `finishNode`，没有旁路。BOSS 因此照旧走
`finishBattleNode` 的 `battle.boss && !battle.won` → `'boss-loss'` →
`endRun(false)`：`DB.wins` 不动、不发纪念卡、无 `+30` 回血。
「免费」只指不扣血，不指不算失败。

## 快照与恢复（未来任务，当前未启用）

`ghostUsed` 是普通布尔，**可 JSON 序列化**，所以将来做远征快照/读档时它会
自动跟着 run 一起往返。缺字段（老存档、旧快照）按 `falsy` 处理 =
**本轮未用**，仍然可用一次：保守口径是不给玩家凭空扣掉一次权益，也不让
玩家卡死成「永远不能免费撤退」。

> 当前版本**没有**暂停/快照功能，本任务**没有**声称支持中途退出后保留额度；
> 这里只是保证字段形状不会阻碍将来的实现。

## 文案

| 位置 | 文案 |
|---|---|
| `src/data/relics.js` 图鉴 | 「每轮远征可免费跳过一次，不计失败（用完后跳过仍需付代价）」 |
| 跳过按钮（可用） | `影分身 / 免费撤退 · 本轮仅剩 1 次` |
| 跳过按钮 tooltip（可用） | 「影分身：本轮远征唯一一次免费撤退，不计失败、不扣生命」 |
| 跳过按钮（已用完） | `跳过 / 损失 50 生命`（与没有影分身时逐字相同） |
| 跳过按钮 tooltip（已用完） | 「影分身本轮已用完：撤退需要损失 50 点生命」 |
| toast（免费） | 「👻 影分身：免费撤退（本轮唯一一次），不计失败」 |
| toast（付代价时） | 「跳过：损失 50 点生命（影分身本轮已用完）」 |

`index.html` 里 `tSkip` 的静态骨架仍是 `跳过<small>损失 50 生命</small>`
（渲染前的那一帧），未改。

## 测试

新增 `tests/unit/ghost.test.js`（20 条）。它**不复用**纯计数桩：
`finishNode` 走真实 `finishBattleNode`，`loseFight` 照抄 `runtime.js` 的真实实现
（`if (B.over) return` 闸门 + `endRun(false)` → 真实 `endRunProgress`）。
harness 的 `nextBattle()` 会换一个全新 B 对象和一个新节点，模拟真实
`startFight` + `advance`，用来证明「换战斗不重置」。

覆盖：`createRun` 初始化且不泄漏到下一局、B 上不再有 ghost 字段、
同 run 第二场必须付 50、第二场低血必须**真实战败**（不是被拒绝）、重复持有
影分身不重置、没影分身不受影响、两局 run 额度独立、JSON 快照往返保留布尔、
缺字段按未用处理、BOSS 免费撤退仍是 `boss-loss` 不 win、连点只消耗一次、
免费撤退不记掌握/通关、UI 四种状态文案 + 图鉴口径。

新增 `tests/e2e/ghost.spec.js`（8 条，真实 Chrome，只跑 new 目标）：
第一场免费→第二场付 50、第二场低血是真实失败远征（`B.myHp === 0`、
楼层不变、`wins === 0`）、重复拿影分身按钮仍是普通跳过、
`#oAgain` 重开后 `ghostUsed === false` 且新一局能免费一次但也只有一次、
连点只消耗一次、BOSS 用影分身仍是「远征结束」、按钮 tooltip 与图鉴文案。

### 真实运行结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --test tests/unit/ghost.test.js`（实现前 RED） | 1 | 20 tests / **15 fail** / 5 pass |
| `node --test tests/unit/ghost.test.js`（实现后） | **0** | 20 tests / 20 pass / 0 fail |
| `node --test tests/unit/*.test.js`（全 unit，无管道） | **0** | 205 tests / 205 pass / 0 fail（基线 182 + 新增 23） |
| `playwright test tests/e2e/ghost.spec.js` | **0** | 8 passed（new）+ 8 skipped（legacy） |
| `playwright test`（全套 8 个 spec，无管道） | **0** | **57 passed / 0 failed** / 23 skipped |

> ⚠️ **不要用 `| tail` 之类管道判定通过**：管道的退出码是 `tail` 的，不是
> playwright 的，会把 failed 报成 exit 0。本轮所有结论都用
> `...; echo EXIT=$?` 直接取真实退出码。

### 一次「失败」的排查记录（非本任务缺陷）

第一次跑「既有 7 个 spec」的全套时，`baseline.spec.js:3`（存档重载测试）
报了 1 个 failed。排查结论：**是验证过程自身的错误，不是产品缺陷**。

时间线说明了原因：那套 E2E 是在后台跑的，而我在它**还在跑的时候**执行了
突变脚本 —— 突变脚本会**原地反复改写** `src/app/combat.js`、`fight.js`、
`run.js`（共 7 次）。Vite dev server 是 `reuseExistingServer`，会把这些
中间态代码喂给正在跑的浏览器，于是那一次套件测的是临时状态。

复核证据（都在突变脚本删除、源码稳定之后）：

| 复跑 | 结果 |
|---|---|
| `baseline.spec.js --project=new` 单跑 | 5 passed |
| `baseline.spec.js --project=new --repeat-each=6` | **30 passed**（该文件 ×6） |
| 既有 7 个 spec 全套（相同命令，第二次） | 49 passed / **0 failed** |
| **全套 8 个 spec（含 ghost.spec.js）** | **57 passed / 0 failed** |

即：同一测试在隔离下连续 30 次全绿、全套下连续 3 次全绿；失败不可复现，
且失败的那一次恰好覆盖了源码被并发改写的窗口。

**顺带确认不是我的改动**：`git worktree add` 拉了 pristine `8566a62` 到
独立目录（独立端口 4174）跑同一套 7 个 spec —— 49 passed / 0 failed。
（该临时 worktree 与其中的 `playwright.config.js` 端口改动已删除。）

**顺带发现的既有脆弱点**（未改，不在本任务范围）：`baseline.spec.js:24` 在
`page.reload()` 之后断言整个存档对象，其中 `runs: 12 → 13` 依赖「reload 前
那一轮已计数且不再重复计数」。这条断言对时序敏感，建议整合者考虑给它加
显式等待或把它拆成更小的断言。

### 突变验证（证明测试真的加载了被改的代码）

一次跑完 6 个突变 + 还原（脚本用内存里的原文写回，跑完已删除），退出码 **0**：

| 突变 | fail 数 | 结果 |
|---|---|---|
| A 额度退回 battle 级（`!B.ghostUsed`） | 14 | CAUGHT |
| B 用完后恢复「拒绝」（旧语义） | 8 | CAUGHT |
| C 重复持有影分身也恢复额度 | 8 | CAUGHT |
| D UI 读 `B.ghostUsed`（换战斗后又变免费） | 3 | CAUGHT |
| E 免费撤退不置 `B.over`（连点重复结算） | 1 | CAUGHT |
| F `createRun` 不初始化额度（跨局泄漏） | 2 | CAUGHT |
| baseline（无突变） | **0** | 符合预期 |

### 同步更新的既有测试（有意差异）

| 文件 | 改动 |
|---|---|
| `tests/unit/controllers.test.js` | 旧测试固定了「每场一次 + 已用完则拒绝」，改为 run 级语义；战斗 fixture 删除 `ghostUsed` 字段；新增「新开一轮恢复额度」一条 |
| `tests/unit/skip-cost.test.js` | 两条影分身旧路径改为新口径：免费仍免费；「已用完 → 拒绝」改为「已用完 → 付 50」（这正是任务 3 的核心语义变化）；新增「已用完 + 血不够 → 仍战败」 |
| `tests/unit/ui-modules.test.js` | 跳过按钮对照改为新文案 + tooltip（归一化后仍与旧版逐字相同）；标签测试改读 run 上的 `ghostUsed`，新增「重复持有不恢复」断言 |
| `tests/unit/extraction.test.js` | `RELICS` 从「逐字等同」清单里移出（影分图文案有意改），改为**精确偏离断言**：只有 ghost 一条漂移，数量/顺序/id 全等 |
| `tests/e2e/game-harness.js` | `state()` 探针增加 `G.ghostUsed` 与 `G.relics`（只加读，不改业务） |

内置 259 词库未改（`check:data` 仍全绿）。

## 未验证 / 剩余风险

- **没有跑 iPhone/安卓真机**：跳过按钮小字从「免费撤退」变成
  「免费撤退 · 本轮仅剩 1 次」（长了 9 个字符），`layout.spec.js` 在
  320/390 视口无溢出，但真机浏览器工具栏高度与安全区未实测。
- **tooltip 只在有 title 的设备上可见**：iOS Safari 长按才显示。已用完时的
  「影分身本轮已用完」目前只靠 tooltip 传达，按钮小字只写「损失 50 生命」——
  和没有影分身时一致。这是刻意的（按钮宽度有限），但**移动端玩家可能看不到**
  「已用完」这个解释，只能从「按钮不再是影分身」推断。若要更明确，可考虑
  在战斗页加一条 notice；本轮未做。
- **`ghostUsed` 不随 `relics` 走**：如果将来支持「出售/丢弃遗物」返还额度，
  当前实现不会退还（也没有这个功能）。语义上「每轮一次」本就与持有状态无关，
  但这是一个尚未表态的边界。
- **`endRun(false)` 在 E2E 里被直接调用**：只是用来快速回到可重开状态
  （真实路径是跳过 BOSS 后的失败结算，同样走 `endRun(false)`），
  不是绕过被测逻辑；「跳过 BOSS 仍失败」本身另有独立一条测试覆盖。
- **离线单文件导出（`dist/index.html`）未验证**：本轮没跑 `npm run build` /
  `test:build` / `test:release`（改动不涉及构建配置），整合者的全套
  `check` 会覆盖。