import { test, expect } from './game-harness.js';

const newOnly = info => test.skip(info.project.metadata.target === 'legacy', 'Home separates expedition and dictation records');

test('a clean first expedition battle appears on home without becoming dictation mastery', async ({ game, page }, info) => {
  newOnly(info);
  await game.open();
  await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const battle = t.G.avail.find(node => node.type === 'battle');
    if (!battle) throw new Error('This fixed seed must offer a real first battle');
    t.enterNode(battle);
  });
  await expect(page.locator('#s-fight')).toBeVisible();
  // Use real keyboard input and the untouched enemy health until the battle is won.
  for (let i = 0; i < 30; i++) {
    const battle = (await game.state()).B;
    if (battle.over) break;
    await page.keyboard.type(battle.word.toLowerCase().replace(/[^a-z]/g, ''));
  }
  const fought = await game.state();
  expect(fought.B.won).toBe(true);
  expect(fought.G.wrong).toEqual([]);
  expect(fought.G.att).toBe(fought.G.attOk);
  expect(fought.DB.mastered.length).toBeGreaterThan(0);
  expect(fought.DB.dictationMastered).toEqual([]);
  await page.locator('#pSkip').click();
  await expect(page.locator('#s-map')).toBeVisible();
  await page.locator('#mPause').click();
  await page.locator('#pzHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#sExpedition')).toHaveText(String(fought.DB.mastered.length));
  await expect(page.locator('#sExpedition').locator('..')).toContainText('远征拼对');
  await expect(page.locator('#sMaster').locator('..')).toContainText('默写掌握');
  await expect(page.locator('#sMaster')).toHaveText('0');
  const unit = page.locator('#units [data-unit="1"]');
  await expect(unit).toContainText(`远征 ${fought.DB.mastered.length}/45 · 默写 0/45`);
  await expect(unit).not.toContainText('未开始');
  await expect(page.locator('#units [data-unit="2"]')).toBeDisabled();
  await expect(page.locator('#masteryGrowth .mgrowth-count')).toContainText('0/467 · 下轮生命上限 +0');
  const savedBefore = await game.saved();
  await game.reload();
  await expect(page.locator('#sExpedition')).toHaveText(String(fought.DB.mastered.length));
  const savedAfter = await game.saved();
  expect(savedAfter.mastered).toEqual(savedBefore.mastered);
  expect(savedAfter.dictationMastered).toEqual(savedBefore.dictationMastered);
});

test('growth explains formal-only credit and its nearby button enters the existing practice flow', async ({ game, page }, info) => {
  newOnly(info);
  await game.open();
  await expect(page.locator('#masteryGrowth .mgrowth-note')).toContainText('只算每日默写里零错误');
  await expect(page.locator('#masteryGrowth .mgrowth-note')).toContainText('未用提示');
  const shortcut = page.locator('#masteryGrowthHost #growthDailyOpen');
  await expect(shortcut).toHaveText('进入每日默写');
  await shortcut.click();
  await expect(page.locator('#s-daily')).toBeVisible();
  await expect(page.locator('#dailyStart')).toHaveText('开始热身');
  await expect(page.locator('#dailyUnit')).toHaveValue('1');
  expect((await game.saved()).dictationMastered).toEqual([]);
});

test('new home progress remains readable at 320px', async ({ game, page }, info) => {
  newOnly(info);
  await page.setViewportSize({ width: 320, height: 740 });
  await game.open({ saved: { mastered: ['litre', 'hamburger'], dictationMastered: ['litre'] } });
  await expect(page.locator('#sExpedition')).toHaveText('2');
  await expect(page.locator('#sMaster')).toHaveText('1');
  await expect(page.locator('#units [data-unit="1"]')).toContainText('远征 2/45 · 默写 1/45');
  for (const selector of ['#s-title', '#units [data-unit="1"]', '#masteryGrowthHost', '#sExpedition']) {
    const box = await page.locator(selector).evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    expect(box.scroll, selector + ' must fit the narrow viewport').toBeLessThanOrEqual(box.width + 1);
  }
});
