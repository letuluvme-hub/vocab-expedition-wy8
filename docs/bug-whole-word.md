# bug-whole-word：最终击杀必须完成当前整词

## 现象

玩家在战斗里只拼出目标词的**一部分**就能赢。典型复现：
`litre` 的敌人只剩 1 血，点一下 `l` → 战斗立刻结束、弹出胜利奖励面板。

```
game.fight({ word: 'litre', enemyHp: 1 })
game.clickLetter('l')
→ B.over = true, B.won = true, G.kills = 1, 打开 #s-pick 奖励面板
```

## 根因

旧实现里「敌人被打死」这个判定散落在 `src/app/combat.js` 的**四个**地方，
每一处都是各自一份的 `enHp -= x; if (enHp <= 0) winFight()`：

| 位置 | 触发条件 | 是不是完整词 |
|---|---|---|
| `dealDamage()` | 每敲对一个字母（`hitDmg()`） | 否 |
| `hurtPlayer()` 荆棘反弹 | 答错一次，敌人 −5 | 否 |
| `pressKey()` 整词大招 | `wordDmg()` | 是 |
| `pressKey()` 收尾 | 大招之后又判一次 `enHp <= 0` | 是 |

只要前两条里任意一条把 `enHp` 打到 <=0，`winFight()` 就会被调用。
`winFight` 自身只有 `if (B.over) return` 一道幂等闸门，**没有任何业务校验** ——
它不检查当前词是否拼完、也不检查伤害来源。

于是「学会一个词」这条教学底线被绕过：玩家赢下了战斗，但这个词既没进掌握表、
也没进本局退休，结算面板只能弹一句「⚔️ 敌人倒下了，但 xx 还没拼完」来事后补救。
荆棘更糟：**答错**一次就能打死 BOSS，等于奖励答错。

## 修复

新增 `src/domain/battle-rules.js`（纯规则，不碰 DOM / 存档 / 全局 G·B），
把「敌人什么时候算被打死」收成**一个**口径：

```js
export const MIN_ENEMY_HP = 1;

applyDamage(battle, amount, { allowFinish = false })
  // allowFinish=false（默认）→ 敌人血量被夹到 max(before-dmg, min(before,1))：能削血，打不死
  // allowFinish=true            → 只有整词大招可以压到 <=0
  // 三道 no-op 门：已结算（over/finished）、血量非法（NaN/undefined/null/脏串）、已死（enHp<=0）
  // 返回 { before, after, dealt, lethal }，dealt 是**实际**扣掉的血

canFinishFight(battle)
  // winFight 的唯一授权条件：over/finished 为假 + 整词拼完 + enHp 合法 + enHp <= 0
```

★ 三条 fail-closed / no-op 规则（审查补强，均为真实可达路径，不是防御性冗余）：

1. **已死或已结算后一律 no-op**。整词大招过量击打会留下真实负血（35 血挨 40 → `-5`），
   后续迟到的伤害（连点、动画回调、荆棘结算）不得把它抬回 1 血地板 —— 那等于把
   已结算的战斗重新拉回进行中。no-op 返回 `dealt: 0`，绝不报负数 dealt。
2. **血量非法一律 no-op + 拒绝授权**。原来的 `(Number(battle.enHp) || 0) <= 0`
   会把 `NaN` / `undefined` / `null` 全部变成 `0`，而 `0 <= 0` 成立 ——
   于是「读不到血量」被静默升级成「可以发胜利奖励」。改成显式 `readHp()`：
   只有真正的有限数（含非空数字串）才算血量，其余一律 `null` → fail closed。
3. **地板夹到 `min(before, 1)` 而不是固定 1**。`before` 已经是 `0.5` 这种小数时
   不能被抬到 1（那等于凭空回血）。

配套改动：

