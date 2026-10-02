# 完整词连胜：分层播报与文字反馈（backlog 17）

## 范围

三个**独立**模块，不碰战斗共享入口（`src/app/combat.js` /
`data/**` / `styles/game.css` / `services/speech.js` / `services/audio.js`），
也不改任何既有测试、CI 配置、package 版本。

| 文件 | 职责 |
|---|---|
| `src/domain/word-streak.js` | 纯规则：台阶表、增长/清零、幂等、封顶。纯函数，不读 DOM/window/存档。 |
| `src/app/word-streak-feedback.js` | 反馈协调器：暂停/新轮/低优先级语音排队与丢弃。**不是**共享 runtime。 |
| `src/ui/components/streak-announcement.js` | 纯展示：一个留在文档流里的 toast。 |
| `src/styles/streak-feedback.css` | 只作用于 `.streak-toast` 的样式。 |

★ **本任务已接线到真实应用**，因此也改了这三个既有文件（都只是加接线/加严校验，
不改任何既有行为）：

| 文件 | 本任务改了什么 |
|---|---|
| `src/app/runtime.js` | 接线 `streakFeedback`（状态住在 run 上、事件身份、语音/UI 注入），以及 `isBattleLive` / `getScopeToken` 两个判据（见下文「最后一击」）。 |
| `src/domain/run-snapshot.js` | 快照编解码里加 `wordStreak` / `wordEventSeq` 两个字段的**严格**校验。 |
| `src/app/progress.js` / `src/app/combat.js` | 仅通过既有可选 port 接入（`onPauseFeedback` / `onWholeWordComplete` 等），逻辑不变。 |

## 规则（逐条都有单测）

1. **「学会」必须同时是 `complete:true` 且 `correct:true`（严格布尔 true）**。
   - `complete:false`（字母级/半词）→ 不增长、也**不消耗 eventId**，后面的整词事件
     仍能用同一个 id 记上。
   - `complete:true, correct:false` → **打错**，把 count 清 0。
   - `correct` 缺失 / `1` / `'yes'` / `{}` → `reason:'not-correct'`：**不增长也不清零**。
     默认当成学会会让一个漏发的标志凭空长一级连胜；反过来凭一个说不清的事件毁掉
     已有的连胜同样是谎报。没打错就是没打错。
2. **身份是显式注入的 `eventId`，不是单词**。由父层注入；本模块不生成、不猜、
   **不改写**：只拿 `trim()` 判「有没有身份」，存储与比较都用原样 token
   （`' a '` 与 `'a'` 是两个不同身份，不替父层合并）。同一轮里同一个词的两次出现
   （payload 完全一样）只要 id 不同就**各记一次**；只按 word 去重会把第二次误判成
   重复，白吞一次连胜。

   ★ **id 必须跨战斗唯一**：建议用**持久化的 run 级自增序号**（由父层串联，例如
   `${runSeq}:${eventSeq}`，`eventSeq` 每战不重置）。**不要**用
   `${roundId}:${wordsDone}` —— `wordsDone` 每战归零，同一个词在第 1 战和第 2 战
   会拿到同一个 id，跨战去重就会误吞一次真实的连胜。
3. **只对最近一次的 `eventId` 去重**：紧挨着的重复投递是幂等的（count 不变、
   不重复播报）。更早的 id 再次出现会被当成新事实再计一次 —— 这是单槽去重的真实
   边界，**不是**「任意旧的重复都挡得住」。上游 publisher 的 eventSeq 单调递增时
   这正是想要的语义：只挡紧邻的重投。

   **缺 `eventId` 时一律不增长**（无法去重就不记，宁可少一次也不重复喊），
   `reason:'no-event-id'`。同理打错也必须带 id：父层不传 id 时模块无法判断这是不是
   已知事件，宁可不记也**不猜** id。
