# 怪物蓄力攻击（清单 13）

> 状态：**已实施**（本分支）。对应 backlog「13. 怪物更大、有持续数秒的攻击蓄力，输入字母可打断，强怪间隔更短」。
> 与清单 10（按轮次递增）**分开实施**：本项参数是固定值，递增留给后续任务。

## 做了什么

怪不再只是站着挨打。它会按 `idle → telegraph → attack → recover → 循环` 自己行动，
蓄力期间玩家尝试一个**可用字母**就能打断；怪物形象同时放大（≤1.2 倍），蓄力进度可视化。

三档参数（`src/data/balance.js` 的 `FOE_ATTACK`，本项固定）：

| 档位 | idle | 蓄力 telegraph | 收招 recover | 伤害 |
|---|---|---|---|---|
| 普通 | 6000ms | 5000ms | 2500ms | 4 |
| 精英 | 5000ms | 4000ms | 2500ms | 6 |
| 首领 | 4000ms | 3500ms | 2500ms | 8 |

普通怪第一次攻击在 11 秒；精英/首领更快更痛（强怪间隔更短）。

## 打断的口径：有效字母尝试

用户原意是「输入字母则可以打断」。本项按**实际被接受的字母尝试**实现，正确或错误都算：

- 算：点击或键盘输入一个字母盘上**没被填过、没被标错**的字母。
- 不算：字母盘上没有的字符、已填入（used）、已试过的错字母（bad 重复）、
  越界索引、自动解锁误标字母的那次点击、退格、提示、方向键。

所以「一直按同一个错字母」**不能**维持永远安全：那个字母第二次就已被标为 bad，
按它只是抖动，不再扣血也不再打断。

打断后进入 `recover`（2500ms 反打窗口），本轮蓄力**永不补打**；下一轮蓄力仍可再打断。
每次蓄力只放行一次，靠**相位本身**当闸门，不另设独立时间窗。

界面文案如实描述这一点：`蓄力时尝试一个可用字母可打断；重复已试字母不算`。

**打断与教学惩罚分开记。** 错误字母打断蓄力的同时，原有的 12 点（不在词里）/ 6 点
（在词里但位置不对）惩罚、错词记录、复习队列、`DB.mastered` 维护全部照旧生效 ——
打断只是额外多一个战术收益，绝不替代代价。

## 伤害走独立路径（为什么不复用 hurtPlayer）

自主攻击有一个新端口 `combat.enemyHit(amount)`，只做「护盾 → 生命 → 判负」。

**绝不**复用 `hurtPlayer`：那是「玩家答错」的惩罚路径，它会把当前词记成错词、
踢进本局复习队列、从 `DB.mastered` 里删掉，还要消耗幸运草 / 首领首击减半。
怪自己打人却走那条路径，等于凭空把一个玩家根本没答错的词判成错词 —— 直接破坏学习主线。

同样不做：荆棘反弹（那是答错的补偿）、假胜利、任何计数（`G.att` / `wordsDone` / `kills`）。
寒冰护符（`freezeWord`）期间这一次不掉血，但**相位照常推进**（不是无限暂停）。

## 暂停、后台与刷新

- 定时器全部走 `lifecycle.scheduleBattle`（带 battle epoch 归属），**没有** `setInterval`，
  也没有自己的 `setTimeout`。暂停冻结、换战斗作废、战败停止都由 lifecycle 统一管。
- 每次相位变化提交一次快照 —— 节奏由相位决定，不存在每帧狂写盘。
- 存档事实只有 `battle.foeAttack`：
  `{ schemaVersion: 1, phase, remainingMs, cycle, interrupted }`。
  **只有 `remainingMs` 一个时间量**：`dueAt` / `performance.now` / 定时器 id / 闭包一律不落盘。
- 采集在快照生成的**那一刻**换算（`due - now`），所以「刚进战斗存一次、10 秒后再存一次」
  两份存档的 `remainingMs` 不同。暂停期间不再重算（避免墙钟继续走把蓄力越扣越短）。
- 刷新后按 `remainingMs` 精确重建：既不补打已经过去的那一下，也不会凭空提前。
- 旧存档没有这个键 = 合法，恢复成**干净的 idle 窗口**，绝不默认「立刻攻击」。
- 脏事实（负数/超上限/未知相位/错版本）整份快照 fail closed：编码侧返回 `null`（不写），
  解码侧判 `invalid`。绝不静默丢成「没有攻击状态」。
- 战斗结束（`over` / `finished`）、词汇完成 / 奖励 / 结算相位一律不再推进；相位转 `defeated`。

## 三条纵向契约（本次定向修补）

### ① 相位推进与实际伤害是**同一次事务**

- `step()` 走 `applyPhase(next, { publish:false })` 内部落事实（写 `B.foeAttack`、算
  `dueAt`、排下一次定时器），**不 commit、不 renderFight**；attack → recover 两步都不发布，
  结算伤害后只 `publishPhase()` 一次。
- 旧实现是 `commitPhase(attack)` → `commitPhase(recover)` → `foeAttackHit()`，于是快照里
  出现过一帧「怪已收招、玩家一滴血没掉」（实测 `liveHp 56 / lastSavedHp 60 /
  lastRenderedHp 60 / phase recover`）。那份存档刷新回来永久少一次伤害，且无处自愈。
- `live()`、`stop()`、`notifyLetterAttempted()`、`start()`、`restore()` 全部经由 `applyPhase`，
  **没有任何 producer 还能单独发布 attack 这个中间态**。
