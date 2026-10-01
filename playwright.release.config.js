import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir: './tests/release',
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 20_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: {width:390,height:844},
    reducedMotion: 'reduce',
    launchOptions: {executablePath:existsSync(chrome)?chrome:undefined,args:['--mute-audio']},
  },
  webServer: {
    command: `"${process.execPath}" "${path.resolve('node_modules/vite/bin/vite.js')}" preview --host 127.0.0.1 --port 4174 --strictPort`,
    url: 'http://127.0.0.1:4174/vocab-expedition-wy8/',
    reuseExistingServer: false,
  },
});
