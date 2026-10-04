import {test,expect} from './game-harness.js';
for(const hero of ['scholar','warrior','scout','lucky','healer','ranger','berserker','pyromancer','assassin']) {
 test(`${hero} relic and consumable preview agrees with damage after pause`,async({game,page},info)=>{
  test.skip(info.project.metadata.target==='legacy','Nine-role audit');
  await game.open({saved:{hero}});await game.start();await game.fight({word:'desert',enemyHp:100000});
  await page.evaluate(()=>{const t=window.__gameTest;t.G.gold=200;t.G.relics=['combo','focus','shield','thorn'];t.G.milestones={};t.G.bag={rage:2,chain:2,stone:2};t.B.myHp=20;t.B.shield=3;t.B.offer=[t.B.word,t.G.pool.find(w=>w.w!==t.B.word.w)];t.renderFight()});
  await page.locator('#fItems .item').filter({hasText:'怒火护符'}).click();await page.locator('#fItems .item').filter({hasText:'连锁闪电'}).click();
  await page.locator('#tPause').click();await page.reload();await page.locator('#continueRun').click();
  const predicted=Number((await page.locator('#fOffer .wcCard.on').innerText()).match(/⚔(\d+)/)[1]);
  const before=await page.evaluate(()=>window.__gameTest.B.enHp);await page.keyboard.type('desert');
  expect(before-await page.evaluate(()=>window.__gameTest.B.enHp)).toBe(predicted);
  const result=await page.evaluate(()=>({hp:window.__gameTest.B.myHp,shield:window.__gameTest.B.shield,max:window.__gameTest.G.maxhp,guard:window.__gameTest.B.heroShieldGained,heal:window.__gameTest.B.heroHealed}));
  expect(result.hp).toBeGreaterThan(0);expect(result.hp).toBeLessThanOrEqual(result.max);expect(result.shield).toBeLessThanOrEqual(result.max);
  expect(result.guard||0).toBeLessThanOrEqual(6);expect(result.heal||0).toBeLessThanOrEqual(18);
 });
}
test('seer opening bonus remains visible through a shop, refresh, and only the next fight consumes it',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Pending opening bonus presentation');
 await game.open();await game.start();await game.fight({enemyHp:1});
 await page.evaluate(()=>{window.__gameTest.G.relics=['purse','scholar']});await page.keyboard.type('litre');
 await expect(page.locator('[data-opt="reward:seer"]')).toBeVisible();await page.locator('[data-opt="reward:seer"]').click();
 await expect(page.locator('#s-map')).toBeVisible();await expect(page.locator('#mTip')).toContainText('下一场战斗');
 await page.waitForTimeout(450); // Existing progression debounce also applies to fast fixture navigation.
 await page.evaluate(()=>{const t=window.__gameTest;const n=t.G.avail[0];n.type='shop';t.enterNode(n)});
 await page.locator('[data-opt="shop:leave"]').click();await expect(page.locator('#s-map')).toBeVisible();await expect(page.locator('#mTip')).toContainText('下一场战斗');
 await page.locator('#mPause').click();await page.reload();await page.locator('#continueRun').click();await expect(page.locator('#mTip')).toContainText('下一场战斗');
 await page.evaluate(()=>{const t=window.__gameTest;const n=t.G.avail[0];n.type='battle';t.enterNode(n)});
 expect(await page.evaluate(()=>window.__gameTest.G.nextHint)).toBe(0);expect(await page.evaluate(()=>window.__gameTest.B.hintTotal)).toBe(1);
 await page.locator('#tPause').click();await page.reload();await page.locator('#continueRun').click();expect(await page.evaluate(()=>window.__gameTest.B.hintTotal)).toBe(1);
});
