# 跳过代价：固定 50 点生命

对应 `docs/product-backlog.md` 任务 A.2（"跳过过强"）。本文只记录**跳过代价**，
不含影分身跨轮限制（任务 3）、整词击杀（任务 4）。

## 语义（唯一口径）

| 情况 | 生命 | 结算 | 明确不做的事 |
|---|---|---|---|
| 有影分身且本场未用 | 不变 | `finishNode` → 正常推进 | 不扣血、不记失败（**保持旧逻辑**，免费额度仍是每场一次，任务 3 才改） |
| 影分身本场已用完 | 不变 | 拒绝（`skipFight()` 返回 `false`） | 不退化成普通跳过（**保持旧逻辑**） |
| 普通跳过，HP > 50 | `B.myHp -= 50` | `finishNode` → 普通/精英 `'advance'`、BOSS `'boss-loss'` | 不计击杀、不给掌握、不算通关 |
| 普通跳过，HP ≤ 50 | `B.myHp = 0` | `loseFight` → `endRun(false)` | **不** `finishNode`、**不** clamp 保底、无击杀/通关/纪念卡 |

`SKIP_HP_COST = 50` 是**固定点数**，不是本场生命的百分比，也**不是** 50%。

## 为什么是固定点数而不是百分比

用户原话"扣血更多，比如 50"是**候选方案，不等同 50%**。本阶段按固定 50 点生命
实现（已向用户说明本阶段口径是 50 点生命，不是百分比）。

百分比在低血时会退化成"扣一点点还能苟住"：20% 血时跳过只掉 4 点，玩家可以反复
撤退而几乎不承担风险，"跳过"就成了比认真打完更优的策略 —— 这正是原 bug 的形状。
固定 50 让低血撤退成为一次真实决策：付得起就撤，付不起就战败。

`src/data/balance.js` 是这个数的**唯一来源**，`combat.js`（结算）与 `fight.js`
（按钮文案）都从它读，改一处即两处同步。

## 代价不走受击管线

`skipFight` 直接改 `B.myHp`，**不**走 `hurtPlayer`。因此：

- 护盾不代付（`B.shield` 原样保留，护盾跨战斗保留的语义不变）
- 幸运草（`lethUsed` 首次答错免伤）不减免跳过代价，也不被跳过消耗
- 没有 `flash` / `animHero` / 浮字等受击表现 —— 跳过不是被打

扣的是 `B.myHp` 而不是 `G.hhp`：`G.hhp` 会被 `finishNode` 的结转覆盖掉。

## 死亡路径为什么必须调 `loseFight` 而不是 `finishNode`

两个陷阱，都在真实代码里验证过：

1. **`loseFight` 开头是 `if (B.over) return`**（`src/app/runtime.js`）。
   所以死亡分支里**绝不能先置 `B.over = true` 再调它** —— 那样它会直接返回，
   战斗永远不结算失败，玩家卡在"血 0 但还能操作"的死局。
   正确顺序是：置 `myHp = 0` → `loseFight()`（由它自己置 `over` 并安排
   `setTimeout(() => endRun(false), 800)`）。
2. **`finishBattleNode` 会 `run.hp = clamp(battle.myHp, 1, run.maxhp)`**。
   死亡分支若走 `finishNode`，0 血会被救成 1 血并继续推进下一层 —— 这就是
   "跳过永远不会输"的旧行为。

死亡分支因此**不调** `finishNode`：节点不标记 `done`、远征生命不结转、
`G.result = false`、无纪念卡。

## BOSS 不借跳过通关

BOSS 跳过即使血够，也只走 `finishBattleNode` 的 `battle.boss && !battle.won`
分支 → `'boss-loss'` → `endRun(false)`。`DB.wins` 不动（`registerRunWin` 只在
`boss-win` 路径被调用），不发纪念卡。血不够时直接走死亡路径，同样是失败。

## 文案

- `index.html`：`<small>不掉血</small>` → `<small>损失 50 生命</small>`
  （旧文案"不掉血"与 40% 的实际行为都不准确）
- `fight.js`：`renderFight` 改用 `innerHTML` 写按钮（`textContent` 会抹掉
  `<small>` 里的代价说明）：影分身可用 → `影分身 / 免费撤退`，
  否则 → `跳过 / 损失 50 生命`
- `combat.js`：toast 分别说"损失 50 点生命"和"生命耗尽（-50），远征失败"

## 测试

新增 `tests/unit/skip-cost.test.js`（15 条）。它**不复用**纯计数桩：
`finishNode` 走真实 `finishBattleNode`，`loseFight` 照抄 `runtime.js` 的真实实现
（`if (B.over) return` 闸门 + 800ms 后 `endRun(false)` → 真实 `endRunProgress`），
所以"先置 over 导致战斗不结束"这类接线错误会被真的抓住。

