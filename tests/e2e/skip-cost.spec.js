import { test, expect } from './game-harness.js';

// 真实浏览器里的跳过代价：固定 50 点生命，血不够就是失败而不是保底活着。
// legacy 目标是未修改的归档页面（40% 且 Math.max(1,...) 保底），这些是新版行为，
// 所以只在 new 项目上运行 —— 与 counting.spec.js 的处理一致。
const newOnly = (testInfo, why) =>
  test.skip(testInfo.project.metadata.target === 'legacy', why);

// 把血量设到指定值，走真实 startFight 之外的最小注入（不改任何业务逻辑）。
async function setHp(page, hp) {
  await page.evaluate(h => {
    const t = window.__gameTest;
    t.G.hp = h; t.G.maxhp = 100;
    t.B.myHp = h;
    t.renderFight();
  }, hp);
}

test('skipping with enough HP pays a flat 50 and advances the normal node', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'New flat-50 skip cost, not legacy 40%');
  await game.open();
  await game.start();
  await game.fight();
  await setHp(page, 70);
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const state = await game.state();
  expect(state.G.hp).toBe(20);           // 70 - 50，不是 70*0.6=42
  expect(state.G.floor).toBe(2);
  expect(state.DB.wins).toBe(0);
  expect(state.DB.rewards).toEqual([]);
});

test('skipping at exactly 50 HP kills the run instead of clamping to 1', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Low-HP skip must be a real loss, not a legacy floor of 1');
  await game.open();
  await game.start();
  await game.fight();
  await setHp(page, 50);
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oTitle')).toHaveText('远征结束');
  await expect(page.locator('#oReward')).toBeHidden();
  await expect(page.locator('#oNext')).toBeHidden();
  const state = await game.state();
  expect(state.B.myHp).toBe(0);          // Math.max(1,...) would have read 1
  expect(state.DB.runs).toBe(1);
  expect(state.DB.wins).toBe(0);
  expect(state.DB.rewards).toEqual([]);
});

test('a skipped node is not advanced and grants no kills when the run is lost', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Failed skip must not settle the node');
  await game.open();
  await game.start();
  await game.fight();
  await setHp(page, 10);
  const floorBefore = (await game.state()).G.floor;
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-over')).toBeVisible();
  const state = await game.state();
  expect(state.B.myHp).toBe(0);
  expect(state.G.floor).toBe(floorBefore);
  expect(state.G.kills).toBe(0);
  expect(state.DB.mastered).toEqual([]);
  expect(state.DB.wins).toBe(0);
});

test('double-clicking skip at low HP still ends the run exactly once', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Idempotence guard for the new death path');
  await game.open();
  await game.start();
  await game.fight();
  await setHp(page, 20);
  await page.locator('#tSkip').evaluate(el => { el.click(); el.click(); });
  await expect(page.locator('#s-over')).toBeVisible();
  const state = await game.state();
  expect(state.B.myHp).toBe(0);
  expect(state.B.over).toBe(true);
  expect(state.DB.wins).toBe(0);
  expect(state.DB.rewards).toEqual([]);
});

test('the skip button states the 50 HP cost', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Copy fix for the new cost');
  await game.open();
  await game.start();
  await game.fight();
  await expect(page.locator('#tSkip')).toContainText('50');
  await expect(page.locator('#tSkip')).not.toContainText('不掉血');
});
