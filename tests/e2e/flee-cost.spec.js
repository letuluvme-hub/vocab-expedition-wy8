import { test, expect } from './game-harness.js';
for (const [gold, left] of [[50, 0], [80, 30], [101, 50], [300, 150]]) {
  test(`fleeing with ${gold} coins pays the shown cost and grants no monster rewards`, async ({game,page}, info) => {
    test.skip(info.project.metadata.target === 'legacy', 'New flee rule');
    await game.open(); await game.start(); await game.fight({word:'litre', enemyHp:500});
    await page.evaluate(gold => { const t=window.__gameTest; t.G.gold=gold; t.B.goldMult=1.5; t.renderFight(); },gold);
    const before=await game.state();
    await expect(page.locator('#tFlee')).toContainText(String(gold-left));
    await page.locator('#tFlee').click();
    await expect(page.locator('#s-map')).toBeVisible();
    await page.waitForTimeout(1300);
    const after=await game.state();
    expect(after.G.gold).toBe(left); expect(after.G.kills).toBe(before.G.kills);
    expect(after.G.bag).toEqual(before.G.bag); expect(after.G.relics).toEqual(before.G.relics);
    expect(after.DB.wins).toBe(0); expect(after.DB.rewards).toEqual([]);
    expect(after.B.won).toBe(false); expect(await page.evaluate(()=>window.__gameTest.B.finished)).toBe(true);
    await expect(page.locator('#s-pick')).toBeHidden();
    expect((await game.saved()).activeRun.run.gold).toBe(left);
  });
}
test('insufficient coins disable flee; a boss escape never clears the unit', async ({game,page},info)=>{
  test.skip(info.project.metadata.target === 'legacy','New flee rule');
  await game.open(); await game.start(); await game.fight({boss:true});
  await page.evaluate(()=>{const t=window.__gameTest;t.G.gold=49;t.renderFight()});
  await expect(page.locator('#tFlee')).toBeDisabled();
  await page.evaluate(()=>{const t=window.__gameTest;t.G.gold=100;t.renderFight()});
  await page.locator('#tFlee').click(); await expect(page.locator('#s-over')).toBeVisible();
  const s=await game.state(); expect(s.G.gold).toBe(50);expect(s.DB.wins).toBe(0);
  expect(s.DB.rewards).toEqual([]); await expect(page.locator('#oReward')).toBeHidden();
});
