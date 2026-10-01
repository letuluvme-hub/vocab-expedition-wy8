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
  workers: 1,
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
