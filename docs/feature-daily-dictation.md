# 每日默写：分阶段实现与存档迁移

## 产品目标与范围

面向上海八年级学生，把每天 10–15 分钟的选词、热身、正式默写和「今日完成」作为主页主流程，原远征继续作为自由练习。收集养成只使用原创内容和纯外观奖励，不以拉长一局作为目标。

实现顺序为五个独立 PR：PR1 掌握判据与正式键盘；PR2 每日短局；PR3 跨天复习与家长日报；PR4 伙伴、词卡和打卡；PR5 降低挫败。本文当前的实现范围为 PR1–PR3。每日短局、跨天复习与家长日报已实现；奖励、伙伴与图鉴由后续独立 PR 接续。

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

## PR2 每日短局、终点与恢复

主页优先展示「每日默写」，原远征按钮改为「自由远征」。教材 Unit 1–6 在每日选词里都可选，独立于自由远征的掌握解锁；今天学校要默写的单元不会因历史进度不足而被锁住。也可以直接粘贴词表，复用 `parseCustomWords` 并保留在原 `custom` 字段。

每次最多 16 个去重词，选择页和练习页明确说明未选词留到后续练习。新增 `dailyCursor` 按词表轮换，优先未正式掌握的词；提前结束的未完成词优先进入下次同一词表的练习。`selectDailyWords` 接受后续跨天模块的到期词；复习配额按最终去重后的实际词数计算，包含只有 1–3 个今日词和复习词重叠的情况，绝不超过一半。

流程为 `warmup → formal-ready → formal → completed`。每个词只热身一次，复用现有 `drawLetters` 字母盘；热身完整拼词记旧 `mastered` 练习历史，绝不写正式掌握。热身结束要主动点「开始正式默写」。正式阶段只有中文释义，复用 PR1 的完整 26 字母键盘与所需空格、连字符、撇号；不自动朗读英语。顺序错与字母错只显示「不对」。提示先写错误证据和复习队列，再显示下一个字母。

完整正式词立即幂等记账，再由「下一个」推进。正式词按最多四组（通常三场普通战斗与一场首领）切分，复用原怪物像素美术，完成本组词才推进；没有无限地图、自动敌人攻击或新数值平衡。小词表按实际词数减小场数。词池耗尽进入「今日完成」，没有自动开下一局或跨单元。

计时使用注入的 `now`，只计算活跃练习时长；暂停、返回主页、后台和刷新后的等待不计时。15 分钟到达明确检查点，只提供「结束本次」收好真实成果，不再延长一轮。也可在手动暂停时主动结束。结算如实区分计划词数、已正式完成、一次拼对、热身完成和未完成词，未尝试词不冒充完成或掌握。正式半词错误、提示也立即进 `reviewQueue`，出现在结算错词中英对照里，但不增加完整完成数。

`wy8a_rogue_v1.dailySession` 是独立且可 JSON 序列化的 `schemaVersion: 1` 检查点；不替换 `activeRun`、`G` 或 `B`。打开每日流程会冻结正在保留的自由远征，回去可以继续原局；刷新后的每日流程停在暂停检查点，需要手动继续。完整词后迟到输入、暂停后的旧输入、重复结算都不授予第二次进度。损坏或不支持版本的每日检查点不自动覆盖，界面提供明确丢弃入口。写盘成功只依据注入 `persist` 的真实布尔值或 `{ok:true}`，失败如实提示；runtime 用 `saveDB()` 标脏后单次 `commit(false)` 同时保存学习事实和每日检查点。

### 后续 PR 的注入契约

`createDailyDictationController` 接受 `getDB/getWords/persist/now/random/onChange`，及以下可选端口。业务端口均在当前动作的唯一持久化之前同步调用；不要另行写盘。刷新恢复不会重发起、重发完整尝试或重结算。

