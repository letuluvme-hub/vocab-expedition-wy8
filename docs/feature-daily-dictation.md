# 每日默写：分阶段实现与存档迁移

## 产品目标与范围

面向上海八年级学生，把每天 10–15 分钟的选词、热身、正式默写和「今日完成」作为主页主流程，原远征继续作为自由练习。收集养成只使用原创内容和纯外观奖励，不以拉长一局作为目标。

实现顺序为五个独立 PR：PR1 掌握判据与正式键盘；PR2 每日短局；PR3 跨天复习与家长日报；PR4 伙伴、词卡和打卡；PR5 降低挫败。本文记录 PR1–PR5 的完整改版；合并／部署与整合者全量验收另在交付报告记录，不把本地实现称为已经上线。

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
| `onAttempt` | `{session,attempt,result,db,at}`；完整正式词或失败词延后处理一次。完整结果含 `completed:true/completedAt`；延后结果含 `completed:false/deferred:true/eligible:false/input/deferredAt`，两者均保留 `key/word/errors/hints/reveals/assistance`。延后不调用 `creditDictation`。 |
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

交接前补历史汇总展示验证：现有 `todayReport` 已提供 `summary` 的纯读副本 `archive`，新单测首跑 40 个全部通过，真实浏览器 seed 历史汇总用例首跑 1 个通过，没有制造实现前失败。临时移除 `archive` 端口后该目标测试 0 通过、1 失败；恢复后 40 个通过。纸卡显示「10词次」，当天词数仍为 0；修改返回汇总副本不会改存档。此补充只改测试和证据，没有变更生产实现。

旧音频存档白名单真实运行 1 个失败，仅因本 PR 新增 `reviewSchedule/wordExposure/dailyReports` 不在旧清单；经整合者授权，只增加这三个合法字段，保留音频层不得自行写盘的断言。

| 命令 | 实现者结果（整合者仍须独立复跑） |
| --- | --- |
| `node --test --test-reporter=tap tests/unit/daily-learning.test.js` | 0；40 通过、0 失败。 |
| `npm run check:data` | 0；259 条，45/55/29/50/41/39，无数据修改。 |
| `npm test` | 0；1106 通过、0 失败。 |
| `npm run build`、`npm run test:build` | 0；站点及离线单文件构建成功，3 个构建测试通过、0 失败，生产无状态探针。 |
| `npx playwright test tests/e2e/daily-report.spec.js tests/e2e/daily-session.spec.js tests/e2e/audio-compatibility-game.spec.js --project=new` | 0；23 通过、0 失败、0 跳过（7 日报＋9 每日＋7 音频）。 |
| `npx playwright test tests/e2e/daily-report.spec.js --project=new --grep "older summary"` | 0；新增历史汇总展示 1 通过、0 失败，显示 10 词次且今日为 0 词。 |
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


## PR4 伙伴、单词图鉴、打卡与每日外观

主页每日入口前移到键盘说明之前；稳定宿主顺序为伙伴／图鉴 `#dailyCollectionHost`，然后日报 `#dailyHomeReport`。部件只重画自己内部的根节点，保留宿主和外来子节点。正式默写仍在独立每日屏幕，伙伴和展开的图鉴不会浮到释义、输入或键盘上。

原创伙伴「墨芽」是由像素矩形绘成的墨水种子与星叶生物，代码原生 SVG，没有复用已有角色、怪物或任何现有游戏 IP。成长只读去重、`trim + lower` 的 `dictationMastered` 数量；旧 `mastered` 不追认成长。阈值是 0／5／20／50／100／200，对应初醒／发芽／结叶／微光／流星／星冠，均为外观形态，不改变战斗数值。已经获得的形态永久保留；复习失败降低当前掌握后，下阶段差词按当前真实数量计算，不删除已收集形态和装饰。

图鉴按 Unit 1–6 浏览原 259 条卡片，原顺序与中英文、难度、主题不变，每个原词条仍有卡。当前自定义词表的全部有效词先列出，未见过的词也显示「未收集」；再并入 `wordExposure.word` 中以前的自定义词快照，英文身份去重，换词表不删除已经见过／练过的旧词卡。所有用户词与释义使用 `textContent`。

