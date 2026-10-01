# 单元解锁主线（任务 7）

> 状态：**已实施**，测试见 `tests/unit/campaign.test.js`、`tests/unit/campaign-ui.test.js`、
> `tests/e2e/campaign.spec.js`。真实 iPhone / 安卓实机未验证。

## 一句话

把「零散独立远征」改成「连续学习轮次」：**只有本单元目标词全部完整拼对，才解锁下一单元**；
跨单元时金币、道具、遗物、角色和已耗尽的额度全部保留，`DB.runs` 不加。

## 三条不能破的口径

1. **解锁只看词汇，不看战绩。** 判据只有一条：本单元全部目标词的身份（`trim` + `lowerCase`）
   都出现在 `DB.mastered` 里。历史 `wins` / `best` / 纪念卡 / 部分词**都不是**证据。
2. **迁移保守且连续。** 旧存档按 `mastered` 覆盖推导：Unit N 解锁要求 Unit 1..N-1 全部完成。
   学完 Unit 3 但没学完 Unit 2 时，Unit 3 仍锁着；绝不因为「玩过很多次」一次性授予全册。
   已解锁的单元随时可以复习（复习 = 新开一轮，不推进解锁）。
3. **自定义词表（单元 0）永远可玩**，但从不参与教材解锁，也永远没有「下一单元」。

## BOSS 与词汇完成是两个独立事实

| 事实 | 由什么驱动 | 后果 |
|---|---|---|
| 击败 BOSS | 整词打空 + 授权闸门 | `DB.wins` +1（**每轮**最多一次）、纪念卡、+30 回血 |
| 击败**本段** BOSS | 同上 +「本段尚未结算」 | 本段的 +30 回血、标记该段节点；`DB.wins` 由上一行独立判定 |
| 词汇完成 | 本单元全部目标词整词拼对 | 解锁下一单元、`DB.unitProgress[unit].complete` |
| 学习完成检查点 | 词池抽干 | **不是**通关：kills / gold / wins / 纪念卡一律不动 |

★ **段结算必须与轮通关分开记。** 同一轮学习可以连打多段（Unit 1→…→6，或同单元续段），
每段都有自己的 BOSS，都该正常回血 + 标记节点；但 `DB.wins` 全程只 +1。

- `run.clearedRun`：**整轮**有没有通关过（`DB.wins` 的唯一依据，终身只 +1）。
- `run.clearedSegment`：**当前这一段**地图的 BOSS 是否已结算。换段（跨单元过渡或同单元续段）
  归 `false`；`createRun` 初始 `false`。缺字段（老存档 / 老快照）按 `!!clearedRun` 保守回落。
- `finishBattleNode` 的守卫判据是 `clearedSegment`：`clearSegment` 为真时重复 BOSS 胜利
  仍返回 `ignored` 且**零副作用**（不回血、不结转护盾、不标记节点、不动 DB）。
  首次 BOSS 胜利在**任何副作用之前**先置 `clearedSegment = true`。
- `registerRunWin` 仍只看 `clearedRun`，所以第二个单元的 BOSS 不会二次 +1 `DB.wins`。

由此有两条互不混淆的继续路径：

- **词汇先完成** → 词汇完成检查点出现「继续 Unit N+1」（携带现有物资）。
- **BOSS 先打完但本单元还有词** → 结算屏给「继续本单元词汇」：在同一轮里换一段学习地图
  继续抽未完成的词。**绝不**提前解锁下一单元，也绝不把玩家卡住。

两条路径都不新建 run、不重发新手道具、不重跑遗物初始化、不回血、不补影分身额度、
不动 `DB.runs` / `DB.wins`、不生成第二张纪念卡（`run.reward` 幂等 + `clearedRun` 守卫）。

## 状态字段

- `DB.unitProgress[unit] = { complete, completedAt }`：只在**真实**答完时写一次（幂等）。
  旧存档没有这个字段，完成性仍由 `mastered` 覆盖推导。**绝不**顺带改任何计数。
- `run.campaign = { startedUnit, segments }`：这一轮从哪个单元开始 / 走过几段学习地图。
  **不是次数**，也不参与任何守卫。
  ★ `startedUnit` 是**纯诊断字段**：它恒等于开局单元，**不能**拿
  `startedUnit !== unit` 当「已经过渡过了」的永久守卫 —— 那会让 Unit 2→3→4 永远接不上。
  `DB.runs` 只在真正新开一轮时 +1，跨单元不加。