- 护盾与生命同一次提交（不会出现「盾扣了、血没扣」的快照）。
- 致死一击会在 `foeAttackHit` 里重入 `loseFight → stop()/markEnding()`：整条链包在
  runtime 的 `mutate` 事务里（`createFoeAttackController` 的 `mutate` 端口），提交只在
  **最外层** `mutationDepth === 0` 时发生一次，绝不落「战斗已关闭却仍在 battle 相位」的非法快照。
- 装配漏掉 `mutate` 端口时（纯控制器用法）仍不发布中间态，只是提交点回落到同步调用。

### ② 暂停冻结与继续重定位

- `foeCtl.pause()` 采**暂停那一刻**的剩余（`dueAt - now`），存进自己的 `pausedRemaining`；
  由 `progress.pause()` / `returnToTitle()` 在 `lifecycle.pause()` **之前**调
  （顺序反了会采到整个窗口而不是真实剩余）。
- `foeCtl.resume()` **只**做 `dueAt = now + savedRemaining`，在 `lifecycle.resume()` 之后调。
  绝不重排已冻结的同页队列、绝不新增任何任务（重排 = 同一相位挂两个回调 = 凭空多挨一下）。
- 冻结值走自己的标志位，不靠 `frozen` 临时判断：`frozen` 是通用开关（奖励屏/结算屏也为真），
  拿它当「暂停了」会在非暂停场景把 `due-now` 冻住。
- 跨刷新重建仍走 `restore()`：只排一次相位 + 一次 UI tick，不重放暂停历史。
- 继续后立刻 checkpoint 的剩余 ≈ 暂停时的剩余（允许动作本身的几毫秒，**绝不为 0**）；
  刷新后仍 > 0，等同样的剩余只挨一下。
- 页面隐藏 / `pagehide` 走的是同一个 `pauseNow`，因此同样带钩子。

### ③ 蓄力可视倒计时真实流动

- UI 节拍 `FOE_UI_TICK_MS = 250`，走 `lifecycle.scheduleBattle` 的**一次性 chain**
  （不是 `setInterval`）：暂停被冻结、换战斗被 epoch 作废、战败/停止后自然停。
- 每 tick **只**调 `paintAttack` 端口（`fightScreen.paintFoeAttack` → `meter.paintLive`）：
  - 不落盘（`commit` 一次都不调）、不推进相位、不整屏 `renderFight`；
  - 传的是**派生事实**，不就地改 `B.foeAttack` —— 存档里的 `remainingMs` 仍只由
    `captureFact()` 在提交那一刻算。
- `paintLive` 只改已存在元素的 `style.width` 与 `textContent`，DOM 结构一个都不动。
  整块重建走另一个口 `paint()`（`renderFight` 用）。这条是硬约束：每 250ms 重建一次字母盘，
  玩家点字母点到一半按钮被换掉、焦点丢失。
- 冻结期间节拍不走；继续后以真实剩余继续。正常活动链为相位与UI两个任务；
  打断或停止时已排出的旧任务以generation作废，允许留到到期后清除，不再续排或伤害。
- 新战斗开始时先复位ticking再排首个UI节拍，不能把已被lifecycle.resetBattle取消的旧链当活链。
- `live()` 把 `defeated` 也算作「不活」：`stop()` 只转相位、不动 `B.over`，
  漏这一条会让战斗结束后蓄力条还在继续倒数。

## 界面

- 新组件 `src/ui/components/foe-attack-meter.js` + `src/styles/foe-attacks.css`
  （只作用于 `.foeAtk*`，追加在样式表末尾，既有七张逐字不变）。
- 蓄力条挂在战斗页敌人信息块 `.finfo` 里（不是 `.vsrow` 上层），所以怪物变大时它跟着走，
  不会把 `.fmid` 顶高、把字母盘挤出手机视口。
- 怪物放大走 `#fAv` 的 inline style，基准取样式表的 `--avatar`
  （**不读自己的 computed width**，否则每帧乘一次会指数放大），上限由
  `FOE_ART_SCALE_MAX = 1.2` 钉在数据层。敌人 SVG、`.avatar` 的形状与特效一个字没改。
- 矮屏（≤620px 高）下蓄力条收紧到一行高度。

## 测试

定向单测（`tests/unit/foe-attack*.test.js`，共80个，其中 `foe-attack-atomic.test.js`
24个）+ 定向E2E（`tests/e2e/foe-attack.spec.js`，14个真实Chrome用例）覆盖：自主攻击一次/挡盾、
有效打断 vs 已用/bad 重复、暂停等待后再恢复不多打、刷新按剩余时间重建且 runid/runs 不变、
胜利/结算后无后续伤害与零额外奖励、320/390 窄屏不遮不溢出、文案如实。

变异测试两处均被抓：去掉 `interruptFoeAttack` 的相位闸门、把脏 `foeAttack` 静默丢弃。

## 未验证 / 风险

- **E2E 没有用 Playwright 假时钟**。相位推进用的是页面自己的 `Date.now` + 真实
  `setTimeout`，所以 `waitForTimeout` 跑的是**真实墙钟**（「11 秒挨第一下」真的等了
  11 秒，这组用例本身要跑 30 秒以上）。旧注释曾声称用了 clock 加速，与实际不符，已改正。
  唯一被加速的是测试框架的等待上限。
- **没有真机验证**。E2E 跑的是真实 Chrome 与真实计时，但不是 iOS/Android；
  浏览器后台节流、iPhone home indicator 安全区仍需人工确认。
- **平衡未定标**。本项参数是设计候选值，不是实测曲线；本轮的首领 4s idle + 3.5s 蓄力
  已经比旧版紧一档，仍留着完整 idle 窗口，再往上加速会压掉中译英回忆时间。
- 与清单 10（按轮次递增）、12（多词门槛）的共同回归尚未做 —— 按 backlog 的执行顺序，
  这两项要在这条状态机之上叠加。