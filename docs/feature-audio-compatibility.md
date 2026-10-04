# 浏览器音频兼容提示（微信音效/朗读放不出声时给玩家一个说法）

> 2026-10-04：关闭后刷新不再主动提示、初始缺失 API 报告及独立通道状态升级见 [微信语音一次性说明](feature-wechat-voice-once.md)。以下保留原接线与回归记录；原「只在本会话关闭」语义已被新版本替换。

## 改了什么

| 位置 | 改动 |
|---|---|
| `src/services/audio-capability.js` | **新增**。能力探测状态机（音效 / 朗读各一路，互相独立） |
| `src/services/audio.js` | 新增可选 `capability` 注入；`unlock()` 改为真 try+resume（含 promise 拒绝）；新增 `handleVisibility()`；`closed` 上下文可安全重建且有封顶；`cleanup()` 只扣正数 |
| `src/services/speech.js` | 新增可选 `capability` / `utteranceTimeoutMs` 注入；新增 `watchUtterance()`；`speak()` 三个失败信号（抛错 / onerror / 超时）都上报 |
| `src/ui/components/audio-compatibility.js` | **新增**。兼容提示条，只画、只派发回调 |
| `src/styles/audio-compatibility.css` | **新增**。只作用于 `#audioCompatibility-root` |
| `src/app/runtime.js` | **接线**。先建 capability 实例，再注入 `createAudio` / `createSpeech`；`onStatus` 接到提示条 `paint()`；起手偏好改走 `AU.setVol` / `TTS.setOn`（把「玩家要不要这一路声音」告诉兼容层） |
| `index.html` | 主页 `#audioSettings` 之后新增空容器 `<div id="audioCompatibility"></div>` |
| `src/styles/game.css` | 末尾追加 `@import './audio-compatibility.css';` |
| `tests/unit/audio-compatibility.test.js` 等 4 个 + `styles` / `extraction` | **新增/更新**单元测试（含两路定时器归属、迟到 promise、重试不降级、样式表与骨架白名单） |
| `tests/e2e/audio-compatibility.spec.js` + `tests/fixtures/audio-compatibility.html` | **新增**夹具验收（端口 4192） |
| `tests/e2e/audio-compatibility-game.spec.js` | **新增**真实游戏页面验收（同一端口，独立 project metadata） |
| `playwright.audio-compat.config.mjs` | `testMatch` 扩到两条 spec；`projects.metadata` 补成 `{ target:'new', basePath }`（harness 读的就是它） |

**没有动**：`audio-settings.js`、`src/domain/**`、轮次/codec/books/战斗数值、
`package.json`/`package-lock.json`、CI、`vite.config.js`。
**已接入真实游戏**（见下「接线」一节）；本分支未 commit、未 push。

## 核心原则：只承认「观察过」的事

| 状态 | 含义 | 是否弹提示 |
|---|---|---|
| `unknown` | 还没试过 | 否 |
| `checking` | 试了但没结论（还挂着，等下一个真实手势） | 否 |
| `available` | **真的观察到** context 在 running / utterance 走完 | 否 |
| `unsupported` | 平台压根没有这套 API | 是（解释，不怪玩家） |
| `blocked` | 有 API 但被拒绝 / 一直 suspended / 朗读报错 | 是 |

四条硬规则，都有对应测试：

1. **UA 是微信不是失败判据。** 微信只决定提示文案说什么。微信里一切正常就不弹。
   （`a WeChat user agent alone never turns into a failure state`）
2. **不承诺声音能听见。** `available` 状态强制携带
   `claim: '接口已就绪，实际播放仍需设备验证'`，UI 不会把它写成「声音正常」。
3. **静音 / 关掉朗读是玩家偏好，不是故障。** `snapshot().muted` 恒为 `false`，
   兼容层绝不自动改回玩家设置（`muting the player is never reported as an audio failure`、
   `turning the voice off is a preference, never a failure state`）。
4. **只在这四种情况弹提示**：`no-api` / `resume-rejected` / `resume-timeout` /
   `utterance-error` / `utterance-timeout`。其它情况一律不打扰。

## 提示文案