覆盖：HP 60→10 / 100→50（固定而非比例）、HP 50→0 战败、HP 20→0 无推进、
连点不重复扣血或重复结算、护盾不代付、幸运草不免伤、6 种遗物都不改变代价、
精英照常推进、BOSS 血够 `boss-loss` 不计通关、BOSS 血不足死亡、
迟到胜利回调不补通关、影分身两条旧路径不变。

新增 `tests/e2e/skip-cost.spec.js`（5 条，真实 Chrome）：
70 血跳过 → `G.hp === 20`（不是 42）且 `floor === 2`；50 血跳过 → `s-over`
「远征结束」且 `B.myHp === 0`；10 血跳过 → 楼层不变、`kills === 0`、
`mastered === []`；连点 → 只结算一次；按钮文案含 50 且不含"不掉血"。

### 真实运行结果

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --test tests/unit/skip-cost.test.js`（修复前） | **1** | 15 tests / **12 fail**（影分身两条旧路径本就正确，符合预期） |
| `node --test tests/unit/skip-cost.test.js`（修复后） | **0** | 15 tests / 15 pass / 0 fail |
| `node --test tests/unit/*.test.js`（修复后，全 unit） | **0** | 182 tests / 182 pass / 0 fail（基线 167 + 新增 15） |
| `playwright test tests/e2e/skip-cost.spec.js`（修复后） | **0** | 5 passed（new）+ 5 skipped（legacy） |
| `playwright test tests/e2e/baseline+progression+counting.spec.js` | **0** | 26 passed（含既有"跳过 BOSS 是失败远征"两条） |
| `playwright test tests/e2e/layout.spec.js` | **0** | 6 passed（按钮多了 `<small>` 一行，320/390 视口无溢出） |

### 突变验证（证明测试真的加载了被改的代码）

一次跑完 4 个突变 + 还原，脚本用内存里的原始内容写回保证还原，退出码 **0**：

| 突变 | 观察值 | 结果 |
|---|---|---|
| A 恢复 `Math.max(1, ...)` 保底 | fail=4 | CAUGHT |
| B 恢复扣本场 40% | fail=12 | CAUGHT |
| C 死亡前先置 `B.over`（`loseFight` 闸门吞掉结算） | fail=3 | CAUGHT |
| D 死亡改走 `finishNode`（clamp 1 让人永生） | fail=4 | CAUGHT |

### 同步更新的既有测试（有意文字/行为差异）

| 文件 | 改动 |
|---|---|
| `tests/unit/controllers.test.js` | 旧 `40%` 断言改为固定 50：起始血 80（50 血场上固定 50 会直接战败） |
| `tests/unit/extraction.test.js` | DOM 骨架对照增加一处**有意**文字差异（跳过按钮小字），偏离面精确到该正则，其余骨架仍逐字相同 |
| `tests/unit/ui-modules.test.js` | 跳过按钮旧版逐字对照改为：其余 id 仍全量对照 `tSkip`，`tSkip` 只比对"属性/尺寸行为相同 + 只多出免费撤退小字"；标签测试改为断言新文案 |

## 未验证 / 剩余风险

- **没有跑 iPhone/安卓真机**：按钮多了一行 8.5–9.5px 小字，320/390 视口 E2E 无溢出，
  但真机浏览器工具栏高度与安全区未实测。
- **固定 50 是否与各角色生命上限平衡未做数值联调**：生命上限 70±（学者 -10、
  战士 +15 等），意味着学者开局跳过一次约损失 83.3%、战士约 58.8%。
  与任务 11（角色平衡）、任务 10（难度曲线）需要一起联调，本轮未做。
- **`SKIP_HP_COST` 未接入难度/平衡配置体系**：目前是 `src/data/balance.js` 里
  的裸常量，没有和敌人强度、层数缩放联动。后续要调平衡时改这一处即可，
  但它暂时不是"按层数缩放"的机制。
- **影分身仍是每场一次**：任务 A.3 要求改成每轮远征仅一次且跨暂停保存。
  本轮**刻意未动**（`hasR('ghost') && !B.ghostUsed` 与"已用完则拒绝"两条路径原样保留），
  并在单测里固定了这两条旧行为，避免任务 3 找不到基线。
- **离线单文件导出（`dist/index.html`）未验证**：本轮没跑 `npm run build` /
  `test:build` / `test:release`（改动不涉及构建配置），父亲的全套 `check` 会覆盖。
- **`G.hp` 在死亡路径不结转**：`finishBattleNode` 没跑，所以远征状态里的
  `G.hp` 仍是战前值。这在失败结算后不影响任何显示（已 `endRun(false)`），
  但若将来做"从失败画面恢复远征"（任务 5），需要显式决定死亡时的血量语义。