| 端口 | 参数与时机 |
| --- | --- |
| `getDueWords` | `{db,at,unit}`；新局选词时返回合法 `{w,z,...}` 词条数组，最终半配额与去重由 daily-session 负责。 |
| `onStart` | `{session,db,at}`；真正新开每日局一次，恢复不调用。 |
| `onWordStart` | `{session,attempt,word,db,at}`；热身或正式新词开始。可用 `session.id + phase + index` 幂等记录开始事实。 |
| `onPractice` | `{session,attempt,word,key,db,at}`；热身/正式接受字母或分隔符输入时，同次持久化之前；退格与未接受键不调用。它证明实际练习，不能把仅展示新词算练过。 |
| `onFailure` | `{session,attempt,word,db,at}`；正式新错误或新的提示/揭示证据即时回调。半词也调用；后续正确字母不重复发错误。 |
| `onAttempt` | `{session,attempt,result,db,at}`；完整正式词记账一次。`result` 含 `key/word/eligible/errors/hints/reveals/assistance/completedAt`。 |
| `onTiming` | `{session,deltaMs,at,db}`；注入时钟计算的真实活跃增量。后台等待不调用。 |
| `onComplete` | `{session,summary,db,at}`；明确完成或提前结束一次；`summary.completed` 不包含半词、热身或未尝试词。 |
| `onChange` | `(session,{saved})`；持久化之后画 UI，只读。 |

`#dailyHomeReport` 与 `#dailyCollectionHost` 是稳定的主页 DOM 宿主，主页重绘保留节点身份和已有子节点；后续日报与养成模块可在其中挂载自己的 UI。结算扩展宿主为 `#dailyCompletionExtra`，每次结算屏重绘后可重新绘制。PR3 再负责到期表、错答移出正式掌握、日期与 30 天日报；PR4 再负责外观奖励；PR5 再验收降低挫败的完整策略。本 PR 没有先加新遗物、战斗伤害或经济平衡。

### PR2 测试证据

先失败提交 `6505019`：`node --test --test-reporter=tap tests/unit/daily-session.test.js` 退出码 1，23 个测试全部失败，新模块尚不存在。后来补小词池配额回归，24 个中 23 通过、1 失败；补 15 分钟不延长、半词错词展示和失败端口，27 个中 24 通过、3 失败。修复后 27 个全部通过。

真实浏览器先跑完整每日局，退出码 1，缺主页入口；实现后初次 7 条 6 通过、1 因测试错写旧暂停按钮 ID 失败，修正定位后全绿。主页报告/收藏宿主保留测试在临时恢复旧错误重绘时退出码 1，1 条失败；恢复正确实现后通过。关键变异：临时清除正式尝试的提示计数后调用 `creditDictation`，27 个测试 26 通过、1 失败，提示不能掌握的断言命中；源码随后恢复，变异未提交。

| 命令 | 退出码及真实结果 |
| --- | --- |
| `npm run check:data` | 0；259 条，六单元 45/55/29/50/41/39，无数据修改。 |
| `npm test` | 0；1066 通过、0 失败。 |
| `npm run build` | 0；静态站点与离线单文件成功。 |
| `npm run test:build` | 0；3 通过、0 失败，生产无测试状态探针。 |
| `npx playwright test tests/e2e/daily-session.spec.js --project=new` | 0；9 通过、0 失败。真实热身→正式→结算，提示排除、半词错误、26 键与重复字母/短语、320/390 布局、原自由远征恢复、自定义文本安全、15 分钟时钟边界、宿主身份保留。 |
| `git diff --check`；既有样式与词库差异检查 | 0；仅新增自身 `.daily-dictation` 前缀样式，无冻结 CSS 或词库修改。 |

整合者仍需独立复跑 `npm run check`。自动化浏览器环境缺中文字体，结构/中文 DOM 内容与键盘坐标通过，但截图中文显示替代字形；真实 iOS/Android/微信字体、工具栏、安全区与触屏仍待实机验收。16 词和 15 分钟终点是产品边界，不宣称真实学生已用 10–15 分钟完成或学校正确率已提高。


## PR3 跨天复习与家长日报

日期规则固定采用上海 UTC+8 日历，不读取设备时区。`shanghaiDate(at)`、`addDays(date,days)`、`splitActiveTime(at,deltaMs)` 都显式传入时钟；应用层 `createDailyLearning({getDB,getWords,now})` 与每日控制器共用可注入时钟。运行时使用 `Date.now`，浏览器测试用 Playwright 的真实页面时钟固定边界。

