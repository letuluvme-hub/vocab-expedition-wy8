# 逐轮难度递增（清单 10）

> 状态：**已接线**（本分支）。对应 backlog「10. 随轮次/关卡逐渐变难」。
> 与清单 13（怪物蓄力自主攻击）分开实施：蓄力参数本身仍是 `src/data/balance.js`
> 的固定值 `FOE_ATTACK`，本模块只回答「这一轮该把它们乘上多少」。
>
> **本文件描述的接线只在本分支成立，尚未上线。** 合并需要整合者跑完整套测试。

## 做了什么

一个纯规则模块 `src/domain/round-difficulty.js` 回答两件事：

1. **这一轮有多难** → `deriveRoundDifficulty({ roundNumber, unit, segments })`
2. **把怪物的基础数值换算成本轮数值** → `scaleFoeAttackProfile(baseProfile, difficulty)`、
   `scaleEnemyHealth(baseHp, difficulty)`

第 1 轮是基线：三个倍率恒等于 1，**逐字等于接线前的行为**。之后每档温和递增，
到 `MAX_DIFFICULTY_ROUND`（9）**永久封顶**。

接线落在四个点（`src/app/**` 与 `src/domain/run-snapshot.js`）：

| 位置 | 做什么 |
|---|---|
| `runtime.newRun` | `registerRunStart` 定下 `roundNumber` **之后**派生一次，存进 `run.difficulty` |
| `runtime.startFight` | `hpMax` 走 `scaleEnemyHealth(..., G.difficulty)`，只算一次；BOSS 的 `+40` 在**缩放之后**作为固定奖励叠加 |
| `app/foe-attacks.js` | `profile()` 走 `scaleFoeAttackProfile(foeAttackKind(B), difficulty)`；起始 `remainingMs` 用缩放后的 `cfg.idleMs` |
| `domain/run-snapshot.js` | `run.difficulty` 作为**可选**事实二向编解码，缺失 = 旧存档 |

同轮冻结由「**只在 `newRun` 派生一次**」保证：换词、换战斗、跨单元、续段、
暂停恢复都不再调用 `deriveRoundDifficulty`。

## 事实形状（固定且可序列化）

```js
deriveRoundDifficulty({ roundNumber: 1, unit: 1, segments: 1 })
// { version: 1, roundAtStart: 1,
//   hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 }
```

只有这五个键，全是数字或常量，JSON 往返逐字不变，可直接落盘。

## 曲线（温和候选值，非实机平衡结论）

| 轮次 | hpMultiplier | damageMultiplier | intervalMultiplier |
|---|---|---|---|
| 1 | 1.00 | 1.00 | 1.00 |
| 2 | 1.08 | 1.06 | 0.95 |
| 5 | 1.32 | 1.24 | 0.80 |
| 9（封顶） | 1.64 | 1.48 | 0.60 |
| 1e9 | 1.64 | 1.48 | 0.60 |

步长：血量 +8%/档、伤害 +6%/档、间隔 −5%/档，9 档封顶。
伤害斜率比血量缓是有意的：血量决定「要打几个词」，伤害决定「错几次会死」，
后者对儿童用户的容错更敏感。

**这些数值是尚未经真机对战验证的一组起点。** 接线后必须由整合者按实机手感调整；
调整时只改 `src/domain/round-difficulty.js` 顶部的 `export const`，
不要在调用点做加减。

## 学习窗口有界（最重要的约束）

用户要的是「每轮更强」，但对词汇学习产品来说，**怪物可以变快，绝不能快到不可反应**。
所以每一类「玩家需要时间思考」的窗口都有硬下限，优先于倍率生效：

| 窗口 | 含义 | 硬下限 |
|---|---|---|
| idle | 蓄力前的完整思考窗口 | ≥ 3500ms |
| telegraph | 可被有效字母尝试打断的窗口 | ≥ 3000ms |
| recover | 收招 / 被打断后的反打窗口 | ≥ 2000ms |

最高档时 boss 的 telegraph 会从 3500ms 被夹到 **3000ms**（而不是继续压到 2100ms）。
打断蓄力的机会在任何轮次都始终存在 —— 否则中译英回忆会被压成盲打，
学习主线就毁了。这是 `Math.max(floor, ...)` 而不是纯乘法的理由。

