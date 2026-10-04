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
  // 2026-10 预习模式起统一「学会」口径：远征整词拼对也算学会单词。
  await expect(page.locator('#sMaster').locator('..')).toContainText('学会单词');
  await expect(page.locator('#sMaster')).toHaveText(String(fought.DB.mastered.length));
  const unit = page.locator('#units [data-unit="1"]');
  await expect(unit).toContainText(`学会 ${fought.DB.mastered.length}/45`);
  await expect(unit).not.toContainText('未开始');
  await expect(page.locator('#units [data-unit="2"]')).toBeDisabled();
  await expect(page.locator('#masteryGrowth .mgrowth-count')).toContainText(`${fought.DB.mastered.length}/467 · 下轮生命上限 +0`);
  const savedBefore = await game.saved();
  await game.reload();
  await expect(page.locator('#sExpedition')).toHaveText(String(fought.DB.mastered.length));
  const savedAfter = await game.saved();
  expect(savedAfter.mastered).toEqual(savedBefore.mastered);
  expect(savedAfter.dictationMastered).toEqual(savedBefore.dictationMastered);
});

test('growth explains the unified learned count and its nearby button opens preview', async ({ game, page }, info) => {
  newOnly(info);
  await game.open();
  await expect(page.locator('#masteryGrowth .mgrowth-note')).toContainText('学会的教材词');
  await expect(page.locator('#masteryGrowth .mgrowth-note')).toContainText('预习里不看提示拼对');
  const shortcut = page.locator('#masteryGrowthHost #growthDailyOpen');
  await expect(shortcut).toHaveText('进入单词预习');
  await shortcut.click();
  await expect(page.locator('#s-daily')).toBeVisible();
  await expect(page.locator('#dailyStart')).toHaveText('开始预习');
  await expect(page.locator('#dailyUnit')).toHaveValue('1');
  expect((await game.saved()).dictationMastered).toEqual([]);
});

test('new home progress remains readable at 320px', async ({ game, page }, info) => {
  newOnly(info);
  await page.setViewportSize({ width: 320, height: 740 });
  await game.open({ saved: { mastered: ['litre', 'hamburger'], dictationMastered: ['litre'] } });
  await expect(page.locator('#sExpedition')).toHaveText('2');
  await expect(page.locator('#sMaster')).toHaveText('2');
  await expect(page.locator('#units [data-unit="1"]')).toContainText('学会 2/45');
  for (const selector of ['#s-title', '#units [data-unit="1"]', '#masteryGrowthHost', '#sExpedition']) {
    const box = await page.locator(selector).evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    expect(box.scroll, selector + ' must fit the narrow viewport').toBeLessThanOrEqual(box.width + 1);
  }
});
