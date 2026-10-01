import { test, expect } from './game-harness.js';

test('shop permits separate repeat purchases rejects rapid duplicates and still leaves', async ({ game, page }) => {
  await game.open();
  await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const shop = t.G.rows.at(-2).find(n => n.type === 'shop');
    t.G.floor = shop.row + 1;
    t.G.gold = 200;
    t.G.hp = 10;
    t.enterNode(shop);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await expect(page.locator('#rSub')).toContainText('200');
  const scroll = page.locator('#rPicks .pick').filter({ hasText: '提示卷轴' });
  // Dispatch two real DOM clicks in one turn to exercise the legacy per-button cooldown.
  await scroll.evaluate(el => { el.click(); el.click(); });
  expect((await game.state()).G.gold).toBe(160);
  expect((await game.state()).G.shopHints).toBe(3);
  await page.waitForTimeout(300); // documented business cooldown is 260ms
  await scroll.click();
  expect((await game.state()).G.gold).toBe(120);
  expect((await game.state()).G.shopHints).toBe(6);
  await page.locator('#rPicks .pick').filter({ hasText: '疗伤药剂' }).click();
  expect((await game.state()).G.gold).toBe(75);
  expect((await game.state()).G.hp).toBe(45);
  const stone = page.locator('#rPicks .pick').filter({ hasText: '磨砺石' });
  await stone.click();
  expect((await game.state()).G.gold).toBe(5);
  expect((await game.state()).G.maxhp).toBe(70);
  expect((await game.state()).G.hp).toBe(70);
  await page.waitForTimeout(300);
  await stone.click();
  expect((await game.state()).G.gold).toBe(5);
  expect((await game.state()).G.maxhp).toBe(70);
  await page.locator('#rPicks .pick').filter({ hasText: '离开商店' }).click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.floor).toBe(9);
  await expect(page.locator('#map .node.pick.boss')).toHaveCount(1);
});

test('BOSS victory collects one reward card and next unit starts without stale battle', async ({ game, page }) => {
  await game.open();
  await game.start();
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await game.clickLetter('l');
  await expect(page.locator('#pTitle')).toContainText('击败词汇之王');
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oTitle')).toHaveText('远征成功！');
  await expect(page.locator('#oReward .reward-card')).toHaveCount(1);
  await expect(page.locator('#oReward')).toContainText('不代表已掌握全部词汇');
  await expect(page.locator('#oAgain')).toHaveText('复习本单元');
  await expect(page.locator('#oNext')).toBeVisible();
  await expect(page.locator('#oNext')).toHaveText('继续 Unit 2');
  const win = await game.state();
  expect(win.DB.wins).toBe(1);
  expect(win.DB.rewards).toHaveLength(1);
  expect(win.DB.mastered).not.toContain('litre');
  await page.evaluate(() => window.__gameTest.endRun(true));
  expect((await game.state()).DB.rewards).toHaveLength(1);
  await page.locator('#oNext').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const next = await game.state();
  expect(next.G.unit).toBe(2);
  expect(next.G.floor).toBe(1);
  expect(next.B).toBeNull();
  expect(next.DB.runs).toBe(2);
  await page.reload();
  await page.locator('#rewardSummary').click();
  await expect(page.locator('#rewardCards .reward-card')).toHaveCount(1);
  expect((await game.state()).DB.rewards[0]).toEqual(win.DB.rewards[0]);
});

test('last unit victory hides next-unit action in computed layout', async ({ game, page }) => {
  await game.open();
  await game.start(6);
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await game.clickLetter('l');
  await expect(page.locator('#s-pick')).toBeVisible();
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oNext')).toBeHidden();
  expect(await page.locator('#oNext').evaluate(el => getComputedStyle(el).display)).toBe('none');
  await expect(page.locator('#oText')).toContainText('本册最后一个单元');
  await expect(page.locator('#oReward')).toContainText('Unit 6');
  await page.locator('#oAgain').click();
  expect((await game.state()).G.unit).toBe(6);
  expect((await game.state()).B).toBeNull();
});

test('skipping BOSS is a failed run with no reward or next-unit action', async ({ game, page }) => {
  await game.open();
  await game.start();
  await game.fight({ boss: true });
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oTitle')).toHaveText('远征结束');
  await expect(page.locator('#oReward')).toBeHidden();
  await expect(page.locator('#oNext')).toBeHidden();
  const state = await game.state();
  expect(state.DB.wins).toBe(0);
  expect(state.DB.rewards).toEqual([]);
  expect(state.B.won).toBe(false);
});