### 复习阶梯与迁移

第一次正式干净答对后，安排 1 天；只有到期且正式干净完成，才依次安排 2、4、7、15 天。未到期重复答对既不跳级，也不把到期日推迟。通过最后一档 15 天的到期复习才记 `stable:true`，之后继续每 15 天复习。首次答对、到达「下一次15天」都还不是稳固。

任何正式错误（含顺序）、提示、预知残卷或透视会立刻排到次日，阶梯回到 1 天、稳固清除、移出 `dictationMastered`；本次后来拼完整也不恢复掌握。同日另开一个没有错误/帮助的完整正式尝试可以恢复掌握，重新从 1 天起。它不会借纠错把本次失败改成成功。旧 `mastered`、自由远征快照和未知字段保留；成长仍只在未来新远征开局计算，不倒扣已有快照的生命上限。

到期词跨教材单元和以前的自定义词表全局合并，不因今天换单元而失去复习机会。`getDueWords` 在选择时迁移并取到期词，原 `selectDailyWords` 按最终去重后的实际词数限制自动并入的复习配额最多一半。未到期的复习表项不会因当前学校词表选择而被删。

| 新字段 | 内容与迁移 |
| --- | --- |
| `reviewSchedule` | 词身份映射，保存原词对象、`intervalIndex/dueDate/stable/pendingFailure` 与最近成功/失败证据。原 `reviewQueue` 无日期的词、PR1/PR2 已有但无日期的正式掌握，均保守设为迁移当天到期，`intervalIndex:-1`，不猜历史日期、不追认稳固。第一份有日期的干净证据从 1 天开始；旧正式掌握本身保留，直到真正正式失败。 |
| `wordExposure` | 词身份映射 `{word,seen,practiced}`。新词展示由 `onWordStart` 标见过，真实字母输入由 `onPractice` 标练过，原词的释义、单元和未知字段保留，换自定义词表不会删除收集事实。没有给旧记录伪造见过日期。后续图鉴可读取这些事实。 |
| `dailyReports` | `schemaVersion:1`；最近 30 个上海日历日 `days` 明细、更早数值 `summary` 和窗口起点 `cutoffDate`。不保留更早逐次事件或错词列表。 |
| `dailySession.learning` | 当前最多 16 词的尝试记账标记 `assessedTokens` 与结算幂等标记；只属于本次检查点，刷新、重画或重放完整尝试不会重复日报、复习进阶和结算。 |

原 `reviewQueue` 继续兼容旧自由远征：正式失败立即进队列；后来一次符合规则的正式干净完成会清除此待纠正身份，未来到期由 `reviewSchedule` 持续安排。旧无日期的已完成每日结果不回放成新的今日练习；旧正式半词有错误/帮助而未记账的，在实际恢复输入或主动结束时以当前日期记账和回退。不猜此前哪一天犯错。损坏/未来每日快照的词表类型严格守卫，保留原文，仍由 PR2 的无法恢复界面处理。

### 日报口径、时长与复制

主页「今日记录」显示上海日期、真实活动时长、练习词数、一次拼对率与当天错词/辅助词中英对照。当天练习词数按英文身份去重，包含热身和正式的实际输入或正式求助，单纯展示而未尝试的新词不算练习。正确率逐次计算：分母为完整正式尝试，以及已经发生错误或使用帮助的中断正式尝试；分子只含严格一次拼对。热身不计入正确率，干净半词尚未完成也不计分母。失败尝试在首次错误/帮助当天计一次，后来纠正完成不重加分母；同日多局合并，热身两词、提示 cat、干净 dog 的报告为练习 2 词、正式 1/2 = 50%。

时间只来自控制器 `onTiming` 的活动增量，按上海午夜拆给各日期；后台、暂停和刷新后等待全部排除。日报事件与学习事实在控制器同一次持久化之前更新。主页停留跨午夜时，只在日期变化时重绘今日记录，不每秒重建日报或写存档。

