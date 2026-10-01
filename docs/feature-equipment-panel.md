# 战斗页「装备与能力」面板

在战斗页道具栏（`#fItems`）下方新增一个折叠面板 `<details id="fEquipment">`，
把**本局已持有的全部装备**摊开给玩家看：角色被动、护盾、每一件遗物、
影分身额度、每一件道具的持有数与本场上限。折叠时是一行紧凑摘要
`装备与能力 · N`，点开逐条显示效果文案。

## 解决什么问题

以前战斗页只有道具栏能看到自己的东西，而且：

- 遗物**最多只露出前三个**，买到第四件之后玩家根本不知道自己拥有它；
- 角色被动（学者多 1 次提示、游侠每字回血……）在战斗中完全不可见；
- 道具「本场已用 N/上限」只有 `title` 提示，手机上没有 hover，等于没有；
- 影分身是一次性资源，用掉之后除了跳过按钮文案外没有第二处说明。

## 改动文件

| 文件 | 性质 | 说明 |
|---|---|---|
| `src/ui/components/equipment-panel.js` | 新增 | 纯展示模块：导出 `equipmentModel()`（无 DOM 的纯规则）与 `createEquipmentPanel()`（渲染） |
| `src/styles/equipment-panel.css` | 新增 | 只作用于 `.equip` / `#fEquipment` 及后代 |
| `src/styles/game.css` | 改 1 行 | 在 `pause.css` **之前**追加 `@import './equipment-panel.css'` |
| `src/ui/screens/fight.js` | 改 3 行 | 1 行 import + 1 行实例化 + `renderFight()` 末尾 1 行调用 |
| `tests/unit/equipment-panel.test.js` | 新增 | 17 条单元回归 |
| `tests/e2e/equipment-panel.spec.js` | 新增 | 13 条真实浏览器回归 |
| `playwright.parallel.config.mjs` | 新增（未跟踪） | 本地并行脚手架，端口 4183 隔离 |

**未改动**：`index.html`（面板由 JS 在 `#fItems` 之后动态创建）、`src/app/**`、
存档格式、任何数值规则、词库、版本、`package.json`、CI。

## 契约

1. **纯只读**。面板不补提示次数、不重新施加遗物护盾、不改 `usedThisFight`、
   不动 `ghostUsed`。`renderFight` 每次都会调它，任何副作用都会变成
   「每敲一个字母就重复触发一次」的隐性数值 bug。单测与 e2e 都断言
   渲染前后 `G`/`B` 逐字段不变。
2. **角色被动读 `G.heroId`**（本局远征选的英雄），不是 `DB.hero`（主页上次选的）。
3. **遗物全部列出**，不截断。重复遗物合并成 `×N`，但只改计数不改效果 ——
   叠两遍护盾符文不会多给一次护盾，所以文案不许出现第二遍。
4. **护盾**：战斗中读真实 `B.shield`（本场可能已被打掉），不在战斗才读 `G.shield`。
   两处来源在文案里都写明。
5. **影分身额度是 run 级**（`G.ghostUsed`），换战斗不重置；用掉显示「本轮已耗尽」。
6. **未知 id 安全降级**。存档里的 `relics`/`bag` 是用户可写字段，拼进 `innerHTML`
   就是存储型 XSS。所有内容一律走 `textContent`，未知 id 渲染成
   `未知装备（<原始 id>）` —— 玩家能认出是哪一条，但它永远不会被解析成元素。
7. **手机上不依赖 hover**。所有效果文案展开后直接可见，单测断言面板内
   `title` 属性数为 0。
8. **重渲染不折叠**。`createEquipmentPanel` 闭包持有同一个 `<details>` 元素复用，
   只改内容不动 `open` —— 战斗每敲一个字母都会 `renderFight()`，重建元素会把
   玩家刚展开的面板收起来。

## 布局与移动端

面板长在 `.fmid` 里，也就是 `responsive.css` 已经设为 `flex:1 1 auto;
overflow-y:auto` 的中段滚动区。内容比中段高时由 `.fmid` 内部滚动消化，
**不会盖住**钉在底部的字母盘与提示/跳过/逃跑按钮。

- 行布局用 `grid-template-columns: minmax(0, 7em) minmax(0, 1fr)`，
  320px 下名称列自己收缩，右列永远拿得到剩余宽度；
- 名称与效果都带 `overflow-wrap: anywhere`，未知 id 里的长串撑不破窄屏；
- 样式表刻意只用纯 `.equip` 选择器（不用媒体查询），便于逐条核对作用域。

e2e 在 320/390 两个视口断言：无横向溢出、面板被裁在 `.fmid` 框内、
展开状态下点字母盘的事件**真的到达** `#fBank`。

## 与道具栏的分工

`#fItems` 是**操作**区（点一下消耗道具），本面板是**只读**清单。
两者共用同一份 `G.bag` / `B.usedThisFight`，不重复记账。
e2e 验证点道具栏按钮会消耗道具并同步面板计数；道具用满本场上限时，
面板标「已用满」、道具栏按钮同步 `off`。

道具行沿用 `#fItems` 的口径（`owned > 0` 才列出）：背包数量归零后整行消失，
和道具栏保持一致，而不是留一条 0 库存的行。

## 验收

RED→GREEN 垂直推进。命令与真实结果（Node v24.19.0，Python
`subprocess.run(argv)` 取 `returncode`）：

| 命令 | RC | 结果 |
|---|---|---|
| `node --test tests/unit/equipment-panel.test.js` | 0 | 17 passed / 0 failed |
| `playwright test --config=playwright.parallel.config.mjs --project=new` | 0 | 13 passed / 0 failed |
| `node --test tests/unit/ui-modules.test.js`（共享回归） | 0 | 25 passed / 0 failed |

RED 起点：`ERR_MODULE_NOT_FOUND`（模块尚不存在）。

**变异测试**：把实现改回 `relics.slice(0,3)` 并把护盾改回读 `G.shield`，
单元 17 → fail 2（`never truncated to the first three`、`real in-fight B.shield`），
e2e 13 → fail 2（同两项）。证明两套断言真的加载了被修改的目标模块。

### 需要整合者处理

- **`tests/unit/styles.test.js` 目前失败（RC=1）**，这是预期内的样式基线冲突：
  该测试把「唯一新增的样式表」硬编码为 `const OWNED = './pause.css'`，并断言
  其余七张表拼接后与归档版本逐字相同。本任务新增了第八张
  `equipment-panel.css`，需要整合者把 `OWNED` 扩展成允许追加的文件列表。
  整合时建议保留原约束：新增文件必须排在 `pause.css` 之前，且其每条选择器
  必须以 `#s-pause`/`#continueRow`（本任务则是 `.equip`/`#fEquipment`）开头。
  已按该测试的同一条作用域规则自查：22 条选择器全部在 `.equip` 命名空间内
  （原先的两个 `@media` 已改为纯选择器方案）。
- `playwright.parallel.config.mjs` 是本地并行脚手架，**不应提交**。
  端口 4183 与主仓 4173、兄弟 worktree 4181/4182 隔离（`strictPort` +
  `reuseExistingServer:false`），vite 用本 worktree 的绝对路径。

## 未验证

- 未在 iPhone / 安卓真机查看：仅在 Chromium 的 320/390 视口做了几何与点击断言。
- 未跑全量 `npm run check`（按任务约定只跑精确 unit + 本功能 e2e + 共享
  `ui-modules` 回归）；未跑 `test:build` / `test:release`。
- 折叠面板在真实移动端浏览器上的滚动手感（`.fmid` 内部滚动）未做主观评估。