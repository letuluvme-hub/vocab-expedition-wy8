# 单词尽量不重复 + 词池穷尽检查点

对应 `docs/product-backlog.md` 清单第 6 项。范围只有一条功能：
**本轮已完成的词不再作为候选；词池抽干时给一个诚实的检查点，而不是伪造战斗通关。**

「下一单元的解锁与继承」是清单第 7 项，本功能**不实现**，也不在界面上预告。

## 抽词规则（`src/domain/word-selection.js`）

`drawWord(run, battle, budget, random)` 仍是纯函数，签名与职责不变：只读 run 与 battle，
返回**一个词条或 `null`**，不改任何状态。

| 规则 | 说明 |
|---|---|
| 已完成的词绝不返回 | `run.done` 里的词即使只剩 1、2 个候选也排除。**小词池不回灌整池。** |
| 词条身份 = `trim` + `lowerCase` | `CAT` / `cat` / `' Cat '` 是同一个词，共用一条退休记录。**绝不用 `norm()`**。 |
| 空格/连字符/撇号不是身份的一部分 | `ice cream`、`icecream`、`ice-cream` 是**三个**独立目标，各练一次。 |
| 同一身份只留首项 | 同身份重复词条只有第一条是候选。不改源词库、不删 `DB.custom`。 |
| 重复字母 ≠ 重复词条 | `banana`、`keep an eye on` 各是一个词条，照常出题。 |
| 错词适量优先 | 复用旧配额 `min(n, 1+floor(n/2))`：错词最多占一半，fresh 至少留一半（不 fresh 饿死）。 |
| 错词队列去重 | 同一身份只算一次，且必须仍是**未完成**词。 |
| 避免立刻重复 | **先**从候选里剔除上一词，**再**按难度分池（顺序反了会让「唯一另一个候选在别的难度档」时认命重复）。 |
| 单候选允许再出现 | 只剩上一个词时保留它 —— 「尽量」不是「跳过未完成词」。 |
| 穷尽返回 `null` | 不是 `undefined`。`run.done` **绝不重置**，词池不清空。 |

### 身份口径为什么是 `trim` + `lowerCase`

`pendingWords` 与 `learningCounts` 共用同一个派生（`uniquePool` + `doneKeys`），
所以 `remaining === pendingWords(run).length` **恒成立**，不是两条独立算出来的巧合。

两个曾经真实分叉的 bug，都出在「比较口径」上：

- **`seen` 登记晚于 `done` 检查**：`pool=[CAT, cat]`、`done={CAT}` 时，`cat` 既不在
  `done` 里、又还没被 `seen` 登记，于是被当成新候选吐出来；而计数那边已经说
  「已完成 1/1、剩 0」。现在 `seen` 先登记，同身份只留第一条。
- **`norm()` 剥掉所有非字母**：`ice cream` 与 `ice-cream` 折叠成同一个 key，
  三个不同的词被吞成一个，短语词再也练不到。比较只用 `trim` + `lowerCase`。

`run.done` 仍以**原始字符串**记账（`Array.from(run.done, keyOf)` 只在比较时归一），
`run.pool` 的词条内容与顺序、`DB.mastered` 一个字节都不改 —— 全是纯派生。

难度口径（`exact → harder → softer`，不足 3 个才放宽）与随机源消费方式保持不变，
所以候选足够大时抽词结果与旧实现逐字一致 —— 见 `tests/unit/selection.test.js`
里保留的 legacy 参照实现与分叉清单。

### 纯派生工具

- `pendingWords(run)`：仍可出题的词（排除 done + 英文去重）。
- `isPoolComplete(run)`：本单元词汇是否已全部完成。
- `learningCounts(run)`：`{total, done, remaining, wrong}`，供 UI 如实报进度。

三个都不新增 run 字段，所以恢复时从 `done` 一算就得到同一结论。

## 检查点：`PHASE.LEARNING_COMPLETE`

`startFight` 与 `nextWord` 抽不到词时**统一**走这个检查点（`showLearningComplete()`）。

它是一个**检查点**，不是结算：

- `kills` / `gold` / `wins` / `DB.mastered` 一个都不动；
- 绝不调 `winFight`、绝不调 `endRun(true)`；
- `B.myHp` / `B.shield` / `B.enHp` 与 run 状态如实保留并写进快照
  （「怪物还剩多少血」是必须说出的事实，不能刷新后凭空重算）；
- `run.result` 仍是 `undefined`，快照照常存在 → 玩家刷新回来还是这个检查点。

存档形状：`phase: 'learning-complete'` + **必须**带 `battle`、不带 `encounter`。
少带 battle 会被 codec 判 invalid（fail closed）；`run.done` 其实没答完时
progress 恢复会退回真实相位，不许凭空显示「已全部完成」。

### 界面（`#s-learning-complete`）