- **微信里**：「点右上角『···』选择『在浏览器打开』」。**不提供**「跳到 Safari」按钮 ——
  微信内置浏览器禁止页面自己跳出去，摆一个点了必然没用的按钮是骗人
  （`a WeChat notice ... offers no fake jump button`）。微信态**也没有**「重试」。
- **非微信浏览器**：只说「可以再点一下屏幕重试，或检查设备音量／静音开关」，
  不提微信那一套。
- **`unsupported` 在微信里也给出路**：只加一句「点右上角『···』选择『在浏览器打开』」。
  那一支原来一个字都不提，玩家看到「这个浏览器不支持音效」只会更困惑 ——
  而微信里恰恰有明确做法。仍然**只是文字**（`UNSUPPORTED_WECHAT_BODY`）：
  内置浏览器禁止页面自己跳出去，摆按钮必然是骗人。
- 音效与朗读是**两件独立的事**，提示分开写（`当前浏览器暂未能播放音效` /
  `当前浏览器暂未能朗读单词`），否则玩家会去调一个根本没坏的开关。
- 全部三段都明说「不影响练习」。
- 关闭只作用于**本次会话**（内存态 `isDismissed`），不写存档、不改任何偏好。

## 两路定时器必须各自归属 ★（真实 bug）

兼容层原来只有**一个** `pendingResume` 槽位。于是**朗读那一路的任何一次收尾**
（`observeOk` 成功、`setEnabled(false)` 关掉朗读、`noCapability`、`reportUtteranceFailure`）
都会顺手清掉**音效**那路的挂起超时 —— 音效还挂在 `suspended` 上却永远停在
`checking`，玩家点多少下都等不到「浏览器放不出音效」。这就是「两路独立」被
一个共享可变槽位悄悄破坏的典型形态。

现在 `pendingResume` 是 `Map`，按 channel key 存取：每个 API 只撤自己那一路，
`dispose()` 才把两路一起收干净。判据是「sfx 自己的超时定时器仍然活着，
并且仍然能把 sfx 判成 blocked」，四条测试分别钉住
朗读成功 / 关掉朗读 / 朗读没 API / 朗读报错这四种干扰。

## 迟到 promise 不得覆盖好状态 ★（真实 bug）

连点两下屏幕 = 同一个 `AudioContext` 上两个 `resume()` promise。原来的守卫只有
`if(this.ac !== a) return`，它只挡得住「上下文被换掉」，**挡不住同一上下文上的旧
promise**：迟到的 reject 会把第二次已经拿到的 `available` 覆盖成 `blocked`，
玩家看着一个明明能出声的浏览器被反复告知放不出声。

现在每次进入 `resumeInto` 发一个递增代号 `_probeGen`，所有异步回调先验代号
（`this._probeGen === gen && this.ac === a`），过期的直接丢弃 —— 与 `speech.js`
的 `_obsSeq` 同一套思路。

## 重试不许把已有结论降级成 `checking` ★（真实 bug，E2E 抓到的）

`beginProbe` / `resolveProbe(suspended)` 原先一律回 `checking`，而 `checking`
意味着「还没结论」，UI 于是把提示条藏掉。可玩家点「知道了」的**那一下 pointerdown
本身就会触发 beginProbe** —— 提示条在 click 落地之前被自己藏起来，click 落在
空气上，提示条随后又弹回来，**永远关不掉**。

现在已经有失败结论（`blocked` / `unsupported`）的一路在重试期间**保持原状态**，
超时兜底照旧挂上（后来的成功仍可覆盖它）。只有「还没试过」才需要 `checking`。

## 接线（本分支已执行）

`runtime.js` 里的顺序是有理由的，不是随便排的：

1. **先**建 capability 实例（`onStatus` 回调里用 `audioCompatibility?.paint()`，
   组件变量用 `let` 先占位）—— 顺序反了两个服务就都拿到 `undefined`，
   探测结果没人接，表现是「微信里没声音但游戏从不提示」。用 `let` + 可选链而不是
   `const`，是为了避开 TDZ：mount 之前的状态变化只更新数据不画，mount 时的那次
   `paint()` 会把最新状态补上。