`boss / elite` 仍然强于 `normal`：同一倍率下伤害排序（8 > 6 > 4）与窗口排序
（更短）都不变，三档之间的相对关系不会被曲线抹平。

> ★ **最高档三类窗口都会撞上下限，这是已知的温和候选，不是待修的缺陷。**
> 第 9 档 interval 0.60 下，boss 的 idle/telegraph/recover 各自被
> `Math.max(floor, …)` 夹住（3500/3000/2000），也就是说封顶档之后继续打，
> 节奏不再变快，只有血量与伤害还在涨。这是刻意的：学习向产品里「无限变快」
> 比「封顶后变厚」更伤主线。**不要为此另造一条曲线** —— 真要调，只改
> `round-difficulty.js` 顶部的 `MIN_*` 与 `INTERVAL_STEP`，并由整合者按实机
> 手感确认。

### BOSS 的 +40 是缩放**之后**的固定叠加

`startFight` 里 `hpMax = scaleEnemyHealth(perWord*targetWords, G.difficulty)` 先缩放，
BOSS 再 `B.enMax += 40`。顺序反过来的话，BOSS 会随轮次额外膨胀一截
（封顶档 1.64 倍的那 40 点也跟着放大），那是没人设计过的难度。
接线单测用 `bossTotal - scaled === 40` 钉住这个不变量。

## 四条不能破的边界

### ① 只依据真实 roundNumber；unit / segments 不参与计算

`unit` 与 `segments` **只被接收**。它们绝不悄悄当成新轮编号：同轮跨单元
（Unit 1→…→6）或同单元续段，结果逐字不变 —— 玩家在同一轮里没有变强，
难度就不该悄悄涨。

轮号缺失 / `NaN` / `Infinity` / 字符串 / `0` / 负数 / **小数** 一律保守按**第 1 轮**。

> ★ **小数是脏形状，不是「四舍五入的轮号」**（本轮修掉的实质不一致之一）。
> 存档里的 `roundNumber` 必须**是整数**（`run-snapshot` 的校验就是 `isInt`），
> 所以 `3.9` 只可能来自损坏或伪造的存档。按整数部分 floor 猜一档，恰恰就是
> 「读不出来还给玩家上难度」—— 而 `readRoundNumber` 原来的注释和文档都写着
> 「小数按第 1 轮」，代码却 floor，注释与实现互相矛盾。现已统一成 fail closed。

轮号可以远超最高档（`1e9`），此时只有倍率封顶，**`roundAtStart` 逐字保留真实轮号** ——
「第几轮」是真实事实，替它改小会让存档自相矛盾。

### ② 纯规则：不碰 DOM / 存储 / 全局

不读 `window` / `localStorage` / 全局 `G·B·DB`，不写 DOM，不排定时器。
只接收显式事实，返回**全新的**普通对象：

- `scaleFoeAttackProfile` 不改 `baseProfile`（逐字节不变），返回新对象而非入参引用。
- `scaleEnemyHealth` 只接受数字，返回正整数；`NaN` / 非数 / 负数 → `1`，
  **绝不返回 NaN**（NaN 渗进生命值 = 玩家看到「NaN 点伤害」）。
- 脏 `baseProfile` 的回落值**直接取自 `FOE_ATTACK.normal`**，不抄第二份字面量。

### ③ 脏输入整体 fail closed，绝不产生「半份」难度

（本轮修掉的第二个实质不一致。）原 `readDifficulty` 的注释写着
「脏事实**整体**回落基线，而不是部分采用」，而代码实际是 `readMultiplier` **逐字段**
回落 —— 注释与实现相反。现已统一成整体 fail closed：

- 任一字段不合法 → 三个倍率**全部**回落 1（等于不缩放）。
  部分采用会让一份半坏的存档产生没人设计过的难度，也让 `999999` 倍血量
  靠一个看起来合法的 `interval` 混进存档。

### ④ 编解码二向严格，且边界与轮次事实**相容**

新增三个导出，供 `run-snapshot.js` 与接线层使用：

| 导出 | 契约 |
|---|---|
| `validateDifficultyFact(d)` | 只认「自己能派生出来的那个」形状，返回布尔 |
| `encodeDifficulty(d)` | 合法 → 全新五键对象；不合法 → `undefined` |
| `decodeDifficulty(raw)` | 同上（缺失 = `undefined`） |