| 卡面档位 | 真实证据 |
| --- | --- |
| 未收集 | 没有见过、练过或正式掌握事实。 |
| 见过 | `wordExposure.seen:true`，单纯展示不算练过。 |
| 练过 | `wordExposure.practiced:true` 或兼容旧 `mastered`；半词输入、热身和辅助完成不能直接成为「默写对」。 |
| 默写对 | 当前 `dictationMastered` 有此身份。 |
| 复习稳固 | 当前正式掌握且 `reviewSchedule.stable:true`、没有待纠正失败；通过完整 1／2／4／7／15 天阶梯才达到。正式失败后真实降档。 |

结束每日局时，只有本局当前上海日期实际接受输入或正式帮助的事实才打卡和获得外观。空白开始后直接退出不获奖；仅结束昨天已暂停的练习不伪造今天打卡。热身／半词可以是实际练习，但绝不成为正式掌握。当天多局、重复结束与刷新最多一次签到和一次外观；外观从尚未拥有的六件中随机选择，收齐后诚实显示重复相遇。三件伙伴装饰和三件词卡边框都可在主页选择，结算页可预览和穿戴，效果实际显示在伙伴 SVG 或卡片内框。没有新增遗物、生命、伤害、金币或战斗奖励。

连续天数以今天已签到或昨天为起点计算，断签不清空卡片、伙伴形态或外观。每个上海日历周允许一次补签，以该周周一日期作为额度身份，年末不混用周编号。目标必须是最近 7 天的过去漏签日，且不能早于首次真实签到；不可补今天、未来、已签到或使用前日期。补签只改变签到，不生成日报练习、正确率、词汇掌握或外观奖励。主页跨午夜只重绘日期展示，不每秒写盘。

`dailyCollection` 为追加字段，包含 `schemaVersion:1`、永久 `unlockedStages`、外观 ID 数组 `cosmetics`、独立 `equipped` 槽位、按日期的 `gifts/checkins`、按周一日期的 `makeupWeeks` 和 `firstCheckinDate`；保留未知字段。当前检查点的 `dailySession.collection.practicedDates` 保存本局真实练习日期，便于午夜与恢复判断。旧正式掌握可以解开对应形态，旧实践记录不追认正式成长，旧日报不回放成签到或奖励。旧签到缺首次日期时从已有真实日期保守恢复；导入不完整收藏后，合法穿戴动作补默认槽位而不丢未知内容。外观／补签写盘失败会明确显示「未保存」，当前效果可继续使用；课堂输入继续有效。

纯规则在 `src/domain/daily-collection.js`，`createDailyCollection({getDB,getWords,now,random,persist,onChange})` 组装端口。`onPractice/onFailure` 标记本局练习日期，`onAttempt` 同步永久形态，`onComplete` 结算当日签到和外观；与 PR3 学习端口组合后，都在原每日控制器的同一次保存之前更新。`view/cards` 纯读，只有合法 `equip/makeup` 动作才各保存一次。样式只在新增 `daily-collection.css`，所有选择器以自身 `.daily-collection` 容器为前缀。

PR4 测试先失败提交 `d0455b6`：新单测 26 个全部失败，新浏览器完整流程 1 个失败（尚无伙伴 UI）。追加兼容回归提交 `6738107`：29 个单测中 26 通过、3 失败，对应自定义全量未收集词卡、缺首次日期的旧签到、导入缺 `equipped` 的穿戴；修复后 29 个通过。实际外观存储拒绝回归在 `8364967` 中先失败 1 个（缺未保存提示），随后补真实提示。关键变异临时删除按日防重复领奖规则，29 个中 28 通过、1 失败；恢复源码后再次全绿，变异未提交。

浏览器初次完整实现 4 个中 3 通过、1 失败，原因是测试把随机卡框奖励误当伙伴装饰；修正为按实际槽位验证 SVG 装饰或真实 `box-shadow`。另有补签测试误把尚未保存的启动迁移视为日报变化，改为先比较内存中的完整迁移事实，再确认同次落盘结果。Unit 1 卡数期待笔误从 44 改为真实 45，没有丢卡或修改词库。音频旧白名单真实运行 1 个失败，经整合者授权仅追加 `dailyCollection` 合法字段，保留音频层不得自行写盘断言。

