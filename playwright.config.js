/* e2e 配置。本轮改了三处，全部有对照实验支撑；理由记在这里，免得重走一遍。
 *
 * 现象：4 个 e2e 用例失败，复跑仍失败。
 *
 * 对照实验（本机 Windows / vite 8.3.1 / 每轮冷启动前先杀净 node+chrome）：
 *   workers=4 + timeout=25s（原仓库状态） →   4 failed / 227 passed
 *   workers=4 + timeout=45s                 → 231 passed / 195 skipped / 0 failed
 *   workers=2 + timeout=45s                 → 231 passed / 195 skipped / 0 failed
 *
 * 结论：**只有 timeout 需要改**。workers 与它无关（4 和 2 在 45s 下同样全绿），
 * 所以 workers 保持原值 4 不动 —— 降并发只会拖慢 CI，实测并不需要。
 *
 * ── 那 4 个失败的真实成因 ──
 * dev 模式无打包，浏览器首屏要逐个拉约 100 个模块/样式文件。实测本机：
 *   entry 首次 31.66s / 第二次 3.04s / 第三次 0.07s（转换缓存已热）
 * workers=4 时最先到的 4 个用例正好撞上这次冷启动。判据不是"用例慢"：
 *   audio-settings.spec.js:17 常态 1.1s、baseline.spec.js:3 常态 1.4s，
 *   却在 25s 上限下烧满 25s；而 audio-compatibility 那两条常态就有 18.3s / 20.6s。
 *
 * 改动清单：
 *   - timeout            25s → 45s  （唯一必须改的并发相关项）
 *   - webServer.url      '/'  → 入口路径（让 Playwright 等到服务器真的热了再开跑）
 *   - webServer.timeout  30s → 120s （光"等就绪"这一步自己就要 ~32s）
 *   ★ url 与 timeout 不是替代关系：url 只能预热 HTML 与入口模块，
 *     **吸收不掉浏览器首次拉完整模块图的成本**，所以 timeout 仍必须给到 45s。
 *
 * ── 排查中我犯的两个错，留作警告 ──
 *   1. 看到 heap out of memory 就断定"45s 超时 × 4 worker 是元因"，于是降 workers。
 *      那个诊断是错的：那轮失败发生在前一轮遗留 151 个泄漏 chrome 进程、
 *      可用内存只剩 0.4GB 的机器上，属于环境被污染；干净重跑即全绿。
 *   2. 于是又补了个"workers 只是治标、内存才是根因"的说法 —— 同样没有证据。
 * ⚠️ 跑 e2e 前先确认没有上一轮残留的 node/chrome 进程。Playwright 的
 *   trace/screenshot 在大量失败时会留一堆 zip，叠加泄漏的浏览器进程会吃穿内存，
 *   进而让 dev server 被系统杀掉，表现为上百个 ERR_CONNECTION_REFUSED ——
 *   那不是测试失败，是服务器中途消失。
 *   ⚠️ 内存数据必须在失败发生的那一刻采；整轮结束后再采说明不了任何问题。
 *
 * ── 尚未修的隐患（不在本轮范围，但 review 时值得知道）──
 *   audio-compatibility.spec.js:22（常态 18.3s）与
 *   audio-compatibility-game.spec.js:144（常态 20.6s）贴着 45s 的下界。
 *   CI runner 若比本机慢，这两条会变成下一批假失败。给它们单独设 per-test timeout
 *   比再抬全局 timeout 稳妥，但那需要另一轮实测，本次没做。
 */
import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = existsSync(chrome) ? chrome : undefined;
const basePath = process.env.E2E_BASE_PATH || '/vocab-expedition-wy8/';
const vite = path.resolve('node_modules/vite/bin/vite.js');

export default defineConfig({
  testDir: './tests/e2e',
  // ★ 25s → 45s。唯一必须改的并发相关项，实测依据见文件头。
  //   判据：那 4 个失败用例里有两个常态只要 1.1s / 1.4s，却在 25s 上限下烧满 25s ——
  //   那是冷启动首屏在拖（dev 模式无打包，浏览器要逐个拉约 100 个模块），不是用例慢。
  //   workers 无需改动：4 与 2 在 45s 下都实测 231 passed / 195 skipped / 0 失败。
  timeout: 45_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // 4 = CI runner 的核数（保持原值）。串行跑要用 20 分钟，装完 Chromium 只剩 6 分半就
  // 撞上 ci.yml 的 15 分钟 job 上限。这些用例基本都在等真实计时窗口、不吃 CPU，
  // 所以 4 worker 在 4 核上能拿到接近线性的加速，又不会因为超订把
  // 「8.8 秒挨第一下」这类时间断言挤到上界之外。fullyParallel 仍是 false：
  // 一个 worker 内保持文件串行，避免同文件用例互相影响。
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: './tests/e2e/artifacts/test-results',
  reporter: [['list'], ['json', { outputFile: './tests/e2e/artifacts/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1024, height: 844 },
    reducedMotion: 'reduce',
    launchOptions: { executablePath, args: ['--mute-audio'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'legacy', metadata: { target: 'legacy', basePath } },
    { name: 'new', metadata: { target: 'new', basePath } },
  ],
  webServer: {
    command: `"${process.execPath}" "${vite}" --host 127.0.0.1 --port 4173 --strictPort`,
    // ★ 必须是**入口路径**，不能是根 '/'。
    //
    //   实测（Windows / vite 8.3.1 冷启动）：
    //     GET /                            → 0.32s 就 200
    //     GET /vocab-expedition-wy8/  第1次 → 31.66s（要爬整个 76 模块 + 20 张 CSS 的图）
    //                                 第2次 → 3.04s
    //                                 第3次 → 0.07s（转换缓存已热）
    //
    //   根路径几乎立刻响应，于是 Playwright 判定"服务器就绪"并立刻放 4 个 worker
    //   去打那条 31 秒的入口路径 —— 在**原来的 timeout 25_000** 下，每一个先到的用例
    //   都会挂，报错是 `page.goto: Test timeout exceeded`：看起来像应用坏了，其实是
    //   服务器没热。timeout 因此被抬到 45s —— 两处缺一不可，见文件头。
    //
    //   指到入口路径 = 让 Playwright 等到那条昂贵路径真的被服务过一次再开跑。
    //   playwright.release.config.js 一直就是这么写的（:20 指向 4174 的入口），
    //   只有这份主配置漏了。
    url: 'http://127.0.0.1:4173/vocab-expedition-wy8/',
    // 冷启动本身就要 ~32s，timeout 必须留出余量，否则"等服务器就绪"会先失败。
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