- `run.rewardId`（可选字符串）：本轮纪念卡的 **id**，首次生成卡时由 `endRunProgress` 写上。
  刷新 / 恢复之后内存里的 `run.reward` 可能没了，但这个 id 还在 —— 于是再次结算时会
  复用 `db.rewards` 里同 id 的那张卡，**绝不 push 第二张**。
  - 编码侧：字段缺失时从内存中的 `run.reward.id` 取；都没有则写空串（=「还没有卡」）。
  - 解码侧：可选，缺失合法；一旦出现就必须是字符串（数字 / 对象 / 布尔 = 脏值，整份 fail closed）。
    **不需要**（也不应该）序列化整个 `reward` 对象 —— 那等于允许篡改卡面数据。
  - 旧快照（既无 `rewardId` 又无 `reward`）领域层不猜、不删、不补：历史卡原样保留。

## 自定义单元（0）的进度

- `unlockProgress` 的单元列表会**排序去重**：输入顺序（`[3,1,0,1,…]`）绝不许改变连续口径。
- 单元 0 按 `wordsFor(0)` 的**真实词表**算 `total / done / remaining / complete`，
  **不再伪报 `total: 0`**；`trim + lowerCase` 身份口径与教材单元完全一致。
- 单元 0 永远 `unlocked: true`、`lockedReason: null`，但它的 `complete`
  **从不参与教材解锁**（旧的自定义词单元也不解锁任何教材单元）。`recordUnitComplete` 同理。
- `wordsFor` 缺失 / 抛错时退化成空词表：这个纯派生视图绝不能成为异常来源。

### 自定义单元的 UI 边界

`progress.next(0)` 返回的是**教材里的 Unit 2**（自定义学完不解锁教材）。
两个界面都**自己**把单元 0 挡在「下一单元」之外，否则玩家会从自己的词表跳进课本：

- 学习完成检查点：单元 0 的 `lcBtnNext` 恒隐藏、无回调。
- 结算屏：单元 0 **仍然**给「继续本单元词汇」（打完 BOSS、自己词表还有词没练完时
  玩家照样需要一条不卡死的续练入口），但绝不预告任何 `Unit N`。

## 「历史完成」与「当前掌握」是两件事

`DB.unitProgress[unit].complete` 是**永久历史成就**；`DB.mastered` 是**当前熟悉度**。
真实存档里两者会分叉（学过 → 旧词退役 / 换版 → `mastered` 44/45 但完成凭据仍在）。

主页单元按钮因此分三态，**绝不让「已全部完成」与「还剩 1」同屏并存**：

| 状态 | 文案 |
|---|---|
| 当前全掌握 | `已完成 m/total` |
| 有历史凭据但当前没全掌握 | `已完成过 · 当前掌握 m/total（可复习）` |
| 完全没开始 | `未开始` |

完成凭据仍然解锁下一单元（历史成就算数），下一单元随时可以复习。

## 段 BOSS 与 run 通关是两个事实

一轮里可以打**多次** BOSS（打完 → 续练 → 再打）。于是必须分开记账：

| 事实 | 由什么驱动 | 记在哪 |
|---|---|---|
| 「这一段的 BOSS 打完了」 | 本段第一次真 BOSS 胜利 | `run.clearedSegment`（段级） |
| 「这一轮通关过」 | 本轮第一次真 BOSS 胜利 | `run.clearedRun` + `DB.wins`（run 级） |
| 「这一轮拿到过纪念卡」 | 本轮第一次结算 | `run.rewardId` + `db.rewards` |

- 换段（跨单元或续练同一单元）把 `clearedSegment` 复位为 `false`，**`clearedRun` 不复位**。
- **同一段内**再来一个 distinct BOSS 战斗对象 → 依旧 `ignored`（不重复回血、不重复标记节点）。
- 换段之后的新 BOSS → 正常 `boss-win`（回血 +30、标记节点、进入结算），
  但 `DB.wins` 全程**只 +1**、`db.rewards` 全程**只 1 张**。
- 逃跑 / 战败**不算**段 BOSS 结算：`clearedSegment` 保持 `false`，这一段还能再打赢。
- 旧内存态 / 旧快照缺 `clearedSegment` 时按 `!!clearedRun` 保守回落 ——
  「宁可当成已结算、也不重复结算」。

## 跨单元过渡的幂等

`applyUnitTransition(run, facts, { words, random, progress })` 的入口校验是过渡幂等的**唯一**依据：

- `facts.ok === true`，且 `facts.from === run.unit` —— 事实必须是从**当前**单元算出来的。
  过期事实（迟到回调、双击、恢复后重放）返回 `null`，且**零副作用**：不换地图、不加段、
  不改单元、不换词池（地图对象身份不变，玩家位置不丢）。