- **`src/app/combat.js`**
  - `dealDamage()` 改用 `applyDamage(B, d)`（不传 allowFinish），**删掉** `winFight()` 调用。
    单字母即使把敌人压到 1 血也只继续战斗。
  - 荆棘改用 `applyDamage(B, 5)`，同样删掉 `winFight()` 调用。
  - 整词大招改用 `applyDamage(B, bonus, { allowFinish: true })`，这是**唯一**允许致命的伤害。
  - 删掉大招之后那句多余的 `if (B.enHp <= 0) return winFight()` ——
    它和刚走过的分支重复，且是半词抢跑的第二条路径。
  - `tryWin()` 改为**只**用 `canFinishFight(B)` 做本地闸门，不再另写一份
    `B.over || B.finished`。两份判据各写一遍必然会漂移（runtime 那份已经加了
    `finished`，本地那份没加），共用同一个函数后授权只有一处口径。
- **`src/app/runtime.js`**
  - `winFight()` 的 `if (B.over) return` 换成 `if (!canFinishFight(B)) return false`。
    这是纵深防御：即使将来新增伤害来源、或测试探针直接调 `winFight()`，
    半词 / 已结算 / 非法血量 / 敌人没死四种情况都绕不过去。
  - `winFight()` 是 DEV 探针（`window.__gameTest.winFight`）暴露的入口，
    保留导出但**不能**用它伪造胜利 —— 授权判据在函数内部，不在调用方。
  - **删除** `winFight()` 里那段「敌人可能死于收尾一击，所以半个词不能进掌握表 /
    精英需打出连击」的长注释，以及对应的 `unfinished` 变量与补救 toast。
    整词授权闸门（`canFinishFight`）已经让「走到 winFight」等价于「当前词已拼完」，
    所以这个分支在闸门之后是**死代码**。
  - **删除** `winFight()` 里第二次的 `creditWord(B.word.w)`（含精英 `B.combo>0` 门槛）。
    `combat.js` 的整词完成分支在调 `applyDamage(allowFinish)` 之前就已经 creditWord 过
    —— 胜利只可能从那个分支产生，所以 winFight 里的这次调用在本次修复之后**必然是重复**。
    现在「学会一个词」在全代码库只有一个入口：combat 的整词分支。
  - `showBattleRewards(g, unfinished)` 的第二个实参改为 `null`：没有「没拼完」要上报。
    `encounters.showBattleRewards` 的 `unfinished` 形参**保留**（归档页 legacy 行为
    与其他调用方不受影响，本次不扩展它的语义）。

### 反馈同步修正

1 血地板生效时，飘字必须显示**实际**扣掉的血量，不能报玩家按下去的伤害值：

```js
const hit = applyDamage(B, d);
floatTxt(c.x, c.y, '-' + hit.dealt, B.foe.tint);   // 敌人 4 血、伤害 999 → 显示 -3
```

荆棘同理（`荆棘 -3` 而不是恒定的 `荆棘 -5`）。

## 副作用（都是设计意图）

1. **敌人血条会停在 1/N**。这是「再拼完一个词就能赢」的明确信号，
   配合「必须拼完整词」的规则反而更清楚。
2. **`wordsDone` / `wordStreak` / `mastered` 现在只在整词分支递增**。
   以前半词赢会跳过它们，导致 `creditWord` 在 `winFight` 里被第二次调用
   （`wordComplete()` 判定在 winFight 里又算了一次）—— 现在这条重复路径没了，
   `winFight` 里的那次调用连同精英 `combo>0` 门槛一并删除。
   ★ **这不是新增的精英学习 policy**：删除前那句门槛
   `wordComplete() && (!B.elite || B.combo>0)` 已经**恒真** ——
   走到 `winFight` 的路径必然来自 combat 的整词分支，而那个分支在调用前就
   已经无条件 `creditWord` 过了。所以删除它不改变任何玩家的学习结果，
   只是不再留一个永远走不到 false 分支的伪门槛。
3. **单字母词（如自定义词表里的 `i`）不受影响**：`wordComplete()` 只比长度，
   `input.length >= norm(word.w).length`，1 个字母拼 1 个字母就是完整词，照样能赢。