2. **再** `createAudio({ …, capability })` 与 `createSpeech({ …, capability })`。
3. 起手偏好改走 `AU.setVol(...)` 与 `TTS.setOn(...)`（不是直接赋 `AU.vol` / `TTS.on`）——
   只有这两个入口会把「玩家要不要这一路声音」告诉兼容层。直接赋值会让兼容层以为
   声音一直开着，一个静音的玩家照样被弹提示。
4. **最后**在 `createAudioSettings(...).mount()` 之后
   `audioCompatibility = createAudioCompatibility({ capability, onRetry })`
   再 `.mount($('audioCompatibility'))`。★ `create` 返回的是 `{ mount, paint }`，
   **不是** refs —— 写成 `const compat = createX().mount()` 会把 mount 的返回值
   当组件用，下一次 paint 拿不到。
5. `onRetry` 只派发 `AU.unlock()` / `TTS.unlock()`（必须发生在真实手势里，
   而这个 onclick 本身就在一次真实点击中），**绝不**替玩家把静音或关掉的朗读开回来。
6. 原有 `addEventListener('pointerdown'/'keydown'/'touchstart', audioUnlock)` 三个
   监听器**保持不动**（探测就挂在它们上面），`visibilitychange` 也不新增自动 resume。

提示条挂在主页文档流里、跟在声音设置区下面：不浮动、不压战斗页、离开主页整块隐藏。

## 手势与生命周期

- **不自动 resume。** `AU.handleVisibility()` 是**空操作**：页面切后台再回前台时
  绝不自动 `resume()` —— 自动播放策略只认真实用户手势，偷跑一次会把「能发声」
  永久变成「不能发声」。下一次真实 `pointerdown`/`keydown` 才再试。
- **resume 的 promise 拒绝必须接。** 现代浏览器用 `resume()` 返回的 promise 表达
  「自动播放被拦」，只 `try/catch` 抓不到，会变成没人处理的 unhandledrejection。
  现在两个都接，并映射到 `blocked / resume-rejected`。
- **`closed` 上下文可安全重建。** 浏览器关掉过的 context 永远不会再出声，
  `unlock()` 会换一个，但 `maxRebuilds = 3` 封顶，防止无限重建/泄漏。
  被动路径 `ctx()` 遇到 `closed` 只返回 `null`，不重建。
- **voice 计数不许扣成负数**（`cleanup()` 里 `if(this.voices>0)`）。这是**防御脏计数**：
  `cleanup` 可能被重复触发（`onended` 之后又被 close 路径调一次），也可能被**上一个已被换掉的
  context 的迟到 `onended`** 触发。
  ⚠️ 更正前一版文档的错误断言：负计数**不会**让 `maxVoices` 闸门「提前触发」——
  负数只会让闸门**更宽松**（更晚触发）。原稿把方向写反了。本任务已删掉那个错误根因，
  保留的只有「计数不许变脏」这一条本身，以及旧 context 回调不许误扣新一轮的防御性意图。

## 朗读的失败信号与「什么不算故障」

`watchUtterance(u, {text, rate})` 装监听但**绝不覆盖** utterance 上原有的
`onstart`/`onend`/`onerror`（可能是别的模块挂的回调）——先存旧的，装一个包装器。
★ 并且把**浏览器给的真事件原样传给旧回调**（不再伪造 `{target:u}`：别的模块要靠
event 里的信息），旧回调抛异常也绝不许遮住探测结论。

四个信号：① `synth.speak()` 抛错；② `utterance.onstart`；③ `utterance.onend`；
④ `utterance.onerror`。兜底超时只针对「四个都没来」的静默失败。

### 一次只观测一句（真实 bug 修点）

每次 `watchUtterance` 发一个递增 token 并**取代**上一个观测；所有回调先验 token。
前一版的三处真实故障与现在的语义：

| 症状 | 原因（修前） | 现在 |
|---|---|---|
| 静默失败被永久放过 | 旧句迟到的 `onend` 调 `clearProbeTimers()`，把**新句**的探测定时器一起清掉 | 迟到的旧事件对当前观测无效果 |
| 假故障 | 旧句迟到的 `onerror` 把新句已拿到的 `available` 覆盖成 `blocked` | 同上，旧错误不许覆盖新结果 |
| 取消后凭空报警 | `stop()` 不收定时器、不作废观测，几秒后自己冒出「朗读超时」 | `stop()` 作废当前 token + 只收它自己的定时器 |

