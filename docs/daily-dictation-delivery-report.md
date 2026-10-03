# 每日默写综合改版交付报告

本轮完成五个串行阶段，每阶段先写失败测试，由独立整合者审查 diff 并复跑完整 `npm run check` 后才进入下一阶段。五个 PR 保持 Draft，未合并、未部署；上线两周后的使用数据仍未产生。

## PR 与结果

| 阶段 | 审阅入口 | 本阶段结果 |
| --- | --- | --- |
| PR1 掌握判据与正式键盘 | [#17](https://github.com/letuluvme-hub/vocab-expedition-wy8/pull/17) | 完整可重复 QWERTY；错误统一“不对”；严格正式证据才掌握，旧练习记录保留。 |
| PR2 每日短局流程 | [#18](https://github.com/letuluvme-hub/vocab-expedition-wy8/pull/18) | 每日主入口、教材／自定义词表、复习配额、逐词热身、最多四组、15 分钟检查点与明确结束。 |
| PR3 跨天复习与家长日报 | [#19](https://github.com/letuluvme-hub/vocab-expedition-wy8/pull/19) | 上海日期、1／2／4／7／15 天复习、失败回退、真实活动时长、30 天日报与纯文本复制。 |
| PR4 伙伴、图鉴、打卡 | [#20](https://github.com/letuluvme-hub/vocab-expedition-wy8/pull/20) | 原创像素伙伴“墨芽”、四档已收集词卡、永久外观、连续打卡与每周一次补签。 |
| PR5 降低挫败与发布物验收 | [#21](https://github.com/letuluvme-hub/vocab-expedition-wy8/pull/21) | 错词可延后继续，未拼完不计完成；保留正确词，零拼错伤害、无定时怪物攻击。 |

PR2 至 PR5 的 base 分别为前一阶段分支，便于按顺序审阅和合并。工作基线为 `2bb108ac9f7a5e435b4ae4c392123f28e8ebd0e7`。

## 整合者独立验收

以下记录整合者独立运行的完整命令结果。每阶段 `npm run check` 包含词库校验、单测、构建、构建测试、完整 e2e 和发布物浏览器验收；全部退出码 0，全部失败数 0。

| 阶段 | 单测通过 | 构建测试通过 | e2e 通过 | 预期跳过 | 发布物通过 | 退出码 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PR1 | 1039 | 3 | 236 | 200 | 2 | 0 |
| PR2 | 1066 | 3 | 245 | 209 | 2 | 0 |
| PR3 | 1106 | 3 | 253 | 217 | 2 | 0 |
| PR4 | 1135 | 3 | 261 | 225 | 2 | 0 |
| PR5 | 1151 | 3 | 267 | 231 | 4 | 0 |

跳过的是旧版项目不支持的新增功能及已有明确不适用场景，未计入通过数。最终浏览器统计 unexpected = 0、flaky = 0。`check:data` 每阶段均确认 259 条，六单元 45／55／29／50／41／39。生产构建测试确认无 `__gameTest`／`__VOCAB_TEST__` 状态探针；发布物验收分别使用真实网站与断网 `file://` 单文件。

本地运行 Node.js 24.19.0、仓库锁定的 Playwright 1.63.0 和缓存 Chromium headless shell（revision 1194）。远端 GitHub Actions 使用仓库原 CI 配置独立验证；实时状态见各 PR 的 Checks。package、锁文件、Vite 与 CI 保持基线版本。

| 验收要求 | 证据位置与范围 |
| --- | --- |
| 顺序错／字母错／提示／预知残卷／透视不能掌握 | `tests/unit/dictation.test.js` 与 `daily-learning.test.js`；真实控制器五类失败后纠正仍留复习。 |
| 到期答错回到 1 天、移出掌握 | `daily-learning.test.js`、`daily-report.spec.js`、`daily-comfort.test.js`；立即撤销与后续完成幂等。 |
| 热身不掌握、带帮助不掌握、完整短局到结算 | `daily-session.spec.js`、`daily-report.spec.js`、`daily-comfort.spec.js`；生产网站及断网单文件亦走完整流程。 |
| 日报日期／时长／词数／正确率／错词和复制 | `daily-report.spec.js` 实际剪贴板回读；拒绝能力时可选纯文本，跨午夜时间拆分与 30 天数值归档有单测。 |
| 320px／390px 输入区域 | 键盘、每日流程、日报、收藏与 comfort 浏览器用例检查坐标、水平溢出、按钮和页面隔离；伙伴／图鉴只在主页，不浮到正式输入上。 |
| 错词延后、恢复与旧攻击隔离 | `daily-comfort.spec.js` 实际从自由远征蓄力切入每日，等待真实攻击窗口后旧生命／战斗仍冻结；完成词保留。 |
| 伙伴／图鉴／补签／奖励 | `daily-collection.test.js` 与 `.spec.js`；两类实际穿戴、重复奖励、补签不造日报、断签不丢收藏、真实写盘拒绝。 |

每阶段先红测试提交和逐次结果、关键变异测试、实现者定向检查均完整记录在 [feature-daily-dictation.md](feature-daily-dictation.md)。PR1 临时放宽错误判据产生 5 个失败；PR2 忽略提示计数产生 1 个失败；PR3 不撤销掌握产生 12 个失败；PR4 移除按日领奖 guard 产生 1 个失败。PR5 的具体变异结果见该文档末节。变异代码均已恢复，不在交付树中。

## 学习与存档口径

`wy8a_rogue_v1`、旧 `mastered`、自由远征快照与未知字段保留。旧 `mastered` 继续表示练习历史，不追认正式默写。新 `dictationMastered` 缺失时从空数组开始，单元解锁和未来新轮生命成长只读取它；旧快照已有生命不倒扣、不补叠。

正式完整拼对且零错误、零提示、零揭示才获得掌握。任何正式失败／帮助立即进入次日复习；到期复习失败回到 1 天并移出掌握。干净到期成功依次排 1／2／4／7／15 天，通过 15 天阶段后显示复习稳固；提前练习不擅自推进或推迟到期。

每天最多 16 词，合并复习配额不超过所选词数一半；热身一次后进入正式完整键盘。少量词表可提前结束，不强迫等待到 10 分钟。15 分钟活动计时到点暂停输入并提供结束入口；暂停／后台不计时，结束后不自动开新局。正式拼错生命伤害上限为 0，怪物分组只随词的处理进度推进，没有手速蓄力攻击。

延后的失败／辅助词明确记录 `completed:false`、`deferred:true`、`eligible:false`，不调用 `creditDictation`，不增加完成或掌握数；失败仍进入一次拼对率分母。日报分母为完整正式尝试或已发生失败／帮助的正式尝试，热身和干净半词不算。昨天已经评估的失败仅在今天恢复并延后，不回放成今天输入、评估或奖励。

日报仅保留最近 30 个上海日历日明细，更早的按数值汇总，累计当日去重练习词数显示为“词次”。词卡曝光／掌握／复习事实和当前恢复检查点各自保留，不拿旧日报补造日期、签到或奖励。每周一次补签只改变签到显示；原有卡片、伙伴形态、外观不会因断签或复习失败删除。

## 冻结与改动文件

相对基线，38 个既有 `src/data/**` 和 `src/styles/**` 文件的 Git blob 逐个相同。259 词的内容、顺序、释义、难度、主题以及既有角色／怪物和数值未修改。仅新增带自身容器前缀的样式表。Backlog 10／11／12／14／17／19、新遗物及数值平衡继续冻结，恢复条件是实际部署满 14 天且已有真实使用数据。

本轮共 56 个改动文件（含本报告），如下。阶段列标记文件在哪个阶段修改。

| 文件 | 改动阶段 |
| --- | --- |
| [`README.md`](../README.md) | PR5 |
| [`docs/architecture.md`](../docs/architecture.md) | PR5 |
| [`docs/daily-dictation-delivery-report.md`](../docs/daily-dictation-delivery-report.md) | PR5 |
| [`docs/feature-daily-dictation.md`](../docs/feature-daily-dictation.md) | PR1、PR2、PR3、PR4、PR5 |
| [`docs/product-backlog.md`](../docs/product-backlog.md) | PR1、PR5 |
| [`src/app/combat.js`](../src/app/combat.js) | PR1 |
| [`src/app/daily-collection.js`](../src/app/daily-collection.js) | PR4 |
| [`src/app/daily-dictation.js`](../src/app/daily-dictation.js) | PR2、PR3、PR5 |
| [`src/app/daily-learning.js`](../src/app/daily-learning.js) | PR3 |
| [`src/app/runtime.js`](../src/app/runtime.js) | PR1、PR2、PR3、PR4 |
| [`src/domain/campaign.js`](../src/domain/campaign.js) | PR1 |
| [`src/domain/daily-collection.js`](../src/domain/daily-collection.js) | PR4 |
| [`src/domain/daily-learning.js`](../src/domain/daily-learning.js) | PR3 |
| [`src/domain/daily-session.js`](../src/domain/daily-session.js) | PR2、PR5 |
| [`src/domain/dictation.js`](../src/domain/dictation.js) | PR1 |
| [`src/domain/learning.js`](../src/domain/learning.js) | PR1 |
| [`src/services/storage.js`](../src/services/storage.js) | PR1 |
| [`src/styles/daily-collection.css`](../src/styles/daily-collection.css) | PR4 |
| [`src/styles/daily-report.css`](../src/styles/daily-report.css) | PR3 |
| [`src/styles/daily-session.css`](../src/styles/daily-session.css) | PR2 |
| [`src/styles/dictation.css`](../src/styles/dictation.css) | PR1 |
| [`src/ui/components/daily-collection.js`](../src/ui/components/daily-collection.js) | PR4 |
| [`src/ui/components/daily-report.js`](../src/ui/components/daily-report.js) | PR3 |
| [`src/ui/components/dictation-keyboard.js`](../src/ui/components/dictation-keyboard.js) | PR1 |
| [`src/ui/screens/daily-dictation.js`](../src/ui/screens/daily-dictation.js) | PR2、PR4、PR5 |
| [`src/ui/screens/title.js`](../src/ui/screens/title.js) | PR1 |
| [`tests/e2e/audio-compatibility-game.spec.js`](../tests/e2e/audio-compatibility-game.spec.js) | PR1、PR3、PR4 |
| [`tests/e2e/baseline.spec.js`](../tests/e2e/baseline.spec.js) | PR1 |
| [`tests/e2e/campaign.spec.js`](../tests/e2e/campaign.spec.js) | PR1 |
| [`tests/e2e/combat.spec.js`](../tests/e2e/combat.spec.js) | PR1 |
| [`tests/e2e/daily-collection.spec.js`](../tests/e2e/daily-collection.spec.js) | PR4 |
| [`tests/e2e/daily-comfort.spec.js`](../tests/e2e/daily-comfort.spec.js) | PR5 |
| [`tests/e2e/daily-report.spec.js`](../tests/e2e/daily-report.spec.js) | PR3 |
| [`tests/e2e/daily-session.spec.js`](../tests/e2e/daily-session.spec.js) | PR2 |
| [`tests/e2e/dictation-keyboard.spec.js`](../tests/e2e/dictation-keyboard.spec.js) | PR1 |
| [`tests/e2e/growth.spec.js`](../tests/e2e/growth.spec.js) | PR1 |
| [`tests/e2e/progression.spec.js`](../tests/e2e/progression.spec.js) | PR1 |
| [`tests/e2e/round-cards.spec.js`](../tests/e2e/round-cards.spec.js) | PR1 |
| [`tests/e2e/round-difficulty.spec.js`](../tests/e2e/round-difficulty.spec.js) | PR1 |
| [`tests/e2e/word-queue.spec.js`](../tests/e2e/word-queue.spec.js) | PR1 |
| [`tests/release/smoke.spec.js`](../tests/release/smoke.spec.js) | PR5 |
| [`tests/unit/campaign-continuity.test.js`](../tests/unit/campaign-continuity.test.js) | PR1 |
| [`tests/unit/campaign-ui.test.js`](../tests/unit/campaign-ui.test.js) | PR1 |
| [`tests/unit/campaign.test.js`](../tests/unit/campaign.test.js) | PR1 |
| [`tests/unit/controllers.test.js`](../tests/unit/controllers.test.js) | PR1 |
| [`tests/unit/daily-collection.test.js`](../tests/unit/daily-collection.test.js) | PR4 |
| [`tests/unit/daily-comfort.test.js`](../tests/unit/daily-comfort.test.js) | PR5 |
| [`tests/unit/daily-learning.test.js`](../tests/unit/daily-learning.test.js) | PR3 |
| [`tests/unit/daily-session.test.js`](../tests/unit/daily-session.test.js) | PR2 |
| [`tests/unit/dictation-keyboard.test.js`](../tests/unit/dictation-keyboard.test.js) | PR1 |
| [`tests/unit/dictation.test.js`](../tests/unit/dictation.test.js) | PR1 |
| [`tests/unit/domain.test.js`](../tests/unit/domain.test.js) | PR1 |
| [`tests/unit/foe-attack-combat.test.js`](../tests/unit/foe-attack-combat.test.js) | PR1 |
| [`tests/unit/relic-combat-synergy.test.js`](../tests/unit/relic-combat-synergy.test.js) | PR1 |
| [`tests/unit/storage.test.js`](../tests/unit/storage.test.js) | PR1 |
| [`tests/unit/ui-modules.test.js`](../tests/unit/ui-modules.test.js) | PR1 |

## 已验证源码与远端映射

远端通过 GitHub Git Data API 创建提交；提交元数据使 commit SHA 与本地不同。整合者逐提交比较 tree SHA，远端文件树必须与本地提交逐字节一致后才建立分支。以下是每阶段被完整独立检查的源码提交；本报告在 PR5 的额外文档提交中加入，未改变该已验证源码。

| 阶段 | 本地源码 SHA | 远端相同文件树的提交 SHA | tree SHA |
| --- | --- | --- | --- |
| PR1 | `a1ff3d50955f3a9090169a825f63b885f86c36d5` | `0b83ac668ddca0989fe17d9493cda642b3067aba` | `03ce0584a17f9e2ab6e2bcea9d01b40c1072a5da` |
| PR2 | `eca86d17243d99a4314870fec39ab111c882c711` | `55ad450df6e4a0bd9c1a1cd1c3e1fd36d1c5d319` | `f7ef099de414a35954ecaab536911d83a6b5f054` |
| PR3 | `e3d0fa2138da9c587eee8f1461783defa43a5003` | `27c5f19ed32f4f5cae900ada1522da71e6fc43e2` | `9f67bac0df4f9c8e1c87306bedc3972e12c18d76` |
| PR4 | `8b2134579341cef816734a3cf79d5eac336a5ce9` | `c019546193b3ef0569ebf41aba3f706735a522ac` | `e74ec3e9bf31d67dac398b53f813be5b743e9e9b` |
| PR5 | `29912d2edb43e4c953ef54eb7d07946732c31893` | `7344ecd2ea9018554bc033b1044d093741e079e8` | `d60ed02314fb33b482582d97487ba05280a13d56` |

## 未验证风险

- 未进行上海八年级学生的实际使用试验：每日主动打开、10–15 分钟完成分布、学校默写正确率提升，以及伙伴阈值和外观偏好仍需上线后数据。
- 未做 iPhone／Android／微信真机字体、输入法、触屏、安全区、浏览器工具栏和实际音频试听。自动化环境缺中文字体；中文 DOM 与几何位置通过，不等同真实字形排版。
- 剪贴板和 localStorage 权限由平台决定。真实 Chromium 复制／拒绝及写盘失败提示已测；不同手机权限、无痕模式和 `file://` 存储行为仍需设备验证。
- 学习、签到和收藏保存在当前浏览器，没有云账户或跨设备同步；移动离线文件或切换域名／浏览器不会自动迁移存档。
- 五个 Draft PR 尚未合并或发布，因此没有公共生产地址验收、上线后两周观察或真实学习效果结论。