`validateDifficultyFact` 除了上下界，还要求三个倍率**与该 `roundAtStart`
派生出的值逐字相符**（允许 1e-9 浮点表示误差）。只夹上下界是不够的：
一份 `roundAtStart: 1` 却带 `hpMultiplier: 1.64` 的存档仍能通过 —— 那是
「基线轮 + 最高难度」，没人设计过，也没有任何地方会自愈。

`encode` 的口径要分清两件事，它们方向相反但都成立：

- **白名单投影**：合法事实只写出那五个键，调用方挂上来的任何**未知字段会被丢掉**。
  这是有意的（存档形状由本模块说了算），丢的也只是「没人定义过含义」的多余键，
  不影响任何真实事实。
- **绝不修正数值**：白名单**不是**修正器。`roundAtStart`、三个倍率只要有一个
  非法，就整份返回 `undefined`（调用方 fail closed），绝不夹取、不四舍五入、
  不补缺、也不用合法字段去「救」非法字段。理由与上一段相同：一份脏存档被静默
  修成看起来干净的事实，比明确存不下更糟 —— 损坏就此消失且无人知晓。


## 与存档的关系

- `run.difficulty` 是**可选**字段（与 `growth` 同一处理口径）：合法才写，
  缺失时整个键都不出现。
- **旧档保旧值**：旧存档没有 `difficulty` 键时，解码后保持 `undefined`，
  调用方**按基线（倍率全 1）**还原，**绝不**按当前 `DB.runs` 或 `roundNumber`
  重算 —— 否则刷新一次就凭空给老玩家升一档。接线层用的是 `run.difficulty`
  本身，不是 `DB.runs`。
- 脏 `difficulty`（错版本 / `NaN` 倍率 / 与轮号不相容的倍率 / 非对象）
  → **整份快照 fail closed**，主页如实说「远征进度已损坏」；
  编码侧内存态自己脏了 → `encodeSnapshot` 返回 `null`（不写整份快照）。

## 测试

| 文件 | 覆盖 |
|---|---|
| `tests/unit/round-difficulty.test.js` | 纯规则：事实形状、基线、脏值、单调 + 封顶、窗口下限、三档排序、整体 fail closed、编解码二向严格、纯度 |
| `tests/unit/round-difficulty-wiring.test.js` | 接线：开局派生一次、同轮冻结、血量/蓄力档案/UI 窗口同源、BOSS +40、换词不重排、快照往返、旧档完全基线、暂停冻结 |
| `tests/e2e/round-difficulty.spec.js` | 真实 Chrome：第 1 轮逐字等于旧行为、高轮次真被缩放、轮号冻结、换战斗不重算、**真实 nextUnit/continueUnit 跨单元与续段**、刷新恢复、旧档基线、脏档 fail closed、**页面内锚点的真墙钟 8.8 秒** |

### 两条被修掉的测试假绿

| 假绿 | 症状 | 修法 |
|---|---|---|
| 8.8 秒排期用例 | 原来只有 `waitForFunction(cycle >= 1, timeout 20s)` —— 只证明「20 秒内挨了一下」。未缩放的 11 秒排期同样绿：20 秒的等待窗口本身就大于缩放前的节奏。`game.fight()` 里 `enterNode / drawLetters / renderFight` 的几百毫秒也全在计时口径之外乱算。 | 页面内锚点：把 `performance.now()` 挂在 `foeAttackCtl.start`（`startFight` 真正排期的那一次调用）上作为 epoch，用 10ms 节拍轮询 `cycle >= 1` 记下命中时刻，断言 `elapsed ∈ [8000, 10200] ms`。两端都在页面内测，Node 侧的耗时完全不算进来；20s 降级为「别挂死」的兜底。 |
| 跨单元/续段用例 | 原来直接 `G.unit = 5; G.campaign = {...}` 再断言 difficulty 没变 —— 恒真。difficulty 早在 `newRun` 就冻结在 run 上，改不改 unit 它都不动；这条断言连「过渡有没有发生」都没验。 | 走应用自己的两条入口：`showLearningComplete → #lcBtnNext → progress.nextUnit → 来源相位闸门 → applyUnitTransition`（unit 1→2、segments 1→2），以及 `BOSS 打赢（run.result === true）→ #oNext → progress.continueUnit → applyUnitSegment`（segments 2→3）。断言 unit/segments 是**可观测的真变化**，同时轮号、DB.runs、difficulty 逐字不变。词池只按 `campaign.spec.js` 的同款手法推到只剩最后一个词 —— 过渡本身完全由应用完成。 |

