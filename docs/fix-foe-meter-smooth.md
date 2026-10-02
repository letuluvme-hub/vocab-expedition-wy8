# 蓄力条卡顿修复（fix: smooth-foe-countdown）

用户线上实测：战斗页的蓄力条**一顿一顿**，像坏了。

## 症状与实测证据

在真实 Chrome、`prefers-reduced-motion: no-preference`（默认动效路径）、50ms 间隔
取样蓄力条填充元素的**视觉 bbox**（`getBoundingClientRect().width`）：

- 修复前，29 个采样间隔里有 **10 个宽度完全不变**（≈35%），呈阶梯状：
  `[173, 173, 172.3, 171.3, 170.6, 170.6, 170.6, 166.8, ...]`
  —— 一段密集下移、然后突然静止。
- 计算样式是 `transition: width 0.12s linear`。
- reduce 下 22/29 帧静止 —— 那是**应有的**静止，不是 bug（见下文降级）。

父代理的独立取样（`scratch/foe-stutter-normal-v3.json`）与我这次在
1024px 视口的取样结论一致；1024px 下静止比例更高（77%），因为条更长、
每一跳的绝对差值更大但相对节拍不变。

## 根因

两条独立的原因，叠加起来正好解释「卡」：

1. **过渡时长短于刷新节拍。** JS 每 250ms 写一次进度，CSS 过渡只有 120ms。
   每拍必然是「动 120ms、停 130ms」，半程静止。
2. **`width` 是 layout 属性。** 每一次进度变化都触发重排；不是合成器在跑，
   而是主线程在反复布局。

外加第三条，放大了症状：每打一个字母 `renderFight` 都会调 `paint()`，
而旧的 `paint()` 无条件 `box.innerHTML = ''` 整块重建 —— 进度条节点被换掉，
动画从 0 重新开始。实测 `before === after` 为 `false`、`before.isConnected`
为 `false`，证实确实重建了。

## 修法

### 进度走 `transform`，不走 `width`

`src/styles/foe-attacks.css`：

```css
.foeAtkBar>i{ width:100%; transform-origin:left center;
               transition:transform .26s linear }
```

`src/ui/components/foe-attack-meter.js` 只写 `transform: scaleX(ratio)`，
**从不写 `width`**。

- `transform` 是合成属性：不触发布局、不重绘光栅，交给合成器逐帧跑。
- `transform-origin: left center` 让条「从左往右退」。默认的 `center`
  会让它从中间向两边缩 —— 那是另一个方向的视觉 bug。
- **`.26s` 略长于 250ms 节拍**：相邻两拍的过渡首尾重叠，于是任何时刻画面上
  都**有一个正在跑的过渡**，不再有「动完就停」的静止缝隙。再长会拖尾、
  再短（≤250ms）会重新出现缝隙，所以这个区间被测试钉住（`>0.25s` 且 `≤0.3s`）。
- `will-change: transform` **只挂在 `.tel` 上**：只在真的在动时占合成层，
  不写进通配规则。

### 同相位复用节点

`paint()` 不再无条件重建。满足以下全部条件时原地复用同一批节点：

- 同一个容器（`refs.box === box`）
- 节点仍接在文档上（换屏后旧的已断开）
- 相位相同、伤害相同、总窗口 `telegraphMs` 相同

`paintLive()` 用同一套判据。打一个字母触发的 `renderFight` 现在**不再重建
进度条**（e2e 断言 `sameNode === true`）。相位变了 / window 变了 / 节点断连
才允许重建 —— 宁可多花一次，也绝不把上一相位的残骸留在屏幕上。

真实 `renderFight` 还需要从控制器取得当下的派生剩余，而不能重画上次落盘的旧值。父层用真实提示点击复现进度从401.8px涨到500.2px，已添加失败测试并接入 `getFoeAttackFact:()=>foeAttackCtl.captureFact()`。它不改战斗事实或写存档，仅修正展示输入。另把controller.start的dueAt初始化移到首屏render前，第二场不再读取旧截止时间。

### 不重写没变的东西

250ms 节拍每秒四次，而秒数每秒只变一次。现在 `className` 与 `textContent`
都是「变了才写」：同一秒内连刷四次，一次都不会重写那段长文案。

