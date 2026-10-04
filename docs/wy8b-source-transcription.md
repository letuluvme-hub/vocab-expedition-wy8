# 八下教材词表转录记录

本次新增 `src/data/words-wy8b.js`，导出独立的 `WORDS_WY8B`；不合并或改写八上 `WORDS` 的原始 259 条。来源仅为用户于 2026-10-04 提供的四张教材词表照片。教材词表页码为 129–132，截图中每词旁边的 `p.` 数字是正文出现页码，不是词表页码。

| 单元 | 条数 | 词表页码 | 本次主题标签 |
| --- | ---: | --- | --- |
| Unit 1 | 29 | 129 | 艺术与表达 |
| Unit 2 | 32 | 129–130 | 发现与发明 |
| Unit 3 | 44 | 130–131 | 金钱与经济 |
| Unit 4 | 24 | 131 | 时尚与穿着 |
| Unit 5 | 46 | 131–132 | 灾害与求生 |
| Unit 6 | 33 | 132 | 故事与情感 |
| 合计 | 208 | 129–132 | |

主题标签是根据该单元词汇内容整理的游戏元数据，不宣称是照片未展示的教材单元标题。难度 `d` 按待拼英文字母数派生：忽略空格、标点、连字符后，1–5 个字母为 1，6–9 个为 2，10 个及以上为 3。该难度不是教材标注，也不用于改写原八上难度。每条仍只有 `{u, d, w, z, th}` 五个字段；不将音标、词性或页码当成待拼内容。

| 用户图片 | 词表页码 | 本页条目范围 | 条数 |
| --- | ---: | --- | ---: |
| `0c50113239195c905965cabd1d7d96df.jpg` | 129 | Unit 1 全部；Unit 2 discovery 至 by accident | 49 |
| `8768f4c59b4290a02b2fe28d470c40b0.jpg` | 130 | Unit 2 to one’s surprise 至 spare；Unit 3 mall 至 completely | 51 |
| `f49374b15bd03671c79457dfea5bf064.jpg` | 131 | Unit 3 valuable 至 account for；Unit 4 全部；Unit 5 disaster 至 electronic | 54 |
| `5da307ac47c8897936ad5a8477154e14.jpg` | 132 | Unit 5 sharp 至 tent；Unit 6 全部 | 54 |

按左栏从上到下，再接右栏从上到下的教材阅读顺序录入，跨页续接同一单元。全部 208 条由两名 agent 分别查看原图并独立转录，再逐条比较英文顺序及中文释义；英文顺序 208/208 一致，中文在多词性分隔符和美式拼写注记的已说明处理后亦 208/208 一致。

需要保留的词形与注记：

- `prefer ... to`、`turn ... into` 的英文省略号为三个点；数据不删去占位省略号。中文释义保留教材中文省略号。
- `to one’s surprise` 保留弯引号；`self-expression`、`life-saving`、`X-ray`、`low-lying`、`bad-tempered` 保留连字符。
- `BCE`、`CE`、`Rd`、`X-ray` 保留教材大小写；没有扩写成新的待拼词。
- `jewellery (AmE jewelry)` 主词录为 `jewellery`，释义注明“美式拼写 jewelry”；`towards (AmE toward)` 同样使用 `towards` 并注明美式变体。每项仍只算一条教材词汇。
- `award`、`budget`、`trade`、`cost`、`complete`、`force`、`ache` 等多词性词条保持全部中文释义，以 ` / ` 分隔；没有拆成重复词条。
- Unit 3 的 `saying`（谚语；格言；警句）曾在初读时误认成 `saving`，已对照片该行局部放大并由两名 agent 确认为 `saying`。最终数据与契约测试使用 `saying`，没有根据常识擅自替换教材词。
- 已局部复核 `sir` 的“名字或姓名前面”和 `trainers` 的“运动鞋；便鞋”。没有尚未确认的模糊词或释义。

照片还给出下列词形说明，未将说明文本或额外词形加入 208 条主表：`BCE (= before the Common Era)`、`CE (= Common Era)`、`advertisement (= ad)`、`Rd (= road)`、`exam (= examination)`、`anybody (= anyone)`、`knife (pl. knives)`、`yourself (pl. yourselves)`。这些说明在此保留，便于后续教材注记功能使用。

验证范围：

- 新增数据契约测试先执行，缺少实现时退出 1，0 通过 / 7 失败；填入数据后退出 0，7 通过 / 0 失败。
- 将实际数据 `saying` 临时变异为 `saving` 后退出 1，5 通过 / 2 失败，证明顺序和关键词形断言能发现该转录错误；恢复后重新执行。
- `npm run check:data` 退出 0，原八上仍为 259 条、六单元 45/55/29/50/41/39。八下 208 条及其单元分布由新增数据契约独立校验，原校验脚本未改动。
- `npm test` 退出 0，1302 通过 / 0 失败 / 0 跳过。最初完整测试因独立 worktree 未连接既有 `@playwright/test` 依赖而有 1 个模块加载失败；连接既有依赖后完整重跑通过，没有修改测试来规避。
- `npm run build` 退出 0；`npm run test:build` 退出 0，3 通过 / 0 失败，生产发布物不含测试状态探针。
- 教材选择、单词图鉴、每日默写与远征的双教材接入由整合者另行验证。本数据提交没有宣称这些 UI 已经接入八下。
