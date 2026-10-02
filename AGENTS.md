# Agent 开发约定

## 首先读取

- `README.md`、`docs/architecture.md`、`docs/baseline.json`。
- 不要把桌面旧单文件覆盖仓库最新代码。
- 当前 `src/app/runtime.js` 是启动与模块装配层，新功能优先进入所属controller/domain/ui模块。

## 所有权与依赖

| 区域 | 责任 | 禁止 |
|---|---|---|
| `src/data/**` | 教材/角色/敌人/数值数据 | 混入 DOM、状态或存档 |
| `src/domain/**` | 显式传参的规则 | 直接读 window、DB/G/B、localStorage |
| `src/services/**` | 浏览器能力与存储适配 | 偷读远征/战斗全局状态 |
| `src/ui/**`、`src/styles/**` | 展示/动画 | 改掌握判定和数值规则 |
| `src/app/**` | 整合者拥有的调用顺序与状态协调 | 多个 Agent 并发改同一文件 |

接口变更、package/lock、Vite、CI 和共享协调入口由整合者管理。需要跨边界改动时先报告，由整合者分配，不擅自扩展写入范围。

## 并行开发

1. 每任务独立分支与 git worktree；一个 worktree 一个写入者。
2. 拆任务前先固定接口、可修改路径、禁止路径和验收命令。
3. 测试与实现可以分配不同路径，但测试 API 必须预先约定。
4. 不提交 dist、node_modules、调试日志、浏览器报告或用户存档。
5. 不自动 push main、合并 PR 或发布；发布必须验证基线未被别人更新。

## 必须保持的行为

- 259 条原始词库内容、顺序、难度、主题和释义，不顺手校正。
- 键盘与点击走同一输入路径；重复字母、短语、连字符可完成。
- 半词击杀不算学会；整词完成只记一次；错词进入复习。
- 逃跑/跳过 BOSS 不算通关；单元导航与纪念卡不能暗示全册已经掌握。
- `wy8a_rogue_v1`、既有字段及未知字段兼容；不把 Set 直接 JSON 保存。
- 音效与语音缺失或失败不影响玩法；API 模拟成功不代表真机可听。
- 移动端 HUD、底部按钮、安全区与短语布局不回退。
- 保留用户已认可的角色/怪物形象，CSS 覆盖顺序不可随意重排。

## 测试与验收

新规则/修复先写失败测试，再实现、跑绿。结构提取先对旧版真实行为建基线。主要命令：

```sh
npm run check:data
npm test
npm run build
npm run test:build
npm run test:e2e
```

报告必须列出改动文件、命令、退出码/真实通过失败数、未验证风险。至少对一个关键断言做变异测试，证明测试确实加载了被修改的目标。不能仅凭源代码字符串匹配宣称 UI 行为正确。

整合者需独立阅读 diff、运行合并后的全套测试，并检查生产 bundle 没有 `__gameTest`/`__VOCAB_TEST__`。浏览器自动化不替代 iPhone/安卓实机试听与浏览器工具栏高度验证。

## 改文件的方式（踩过的坑）

**不要用 PowerShell 的 `Get-Content` / `Set-Content` 往返改本仓库的源文件。**

实测事故：一次变异测试用 `$s = Get-Content f -Raw; ...; Set-Content f $s -Encoding UTF8`
改 `src/app/runtime.js`，那次往返按**控制台默认编码解码**、再按 UTF-8 写回，把文件里
全部中文注释毁成乱码，`node --check` 直接报 `Unterminated string`。更危险的是它
**当时没有让任何测试变红** —— `runtime.js` 不被任何测试 `import`，只有几个测试把它当
**文本**读，于是损坏潜伏到 build 才爆出来。

正确做法：

- 改文件用编辑工具，不要用 shell 做读-改-写往返
- 必须脚本化时用 Node 的 `readFileSync(path, 'utf8')` / `writeFileSync(path, src, 'utf8')`
- 改完立刻 `node --check <file>`；改过中文文件时额外确认没有乱码：
  `rg '[锛銆绔]' <file>`
- 提交前跑 `npm run build`。**单元测试全绿不代表文件没坏** —— 有些源文件没有任何
  测试 import 它，只被当文本读。

## 新增样式表时：只登记 `tests/unit/css-manifest.js`

**曾经**这里写的是"两份清单都要登记"——`styles.test.js` 的 `ADDED` 与
`extraction.test.js` 的 `ADDED_CSS` 各有一份独立副本。VE-12 已合并为
**单一来源 `tests/unit/css-manifest.js`**，两个消费方都从它导入：

- `ADDED`：`[路径, 选择器前缀, 中文标签]`，`styles.test.js` 用它逐条核对
  "新增表只作用于自己的容器"
- `ADDED_CSS`：由 `ADDED` 派生的路径数组，`extraction.test.js` 用

新增样式表时**只改这一处**。

为什么值得记：两份副本时我只登记了一处，另一处就把新表算进"原始七张"，
于是那条"与 legacy 逐字节相同"的比对**恒假**——而报错是一整屏 CSS 文本，
看不出真实原因，排查花了几分钟。**漏登记是这套机制唯一会静默出错的方式**：
多登记立刻报错，漏登记恒假。`tests/unit/css-manifest.test.js` 现在守着
"只有一份清单"这个事实（两边必须从同一模块导入、且与 `game.css` 真实导入序列
不多不少不漏），但它守不住"你忘了往清单里加一行"——那还是得靠你记得。

## 下一步提取原则

`runtime.js` 仍有闭包状态 DB/G/B。对它的进一步提取一次只处理一个流程：先补特定回归，明确参数/动作/副作用契约，再搬代码。保留结算顺序，避免最后一击、荆棘、回血、掌握记账和 setTimeout 交错回归。

按 id 查数据表请一律用 `src/data/lookup.js`（不要再写 `.filter(x => x.id === id)[0]`）。注意 `scholar` / `lucky` / `greed` 三个 id **跨表重复**（角色/道具与遗物撞名），所以索引必须按表分开，不存在"全局 id 查找"。
