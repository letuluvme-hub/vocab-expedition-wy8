# 词汇远征 · 外研版八上

纯静态英语拼词 roguelite，支持外研版八上 Unit 1–6 共 259 条词汇、自定义词表、角色、遗物、道具、语音及通关纪念卡。

## 核心玩法：选词出招

每个词出招前给 2–3 张候选卡（中文释义 + 字母数 + 预估伤害），词越长打得越疼；没动过这个词前可点卡或按 Tab 换。
普通战以道具奖励为主，遗物主要来自精英与首领；远征里把一个单元的词全部整词拼完也会解锁下一单元。
详见 [docs/feature-word-choice.md](docs/feature-word-choice.md)。

## 长远征后期

地图顶栏显示「第几轮 · 第几图」。同一次远征越往后的地图，怪物血更厚、打得更疼，商店也越贵；
商店另有提示宝典（1000 金币，每场提示 +1）、提示圣典（2000，+3）、生命圣杯、遗物宝箱。
八上 Unit 6 学完接着进八下 Unit 1，两册都学完后每张新图随机复习一个单元。
详见 [docs/feature-late-run.md](docs/feature-late-run.md)。

## 单词图鉴与练习

主页标题下方保留「单词图鉴」，单词预习、伙伴、打卡与今日记录在页面底部「练习与收藏」，默认折叠。

2026-10 起每日默写改成**单词预习**：任选教材册和单元（不受远征解锁限制），把整个单元按课本顺序过一遍。看中文，用字母盘拼英文；提示不限次数，每次替你填一个字母；不会的词可以直接跳过；不限时，随时暂停，刷新后接着练。不看提示拼对的词记为学会（写进 `mastered`），用了提示的词只记练过，并出现在家长日报的「错词／辅助词」里。详见 [docs/feature-preview.md](docs/feature-preview.md)。

「学会」改成统一口径：以前正式默写掌握的、远征里整词拼对的、预习里不看提示拼对的都算。单元解锁、新开远征的生命/攻击成长、墨芽长大、主页「学会单词」统计都读这一份。旧版正式默写的会话、键盘与严格掌握规则仍保留在代码里，只为恢复旧存档里进行到一半的默写。自由远征保留在主页，进入预习会冻结原远征，回来可继续。

主页还显示原创像素伙伴「墨芽」、单词图鉴、连续打卡和可复制的家长「今日记录」。完整规则、上海日期、跨天复习阶梯、30 天日报及旧档迁移见 [docs/feature-daily-dictation.md](docs/feature-daily-dictation.md)。收集和纯外观奖励保存在本机，断签不清收藏；补签每周一次，不伪造练习日报。真实学生的 10–15 分钟完成率、主动使用与学校默写提升尚待使用数据验证。

## 平板显示方式

平板主页有「显示方式」切换：自动、手机版式、电脑版式，靠改 meta viewport 宽度实现，选择存本机，不进学习存档。手机和电脑上不出现。详见 [docs/feature-display-mode.md](docs/feature-display-mode.md)。

## 开发

需要 Node.js 22.12+（推荐 24 LTS）。

```sh
npm ci
npm run dev
```

打开终端提供的地址，路径为 `/vocab-expedition-wy8/`。开发源使用 ES Modules，不能直接双击源 `index.html`。

```sh
npm run check:data  # 词库校验
npm test           # Node 单元测试与旧版对照
npm run build      # 静态 dist + 可离线双击的单文件
npm run test:build # 发布物版本桥接、无调试状态探针
npm run test:e2e   # 真实 Chromium：旧版及新版相同操作回归
npm run test:release # 生产站点及断网 file:// 单文件真实浏览器验收
```

浏览器测试在 Windows 优先使用安装的 Chrome，也可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。CI 使用 `npx playwright install --with-deps chromium` 安装浏览器。

## 构建与部署

- `dist/index.html` 与 `dist/assets/*` 是网站发布物，仍然无需后端。
- `dist/vocab-expedition-standalone.html` 是自动生成的单文件，供离线下载使用；不要手工编辑。
- Pages 发布通过 `.github/workflows/deploy.yml`，验证完整 `npm run check` 后上传整个dist，再部署；Pages build_type须为workflow。
- 用户已授权本次重构完成后合并上线；合并前必须验证最新main、CI和回滚标签，发布后验证公共地址。
- 模块化源码不能直接套用旧 `redeploy.py`：它只上传一个 HTML。上线前须切换 Pages 到 GitHub Actions 并发布整个 dist，或明确采用单文件发布方案。
- `public/version.json` 是版本唯一来源；构建同步注入版本常量，并保留旧 HTML 客户端可识别的版本标记。
- 存档仍使用 `wy8a_rogue_v1`；部署时保持既有域名与地址，不清空学习记录。

## 模块化开发

词库/配置、地图/抽词/字母盘/伤害/护盾/学习/远征规则、存档/语音/音效/版本服务、title/map/fight/over页面、事件/商店/奖励和战斗控制器均已分离。样式按组件切分并精确保留覆盖顺序。`src/app/runtime.js` 保留启动、唯一状态所有权、浏览器事件和跨模块装配。

远征/战斗计时器由 lifecycle 管理，重开、放弃或清档不会执行旧局结算；战斗奖励只能兑现一次。结构重构不混入新玩法、伤害平衡或存档格式迁移。

协作规则见 [AGENTS.md](AGENTS.md)，边界及后续步骤见 [docs/architecture.md](docs/architecture.md)。冻结基线见 `docs/baseline.json` 和 `tests/fixtures/legacy.html`。