| 命令 | 实现者结果；整合者仍须独立全量复跑 |
| --- | --- |
| `node --test --test-reporter=tap tests/unit/daily-collection.test.js` | 0；29 通过、0 失败。 |
| `npm test` | 0；1135 通过、0 失败。 |
| `npm run check:data` | 0；259 条，六单元 45／55／29／50／41／39，原词库未修改。 |
| `npm run build`、`npm run test:build` | 0；站点与离线单文件成功，3 个构建测试通过、0 失败，生产无状态探针。 |
| `npx playwright test tests/e2e/daily-collection.spec.js tests/e2e/audio-compatibility-game.spec.js tests/e2e/daily-report.spec.js tests/e2e/daily-session.spec.js --project=new` | 0；31 通过、0 失败、0 跳过（7 收藏＋24 既有回归）。 |
| `npx playwright test tests/e2e/daily-collection.spec.js --project=new` | 0；新增跨午夜只读刷新后 8 通过、0 失败、0 跳过。覆盖全流程奖励、320／390 实际布局、伙伴与词卡两类可见穿戴、自定义文本安全、补签不造日报、实际存储拒绝与断签不清收藏。 |
| `git diff --check`、冻结词库／既有 CSS 对照 | 0；全部原词库与已存在样式未变，仅新增自身容器前缀样式。 |

PR4 改动文件：`src/domain/daily-collection.js`、`src/app/daily-collection.js`、`src/ui/components/daily-collection.js`、`src/styles/daily-collection.css`、`src/app/runtime.js`、`src/ui/screens/daily-dictation.js`、`tests/unit/daily-collection.test.js`、`tests/e2e/daily-collection.spec.js`、`tests/e2e/audio-compatibility-game.spec.js`、`docs/feature-daily-dictation.md`。

未验证：真实学生的每日主动使用、10–15 分钟完成率、学校默写提升与伙伴阈值偏好；iOS／Android／微信真机字体、工具栏、安全区、触屏和实际声音。自动化环境中文缺字形，DOM 中文与坐标验收不等于真机字形验收。收藏和打卡仍为当前浏览器的本地存档，没有跨设备同步。

## PR5 降低挫败与真实完成口径

每日短局保持独立学习流程：正式拼错的生命伤害上限为 **0**，没有怪物定时攻击，也没有由错字触发整局失败的入口。多次顺序错或字母错只反馈「不对」并记录复习，不会清空已拼对的词；原自由远征的伤害、装备与蓄力规则未调整。进入每日流程时原远征冻结，正式输入慢也不会让旧怪物跨流程攻击。

当正式当前词尚未拼完且已经有错误、提示或揭示证据，显示「留到复习，下一词」。它保留当前输入与错误，推进下一个词；最后一个词延后后进入「今日完成」，不自动开新局。热身、干净半词与已经完整的词不能延后。延后词只按原失败事实的复习计划再练，不按延后动作日期重新推迟；已经安排的次日到期与 1 天回退照常保留。

延后结果保存 `completed:false/deferred:true/eligible:false`、`input`、`errors/hints/reveals/assistance` 和 `deferredAt`，不调用完整词掌握记账。`onAttempt` 只处理失败评估并兜底旧版尚未评估的半词；已有 token 的失败不重放到今天，也不伪造今天的练习、签到或外观奖励。完整结果增加 `completed:true`，旧 schema-1 结果缺此字段仍按原完整词解释，不删除旧记录或未知字段。恢复严格校验词顺序、当前索引和结果、失败证据与相位，拒绝把延后结果改回干净当前词或热身，以免绕过判据。

结算同时显示「正式完成」「留到复习（未拼完）」与真实一次拼对率。正式评估分母包括完整结果、延后失败和主动结束时已经错误／辅助的半词；热身和干净未完成词不计分母。例：cat 一次拼对，dog 错后延后，pig 一次拼对 → 完整 2／3 词，延后 1 词，一次拼对 2／3（67%）；dog 保留中英对照和失败记录，不能显示 100%。暂停、刷新、预算终点和提前结束都保留已有正式掌握与完整结果。

### PR5 测试证据

先失败提交 `081ec5e`：新单测 14 个，0 通过、14 失败（缺 `defer` 与真实评估字段）；真实浏览器 1 个失败（缺延后动作）。同一基线的新增生产站点与断网单文件验收 2 个均失败，真实等待不到新动作，各在既有 20 秒超时内失败，没有修改测试配置。