### 「我们自己叫停」不是故障 ★

`error` 为 `canceled` / `cancelled` / `interrupted` 时**不写任何状态**。
`synth.cancel()`、换一句、退出关卡都会让在念的那句以这些类别收场 ——
把它们报成 `blocked` 的表现是**玩家正常操作却反复被弹「浏览器无法朗读」**。
真正的 `synthesis-failed` / `not-allowed` 等仍然照常上报。

### 超时不再用固定 4s

`utteranceTimeoutMs` 语义改为：

| 传值 | 行为 |
|---|---|
| 不给（`null`） | **按文本长度与语速估算**（`len*90/rate * 1.6 + 800`，下限 1200ms，上限 60s） |
| `>0 且 <60000` | 逐字使用该值（测试要能钉死一个确定值） |
| `0` | 显式关掉超时兜底 |

★ 固定 4s 会把「一句正常念完的长台词」误报成「放不出声」——它可能本来就超过 4 秒。
`onstart` 一到就立刻判定 `available` 并**解除**静默起步超时：只证明接口开始播放，
长句不因时长误报；观测归属仍保留到 end/error/stop，开始后的真实播放错误照常上报。
仍然没有任何事件的静默 utterance 超时 → `blocked`。
`onstart` 只代表**接口可用**，措辞仍由 `AVAILABLE_CLAIM` 把关，不声称真机能听见。

### 偏好闸门：`cap.setEnabled(channel, bool)` ★

父层把玩家偏好接进来（`TTS.setOn` → `disableChannel`/`enableChannel`，
`AU.setVol` → `setEnabled(SFX, !muted)`）。关着的一路**一个状态都不写**，连
`checking` 都不写。`unlock()` 仍会**照常暖机**（对玩家有利），但绝不因此报
`unsupported`/`blocked` 去打扰他。关掉时顺带**撤掉**已挂着的失败提示
（状态回 `unknown`）—— 玩家自己选择不听了，继续弹既吵又误导；
但**已经 `available` 的一路保持 `available`**，那是观察到的事实，不是提示。

### 构造时不抢先报 `no-api`

`createSpeech` 构造时**不**报 `no-api`：父层此时还没恢复存档里的朗读开关，
一个本来就把朗读关掉的玩家不该一进游戏就被弹「浏览器不支持朗读」。
真正用到时（`unlock()`/`speak()`）才判，那时才知道玩家是不是自己想听。
`unlock()` 里也只有 `T.on` 为真才报 `no-api`。

探测**绝不发声**：暖机仍是原来的 `volume=0` 空串（`the priming utterance stays silent`），
`watchUtterance` 本身不入队任何 utterance（`watching never speaks`）。
只挂监听器不算「正在发声」，所以 `T.on=false` 时 `speak()` 直接返回、不开探测。
**没注入 `capability` 时 `watchUtterance` 完全不动 utterance**（不装回调、不设定时器），
老调用方签名与行为逐字保留。

## 契约（签名兼容，老调用方零改动）

```js
// 全部是可选注入。不给 = 完全不启用兼容层，行为与原来逐字一致。
createAudio({ getCombo, environment, capability })        // 新增第 3 个可选参数
createSpeech({ heroVoice, curHeroId, rnd, voiceLines, foeLineCfg, onChange,
               environment, capability, utteranceTimeoutMs })   // 新增后 3 个可选参数
```

`createAudioCapability({ environment, onStatus, resumeTimeoutMs, setTimer, clearTimer })`
返回 `{ beginProbe, resolveProbe, rejectProbe, noCapability, reportUtteranceFailure,
observeOk, setEnabled, isEnabled, disableChannel, enableChannel,
snapshot, channelState, dismiss, isDismissed, resetDismiss, canRetry, dispose }`。
时间与定时器全部注入，Node 里可零延迟跑完整条状态机。