4. **实际打错（`correct:false`）把 count 清 0**；`newRun()` 也清 0。
5. **台阶 1..8**，首次到达才播报，文案按用户给的规范拼写：

   | 台阶 | 文案 | 台阶 | 文案 |
   |---|---|---|---|
   | 1 | First Blood | 5 | Penta Kill |
   | 2 | Double Kill | 6 | Rampage |
   | 3 | Triple Kill | 7 | Unstoppable |
   | 4 | Quadra Kill | 8 | Godlike |

6. **第 8 级之后饱和**：`count` 停在 8，继续完成词不再有新播报（免得每拼一个词
   就狂喊一遍 Godlike）。`count` 是纯数字，不进文案。
7. **恢复默认**：协议没接上时父层走 `normalizeWordStreakState()`，坏 state 显式
   降级成 `{count:0,lastEventId:null}`（非对象/NaN → 0，>8 → 8）—— 这是
   **内存态**的降级口径。
   ★ **存档协议不是这个口径**：`run-snapshot.js` 里 encode / decode 两侧都按
     **原值 fail closed**，绝不 normalize 掩坏（见下文「快照」）。两者分工：
     内存态兜底「协议没接上」，存档态拒绝「这份存档不可信」。
8. **暂停冻结**：`pause()` 取消在途待播、作废其回调 token（真机上 cancel 未必赶得
   上的那一只，回来发现自己过期就什么都不做），**并置上自己的冻结标志** —— 暂停
   判定是「内部标志 OR 外部注入的 `isPaused()`」，所以即使父层不提供 `isPaused`，
   `pause()` 之后 `complete`/`mistake` 也一律返回 `{ok:false, reason:'paused'}`，
   状态一个字节都不动。`resume()` 解除内部标志并**不补播**暂停期间丢掉的阶段。
9. **新轮清零**：`newRun()` 写回 `{count:0,lastEventId:null}` 并作废待播。
10. **`dispose()` 幂等**：之后所有入口都是 no-op（不再出声、不再改状态）。
11. **任何被接受的新事实都作废在途待播**：`mistake` / `grown` / `saturated`
    （含第 8 级之后无播报的饱和事件）都作废；`duplicate` / `incomplete` /
    `not-correct` / `no-event-id` 什么都没发生，不动在途待播。
12. **定时器成对**：注入 `cancelSchedule` 时用它取消；**没注入就用
    `clearTimeout`** 取消默认 `setTimeout` 排出去的待播（否则默认路径会留下悬挂的
    定时器）。`newRun()` / `dispose()` / `pause()` 都会真正清掉。

## 语音优先级（本任务的核心约束）

**完整词朗读是最高优先级。** 本模块**从不**调用任何会打断它的接口：不
`TTS.stop()`、不 `TTS.speak()` 抢先、不 `TTS.line()` 强插。

- 注入的 `speakAnnouncement({text, priority:'feedback', count, stage})` 返回
  `false` = 这一路真的没播出来（没装 TTS / 被拒 / 静音）。此时只当「这次没播」，
  **不改任何玩家偏好**（不自动开语音、不动音量），不假装成功。
- `getWordPriorityBusy() === true` 时：文字反馈照常立刻给（视觉通道不抢话），
  语音只留**一条**「最新」的待播（旧的当场取消），最多重排
  `FEEDBACK_MAX_DEFERRALS=30` 次、总共不超过 `FEEDBACK_DEFER_WINDOW_MS=5000ms`；
  等不到就**安静丢弃**，绝不排队盖住下一个词。

  ★ 这两个数是**工程取值，不是真机标定**：仓库里没有任何真机可听性测量
    （e2e 用的是记录调用的 speechSynthesis 桩，不合成声音）。谁先到谁生效：
    30 × 120ms = 3.6s **标称**小于 5s，所以通常先撞上的是**重排次数上限**；
    5s 窗口是硬上界，专门兜住「回调被事件循环卡顿拖迟到」（重排次数没用完，
    但墙上时间已超窗）。两条都在**排下一次之前**检查。
  ★ 5s 是待播的**寿命上界**：待播在第一次想出声那一刻记下 `bornAt`，整条
    重排链共用它（每次重排重新取 `clock()` 会让差值恒为 0，窗口形同虚设）。检查
    发生在**排下一次之前**且**每次尝试出声前都重算**，所以 `deferMs > deferWindowMs`
    时第一拍就丢弃；事件循环卡顿导致回调迟到时，它回来会发现自己已过期（不会因为
    「词这会儿空着」就把陈旧阶段喊出来）。
