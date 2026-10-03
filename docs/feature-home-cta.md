# 主页开始按钮点击修复（P0-1）

基线：`ab4546e`。产品改动仅在 `src/styles/home-cta.css`：将 `#startRow` 的层级从 4 提至 50，添加不透明的 `var(--bg)` 底色。版本号和七张冻结样式表未改。

`tests/e2e/home-cta-hit.spec.js` 覆盖 390×844、375×667、360×780、320×568。每个视口检查按钮中心、左 20%、右 80% 的 `elementFromPoint` 命中；再自然滚动，让现有角色头像经过 sticky 按钮，重复检查并用普通 `page.click` 进入地图。没有强制点击、伪造遮罩或调用游戏调试入口代替点击。

Linux 浏览器的初始视口未单独复现遮挡；滚动后真实角色的头像、眼睛等部件拦截按钮区域。修复前四个用例均失败，修复后四个均通过。将实际 CSS 的层级临时改回 4、保留底色，390×844 用例再次失败；随后已恢复为 50。

## 测试环境修正

- `tests/e2e/pause-resume.spec.js`：原有 400ms 去重窗口用例在全量及独立复跑中都失败。把 `advAt` 的设置移入离开商店按钮的一次性真实 click 捕获监听，使其与生产处理器在同一事件中执行，避免可见性检查和点击 RPC 耗尽时间窗口。全部原断言保留。
- `tests/release/smoke.spec.js`：对网站和离线单文件两种发布物都显式授予测试浏览器剪贴板读写权限，避免 `file://` 读回等待权限提示。仍然读取真实剪贴板，未 mock，未减少断言。

## 验收

所有测试命令均在允许启动子进程和浏览器的环境执行。浏览器使用隔离的 4290 端口；临时配置指定此 worktree 的绝对测试路径、输出路径和 `webServer.cwd`，并关闭 `reuseExistingServer`。

| 命令/场景 | 实际结果 | 退出码 |
|---|---|---:|
| 新主页用例，修复前 | 0 通过 / 4 失败 | 1 |
| 新主页用例，修复后 | 4 通过 / 0 失败 | 0 |
| 层级改回 4 的关键变异 | 0 通过 / 1 失败 | 1 |
| `npm run check:data` | 259 词校验通过 | 0 |
| `npm test` | 1201 通过 / 0 失败 | 0 |
| `npm run build` | 网站及单文件构建通过 | 0 |
| `npm run test:build` | 3 通过 / 0 失败 | 0 |
| 原 400ms 用例，夹具修正后 | 1 通过 / 0 失败 | 0 |
| `npm run test:release -- --config=/tmp/vocab-home-cta-release.config.mjs` | 6 通过 / 0 失败 | 0 |
| 完整 E2E，两个 worker | 291 通过 / 1 失败 / 256 跳过 | 1 |
| 失败的旧档 difficulty 用例原样独立复跑 | 1 通过 / 0 失败 | 0 |

完整 E2E 命令：`npm run test:e2e -- --config=/tmp/vocab-home-cta-playwright.config.mjs --workers=2`，用时 10.9 分钟。本轮四个主页命中用例和 400ms 用例均通过。唯一失败为现有 `round-difficulty.spec.js:285` 的真实倒计时断言：期望剩余时间大于 3600ms，实得 3580ms；其余旧档难度断言已通过。未修改该测试或产品代码，原样独立复跑通过（7.9 秒），完整运行的失败记录仍保留，不将独立复跑算作全量通过。

独立复跑命令：`npm run test:e2e -- --config=/tmp/vocab-home-cta-playwright.config.mjs --project=new --workers=2 --grep='旧存档没有 difficulty' tests/e2e/round-difficulty.spec.js`。

首次完整 E2E 为 291 通过 / 1 失败 / 256 跳过（退出码 1），唯一失败为上述已修正的 400ms 测试夹具。

尚未在 iPhone、安卓实机上验证浏览器工具栏与安全区变化；本次验证覆盖 Chromium 的四个移动视口。
