import { test, expect } from './game-harness.js';

// 影分身（👻）：免费撤退额度是 run 级，一轮远征只有一次，跨战斗不重置。
// legacy 目标里额度挂在 B.ghostUsed（每场重建），所以这些断言只在新版上跑 ——
// 与 counting.spec.js / skip-cost.spec.js 的处理一致。
const newOnly = (testInfo, why) =>
  test.skip(testInfo.project.metadata.target === 'legacy', why);

// 给当前 run 装上影分身并给血。只改状态，不碰任何业务逻辑。
async function giveGhost(page, hp) {
  await page.evaluate(h => {
    const t = window.__gameTest;
    if (t.G.relics.indexOf('ghost') < 0) t.G.relics.push('ghost');
    t.G.hp = h; t.G.maxhp = 100;
    t.B.myHp = h;
    t.renderFight();
  }, hp);
}

const skip = page => page.locator('#tSkip');

// 点一次跳过并等到地图出现。
// 换场前必须过 ADV_LOCK_MS(400ms) 的推进去重窗口：这是真实玩法的节奏
// （玩家不会在 0.4 秒内推进两次），等的是真实去重，不是绕过什么。
async function skipAndAdvance(page) {
  await skip(page).click();
  await expect(page.locator('#s-map')).toBeVisible();
  await page.waitForTimeout(500);
}

// 一次免费撤退把额度用掉，然后结束这一轮远征，回到可重开的状态。
// 注意：免费撤退本身付不起代价，所以结束远征要用真实的 endRun(false)（失败结算），
// 这正是游戏里「跳过 BOSS 之后」走的同一条路。
async function burnGhostOnRunEnd(page) {
  await giveGhost(page, 90);
  await skipAndAdvance(page);
  await page.evaluate(() => window.__gameTest.endRun(false));
  await expect(page.locator('#s-over')).toBeVisible();
}

test('the ghost gives one free retreat and the next fight must pay 50 HP', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Ghost charge moved from per-battle to per-run');
  await game.open();
  await game.start();
  await game.fight();
  await giveGhost(page, 90);

  // 第一场：免费撤退
  await expect(skip(page)).toContainText('影分身');
  await expect(skip(page)).toContainText('本轮仅剩 1 次');
  await skipAndAdvance(page);
  let state = await game.state();
  expect(state.G.ghostUsed).toBe(true);
  expect(state.B.myHp).toBe(90);          // 免费
  expect(state.G.floor).toBe(2);

  // 第二场：**新的战斗对象**，额度不得重置
  await game.fight();
  await expect(skip(page)).toContainText('50');
  await expect(skip(page)).not.toContainText('影分身');
  await expect(skip(page)).toHaveAttribute('title', /已用完/);
  await page.evaluate(() => { window.__gameTest.B.myHp = 90; window.__gameTest.renderFight(); });
  await skipAndAdvance(page);
  state = await game.state();
  expect(state.B.myHp).toBe(40);          // 90 - 50
  expect(state.G.ghostUsed).toBe(true);
  expect(state.G.floor).toBe(3);
});

test('a second free retreat is impossible even at full HP and gives no extra node', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Per-run ghost charge must not reset across fights');
  await game.open();
  await game.start();
  await game.fight();
  await giveGhost(page, 100);
  await skipAndAdvance(page);

  // 第二场：血不够付 50 → 必须是真实战败，而不是又一次免费撤退
  await game.fight();
  await page.evaluate(() => { window.__gameTest.B.myHp = 50; window.__gameTest.renderFight(); });
  const floorBefore = (await game.state()).G.floor;
  await skip(page).click();
  await expect(page.locator('#s-over')).toBeVisible();
  const state = await game.state();
  expect(state.B.myHp).toBe(0);
  expect(state.G.floor).toBe(floorBefore);
  expect(state.DB.wins).toBe(0);
  expect(state.DB.rewards).toEqual([]);
  expect(state.DB.mastered).toEqual([]);
});