对应变异（都在 worktree 外的独立 mutants 源码副本上跑，端口 4218，不碰生产源）：

| 变异 | 结果 |
|---|---|
| M14 `multipliersFor` 里 `intervalMultiplier` 恒为 1（排期退回 11 秒基线） | E2E **1 fail** ✅（实测 elapsed = 11021.8ms > 10200） |
| M15 `nextUnit` 成功后按新 unit 重算 difficulty | E2E **1 fail** ✅（跨单元后倍率与第 5 轮不再逐字相等） |

命令与结果（本分支实测）：

```
node --test tests/unit/*.test.js     # 744 pass / 0 fail
```

定向 E2E（独立端口 4216、独立 artifacts、cwd 指向本 worktree）：

```
playwright test --config=<worktree 外>/vocab-difficulty-playwright.config.mjs
# 8 passed / 7 skipped（legacy 项目按设计跳过）/ rc=0
```

> ★ E2E 配置**刻意放在 worktree 之外**（本任务的写入范围只有那几份源码/测试），
> 合并时对谁都没用。整合者跑仓库自带的 `npm run test:e2e` 即可，
> 本文件不需要那份配置。

### 变异测试（证明断言真的在测被改的代码）

Node 侧 10 个变异，**9 杀 1 存活**（存活项是真等价变异体，见下）：

| 变异 | 结果 |
|---|---|
| M3 `profile()` 丢掉 difficulty | **4 fail** ✅ |
| M4 起始 `remainingMs` 用未缩放 base | **2 fail** ✅ |
| M5 脏 difficulty 不 fail closed（编码侧 + 解码侧） | **1 fail** ✅ |
| M6 解码时按 `roundNumber` 现算补填 | **1 fail** ✅ |
| M7 逐字段部分采用 | **1 fail** ✅ |
| M8 validate 去掉 hp 通道的轮号相容判定 | **1 fail** ✅ |
| M9 小数轮号 floor 成中间档 | **1 fail** ✅ |
| M10 回落值抄字面量而非 import `FOE_ATTACK` | **1 fail** ✅ |
| M11 去掉 damage 通道相容判定 | **1 fail** ✅ |
| M12 去掉 interval 通道相容判定 | **1 fail** ✅ |
| M1 派生入参 `G.roundNumber` → `DB.runs` | **存活（等价变异体）** |

浏览器侧 3 个（Node 完全够不到的接线，**只有 E2E 能杀**）：

| 变异 | 结果 |
|---|---|
| M2 `startFight` 不缩放血量 | E2E **1 fail** ✅（517 vs 392） |
| M13 派生挪到 `registerRunStart` **之前**（轮号还没定） | E2E **4 fail** ✅ |
| M1 `G.roundNumber` → `DB.runs` | E2E 存活（等价变异体） |

**关于 M1「存活」**：这是**真等价变异体**，不是漏测。`registerRunStart` 在被调用的
同一行里执行 `db.runs = (db.runs|0)+1; run.roundNumber = db.runs`，所以
派生那一刻 `G.roundNumber` 与 `DB.runs` **逐字相等** —— 把入参从其中一个换成另一个
在行为上不可能被观测到。仍然保留 `G.roundNumber` 是为了语义正确
（「轮号是 run 上的事实」，而不是「读一个全局计数器」），
E2E 里那条 `★ 轮号只认 run.roundNumber` 用例守住的是**派生之后 `DB.runs` 再变**的路径
（它真正杀死的是 M13：派生时机）。

## 未验证的风险

- **数值未经真机验证**：8%/6%/5% 与 9 档封顶是温和候选，实机手感必须由整合者确认。
- **未跑完整 gate**：本轮只跑了定向 Node 全量 + 定向 E2E，未跑
  `npm run build` / `test:build` / 全量 `test:e2e`（不碰打包配置与别的 worktree 的端口）。
  合并后需要完整跑。
- E2E 的真实墙钟断言（第 5 轮 8.8 秒挨第一下）依赖 `Date.now` + 真实 `setTimeout`，
  仍**不等于真机**：iOS/Android 的后台节流行为需人工验证。