# 九角色、知识攻击与战斗展示发布审查

版本：2026.10.04-nine-heroes-growth-1。基线：main 1d658b564a369b93f64ffad00fd98379ad802aaf。

独立 PR：#40 致死跳过、#41 九角色/攻击成长、#42 常驻战斗/眨眼。合并发布采用同一树并包含三项父提交，避免分三次发布中间状态。共享样式冲突只保留 hero-roster → battle-stage 的追加顺序，同步两份注册表；runtime 的成长事实与确认端口分别保留。

| 变化 | 文件 |
|---|---|
| 致死跳过确认 | app/combat.js、app/runtime.js；controllers、ghost、skip-cost 单测与浏览器回归 |
| 九角色与累计攻击 | data/heroes.js、data/hero-balance.js；domain/hero-rules.js、damage.js、mastery-growth.js、run.js、run-snapshot.js、word-choice.js；ui/components/hero.js、equipment-panel.js、mastery-growth.js；styles/hero-roster.css、mastery-growth.css；baseline、nine-heroes-growth、生产 smoke 测试 |
| 常驻对峙/持续眨眼 | index.html、ui/screens/fight.js、styles/battle-stage.css、pixel-art.css；battle-stage 浏览器回归 |
| 接线/审查 | styles/game.css、extraction/styles 注册及现有 UI 单测；scripts/simulate-hero-balance.mjs、verify-public-checks.mjs；public/version.json 与各功能文档 |

来源路径均在 src/（测试、脚本及文档除外）。原 259 词和七张冻结 CSS 的逐字节对照仍通过。存档 key 不变，旧成长 version 1 只保留生命；新局 version 2 冻结生命和攻击，未知存档字段保留。生产 bundle 不含 __gameTest / __VOCAB_TEST__。

新规则先补失败测试；关键变异分别去掉致死确认、攻击步长 4 改 5、强制重建 SVG，均被行为断言捕获。新版九角色期望与归档六角色期望明确分开，不删除旧输入/学习/控件回归。

验收命令：npm run check:data、npm test、node --test android/test/tts-shim.test.mjs、npm run build、npm run test:build、npm run test:e2e、npm run test:release。各 feature 与合并树分别执行；准确退出码与通过/失败数记录在 PR 描述和 GitHub CI。公开发布后逐文件比较构建哈希，并通过真实按钮验证角色、成长、取消致死跳过、暂停恢复、滚动装备与旧存档/正式默写；生产验证不启用调试桥。

局限：6912 轮角色/成长比较是固定五战的受控规则模拟，不能代表真实学生胜率或兴趣。Chromium 平台自动化不替代安卓/iPhone 真机音色、浏览器工具栏及手势安全区观察。新增攻击成长只算正式默写掌握，新局生效，远征历史拼对展示不因此改判掌握。