### reduced-motion 的降级

**降级全部在 CSS 里，组件绝不查询 `matchMedia`** —— 两处真相迟早打架。
`@media (prefers-reduced-motion:reduce)` 下：

- `transition: none`
- **`.foeAtk.tel .foeAtkBar { display: none }`** —— 整条跳动条藏起来。

为什么是「藏」而不是「留着但不过渡」：reduce 下 JS 仍会每 250ms 写一次
`scaleX`，留着就变成「每 250ms 无过渡地猛跳一格」，比不显示更糟。
藏起来之后，**秒数文案是唯一且显眼的时间来源**，而它本来就每秒才变一次。

### 时基不变

没有新增 `requestAnimationFrame` / `setInterval`。250ms 的 lifecycle 节拍
仍是唯一时基；动画完全交给 CSS 合成器。暂停/冻结/换屏由既有 lifecycle 机制
负责 —— 暂停时组件不再被调用，进度就停在原地，不后台耗 CPU。

## 已知取舍

- **过渡残留 ≤ ~260ms。** 暂停/切屏发生在过渡进行到一半时，画面上会看到
  条停在当前位置、而不是冻结值。这是可接受的：残留上限就是过渡本身的长度，
  且**只影响观感，不影响任何数值**（伤害、相位、剩余时间都由
  `app/foe-attacks.js` 算，UI 只是读）。e2e 用例
  「继续后按真实剩余同步」钉住了继续后不漏、不重启旧链、不归零。
- **`scaleX` 精度 4 位小数。** 1 位量化会让每一跳肉眼可见地跳一格。

## 测试

新增 `tests/unit/foe-meter-smooth.test.js`（12 例）与
`tests/e2e/foe-meter-smooth.spec.js`（8 例）。

**方法论上的三条声明：**

1. 断言的是**视觉 bbox**，不是内联样式。过渡期间内联值早就写到终值了，
   只有 bbox 反映画面上真正看到的东西。
2. **关键用例显式 `test.use({ reducedMotion: 'no-preference' })`。**
   本仓库 `playwright.config.js` 全局是 `reduce`，且 `responsive.css` 里有
   `*{transition-duration:.01ms !important}` —— 在 reduce 下量「顺滑」只会
   得到恒绿的假象（那里本来就该静止）。所以测的是**线上默认**那条路径，
   另有一组显式 `reduce` 的用例覆盖降级行为。
3. 真实 Chrome + 真实墙钟，没有加速任何定时器。**这仍不等于真机** ——
   iOS/Android 浏览器的后台节流行为需人工验证。

核心断言：50ms 间隔的相邻帧里「完全没动」的比例必须 < 15%（修复前 35%~77%）。

**红绿验证记录：** 实现前 7/12 unit 与 4/6 e2e 红（失败原因是缺 `transform`、
缺节点复用、`transition` 还是 `.12s`、reduce 下条仍显示）。另做过一次
**变异测试**：把 `.26s` 改回 `.12s`，「连续运动」与「过渡时长」两条如期转红 ——
证明它们不是空跑。另有 3 处失败源于我自己的测试数据写错（`ceil` 边界、
初始比例不是 1、`3900ms` 本就跨秒），已修正测试而非放宽断言。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/ui/components/foe-attack-meter.js` | 进度改 `scaleX`；同相位复用节点；变了才写 class/文案 |
| `src/styles/foe-attacks.css` | `width:100%` + `transform-origin` + `transition:transform .26s`；`will-change` 仅 `.tel`；reduce 降级 |
| `tests/unit/foe-meter-smooth.test.js` | 新增，12 例 |
| `tests/e2e/foe-meter-smooth.spec.js` | 新增，8 例 |
| `tests/unit/foe-attack-atomic.test.js` | 一条既有用例改读 `transform`（原读 `width`），功能断言不变 |
| `tests/e2e/foe-attack.spec.js` | 三处进度读取改读视觉 bbox / `scaleX`（原读内联 `width`），功能断言不变 |

**未触碰**：战斗状态、伤害、存档、相位推进、lifecycle 时基 —— 全部留在
`src/app/foe-attacks.js` 与 `src/domain/`，本次只动展示层。