★ **父层必须接的偏好契约**：`capability.setEnabled(CHANNEL.SPEECH, !!DB.voice)` 与
`capability.setEnabled(CHANNEL.SFX, vol > 0)`。两个服务已各自在自己内部接好了
（`TTS.setOn` / `AU.setVol`），但如果父层在别处直接改这两个偏好，就自己补一次调用。
不接的后果只是「玩家静音时仍可能被提示」，不会导致误判可用或功能异常。

`createAudioCompatibility({ capability, document, onRetry })` → `{ mount, paint }`，
与 `audio-settings.js` 同风格：不读 `DB`/`G`/`B`、不写 `innerHTML`、不带内联 style、
不联网、不加载任何录音（两条结构约束有测试钉死）。

## 测试与真实结果

全部用 Node 24 原生二进制 + Python `subprocess` argv 直读退出码与完整
stdout/stderr（不用 grep/tail 判绿），日志落在 `%TMPDIR%\t19\`。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node --test tests/unit/speech-failure.test.js`（本轮 GREEN） | 0 | 24 pass（RED：14 项真实 bug 断言 → rc=1） |
| `node --test tests/unit/audio-compatibility-sfx.test.js`（本轮 GREEN） | 0 | 17 pass（RED：4 项静音偏好断言 → rc=1） |
| `node --test tests/unit/*.test.js`（全套 38 个文件，接线轮） | 0 | **546 pass / 0 fail**（接线前 538；本轮新增 8 项） |
| `playwright test --config=playwright.audio-compat.config.mjs`（接线轮） | 0 | **16 passed**（真 Chrome，独立端口 4192；夹具 9 + 真实游戏页 7） |

### 接线轮的 TDD 记录

先只加测试、不改源码，`tests/unit/audio-compatibility.test.js` 新增 4 项
（朗读成功 / 关掉朗读 / 朗读没 API / 朗读报错 都不许撤掉 sfx 的挂起超时；
`dispose` 清两路）+ `audio-compatibility-sfx.test.js` 新增 1 项（迟到 promise）
+ `audio-compatibility-ui.test.js` 新增 2 项（`unsupported` 在微信里也给出路），
再在 `audio-capability.js` / `audio.js` / `audio-compatibility.js` 上转绿。
真实页面 E2E 也先 RED：`git stash` 掉 `runtime.js`/`index.html`/`game.css`
三处接线后，7 条里 **6 条失败**（第 1 条「从不提示」在未接线时恰好成立），
恢复接线后全绿 —— 证明这批断言真的在验收接线，不是空跑。

其中一处断言由我写错后改正：存档字段清单原本硬编码成 8 个，实际应用自己还会补
`rewards`/`kbMode`/`kbUpper`/`unitProgress`。改成「不得超出 seed ∪ 应用合法字段」
的相对判据，而不是放宽成「什么都行」。

本轮 TDD 记录：先只加测试、不改源码，`speech-failure` + `audio-compatibility-sfx`
共 **14 项失败**（取消被误报、旧 end 清掉新定时器、旧 error 覆盖新成功、`stop()` 不收定时器、
`onstart` 未被使用、固定 deadline 误报长句、伪造事件、无 cap 仍开探测、构造时抢先报
`no-api`、静音仍报警等），全部为真实断言而非编译错误；再改三个服务转绿。
其中一处断言由我写错后修正：静音期间该路**一个状态都不写**（`unknown`），
而不是我最初写的 `checking` —— 源码行为更强，改正断言而非放宽源码。

### 变异测试（证明测试真的加载了被改的代码）

4 个变异体全部被杀，源码随后还原并复跑通过：

| 变异 | 结果 |
|---|---|
| `RANK` 里 `available:2`/`unknown:1` 互换 | rc=1，4 项失败 |
| `if(p&&typeof p.then==='function')` → `if(false)`（不接 resume 拒绝） | rc=1，1 项失败 |
| `u.onerror=fail` → `u.onerror=prevErr`（覆盖别人的回调） | rc=1，1 项失败 |
| 微信态加回 `open-external` 假跳转按钮 | rc=1，2 项失败 |

### E2E 抓到一个真 bug（单元 stub 掩盖了）