30 天窗口按日历日而不是「有记录的30天」计算。更早明细折叠进数值汇总：时长、练习日数、当天去重词数之和（展示为「词次」）、正式尝试数、一次拼对数与结束次数。删除老明细后不再保留老错词英文或逐次事件；收集/复习事实与恢复检查点另按其用途保留。

复制按钮调用实际剪贴板能力，成功后才显示「已复制」。缺少能力或拒绝时显示可手选的纯文本框，主动选中全文，并明确「手动复制」；不会把失败冒充复制成功。文本包括口径说明，没有 HTML。日报挂自己的内部根节点，保留 PR2 的稳定宿主身份及外来子节点。样式只新增 `.daily-report` 前缀纸卡，含自身 `user-select:text` 和 WebKit 手选规则，320/390px 不水平溢出；不修改冻结 CSS。

### PR3 测试证据

真正先失败提交 `4716b0f`：新单测 29 个全部失败；补真实控制器判据与浏览器用例的提交 `1eb51fa`：34 个单测全部失败，完整日报浏览器 1 个失败，原主页宿主为空。实现后 34 个通过。

兼容回归先红：37 个中 35 通过、2 失败，分别为损坏 `dailySession.words:{}` 的启动迁移与旧失败半词直接结束漏记；修复后 37 个通过。随后补最后辅助词结算幂等通过，再补「早先干净词的回调在后来词完成后重放」：39 个中 38 通过、1 失败；采用本局最多 16 个评估 token 后 39 个全部通过。

关键变异：临时关闭失败时从 `dictationMastered` 移除的规则，39 个单测 27 通过、12 失败，纯规则与真实控制器五种失败条件均命中；恢复源码后 39 个通过，变异未提交。

浏览器首次实现运行 16 个全因日报宿主挂载顺序失败；修复为先创建宿主再挂部件。第二轮 15 通过、1 失败是测试时钟未冻结造成的毫秒期待漂移；改用真实页面 `clock.pauseAt` 固定操作起点后 16 个全部通过（7 个新日报、9 个原每日流程）。剪贴板回读是真实 Chromium API；拒绝用例仅替换平台能力，游戏报告逻辑未替换。新增手选计算样式断言在原通用 textarea 规则下已通过，日报仍补自身 Safari 手选规则。

旧音频存档白名单真实运行 1 个失败，仅因本 PR 新增 `reviewSchedule/wordExposure/dailyReports` 不在旧清单；经整合者授权，只增加这三个合法字段，保留音频层不得自行写盘的断言。

| 命令 | 实现者结果（整合者仍须独立复跑） |
| --- | --- |
| `node --test --test-reporter=tap tests/unit/daily-learning.test.js` | 0；39 通过、0 失败。 |
| `npm run check:data` | 0；259 条，45/55/29/50/41/39，无数据修改。 |
| `npm test` | 0；1105 通过、0 失败。 |
| `npm run build`、`npm run test:build` | 0；站点及离线单文件构建成功，3 个构建测试通过、0 失败，生产无状态探针。 |
| `npx playwright test tests/e2e/daily-report.spec.js tests/e2e/daily-session.spec.js tests/e2e/audio-compatibility-game.spec.js --project=new` | 0；23 通过、0 失败、0 跳过（7 日报＋9 每日＋7 音频）。 |
| `git diff --check`、冻结词库/既有 CSS 对照 | 0；全部既有词库与样式逐字节未变，只新增自身前缀日报样式。 |

未验证：iOS/Android/微信实机剪贴板权限与工具栏、安全区、中文字体、真实声音及真实学习效果；本测试环境中文缺字形，DOM 中文内容与结构坐标通过，截图未冒充真实设备排版。不同设备之间不会自动同步，纯静态站点日报只存在当前浏览器存档；没有云账户或服务器。


PR3 改动文件：

- `src/domain/daily-learning.js`
- `src/app/daily-learning.js`
- `src/app/daily-dictation.js`
- `src/app/runtime.js`
- `src/ui/components/daily-report.js`
- `src/styles/daily-report.css`
- `tests/unit/daily-learning.test.js`
- `tests/e2e/daily-report.spec.js`
- `tests/e2e/audio-compatibility-game.spec.js`
- `docs/feature-daily-dictation.md`
