import {test,expect} from './game-harness.js';
const newOnly=info=>test.skip(info.project.metadata.target==='legacy','New role identities');
for(const hero of ['healer','pyromancer']) test(`${hero} uses the displayed new-run tradeoff and survives pause and a real win`,async({game,page},info)=>{
 newOnly(info);await game.open({saved:{hero}});await game.start();
 const initial=await page.evaluate(()=>({hp:window.__gameTest.G.hp,max:window.__gameTest.G.maxhp}));
 expect(initial).toEqual(hero==='healer'?{hp:33,max:65}:{hp:58,max:58});
 await game.fight({word:'desert',enemyHp:1});
 await page.locator('#tPause').click();await page.reload();await page.locator('#continueRun').click();
 expect(await page.evaluate(()=>window.__gameTest.G.maxhp)).toBe(initial.max);
 await page.keyboard.type('desert');await expect(page.locator('#s-pick')).toBeVisible();await page.locator('#pSkip').click();
 await expect(page.locator('#s-map')).toBeVisible();
 expect(await page.evaluate(()=>window.__gameTest.G.maxhp)).toBe(initial.max+(hero==='healer'?5:0));
 await page.locator('#mPause').click();await page.reload();await page.locator('#continueRun').click();
 expect(await page.evaluate(()=>window.__gameTest.G.maxhp)).toBe(initial.max+(hero==='healer'?5:0));expect(game.errors).toEqual([]);
});
test('six-letter pyromancer card estimate equals actual total damage',async({game,page},info)=>{
 newOnly(info);await game.open({saved:{hero:'pyromancer'}});await game.start();await game.fight({word:'desert',enemyHp:100000});
 await page.evaluate(()=>{const t=window.__gameTest;t.B.offer=[t.B.word,...t.G.pool.filter(w=>w.w!==t.B.word.w).slice(0,2)];t.renderFight()});
 await page.locator('#fEquipment > summary').click();await expect(page.locator('#fEquipment')).toContainText('本词当前大招加成 +40%');
 const predicted=Number((await page.locator('#fOffer .wcCard.on').innerText()).match(/⚔(\d+)/)[1]);
 const before=await page.evaluate(()=>window.__gameTest.B.enHp);await page.keyboard.type('desert');
 expect(before-await page.evaluate(()=>window.__gameTest.B.enHp)).toBe(predicted);
});