恢复兼容回归先失败提交 `296d35b`：15 个中 14 通过、1 失败，延后结果被改成当前干净尝试仍可恢复；加强索引／结果一致性后全绿。再先失败提交 `5867876`：16 个中 15 通过、1 失败，正式结果被改回热身相位仍可恢复；修复后 16 个全部通过，也验证正式准备相位和已完整 credited 对应结果不得是 deferred。

关键变异：在延后处理里临时重新调用 `review()`，15 个中 14 通过、1 失败，准确命中「昨天已评估错误，今天仅延后不得伪造练习／签到」断言。变异子进程退出码 1；`finally` 恢复源码并确认字节一致，恢复后 15 个全绿，变异未提交。

| 命令 | 实现者结果；整合者另独立全量复跑 |
| --- | --- |
| `node --test --test-reporter=tap tests/unit/daily-comfort.test.js` | 0；16 通过、0 失败、0 跳过。覆盖各类辅助、半词、到期回退、幂等、跨日和旧档恢复。 |
| `npm test` | 0；1151 通过、0 失败、0 跳过。 |
| `npm run check:data` | 0；259 条，六单元 45／55／29／50／41／39，全部原词库未改。 |
| `npm run build`、`npm run test:build` | 0；站点与离线单文件成功，3 个构建测试通过；生产无调试状态探针。 |
| `npx playwright test tests/e2e/daily-comfort.spec.js tests/e2e/daily-session.spec.js tests/e2e/daily-report.spec.js tests/e2e/daily-collection.spec.js --project=new` | 0；31 通过、0 失败、0 跳过。6 个新用例与 25 个日常／日报／收藏回归。 |
| `npx playwright test tests/e2e/daily-comfort.spec.js --project=new`（最后恢复校验后） | 0；6 通过、0 失败、0 跳过，含真实 12 秒攻击周期观察、实际剪贴板、刷新恢复与 320／390px 输入／动作布局。 |
| `npm run test:release` | 0；4 通过、0 失败，保留原 2 个自由远征验收，新增站点及断网单文件完整日常流程。新增两条仅用公开 DOM 和真实本地存档，不启用测试探针；站点实际读取剪贴板，离线按平台实际复制成功或可手选降级检查文本。 |
| `git diff --check`、冻结词库与全部既有 CSS 对照 | 0；未改教材或任何已有样式，本 PR 无新增样式或数值平衡。 |

PR5 改动文件：`src/domain/daily-session.js`、`src/app/daily-dictation.js`、`src/ui/screens/daily-dictation.js`、`tests/unit/daily-comfort.test.js`、`tests/e2e/daily-comfort.spec.js`、`tests/release/smoke.spec.js`、`README.md`、`docs/architecture.md`、`docs/product-backlog.md`、`docs/feature-daily-dictation.md`。

仍未验证真实学生的主动使用、10–15 分钟完成率或学校默写提高；iOS／Android／微信的字体、工具栏、触屏、安全区、音效与语音仍须真机。320px 自动化截图缺少中文字体，显示替代字形；DOM 中文和几何位置正确不能代替实机字形验收。没有跨设备存档同步，也没有拿自动化结果代替冻结解除所需的两周上线与真实使用数据。

## PR5 降低挫败与失败词延后

每日局沿用独立学习战斗：拼错的生命伤害上限为 **0**，没有怪物定时攻击，也没有因拼错造成血量归零的整局失败。等待、顺序错或字母错不会清空本局早先的完整词、正式掌握或收藏；原自由远征的血量和蓄力快照仍冻结，恢复原局再继续其原有规则。没有新增遗物或战斗数值平衡。

正式阶段的当前词尚未拼完，且已有错误、提示或揭示证据时，显示「留到复习，下一词」。这是一个真实可用的退出难词动作：保存当前输入、错误／帮助计数和复习事实，直接推进下词；最后一个词处理完就进入「今日完成」。热身、干净半词、完整词或暂停状态不提供延后动作，15 分钟预算到达后仍只允许结束本次。

延后结果存于原 schema-1 的 `results` 中，明确 `completed:false/deferred:true/eligible:false`，保留 `input/errors/hints/reveals/assistance/deferredAt`。完整结果新增 `completed:true`；旧结果缺该字段仍代表原完整词。延后不调用 `creditDictation`、不增加完整词数或掌握，也不立即当作「尚未尝试的剩余词」优先塞回同词表下一局；后续复习由已有 `reviewSchedule` 安排。到期答错的移出掌握、回到 1 天规则仍由首次失败证据触发。