4. 玩家自身的失败路径（护盾 → 生命 → 荆棘 → `loseFight`）优先级与数值**完全未动**。

## 验证

### 新增测试

- `tests/unit/whole-word.test.js`（17 条）：纯规则 7 条 + 战斗控制器集成 10 条。
  覆盖 1 血地板、`allowFinish` 语义、`canFinishFight` 四条件、
  **已死 / 已结算后伤害 no-op**、**非法 HP 不改状态也不授权**、
  **0.5 血不被抬到 1 血**、单字母 / 荆棘 / 直接调 `dealDamage` 都打不死、
  被打到 1 血后必须拼完整词、单字母词 `i` 允许赢、
  **重复按键 + 真实二次调用 `winFight()` 都只发一次奖**、
  **胜利后再补一刀不会二次赢**。
  - 重复结算用例里的 `winFight` 桩走**真实** `canFinishFight` 并复刻 runtime 副作用
    （`B.over/B.won`、`G.kills++`、奖励次数），并由 `portsWin` 显式导出 ——
    旧的 `h.portsWin = null` 只是往一个没人读的字段上写 null，等于什么都没断言；
    现在是真实第二次调用 + 逐字段快照比对（over/won/enHp/wordsDone/wordStreak/
    mastered/done/kills 全部不得变）。
- `tests/e2e/whole-word.spec.js`（8 条）：真实浏览器，new 项目。
  覆盖 1 血敌人点单字母不结束战斗、拼完整词才赢并记学会一次、
  最后一个字母的普通 hit 不抢先赢、连点最后一次键只结算一次、
  直接调 `winFight()` 被授权闸门拒绝、BOSS 不能被半词打死、单字母词 `i` 可赢。

### 旧测试的处置

- `tests/unit/controllers.test.js` 两条断言编码的是旧 bug
  （`enHp:10` 敲第一个字母就 winFight），已改写为新的验收标准：
  半词不得赢、赢一定发生在大招上。两条都是**语义替换**，不是删除。
- 该文件的 `winFight` 桩从「只挡 `B.over`」改成走**真实的** `canFinishFight`，
  于是单测里「赢了」这个事实本身就等价于三条授权条件同时成立。
- `tests/e2e/combat.spec.js` 的 `partial word kill never becomes mastered or retired`
  保留为 **legacy 归档页的事实基线**（`test.skip` 掉 new），
  并新增一条对应用例断言新版不再半词赢。
- `tests/e2e/counting.spec.js` / `progression.spec.js` / `lifecycle.spec.js`
  的 BOSS helper 不再只敲一个 `l`：改为敲完整词。
  `progression.spec.js` 与 `lifecycle.spec.js` 同时跑两个项目，
  所以按 `testInfo.project.metadata.target` 分支：
  legacy 保留半词击杀路径，new 走整词击杀路径。
- `tests/e2e/game-harness.js` 的 `fight()` 增加 `DB.custom` 回退查找，
  让单字母词 `i` 能作为场景词使用。生产代码未改、归档 fixture 未改。

### 实测结果

```
node --test tests/unit/*.test.js                    221 tests, 221 pass, 0 fail
playwright test tests/e2e/whole-word.spec.js --project=new
                                                    8 passed
```

（unit 从 217 → 221：本次审查新增 4 条。E2E 未改动断言，本轮只做一次真实回归。）

## 未验证

- 真实手机硬件、有声 TTS、Safari/Firefox、部署后缓存/CDN
- `verify-baseline.mjs` 的两项负向突变（`partial-mastery` /
  `duplicate-mastery`）仍锚在 legacy 归档页上，本次未改动 fixture，行为不变；
  但 `partial-mastery` 突变验证的语义已随本 bug 修复而改变 ——
  它现在证明的是「legacy 仍会半词记学会」，不再是新版的验收依据。