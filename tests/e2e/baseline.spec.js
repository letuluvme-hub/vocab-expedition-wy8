import { test, expect, instrumentLegacy } from './game-harness.js';

test('legacy save retains mastered custom rewards keyboard and hero through reload', async ({ game, page }) => {
  const reward = { id: 'WR-legacy', unit: 1, heroId: 'scout', accuracy: 87, kills: 8, floor: 9, earnedAt: '2026-09-30T10:00:00.000Z' };
  const saved = { runs: 12, wins: 3, best: 9, mastered: ['water', 'lake'], custom: [{ w: 'apple', z: '苹果' }], rewards: [reward], kbMode: true, kbUpper: true, hero: 'scout' };
  await game.open({ saved });
  await expect(page.locator('#sRun')).toHaveText('12');
  await expect(page.locator('#sWin')).toHaveText('3');
  await expect(page.locator('#sMaster')).toHaveText('2');
  await expect(page.locator('#sFloor')).toHaveText('9');
  await expect(page.locator('#heroes .hcard.sel b')).toHaveText('探险家');
  await page.locator('#rewardSummary').click();
  await expect(page.locator('#rewardCards .reward-card')).toHaveCount(1);
  await expect(page.locator('#rewardCards')).toContainText('WR-legacy');
  await page.locator('#toImport').click();
  await expect(page.locator('#ta')).toHaveValue('apple 苹果');
  await page.locator('#s-import [data-back]').click();
  await game.start();
  await game.fight();
  await expect(page.locator('#fBank')).toHaveClass(/kb/);
  await expect(page.locator('#tBankCaseV')).toHaveText('开');
  await page.reload();
  const db = (await game.state()).DB;
  for (const key of Object.keys(saved)) expect(db[key]).toEqual(key === 'runs' ? 13 : saved[key]);
  await expect(page.locator('#s-title')).toBeVisible();
});

test('start builds connected map without early shops and locks nonadjacent nodes', async ({ game, page }) => {
  await game.open();
  await game.start();
  const map = await page.evaluate(() => {
    const { G } = window.__gameTest;
    return { early: G.rows.slice(0, 3).flat().map(n => n.type), preBoss: G.rows.at(-2).map(n => n.type),
      rows: G.rows.length, first: G.rows[0].length, avail: G.avail.length };
  });
  expect(map.early).not.toContain('shop');
  expect(map.preBoss).toContain('rest');
  expect(map.preBoss).toContain('shop');
  expect(map.rows).toBe(9);
  expect(map.avail).toBe(map.first);
  await expect(page.locator('#map .node.pick')).toHaveCount(map.first);
  await page.locator('#map .node.boss').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).B).toBeNull();
  // Pin one generated reachable node to a real battle; topology remains generated.
  await page.evaluate(() => { const t = window.__gameTest; t.G.avail[0].type = 'battle'; t.renderMap(); });
  const battle = page.locator('#map .node.pick[title="遭遇词灵"]').first();
  await expect(battle).toBeVisible();
  await battle.click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const linked = await page.evaluate(() => window.__gameTest.G.node.links.map(n => ({ row: n.row, x: n.x })));
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.floor).toBe(2);
  await expect(page.locator('#map .node.pick')).toHaveCount(linked.length);
  const actual = await page.evaluate(() => window.__gameTest.G.avail.map(n => ({ row: n.row, x: n.x })));
  expect(actual).toEqual(linked);
  await page.locator('#map .node.lock').last().click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.floor).toBe(2);
});

test('title preserves six heroes and all six units plus custom range', async ({ game, page }) => {
  await game.open();
  await expect(page).toHaveTitle('词汇远征 · 外研版八上');
  await expect(page.locator('#heroes .hcard b')).toHaveText(['学者', '战士', '探险家', '幸运儿', '治愈师', '游侠']);
  await expect(page.locator('#units .unit b')).toHaveText([
    'Unit 1 水与资源', 'Unit 2 数字生活', 'Unit 3 成长与发现',
    'Unit 4 记忆与学习', 'Unit 5 团队与舞台', 'Unit 6 外星来客', '我的词表',
  ]);
  await expect(page.locator('#heroes .hcard[aria-pressed="true"] b')).toHaveText('学者');
  await expect(page.locator('#s-fight')).toBeHidden();
});

test('old save without newer preferences defaults safely and custom range remains playable', async ({ game, page }) => {
  await game.open({ saved: { runs: 2, wins: 0, best: 2, mastered: ['litre'], custom: [{ w: 'apple', z: '苹果' }] } });
  const db = (await game.state()).DB;
  expect(db.rewards).toEqual([]);
  expect(db.kbMode).toBe(false);
  expect(db.kbUpper).toBe(false);
  await expect(page.locator('#heroes .hcard.sel b')).toHaveText('学者');
  await game.start(0);
  expect((await game.state()).G.unit).toBe(0);
  await page.evaluate(() => {
    const t = window.__gameTest;
    const node = t.G.avail[0]; node.type = 'battle'; t.enterNode(node);
  });
  await expect(page.locator('#fZh')).toHaveText('苹果');
  expect((await game.state()).B.word).toBe('apple');
  await expect(page.locator('#fBank')).not.toHaveClass(/kb/);
});

test('normal browser session exposes no test-only runtime bridge', async ({ page }, testInfo) => {
  const { target, basePath } = testInfo.project.metadata;
  if (target === 'legacy') await page.route('**/tests/fixtures/legacy.html*', route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: instrumentLegacy(),
  }));
  await page.addInitScript(() => localStorage.setItem('wy8a_rogue_v1', JSON.stringify({
    runs: 0, wins: 0, mastered: [], best: 0, custom: [], voice: false, mute: true, vol: 0,
  })));
  await page.goto(target === 'legacy' ? `${basePath}tests/fixtures/legacy.html` : basePath);
  await expect(page.locator('#s-title')).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, '__gameTest'))).toBe(false);
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect(await page.evaluate(() => Object.hasOwn(window, '__gameTest'))).toBe(false);
});
