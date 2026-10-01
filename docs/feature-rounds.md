# 轮次纪念卡（任务 8）

> 状态：**已实施**。测试：`tests/unit/round-cards.test.js`、`tests/unit/round-snapshot.test.js`、
> `tests/unit/rounds-runtime.test.js`、`tests/unit/reward-card-round.test.js`、
> `tests/e2e/round-cards.spec.js`。真实 iPhone / 安卓实机未验证。

## 一句话

给通关纪念卡一个**真实的轮次身份**（这是第几次远征）、一份**真实的本轮完成范围**
（这一轮真的把哪些单元的词整词拼完了），并让旧卡老实说「旧版记录」而不是被编一个编号。

## 四条不能破的口径

1. **轮次编号只有一个来源**：真正新开一轮时 `registerRunStart` 成功 `DB.runs += 1`，
   **之后**取 `db.runs` 写进 `run.roundNumber`。
   - 绝不按 `db.rewards.length` / `db.wins` / 地图数猜；
   - **绝不从旧恢复补填**：`restored=true` 的登记路径直接 return，不碰编号；
   - `countedStart` 是幂等闸门：同轮重复登记、刷新恢复、跨段都碰不到那一行，
     所以同轮内编号固定。
2. **`roundId` 与 `run.id` 是两回事**。`run.id`（`'R1'`、`'R2'`…）是进程内自增的**诊断标识**，
   刷新后 `RUN_SEQ` 归零就会重复；`roundId` 是持久身份，由 runtime 用
   `crypto.randomUUID()` 生成（`src/app/rounds.js` 的 `newRoundId`，无 crypto 时退回
   时间戳+随机串），domain 的 `assignRoundId` 只接收显式事实，**脏值（数字/空串/对象）一律拒绝**。
   Unit 1→6 一路跨单元时 `roundId` 与 `roundNumber` 都不变（同一轮）。
3. **完成范围只认「本轮整词完成」的证据**。`run.completedUnits` 由
   `recordRoundUnitComplete(run, unit)` 写入，调用方只有两条真实路径：
   `showLearningComplete()`（词池抽干）与 `nextUnit()` 成功过渡。
   到过某个单元、打过 BOSS、跳过节点、半词、战败、撤退**都不写**。
   - 单元号必须落在**本轮范围**内（`roundScopeUnits`）：从 Unit 3 开局的这一轮范围是
     `[3,4,5,6]`，`recordRoundUnitComplete(run, 1)` 返回 `false`，绝不谎报 Unit 1/2。
   - 历史存档里 Unit 1..6 的词全在 `mastered` 里，**一开地图不会**自动记成本轮完成。
4. **一轮最多一张卡，内容只更新不复制**。`rewardId` 跨刷新复用同一张卡；
   先打 BOSS 后学完范围、或先学完词后打 BOSS，都落回同一张卡：
   `id` 与 `earnedAt` 固定，`completedUnits` / `roundComplete` / 统计按**同一轮**的最新
   真实事实更新。战败 / 撤退不发卡，也不会弄丢以前已获的卡。

## 卡上必须分清的三件事

| 行 | 内容 | 依据 |
|---|---|---|
| `.reward-round` | `第 N 轮` 或 `旧版记录 · 未记录轮次` | `card.roundNumber` |
| `.reward-done` | `本轮完成单元：Unit 3 成长与发现` | `card.completedUnits` |
| `.reward-complete` | `本轮学习范围已完成` / `本轮学习范围未完成` | `card.roundComplete` |

- 「击败最终 BOSS」是**卡存在的原因**，与「完成单元」「范围完成」是三个独立事实，
  不能揉成一句「全册已掌握」。
- 范围完成的名义口径是「本轮学习范围已完成」—— 从 Unit 3 开局的这一轮范围只有 3..6，
  说「全册」就是虚报。自定义词表轮（单元 0）范围就是 `[0]`，卡上自称「我的词表」，
  **不预告任何教材单元**。
- 旧卡没有 `roundNumber` → `旧版记录 · 未记录轮次`；缺少完成范围字段时显示「未记录完成范围」。
  未记录不是未完成，不推断旧轮次的完成范围或编号。
- `recordRoundUnitComplete` 必须用 `run.done` 覆盖该单元的非空词池；历史 `mastered` 只用于解锁。
  跨单元在换池前捕获 `fromPool`，合法过渡后再验证本轮完成，不借历史记录虚报。
- 学习完成、合法跨单元以及主动结束学习前，`syncRoundCard(run,db)` 即时同步已存在的卡。
  同步不新建卡、不结算、不改计数、统计、卡号或获得时间，与学习进度同次落盘。

## 快照（schemaVersion: 1 的可选字段）

`run.roundId` / `run.roundNumber` / `run.completedUnits` 都进快照，三者**可选**：

- 旧快照完全没有这三个键是**合法**的，解码后分别是 `undefined` / `undefined` / `[]`，
  **绝不**按 `DB.runs` 或卡片数量补一个编号出来。
- 编码侧的「没有」表示：`roundId: ''`、`roundNumber: 0`（真实编号从 1 开始）、
  `completedUnits: []` —— 与既有的 `rewardId: ''` 同一套约定。
- 脏值整份 **fail closed**：`roundId` 非字符串、`roundNumber` 非非负整数、
  `completedUnits` 非数组或含 `0..6` 之外的单元号 → `invalid`，上层照常显示「不能恢复」。
  宁可明确不能恢复，也不让半恢复的 run 去结算 BOSS 或发纪念卡；**绝不**把正在进行
  的一局判成损坏，更不白屏。
- 编码侧对 `completedUnits` 去重 + 排序，跨刷新顺序不漂移。

## 明确不做 / 未做

- 不改 `data/books`、战斗数值、角色、道具、音效与布局；不改版本、CI、package。
- 轮次**编号**不由 UI 计算、不由存档回推：只有 `registerRunStart` 那一行。
- 「解锁的单词越多越强」是清单 9，不在本项内。
- 真实 iPhone / 安卓实机未验证。