第一版 `paint()` 写的是 `refs.acts.children.length = 0`。
`children` 是**实时只读**的 `HTMLCollection`，而 ES module 是严格模式 —— 这行直接抛
`TypeError`，`paint()` 断在那里，真浏览器里**提示条根本画不出按钮**（4 项 E2E 失败，
但 12 项单元测试全绿）。已改为 `while(firstChild) removeChild(firstChild)`，
并把单元测试的 DOM stub 改成只读 `children` + 实时 `firstChild`，让它**不再掩盖**
这类严格模式错误。这条同时说明：DOM stub 必须贴近真浏览器语义，否则单测的绿灯是假的。

### 真实页面 E2E 又抓到一个真 bug（单元与夹具都测不到）

「知道了」按钮在真实游戏页面上**点不掉**：`pointerdown` 触发的 `beginProbe` /
`resolveProbe(suspended)` 把状态降级成 `checking` → 提示条在 `click` 落地之前
被自己 `hidden` 掉 → click 落在空气上 → 稍后 reject 落地，提示条又弹回来。
**单元测试全绿、夹具 E2E 也全绿**（夹具的假 capability 不会发 pointerdown），
只有跑在真实页面上、让真实的 `addEventListener('pointerdown', audioUnlock)` 参与
才会暴露。修法见上「重试不许把已有结论降级成 `checking`」。


## 未验证 / 硬限制（请勿对外宣称）

1. **微信 iOS / 安卓真机完全未实测。** 本分支只验证了「API 层失败 → 提示出现 →
   可关闭 → 布局不破」这一条链。真机仍需人工确认：微信内置浏览器里 AudioContext
   到底停在哪个状态、`speechSynthesis` 是否真的静默、右上角菜单文案是否如描述、
   系统 TTS 音色是否真的出声。**这是发布前的硬限制，不是「已验证可用」。**
2. **静态降级路径可发布，真机行为未知。** 新代码在失败时只会更安静地降级
   （提示可关、玩法不变），所以合并不构成线上风险；但「提示在真机上是否会出现」
   这个问题，本任务无法回答。
3. **真实游戏页面 E2E 只模拟浏览器 API，不模拟游戏逻辑。** 用 `addInitScript` 换掉
   `AudioContext` / `speechSynthesis`（DOM、onclick、状态机、存档、战斗流程全部是
   应用自己的）。它证明的是「接线接得上、且不影响练词」，**不**证明真机可听。
   ⚠️ 写这类桩有两个真实的坑（都踩过）：`window.speechSynthesis` / `window.AudioContext`
   在 Chrome 上是**只读访问器**，直接赋值会被静默丢弃，必须 `Object.defineProperty`；
   而 Playwright 的点击是**可信手势**，Chrome 会在内部把 AudioContext 直接恢复成
   `running`，只拦 `resume()` 永远测不到失败分支，必须连 `state` 一起钉住。
4. **样式表 / 骨架守卫已在本分支更新，但仍可能与并行任务撞车。**
   `tests/unit/styles.test.js` 的 `ADDED` 与 `tests/unit/extraction.test.js` 的
   `ADDED_CSS` 现在都包含 `./audio-compatibility.css`；`PAUSE_ONLY_NEW` 里加了
   提示条容器（含注释）的精确剥离正则，并补了一条**正向**断言确保它真的在页面上
   （否则剥离会静默失配，「骨架一致」变成永远为真的假通过）。
   ★ 原始七张样式表仍与归档逐字相同，白名单仍是逐条选择器前缀核对，
   **没有**笼统放宽。`@media` 只是被摘掉前导语句让内部规则照样被核对。
   若并行任务也在加样式表，需要合并这三处清单。
5. **未跑 `npm run check` 全套。** 按分工只跑本任务的单元 + 独立 E2E
   （+ 主配置的 `--project=new` 回归）；
   `check:data` / `build` / `test:build` / `test:e2e` / `test:release` 留给整合者在
   合并后跑完整套。
6. **本分支未 commit、未 push。** 工作区改动留在
   `C:/Users/frank/projects/vocab-agent-audio-compat`（HEAD 仍是 `7298095`）。
