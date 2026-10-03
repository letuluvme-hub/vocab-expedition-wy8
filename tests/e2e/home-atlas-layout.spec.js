import { test, expect } from './game-harness.js';
const newOnly = info => test.skip(info.project.metadata.target === 'legacy', 'Home layout is new');

for (const width of [320, 390, 1024]) test(`atlas is first, practice is closed at bottom on ${width}px home`, async ({ game, page }, info) => {
  newOnly(info);
  await page.setViewportSize({ width, height: 844 });
  await game.open();
  await expect(page.locator('#homeAtlas')).toBeVisible();
  await expect(page.locator('#homeAtlas h2')).toHaveText('单词图鉴');
  await expect(page.locator('#dailyEntry')).toHaveJSProperty('tagName', 'DETAILS');
  await expect(page.locator('#dailyEntry')).toHaveJSProperty('open', false);
  await expect(page.locator('#dailyEntry > summary')).toHaveText('练习与收藏');
  await expect(page.locator('#dailyOpen')).not.toBeVisible();
  await expect(page.locator('#dailyPartner')).not.toBeVisible();
  await expect(page.locator('#dailyHomeReport')).not.toBeVisible();
  expect(await page.locator('#s-title').innerText()).not.toMatch(/每日默写|每日短局/);
  const bounds = await page.evaluate(() => {
    const before = (a, b) => !!(document.getElementById(a).compareDocumentPosition(document.getElementById(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { atlasFirst: before('homeAtlas', 'keyboardTipHost'), practiceLast: before('rewardCollection', 'dailyEntry'),
      separate: !document.getElementById('dailyEntry').contains(document.getElementById('homeAtlas')),
      width: document.documentElement.scrollWidth, atlasHeight: document.getElementById('homeAtlas').getBoundingClientRect().height };
  });
  expect(bounds).toMatchObject({ atlasFirst: true, practiceLast: true, separate: true });
  expect(bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.atlasHeight).toBeLessThanOrEqual(140);
  const before = await game.saved();
  await page.locator('#dailyAtlasToggle').click();
  await expect(page.locator('#dailyAtlasCards .daily-card')).toHaveCount(45);
  await expect(page.locator('#dailyEntry')).toHaveJSProperty('open', false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await game.saved()).toEqual(before);
});

test('successful settlement removes replay and same-run continuation preserves resources', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start();
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await page.keyboard.type('litre'); await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oAgain')).not.toBeVisible();
  await expect(page.locator('#oAgain')).toBeDisabled();
  expect(await page.locator('#oAgain').evaluate(node => node.onclick)).toBeNull();
  expect(await page.locator('#s-over').innerText()).not.toMatch(/复习本单元|复习自定义词表/);
  const before = await page.evaluate(() => {
    const { G, DB } = window.__gameTest;
    return { id: G.id, gold: G.gold, bag: structuredClone(G.bag), relics: [...G.relics], done: [...G.done], runs: DB.runs };
  });
  await page.locator('#oAgain').evaluate(node => node.click());
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oNext')).toHaveText('继续本单元词汇');
  await page.locator('#oNext').click(); await expect(page.locator('#s-map')).toBeVisible();
  expect(await page.evaluate(() => {
    const { G, DB } = window.__gameTest;
    return { id: G.id, gold: G.gold, bag: structuredClone(G.bag), relics: [...G.relics], done: [...G.done], runs: DB.runs };
  })).toEqual(before);
});

test('keyboard toggles practice without moving atlas or losing mounted reports on repaint', async ({ game, page }, info) => {
  newOnly(info); await game.open();
  const summary = page.locator('#dailyEntry > summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#dailyOpen')).toBeVisible();
  await expect(page.locator('#dailyOpen')).toHaveText('开始练习');
  await expect(page.locator('#dailyPartner')).toBeVisible();
  await expect(page.locator('#dailyHomeReport')).toBeVisible();
  const before = await game.saved();
  await page.evaluate(() => {
    window.homeHosts = ['dailyCollectionHost', 'dailyHomeReport', 'dailyAtlasHost'].map(id => document.getElementById(id));
    window.__gameTest.renderTitle();
  });
  expect(await page.evaluate(() => window.homeHosts.every(host => document.getElementById(host.id) === host))).toBe(true);
  await expect(page.locator('#dailyEntry')).toHaveJSProperty('open', true);
  await summary.focus(); await page.keyboard.press('Space');
  await expect(page.locator('#dailyEntry')).toHaveJSProperty('open', false);
  await expect(page.locator('#homeAtlas')).toBeVisible();
  expect(await game.saved()).toEqual(before);
});

test('paused practice remains recoverable after reload while the bottom entry stays folded', async ({ game, page }, info) => {
  newOnly(info); await game.open();
  await page.locator('#dailyEntry > summary').click();
  await page.locator('#dailyOpen').click();
  await page.locator('#dailyCustomText').fill('cat 猫');
  await page.locator('#dailyImport').click(); await page.locator('#dailyStart').click();
  await page.keyboard.type('c'); await page.locator('#dailyPause').click();
  const before = await game.saved();
  await game.reload();
  await expect(page.locator('#dailyEntry')).toHaveJSProperty('open', false);
  await expect(page.locator('#dailyOpen')).not.toBeVisible();
  expect((await game.saved()).dailySession).toEqual(before.dailySession);
  await page.locator('#dailyEntry > summary').click();
  await expect(page.locator('#dailyOpen')).toHaveText('继续练习');
  await page.locator('#dailyOpen').click(); await page.locator('#dailyResume').click();
  await expect(page.locator('#dailyInput')).toHaveText('c');
  await page.keyboard.type('at'); await expect(page.locator('#dailyInput')).toHaveText('cat');
  expect((await game.saved()).dictationMastered).toEqual([]);
});
