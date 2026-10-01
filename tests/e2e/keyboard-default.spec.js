import { test, expect } from './game-harness.js';

// 任务14：默认字母盘是 QWERTY。本规格只针对 new 目标 —— legacy 归档页保留它
// 自己的历史默认值（由 baseline 规格负责），本任务不改归档源码。
const NEW_ONLY = 'Archived legacy page keeps its own historical default; this spec targets the new build';

test('fresh save without kbMode enters a real fight on the QWERTY keyboard', async ({ game, page }, testInfo) => {
  test.skip(testInfo.project.metadata.target !== 'new', NEW_ONLY);
  // 存档里完全没有 kbMode 字段（首次进入 / 老存档没有这个偏好）。
  await game.open({ saved: { runs: 1 } });
  expect((await game.state()).DB.kbMode).toBe(true);
  await game.start();
  await game.fight({ word: 'cotton' });
  // 真实渲染出来的字母盘 class，而不是内部状态。
  await expect(page.locator('#fBank')).toHaveClass(/\bkb\b/);
  await expect(page.locator('#fBank')).not.toHaveClass(/\bgrid\b/);
  await expect(page.locator('#fBank .kbrow')).toHaveCount(3);
  const rows = await page.locator('#fBank .kbrow').evaluateAll(els =>
    els.map(el => [...el.querySelectorAll('.key')].map(k => k.textContent.toLowerCase())));
  const qwerty = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  for (const letters of rows) {
    const layout = qwerty.find(row => row.includes(letters[0]));
    expect(layout, 'row belongs to a QWERTY row: ' + letters.join('')).toBeTruthy();
    expect(letters.every(ch => layout.includes(ch))).toBe(true);
    expect(letters.map(ch => layout.indexOf(ch)))
      .toEqual(letters.map(ch => layout.indexOf(ch)).sort((a, b) => a - b));
  }
  await expect(page.locator('#tBankModeV')).toHaveText('开');
  // 不完成整词，避免与击杀/相位记账相交。
  expect((await game.state()).DB.mastered).toEqual([]);
});

test('explicit kbMode false stays on the shuffled grid across reload', async ({ game, page }) => {
  // 这条对两个目标都成立：明确 false 的旧档必须保持网格。
  await game.open({ saved: { kbMode: false } });
  expect((await game.state()).DB.kbMode).toBe(false);
  await game.start();
  await game.fight({ word: 'cotton' });
  await expect(page.locator('#fBank')).not.toHaveClass(/\bkb\b/);
  await expect(page.locator('#fBank')).toHaveClass(/\bgrid\b/);
  await expect(page.locator('#tBankModeV')).toHaveText('关');
  await game.reload();
  expect((await game.state()).DB.kbMode).toBe(false);
});

test('explicit kbMode true stays on QWERTY and switching to grid survives reload with a half word', async ({ game, page }) => {
  await game.open({ saved: { kbMode: true } });
  await game.start();
  await game.fight({ word: 'cotton' });
  await expect(page.locator('#fBank')).toHaveClass(/\bkb\b/);
  // 打到一半，再切到网格：半词不能因为换布局而丢。
  await page.locator('#fBank .key:not(.out):not(.gone)').filter({ hasText: /^c$/i }).first().click();
  await page.locator('#fBank .key:not(.out):not(.gone)').filter({ hasText: /^o$/i }).first().click();
  const partial = (await game.state()).B.input.join('');
  expect(partial).not.toBe('');
  expect((await game.state()).DB.mastered).toEqual([]);
  await page.locator('#tBankMode').click();
  await expect(page.locator('#fBank')).not.toHaveClass(/\bkb\b/);
  expect((await game.state()).B.input.join('')).toBe(partial);
  await game.reload();
  const after = await game.state();
  expect(after.DB.kbMode).toBe(false);
  expect(after.DB.mastered).toEqual([]);
});

test('no-storage devices still reach a playable QWERTY keyboard', async ({ page }, testInfo) => {
  test.skip(testInfo.project.metadata.target !== 'new', NEW_ONLY);
  // 平台能力降级（localStorage 整个拿不到），不是对游戏逻辑打桩。
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true, get() { throw new Error('SecurityError: storage blocked'); },
    });
    window.__VOCAB_TEST__ = true;
    let state = 0x51a7 >>> 0;
    Math.random = () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  });
  await page.goto(testInfo.project.metadata.basePath);
  await expect(page.locator('#s-title')).toBeVisible();
  expect(await page.evaluate(() => window.__gameTest.DB.kbMode)).toBe(true);
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const node = t.G.avail[0];
    node.type = 'battle';
    t.enterNode(node);
    const entry = t.WORDS.find(x => x.w === 'cotton');
    t.B.word = entry;
    const letters = t.drawLetters(entry);
    Object.assign(t.B, { letters: letters.letters, used: letters.used,
      bad: letters.letters.map(() => false), input: [], enHp: 10_000, enMax: 10_000, combo: 0 });
    t.renderFight();
  });
  await expect(page.locator('#s-fight')).toBeVisible();
  await expect(page.locator('#fBank')).toHaveClass(/\bkb\b/);
  await expect(page.locator('#fBank .kbrow')).toHaveCount(3);
});