- `facts.to` 必须是合法教材下一单元：正整数、不是自定义单元 0、不是 `facts.from` 自己；
  调用方给了 `progress` 时还必须满足 `progress.next(facts.from) === facts.to`（不许跳单元）。
- 应用成功时 `segments` 恰好 +1，`startedUnit` 与 `run.id` 不变，资源全部继承。

## 快照与恢复

`run.campaign`、`run.clearedSegment`、`run.rewardId` 都进入版本化快照（`schemaVersion: 1` 的
**可选**字段）。旧快照缺这些字段时分别按 `run.unit` / `!!clearedRun` / 无卡 保守回落；
脏值（`clearedSegment` 非布尔、`rewardId` 非字符串）则整份 fail closed ——
宁可明确「不能恢复」，也不让半恢复的 run 去结算 BOSS 或发纪念卡。
**绝不**把玩家正在进行的一局判成损坏。

跨单元过渡时 `lifecycle.resetBattle()` 作废上一场的迟到回调，并立刻提交一次快照：
刷新后恢复的仍是同一轮、同一单元、同一份物资。

## 闸门在哪

三层，缺一不可：

- **主页显示层**：锁住的单元画出来、写清要完成哪个单元，并且**不挂 `onclick`** ——
  不是「灰着还能点」。
- **运行时入口层**：`runtime.newRun()` 用 `canSelectUnit` 真正拒绝。绕过 UI（探针 /
  将来的恢复流程）也过不了这一关。
- **来源相位层（应用层）**：`nextUnit()` / `continueUnit()` 先问
  `campaignSourceRefusal(kind)`，只认两个来源：
  - `nextUnit` —— 词汇完成检查点（`PHASE.LEARNING_COMPLETE`），
    或一局**已成功结算**的 BOSS（`run.result === true`）；
  - `continueUnit` —— 一局**已成功结算**的 BOSS（`run.result === true`）且同单元还有词可练。

  领域层已经不再用 `startedUnit` 当永久守卫（那会让 Unit 3→4 永远接不上），
  于是「玩家此刻站在哪一屏」只能由应用层回答。缺了这一层，最坏的一档存档
  （259 个词全部记为已掌握）在**普通地图上连点三次**就能 1→2→3→4 一路跳过去 ——
  每一跳在领域层都合法。实测已由 `tests/e2e/campaign.spec.js` 的
  「historically all-mastered save cannot skip units through a triple click」钉住。

  幂等由**来源状态**保证，不靠时间窗：两个动作都会把相位换成 `MAP`、
  把 `run.result` 退回 `undefined`，所以第二次、第三次连点在这里就被拒。
  后台恢复路径（`rebuildFromPhase`）根本不调这两个动作，定时器与
  `visibilitychange` 更碰不到它们 —— **已结算的一局只可能被明确的用户按钮复活**。

- 领域层的 `facts.from === run.unit` 校验在应用层**再判一次**，且判在
  `carryLiveHp()` / `recordUnitComplete()` 之前：被拒的过渡必须**零副作用**。
  先结转血量再发现 `applyUnitTransition` 返回 `null`，等于用 stale `run.hp`
  覆盖真实战况。反过来，成功之后才结转血量与写完成凭据。

- 两个继续动作都走 `progress` 的闸门与事务边界：暂停期间无效，动作结束立即提交
  （解锁事实与快照同一次写入）。

### 定位契约：靠 `data-unit`，不靠文本

单元按钮带 `data-unit="N"`（`1..6` 与自定义 `0`）。脚本与测试按它定位，
**不按按钮文本**：锁说明里本来就写着「完成 Unit N 全部词汇后解锁」，
按 `'Unit N '` 过滤会同时命中该按钮与别的单元的锁说明，strict mode 直接报多元素。

早期实现为了绕开这一点把编号从可见文案里拿掉（「完成上一单元全部词汇后解锁」）——
那是靠躲测试而不是靠结构，单元名与编号现在照常可见。

## 明确不做 / 未做

- 不改 `data/books`、数值、角色、道具、音效与布局。
- 「继续」是结算屏上的**显式用户动作**把这一轮退回 active（并立刻重建快照）；
  复活路径（ENDING 相位）完全不经过这里，背景计时器不会复活已结算的一局。
- 轮次纪念卡与「解锁的单词越多越强」（清单 8、9）不在本项内。
- 战败不给任何继续入口：逃跑/战败不推进学习主线。