- 语音请求里**只有**台阶文案与 `priority:'feedback'`，绝不携带当前英文单词
  （学习答案不进播报通道）。
- **未实施**：父层自合成 accent sfx / 任何额外音效。本模块不加载任何远程音频、
  字体资源（CSS 里有断言强制），只用系统 TTS。
- 将来父层可以在 `deliver()` 里换成 speech 的排队接口，本模块接口不用改。

## UI

`showStreakAnnouncement(host, {count,label,...})` → `{el, hide}`

- 往**调用方给的宿主**里加一个子节点，`position:static` 留在战斗页文档流里，
  绝不用 fixed/absolute 浮在 HUD 上盖住血条、词框和底部按钮（那是移动端操作区）。
- 只落 `label`，**不拼当前英文单词**。
- 全部 `textContent` 落屏（DOM 桩里 `innerHTML` 的 setter 直接抛，这条被测试强制）。
- 没有宿主 / 坏 label → 安静返回 `null`，什么都不画、不排定时器。
- 同一台阶重播复用同一个节点，不堆叠；`hide()` 只取消**自己那一个**定时器句柄。
- `reducedMotion:true` 或系统 `prefers-reduced-motion: reduce` → 不加动画 class，
  但文字照常出现、照常到期收掉，不会留一块挂着的死文字。
- 300+ 字符长标签**原样进 DOM**（截成 `…` 会骗玩家），窄屏换行交给 CSS
  （`min-width:0` + `overflow-wrap:anywhere`，不写死像素宽度）。

## 接线（本任务已实施，docs 见代码注释）

1. **状态住在 run 上**：`run.wordStreak={count,lastEventId}` + `run.wordEventSeq`
   （`createRun` 开局即 0）。`B.wordStreak` 是**另一个**东西（每场战斗的大招档位
   计数），两者绝不共用字段。连胜因此跨战斗、跨单元、跨刷新保持。
2. **事件身份**：`${G.roundId||G.id}:${++G.wordEventSeq}`，token 按字面使用。
   ★ 不用 `B.wordsDone`（每战归零 → 跨战撞 id → 白吞一次真实连胜）。
   ★ **到顶显式降级，绝不重复 token**：`G.wordEventSeq` 到达
     `Number.MAX_SAFE_INTEGER` 时 `++` 不再变化，之后每次事件都拿到同一个身份，
     域层单槽去重会把真实完成全误判成「重复投递」。所以到顶（或读到脏值）
     就改用一次性身份 `${base}:x${newRoundId()}`，宁可身份格式变了也不重复。
3. **唯一发布点**（`src/app/combat.js` 的可选 port）：
   - `onWholeWordComplete`：在 `TTS.word()` 之后、致命判定 / `nextWord()` **之前**。
     最后一击赢下整场战斗那一局照样出里程碑。
   - `onSpellingMistake`：只在「字母被接受且判错」时。已标 bad 的重复点击、
     误标自动解封、退格、提示、字母盘上没有的输入**都不算**（从没被当作答案接受）。
4. **低优先级播报**（`src/services/speech.js` 的 `announcement(text)`）：
   - 只在 `T.on && supported` 且**没有词/提示在念**、合成器本身不忙时才尝试；
   - 说了**不 cancel** 任何东西（`speak(...,{noCancel:true})`）；
   - `TTS.line()/foeLine()` 即使 `force:true` 也不许打断正在念的词；
   - **绝不**替玩家打开朗读偏好；没有 TTS / 静音时返回 false，调用方只当「没播」。