延后调用幂等 `onAttempt` 处理失败词。已经在昨天记录的错误，今天只恢复后点击延后，不重放 `onFailure`，不把旧错误伪造成今天新练习、日报评估、签到或奖励；尚未记账的旧失败半词才保守以当前日期补评估。保存顺序仍是一动作一次事务，收集端口只同步伙伴，不把这个回调冒充实际字母输入。重复推进、结算或恢复不重复评估、领奖或授予掌握。

结算的 `completed` 只算真正完整拼写，`deferred` 单列未拼完词，`assessed` 包含完整正式尝试与已有错误／帮助的未完成尝试。例：cat 一次拼对、dog 拼错后延后、pig 一次拼对，显示「正式完成 2／3」「留到复习 1 词」「一次拼对 2／3（67%）」，日报与纯文本复制也如实记 2／3 和 dog · 狗。已失败半词直接结束也进入分母，干净半词没有完整证据则不进入分母。

恢复额外拒绝矛盾状态：延后结果伪造一次拼对、没有失败证据、输入其实已完整、词条顺序错乱、已延后词被倒退成当前干净尝试，以及正式结果被倒退成热身／准备正式相位。合法旧完整结果、未知字段、原自由远征和 `wy8a_rogue_v1` 均保留；无法恢复仍保留存档原文，用户明确丢弃前不覆盖。

### PR5 测试证据

先失败提交 `081ec5e`：新单测 14 个全部失败，真实 browser 1 个失败，生产网站与断网单文件 2 个失败；均缺新延后动作或真实分母。新规则首版后 14 个通过。追加恢复回归提交 `296d35b`：15 个中 14 通过、1 失败（已延后词还能恢复成当前干净词）；补一致性验证后通过。追加相位回归提交 `5867876`：16 个中 15 通过、1 失败（正式结果可回到热身）；加相位守卫后 16 个通过。此前完整 schema-1 结果缺 `completed` 的兼容例仍通过。

关键变异：临时在延后动作里重新调用 `review()`，15 个中 14 通过、1 失败，准确命中「昨天失败今天只延后，不伪造今天练习／奖励」；进程退出码为 1。`finally` 恢复源码并检查原文完全一致，随后 15 个全部通过；变异未提交。

新增 browser 真实走完整热身→正式→失败词延后→下一词干净→结算→主页日报→实际剪贴板读回；检验提示延后排除掌握、最后词终点、刷新保留完整／延后／半词事实。自由远征先进入实际蓄力，暂停回主页开每日，再等待 12 秒（超过普通怪 11 秒攻击周期）；旧生命与战斗快照不变，多次错词仍在正式阶段，早先正式掌握保留。320／390px 键盘、新动作和原伙伴／图鉴都在自身页面布局中，输入未遮挡；截图中文缺字体，不当作真机字形验证。

发布物验收保留旧两条自由远征 smoke，并新增网站／断网 file:// 各一条完整每日流程，仅用公开 DOM 操作与 localStorage 证据，不使用生产调试探针。网站实际剪贴板读回成功；离线环境检查真实能力结果，能力拒绝时验收可手选的纯文本框，不宣称复制成功。

PR5 改动文件：`src/domain/daily-session.js`、`src/app/daily-dictation.js`、`src/ui/screens/daily-dictation.js`、`tests/unit/daily-comfort.test.js`、`tests/e2e/daily-comfort.spec.js`、`tests/release/smoke.spec.js`、`README.md`、`docs/architecture.md`、`docs/product-backlog.md`、`docs/feature-daily-dictation.md`。没有改动词库、既有 CSS、旧自由远征平衡、package／配置或存档 key。最终命令与真实通过数由本 PR 实现者和整合者分别记录。

未验证风险：真实学生需要多久完成、是否每天主动打开与学校默写正确率变化；iOS／Android／微信的实际触屏、中文字体、安全区、工具栏高度、后台恢复及声音。当前仍为本机存档，没有跨设备同步；自动化成功不替代上线后的真实数据。冻结项必须等实际部署满 14 天且已有使用数据才恢复。
