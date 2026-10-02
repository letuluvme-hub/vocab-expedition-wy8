import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = existsSync(chrome) ? chrome : undefined;
const basePath = process.env.E2E_BASE_PATH || '/vocab-expedition-wy8/';
const vite = path.resolve('node_modules/vite/bin/vite.js');

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 25_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // 4 = CI runner 的核数。串行跑要用 20 分钟，装完 Chromium 只剩 6 分半就
  // 撞上 ci.yml 的 15 分钟 job 上限。这些用例基本都在等真实计时窗口、不吃
  // CPU，所以 4 worker 在 4 核上能拿到接近线性的加速，又不会因为超订把
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
    url: 'http://127.0.0.1:4173',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