5. **占用令牌**：`word()` / `hint()` 占住「最高优先级」，只在**真实** utterance
   的 end / error 释放（onstart 是开始，不是结束）。`stop()` 作废当前代号 ——
   上一句**迟到的** end 认不出自己是当前占用，绝不会把新一句的占用清掉。
   没注入 capability 时不改写任何回调（那条路径的既有契约），退化成按朗读时长
   估算的**有界**占用，绝不会永久卡成「忙」。
6. **等待窗口**：`deferMs=120`、窗口 `5000ms`、最多 30 次重排。两条界都够等完
   当前那句词（原先 480/900ms 的窗口容不下一个正常长度的词，朗读通常 >500ms），
   又绝不允许排到下一个词后面去盖住它。等不到就**安静丢弃**。
   ★ 工程取值，非真机标定：30×120ms = 3.6s 标称 < 5s，通常先撞**次数上限**；
     5s 窗口兜住「回调被事件循环拖迟到」。
7. **生命周期**（`src/app/progress.js` 的可选 `onPauseFeedback/onResumeFeedback`）：
   暂停 / 回主页 / 结算 / 放弃 / 清档都作废在途待播，**一个字节的连胜状态都不动**；
   `resume()` 只解冻、**绝不补播**暂停期间丢掉的阶段；只有 `newRun()` 清零，
   并且它同时**解冻**（上一局在暂停态结束时，新局第一词必须还能计数）。
   跨单元 `nextUnit()` / `continueUnit()` 解冻但不清零。
8. **快照**（`src/domain/run-snapshot.js`）：只写 `{count,lastEventId}` 与
   `wordEventSeq` 两个事实，绝不序列化 UI / utterance / 定时器。旧存档缺这两个
   字段 → 回落 0（合法）。
   ★ **编解码两侧都按原值 fail closed，绝不 normalize 掩坏**（与 `growth` /
     `foeAttack` 同一口径，沿用 `encodeSnapshot` 里的原值守卫）：
     - 编码：`{count:99}` 原先被 `normalizeWordStreakState` 夹成 `{count:8}`
       落盘 —— 存档**看起来正常**，却凭空给玩家记了一个满级连胜。现在**整份拒绝**
       （`encodeSnapshot` 返回 `null`，这一局存不下）。
     - `wordEventSeq`：只查 `isInt(>=0)` 会放过 `1e21`（`Number.isInteger(1e21)`
       为真），而 `++1e21 === 1e21` → 事件身份永久重复 → 域层单槽去重把之后
       每一次真实完成都误判成「重复投递」，连胜彻底卡死。现在必须是
       **`Number.isSafeInteger` 且非负**。
     - **上界刻意留一格**（`MAX_SAFE_INTEGER - 1`）：正好卡在 `MAX_SAFE_INTEGER`
       的存档，其下一次 `++` 就会溢出成同一个值 —— 宁可这一局明确存不下，
       也不写一份「下一次必然重复身份」的存档。publisher 侧另有明确降级（见接线 2）。
     - `lastEventId`：合法字符串**原样保留**（含空格、含控制符）。本模块从不把它
       渲染进 DOM（播报通道只走 `label`），所以不存在 XSS 面，也不该在这里替父层
       归一身份（`' a '` 与 `'a'` 是两个不同的事件身份）。
9. **UI**：`#streakFeedbackHost`（战斗页词框下方，文档流内，`position:static`），
   toast 只落 label（`First Blood`…`Godlike`），绝不携带当前英文单词。
   隐藏定时器带代号：旧那一只迟到时不会把刚画出来的新阶段藏掉；没注入
   `cancelSchedule` 时用 `clearTimeout` 真取消。

## 语音修补的验收边界

词/提示与连胜播报各有独立占用令牌：真实end/error提前释放，onstart不释放；缺结束事件时按估算×4、最少5秒最多30秒的硬上界释放。硬上界独立于可关闭的故障探测，stop/关闭朗读收掉待办。

