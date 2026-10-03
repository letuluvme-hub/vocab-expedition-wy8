# 每日默写：分阶段实现与存档迁移

## 产品目标与范围

面向上海八年级学生，把每天 10–15 分钟的选词、热身、正式默写和「今日完成」作为主页主流程，原远征继续作为自由练习。收集养成只使用原创内容和纯外观奖励，不以拉长一局作为目标。

实现顺序为五个独立 PR：PR1 掌握判据与正式键盘；PR2 每日短局；PR3 跨天复习与家长日报；PR4 伙伴、词卡和打卡；PR5 降低挫败。本文当前的实现范围为 PR1，后续流程、跨天日期、奖励和完整每日局尚未在这一 PR 中发布。

## PR1 掌握事实与键盘接口

`src/domain/dictation.js` 接受显式参数，不读浏览器、时钟或全局状态。

- `createDictationAttempt(word, {phase:'formal'})` 创建可 JSON 序列化的尝试，保存原始 `word`、规范化 `target`、字符串 `input`、`errors/hints/reveals`、`assistance`、`completed/credited` 和 `feedback`。
- `applyDictationInput(attempt,key)` 原地返回尝试。正确字母和词内分隔符推进；顺序错和字母错都累加错误，只显示「不对」。退格不抹去先前错误；完整词后的迟到输入不再改证据。
- `markDictationAssistance(attempt,kind)` 记录 `hint`、`prophecy`、`vision`；必须在提供答案线索之前调用。
- `dictationEligible(attempt)` 仅认可正式阶段、完整准确输入、三个计数均为零。热身、半词、任何错误或帮助都不能成为正式掌握。
- `creditDictation(db,attempt)` 在完整词时幂等记账，返回 `{eligible,added,reviewed,ignored}`。正式成功写 `dictationMastered`；失败写 `reviewQueue`，后来拼对也不擅自删除早先错词。调用方拥有统一存盘事务。
- `dictationWordKey(word)` 仅做首尾空白去除与大小写归一，保留词内空格、连字符和撇号；可以传词条或字符串。原词条大小写、标点与释义不修改。

自定义词解析允许弯撇号 `’`。普通键盘的 `'` 与弯撇号可输入目标原有的撇号字符，内部 `input` 保留目标字符以保证准确比较；身份仍保持 trim/lower 原则，不把两种标点合并成新的词库身份。

`createDictationKeyboard({onInput,document?})` 返回 `render(container,word)`、`handleKey(event)` 和 `destroy()`。26 个字母始终完整展示、可以重复使用；空格、连字符、撇号只在目标需要时出现，退格始终出现。实体键盘和点击均调用 `onInput`。组件不注册全局监听，由整合层仅在每日局激活时转交事件；组合键、输入框和中文输入法合成事件不截获。

样式只新增 `src/styles/dictation.css`，全部选择器具有 `.daily-dictation` 容器前缀。既有 CSS 与 259 条词库保持不变。

## 存档迁移

仍使用 `wy8a_rogue_v1`，不改 key，不删除旧字段和未知字段。

| 字段 | 迁移及新口径 |
| --- | --- |
| `mastered` | 原样保留为自由远征练习记录，不追认正式默写，不因自由远征答错删除历史词。 |
| `dictationMastered` | 旧档缺失时初始化 `[]`；合法数组原样保留。只有新正式默写的严格证据写入。 |
| `reviewQueue` | 新增可序列化字符串数组；错字、顺序错误和正式帮助后的词进入队列。练习完成不抹掉错词。 |
| `unitProgress` | 保留为旧远征历史事实；任何旧 `complete` 时间戳均不能代替正式默写证据。 |
| `activeRun`、纪念卡与成长快照 | 原样兼容。恢复既有生命上限，不按新口径倒扣历史加成，不重复计次数或发奖。 |
| 未知字段 | 不清理、不重命名、不丢失。 |

单元解锁和新轮生命成长只读取 `dictationMastered`。解锁还要求前面连续单元全部覆盖。旧档即使 259 词都在 `mastered`、已有通关卡或单元完成时间戳，新正式默写进度仍为零；收藏和旧学习历史保留。自由远征完整拼词继续记练习，不授予正式掌握。错词被拼完后，`run.wrong` 与持久复习队列仍保留其错误事实。

## PR1 测试证据

测试先于实现提交 `4fe48d1`：`node --test --test-reporter=tap tests/unit/dictation*.test.js` 退出码 1，19 个测试、0 通过、19 失败；缺新模块及旧存档迁移断言失败。

发现弯撇号后先加回归：同命令 20 个测试，18 通过、2 失败；修复后 20 个全部通过。

扩展旧远征保留历史/顺序错误/冰冻错误/纠错不删错词：`node --test --test-reporter=tap tests/unit/dictation.test.js tests/unit/relic-combat-synergy.test.js` 退出码 1，34 个、30 通过、4 失败；实现后连同 `domain.test.js` 44 个全部通过。

关键变异测试：临时删除 `dictationEligible` 中 `errors === 0` 的必要条件，运行 `node --test --test-reporter=tap tests/unit/dictation.test.js` 退出码 1，17 个、12 通过、5 失败，错字、顺序错、退格不清错等断言均命中；随后恢复生产代码。变异没有提交。

实现者的最终验证（整合者还须独立复跑）：

| 命令 | 退出码及真实结果 |
| --- | --- |
| `npm run check:data` | 0；259 条教材数据，六单元数量 45/55/29/50/41/39。 |
| `npm test` | 0；1039 通过，0 失败。 |
| `npm run build` | 0；站点和离线单文件成功构建。 |
| `npm run test:build` | 0；3 通过，0 失败；生产构建无测试状态探针。 |
| `npx playwright test tests/e2e/dictation-keyboard.spec.js tests/e2e/growth.spec.js tests/e2e/campaign.spec.js tests/e2e/round-cards.spec.js --project=new` | 0；28 通过，0 失败，包括 320/390px 键盘与旧档正式证据为零。 |
| `npm run test:e2e`（首次全量） | 1；233 通过、3 失败、200 跳过。三条失败是有意口径变更的旧断言：旧练习数不能冒充正式数、存档初始化新增字段、纠错后保留复习队列；随后更新这些期待。 |
| `npx playwright test tests/e2e/baseline.spec.js tests/e2e/audio-compatibility-game.spec.js tests/e2e/word-queue.spec.js`（更新后） | 0；28 通过，18 跳过，0 失败。既有字段保留和原归档页面的期待仍分别检查。 |
| `npm run test:release` | 0；2 通过，0 失败，包含构建站点与断网离线单文件。 |
| `git diff --check`；既有 `src/data` 与 `src/styles` diff 检查 | 0；词库和所有既有 CSS 无修改。 |

浏览器命令使用已安装的 Chromium headless shell，通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定路径。`npm run check` 的最终完整绿色结果由整合者独立运行记录。

PR1 不宣称完整每日短局 e2e 已通过；日期到期回退属于 PR3，伙伴/图鉴的同屏布局属于 PR4，iOS/Android/微信实机、实际英语成绩提升与 10–15 分钟时长仍须实际使用验证。
