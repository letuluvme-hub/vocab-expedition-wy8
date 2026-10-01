# 词汇远征 · 外研版八上

纯静态英语拼词 roguelite，支持外研版八上 Unit 1–6 共 259 条词汇、自定义词表、角色、遗物、道具、语音及通关纪念卡。

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
- 当前线上 Pages 仍是 main 根目录发布。本重构在独立分支验收，**不直接覆盖线上**。
- 模块化源码不能直接套用旧 `redeploy.py`：它只上传一个 HTML。上线前须切换 Pages 到 GitHub Actions 并发布整个 dist，或明确采用单文件发布方案。
- `public/version.json` 是版本唯一来源；构建同步注入版本常量，并保留旧 HTML 客户端可识别的版本标记。
- 存档仍使用 `wy8a_rogue_v1`；部署时保持既有域名与地址，不清空学习记录。

## 模块化第一阶段

已拆分词库/配置、纯文本/伤害/护盾/学习规则、存档、语音、音效、怪物图形及样式。`src/app/runtime.js` 暂时保留战斗/奖励/页面协调与事件顺序，避免同时重写全部玩法。

这不是完整架构迁移的终点。下一阶段在现有测试保护下逐屏提取渲染器，再提取战斗状态转移、地图和计时器生命周期；不要为了把文件变小而引入能任意修改全局状态的事件总线。

协作规则见 [AGENTS.md](AGENTS.md)，边界及后续步骤见 [docs/architecture.md](docs/architecture.md)。冻结基线见 `docs/baseline.json` 和 `tests/fixtures/legacy.html`。