胜利/失败台词只留一条最多5秒的待播，不抢词和连胜播报。胜利调用携带同战斗与REWARD相位检查：玩家先领奖回地图时，迟到台词丢弃而不是cancel正在读的词。父fake-clock先复现跨相位播报，修后20项speech回归及最后击杀/先领奖两个真实Chrome用例通过。

缺结束回调或合成器持续忙时，连胜语音可能因等待上限而丢弃，只保留文字；这是静默降级，不能承诺异常浏览器仍按完整语音顺序出声。正常回调的顺序为单词→连胜→胜利，记录型speechStub只证明API调用顺序，不证明真机可听。

## 最后一击：里程碑必须能出声（回归修复）

**这是本任务修过的两个真实丢报/残留缺陷。**

1. **丢报**：整词完成的瞬间词正在念 → 里程碑排进队列；紧接着 `applyDamage`
   打空敌人 → `winFight` 把 `B.over` 置真。旧的 `isBattleLive = B && !B.over`
   于是把这条待播判成「战斗没了」而丢弃 —— 玩家刚拼出里程碑却在结算屏听不到。
   **修正后的判据**（`src/app/runtime.js`）：显式放行「**同一场战斗**打赢了、
   且仍在它的待领奖相位」（`B.won && !B.finished && PHASE===REWARD`）。
   词念完之后里程碑照常播出，顺序仍是「词 → 里程碑 → 胜利台词」。
   ★ 只放行这一种情况：领完奖 / 结算 / **败局**（`B.won` 为假）/ 地图 / 标题 /
     词汇完成检查点 一律不活 —— 绝不让上一场战斗的播报串进别的相位。
2. **pending 残留**：早退（战斗不在了 / 超窗 / 作用域换了）原先直接 `return`，
   把那条待播留在队列里 —— `pendingCount` 永远停在 1，而回调早已跑过、不会再回来
   （父已复现）。现在早退**清掉自己那一条**（按 token 认领），`pendingCount`
   反映真实队列。
   ★ 但**过期 token 绝不许清新的 pending**：那时 pending 可能已经是**另一条**
     合法的新待播，清掉它等于让新里程碑永远播不出来。
3. **scope token（可选注入）**：`getScopeToken=()=>B` 捕获战斗对象**身份**。
   延迟播报真的要说出口之前先验「作用域还是当初那一个」—— 快速推进到新战斗
   （B 被整个换掉）之后，上一场的里程碑**绝不**补播进新战斗的语音通道。
   没注入就退化成不校验（单一作用域无此风险）。

回归测试：`tests/unit/streak-feedback-regression.test.js`（反馈侧那半）、
`tests/unit/streak-snapshot-regression.test.js`（编解码严格性）、
`tests/e2e/word-streak-game.spec.js` 的「the final kill still speaks the
milestone」（真实应用里那一半：真 Chrome、真键盘、真 `onend`）。

## 验收（真实执行结果）

Node（`"C:/Program Files/nodejs/node.exe"`）：

```
node --test <49 个不 import services/speech.js 的 unit 文件>
  → RC 0，752 pass / 0 fail（含本次新增的 18 条回归测试）
```

★ **未在本次运行 `node --test "tests/unit/*.test.js"` 全量**：另有 4 个
  speech 相关测试文件（`speech-failure` / `speech-observation-regression` /
  `streak-speech-regression` / `word-streak-wiring`）在本次运行时报
  `SyntaxError: Unexpected token '{'`（`src/services/speech.js:168`）。那是
  **另一位 writer 正在编辑中的文件**，不属于本任务范围（`speech.js` 明确禁止
  改动），因此这 7 个 fail 与本任务的改动无关。

★ **Chrome e2e 未在本次运行**：浏览器端口 4210 由父统一调度，且
  `speech.js` 当时处于语法错误状态（应用无法加载）。新增的
  「the final kill still speaks the milestone」一条**已写好待父运行**。

语音相关的 e2e 用的是**记录调用的 speechSynthesis 平台桩**（不合成声音），
证明的是「utterance 调用顺序与 cancel 次数」；**真机可听性全程未验证**。
