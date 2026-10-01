# 默认字母盘改为 QWERTY

一句话：**新存档和没有 `kbMode` 字段的旧存档进入游戏时，字母盘默认是电脑 QWERTY 键盘排布**；玩家自己选过的偏好（尤其是明确选了网格 `false`）保持不变。

## 为什么

乱序网格是"手机点屏时代"的排布。绝大多数玩家用的是带实体键盘的设备/外接键盘，而英语字母键盘本身就是 QWERTY 三行：让字母盘跟手的位置一致，玩家找字母的时间更短、误触更少。网格模式保留为一个可选偏好，而不是新用户的默认落点。

改动只有一行，位于唯一做默认化的地方：

```js
// src/services/storage.js → initializeDB()
db.kbMode = db.kbMode === undefined ? true : !!db.kbMode;   // 旧：!!db.kbMode
```

## 三条判定规则

`initializeDB()` 是in-place 默认化，**不是 schema 迁移**（不写 `schemaVersion`，不加marker）：

| 存档里的 `kbMode` | 结果 | 理由 |
| --- | --- | --- |
| 字段不存在 / `undefined` | `true` | 新用户与没有该偏好的旧存档 → QWERTY |
| `false` | `false` | 玩家自己选过网格，尊重它 |
| `true` | `true` | — |
| 旧档里的数字/字符串（`0`/`1`/`'yes'`/`''`/`null`） | `!!` 原样兼容 | 不擅自迁移历史值 |

`db.kbMode === undefined` 而不是 `!db.kbMode`：只有"字段缺失"才吃默认值，`null` 属于"字段存在"，按既有 `!!` 规则落到 `false`，和改动前一致。

### 明确不动的部分

- **`kbUpper` 默认值不变**，仍是 `false`。大写显示是另一个独立偏好。
- **未知字段、`activeRun` 快照原样保留**：`initializeDB` 只碰它列出的那几个键。
- **存档 key 仍是 `wy8a_rogue_v1`**，既有字段名与形状不变。
- **归档旧页 `tests/fixtures/legacy.html` 不改**：它保留自己历史版本的默认值，baseline 规格负责对照它。

## 没有 localStorage 的设备

`storage.load()` 拿不到东西时 `initializeDB(null)` 走的是同一条路，所以 `kbMode` 同样是 `true`——禁用存储的设备照样能进游戏、拿到可玩的 QWERTY 字母盘，而不是卡在网格默认或白屏。

## 测试

`tests/unit/keyboard-default.test.js`（新增）：默认 `true`、双向显式偏好保留、旧值 `!!` 兼容、无 schema marker 且不丢 `activeRun`/未知字段。

`tests/unit/storage.test.js`：两处旧的 `kbMode: false` 默认期望改成新的准确期望（缺字段 → `true`）。同文件里"旧档里 `kbMode: 'yes'` → `true`"等兼容断言**故意保留**，它们锁的是"不迁移"这条规则。

`tests/e2e/keyboard-default.spec.js`（新增）：真实浏览器里进战斗，断言 `#fBank` 的 class 是 `kb` 而不是只读内部状态；`saved: { kbMode: false }` 存盘后 reload 仍是网格；打到一半切到网格再 reload，半词不丢、`mastered` 不被污染；`localStorage` getter 抛错的设备仍能玩。只针对 `new` 目标，`legacy` 归档页那两条按其历史行为 skip。

## 已知需要整合者处理的遗留

这两条**现存** E2E 断言的是改动前的 `false` 默认，需要整合者决定是改期望还是改fixture（本任务未越界修改）：

- `tests/e2e/baseline.spec.js:79` — "old save without newer preferences" 里 `expect(db.kbMode).toBe(false)`，且同一条后面 `await expect(page.locator('#fBank')).not.toHaveClass(/kb/)`。新默认下应是 `true` / `toHaveClass(/kb/)`。
- `tests/e2e/combat.spec.js:106` — "QWERTY uppercase switches…" 只点一次 `#tBankMode` 就期望进入 `kb`。新默认下已是 `kb`，需要点两次（或让 `game.open({ saved: { kbMode: false } })`），否则一次点击反而切回网格。

## 未验证

- 未跑全量 `npm test` / `npm run check`（由整合者跑合并后全套）。
- 未跑 `--project=legacy` 全量 baseline 对照；归档源码未改，但新默认对 legacy 规格的影响只做了单点确认。
- iPhone / 安卓真机的键盘高度、安全区与短语布局未实测（自动化不替代真机）。