test('picking up a second ghost does not restore the charge', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Duplicate ghost must not reset the run-level charge');
  await game.open();
  await game.start();
  await game.fight();
  await giveGhost(page, 90);
  await skipAndAdvance(page);

  await game.fight();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.relics.push('ghost');            // 重复持有
    t.B.myHp = 90;
    t.renderFight();
  });
  // 按钮必须已经是普通跳过，而不是又变回影分身
  await expect(skip(page)).not.toContainText('影分身');
  await skipAndAdvance(page);
  expect((await game.state()).B.myHp).toBe(40);
});

test('a new expedition starts with the ghost charge restored', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'A fresh run must get a fresh ghost charge');
  await game.open();
  await game.start();
  await game.fight();
  await burnGhostOnRunEnd(page);

  // 「再来一次」是真实的重开入口（oAgain 要求 G.result 已是布尔）
  await page.locator('#oAgain').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const fresh = await game.state();
  expect(fresh.G.ghostUsed).toBe(false, '新一局必须重新获得一次免费撤退');
  expect(fresh.DB.runs).toBe(2);
});

test('the fresh run really can use its new ghost charge once', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'A fresh run must get a fresh ghost charge, and only one');
  await game.open();
  await game.start();
  await game.fight();
  await burnGhostOnRunEnd(page);
  await page.locator('#oAgain').click();
  await expect(page.locator('#s-map')).toBeVisible();

  await game.fight();
  await giveGhost(page, 90);
  await expect(skip(page)).toContainText('影分身');
  await skipAndAdvance(page);
  const afterFree = await game.state();
  expect(afterFree.G.ghostUsed).toBe(true);
  expect(afterFree.B.myHp).toBe(90);

  // 新一局也只有这一次
  await game.fight();
  await expect(skip(page)).not.toContainText('影分身');
  await page.evaluate(() => { window.__gameTest.B.myHp = 90; window.__gameTest.renderFight(); });
  await skipAndAdvance(page);
  expect((await game.state()).B.myHp).toBe(40);
});

test('double-clicking skip consumes the ghost charge exactly once', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Idempotence guard for the ghost retreat path');
  await game.open();
  await game.start();
  await game.fight();
  await giveGhost(page, 90);
  await skip(page).evaluate(el => { el.click(); el.click(); });
  await expect(page.locator('#s-map')).toBeVisible();
  const state = await game.state();
  expect(state.G.ghostUsed).toBe(true);
  expect(state.B.myHp).toBe(90);          // 连点不得变成扣血
  expect(state.G.floor).toBe(2);
  // 连点也只推进一层（第二次被 B.over 闸门挡住）
  await expect(page.locator('#mFloor')).toHaveText('2');
});

test('skipping the boss with the ghost is still a failed run', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Ghost retreat must not count as clearing the boss');
  await game.open();
  await game.start();
  await game.fight({ boss: true, enemyHp: 10_000 });
  await giveGhost(page, 100);
  await skip(page).click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oTitle')).toHaveText('远征结束');
  const state = await game.state();
  expect(state.DB.wins).toBe(0);
  expect(state.DB.rewards).toEqual([]);
  expect(state.B.myHp).toBe(100);          // 免费，但依然是失败
  expect(state.G.ghostUsed).toBe(true);
});

test('the skip button and the relic catalog state the per-run charge', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Copy must match the per-run semantics');
  // 图鉴在标题页（#toRelics）：先在真实界面上核对文案，再退回标题页开新局
  await game.open();
  await page.locator('#toRelics').click();
  await expect(page.locator('#s-relics')).toBeVisible();
  await expect(page.locator('#rlBox')).toContainText('每轮远征可免费跳过一次');
  await expect(page.locator('#rlBox')).not.toContainText('每场战斗可免费跳过');
  await page.locator('#s-relics [data-back]').click();
  await expect(page.locator('#s-title')).toBeVisible();

  await game.start();
  await game.fight();
  await giveGhost(page, 90);
  await expect(skip(page)).toHaveAttribute('title', /本轮远征唯一一次/);
  await expect(skip(page)).toContainText('本轮仅剩 1 次');
});