# 主页声音设置区（音效 + 单词朗读）

把两个声音开关从「浮在页面上的图标」收成主页下方一块明确的设置区，并删掉右上角的浮动开关。
战斗页的「🔊 听读音」完全不动。

## 改了什么

| 位置 | 改动 |
|---|---|
| `src/ui/components/audio-settings.js` | 新增。可测试的 `createAudioSettings()` + 纯函数 `nearestVolStep / volState / voiceState` |
| `index.html` | 主页 `#s-title` 里的 `.volrow` 换成空容器 `<div id="audioSettings">`（按钮由模块画） |
| `src/app/runtime.js` | 删掉 `mountVolBtn` / `mountVoiceBtn` 两个 IIFE 与浮动按钮的内联定位；`syncVoiceBtn()` 变成空转兼容入口 |
| `src/styles/audio-settings.css` | 新增，只作用于 `#audioSettings` |
| `src/styles/game.css` | 末尾追加一行 `@import './audio-settings.css'` |

## 为什么删掉右上角那个浮层

旧实现是一个 `position:fixed; top:10px; right:60px` 的按钮，由 runtime 用
`document.body.appendChild()` 挂上去的 —— **它不属于任何一层界面**，所以：

- 窄屏手机上它和战斗页 sticky HUD 右上角的敌方血条数字直接重叠；
- 它会跟着玩家飘到地图、奖励、暂停等每一页；
- 为了让它在战斗页消失，旧代码挂了一个 `MutationObserver` 监听
  `document.body` 上所有 `class` 变化，再加一个 `resize` 监听，只为手工切
  `style.display`。

现在按钮住在 `#s-title` 里的 `#audioSettings` 容器中：属于主页文档流，
离开主页就整块不渲染（`.screen` 机制天然完成），观察器与 resize 监听都不再需要。
`syncVoiceBtn()` 保留为空的兼容入口，因为 `show()` 仍会调它。

## 契约

模块**只画、只派发回调**：

- `audio: { vol(), muted() }` / `tts: { supported(), on() }` —— 只读当前值，不缓存。
- `onVolumeStep(dir: +1|-1)` —— 左键前进一档、右键后退一档，父层负责 `AU.setVol` + 落盘。
- `onVoiceToggle(force?)` —— 传 `true`（右键）表示直接开。

状态所有权完全在 runtime：音量档位 `VOL_STEPS=[.55,.3,.12,0]`、存档字段
`DB.vol` / `DB.mute` / `DB.voice`、以及 `commit(false)` 的落盘时机都没有变化。
模块不读全局（不认 `DB`/`G`/`B`/`TTS`），不写 `innerHTML`，不带任何内联 style。

平台没有 `speechSynthesis` 时：朗读那一行**禁用**并显示「不可用 + 一句解释」，
点击不改变任何状态；音效那一行照常可用，游戏玩法一行不变。

## 保持不变

- id 兼容：`volBtn` / `volVal` / `voiceBtn` 全部保留（另加 `voiceVal` 显示当前值）。
- 战斗页 `#tSay`「听读音」原样保留：慢速朗读当前词，长按连读两遍，
  **仍然消耗一次 `B.hints`**，不揭示字母、不代填输入。
- 拼完整词的自动朗读走 `TTS.word()`，不消耗提示次数。
- 存档 schema（`wy8a_rogue_v1`）不变；老存档缺 `voice` 字段仍默认开。

## 测试

```sh
# 单元：模块 DOM 契约 + 接线层的结构约束
node --test tests/unit/audio-settings.test.js

# E2E：真实 Chrome，独立端口 4182
node node_modules/@playwright/test/cli.js test \
  --config=playwright.parallel.config.mjs tests/e2e/audio-settings.spec.js
```

单元测试除了断言画了什么、按了回调什么，还钉死两条结构约束：
面板里**不许出现任何内联 style**，以及**不许用 innerHTML 拼 DOM**。
E2E 断言 `getComputedStyle(#voiceBtn).position !== 'fixed'`、无内联 style、
`closest('.screen').id === 's-title'`、离开主页整块无盒子，
并在 320px / 390px 上核对不横向溢出、不遮 HUD。

## 未验证 / 需要整合者处理

1. **iPhone / 安卓实机试听未做。** 浏览器自动化不能替代真机确认：
   音量四档在手机音量键并用时是否听得清、系统 TTS 音色是否真的出声、
   Safari 地址栏高度下设置区是否被遮。
2. **两个既有基线守卫断言的是「新增样式只有 pause.css 一张」**
   （`tests/unit/extraction.test.js` 的 `CSS extraction preserves cascade order`、
   `page skeleton preserves approved character parts`，
   以及 `tests/unit/styles.test.js` 的 `split styles retain every original rule`）。
   它们现在失败，因为本功能是第二张新增样式表、且把归档里的 `.volrow` 换成了
   `#audioSettings`。已独立验证：**原有七张样式表与归档逐字相同**，
   骨架差异**仅限** `.volrow` → `#audioSettings` 这一处替换。
   这三个断言的豁免名单需要整合者统一更新（并行任务都会撞同一处）。
3. **`tests/e2e/pause-resume.spec.js:854`**
   「toggling voice with an expedition running saves it together with the snapshot」
   在地图页点 `#voiceBtn`，现在点不到了（按钮只在主页）。它的**不变量仍然成立** ——
   本任务的 `toggling voice from the home page keeps the running expedition snapshot intact`
   用「暂停 → 返回主页 → 切语音」的路径证明了同一件事。旧测试需要整合者改路径
   （它属于并行任务的范围，未在本分支改动）。