标题「本单元词汇已全部完成」+ 计数 + 怪物状态 + 两个按钮：

- **保存并返回主页** = `progress.returnToTitle()`：保留这一局，进度留档，随时能继续。
- **结束本轮学习** = `progress.abandonRun()`：主动收手。刻意**不走** `endRun(false)`
  —— 那是战败结算，会给玩家盖上「失败」标签，而她明明是自己结束的。

文案红线：这个屏可以明说「本轮不算通关」「词汇完成不等于击败首领」，
但绝不许出现肯定式的通关/解锁/击败字样。最后一词真的打死怪时，
`combat` 的整词分支先判 `lethal` 并走既有胜利奖励，不会走到这个屏；
「领奖后推进」也会到达这里（那时 `enHp<=0`），文案据真实血量二选一，
不反过来说「它还没被打倒」。

产品文案里**不放开发说明**。旧的「（下一单元的衔接是之后的功能，这里不会替你
解锁任何东西。）」已删除：那是写给开发者的，对玩家没有意义。现在这一屏只讲
玩家现在能做的两件事（保存进度返回主页 / 结束本轮学习）以及「词汇完成不等于
击败首领」。

「结束本轮学习」的 tooltip 必须与**实际行为**一致：它走 `progress.abandonRun()`，
丢掉这一局但**不做战败结算**。所以 tooltip 写「结束 + 已掌握的词与记录会保留，
不算战败」，**不写「结算」** —— 那是战败结算才有的语义。

下一单元的衔接留给清单第 7 项：这里只说「本单元完成」，不预告解锁。

## 顺带修的一个存档编解码 bug

`validBattle` 的战斗词引用校验原本是 `pool.filter(w => w.w === b.word.w).length !== 1`
→ 整份快照 fail closed。玩家把同一行 `cat 猫` 导入两次就会得到两条 `w/u/d/z` 全同的
词条，于是**自定义单元的每一次暂停/保存/刷新都报「存档损坏」**（与本功能无关，
但重复条目是小词池场景必然撞上的）。

现在判据是「**至少有一条**精确匹配，且战斗词的 `w/u/d/z/th` 与**第一条**精确匹配
词条一致」。抽词侧对同身份重复条目只出第一条，所以引用校验也只认第一条 ——
不删 `DB.custom` / `run.pool` 的任何一条，不接受任何字段的「近似匹配」，
词池外的词仍然拒绝。

## 覆盖

- `tests/unit/word-queue.test.js`：小池不回灌、穷尽返回 null、重复词条/重复字母、
  错词去重、单候选允许再出现、500 个种子跑完整轮每词恰好一次、进度计数，
  以及身份口径三条（大小写变体退休、`remaining === pendingWords.length` 恒等、
  空格/连字符独立成词、上一词跨难度档也要避开）。
- `tests/unit/snapshot.test.js`：重复自定义词条的战斗快照仍可往返（只认第一条），
  且 `u/d/z/th` 改一个、词池外的词都必须被拒。
- `tests/unit/learning-complete.test.js`：相位编解码往返（含缺 battle 判 invalid）、
  progress 存/恢复检查点、没答完时 fail closed、UI 文案红线（含「无开发说明」与
  abandon tooltip 不许说「结算」）。
- `tests/unit/selection.test.js`：保留 legacy 参照实现，精确列出三处有意分叉
  （小池回灌 / 穷尽给词 / 10 次认命），并断言「基线事实」确实成立，防止断言空转。
- `tests/e2e/word-queue.spec.js`：真实点击与真实打字走完一整轮 —— 一词池耗尽进检查点、
  三词跨题不重复、跳过未拼不 done 且词还会回来、错词可回顾、刷新/回主页往返保真、
  结束本轮不算战败、最后一词真致死只发一次奖励、重新进节点仍是同一检查点，
  以及重复自定义条目的真实暂停/刷新往返、`CAT`/`cat` 同一身份、
  `ice cream`/`icecream`/`ice-cream` 三个独立目标。

## 顺带修的一个 E2E 夹具 bug

`tests/e2e/game-harness.js` 的 `fight()` 原本把 `B.word` 设成 `DB.custom` 的裸条目
`{w,z}`，缺 `u`/`d`，导致**自定义单元的快照一律被判 invalid**（暂停/保存整条失效，
与本功能无关，但在小池场景里必然撞上）。改为从 `t.G.pool` 取真实词条 ——
真实战斗里的词本来就来自 `run.pool`。

## 未验证 / 已知边界

- 单元导航与下一单元解锁（清单第 7 项）未实现。
- `run.done` 仍以英文字符串记账，同一英文的重复词条共用一条退休记录；
  换成稳定 ID 属于清单第 6 项的后续部分。
- 浏览器自动化不替代 iPhone/安卓实机试听。
