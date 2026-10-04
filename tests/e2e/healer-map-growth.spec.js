import {test,expect} from './game-harness.js';
test('healer wins on a second map grow beyond30 and reload retains the new map budget',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Per-map healer ledger');
 await game.open({saved:{hero:'healer'}});await game.start();
 // Prior six victories are the starting scenario. Continue and the next victory use real controls.
 await page.evaluate(()=>{const r=window.__gameTest.G;r.maxhp=95;r.hp=70;r.healerGrowth={version:1,gained:30};r.whetBuys=2});
 await game.fight({word:'litre',enemyHp:1,boss:true});await page.keyboard.type('litre');
 await expect(page.locator('#s-pick')).toBeVisible();await page.locator('#pSkip').click();
 await expect(page.locator('#oNext')).toBeVisible();await page.locator('#oNext').click();await expect(page.locator('#s-map')).toBeVisible();
 await page.locator('#mPause').click();await page.reload();await page.locator('#continueRun').click();
 await game.fight({word:'desert',enemyHp:1});
 await page.locator('#fEquipment > summary').click();await expect(page.locator('#fEquipment')).toContainText('本图成长 +0/30');await page.locator('#fEquipment > summary').click();
 await page.keyboard.type('desert');await expect(page.locator('#s-pick')).toBeVisible();await page.locator('#pSkip').click();await expect(page.locator('#s-map')).toBeVisible();
 expect(await page.evaluate(()=>window.__gameTest.G.maxhp)).toBe(100);
 await page.locator('#mPause').click();await page.reload();await page.locator('#continueRun').click();
 expect(await page.evaluate(()=>window.__gameTest.G.healerGrowth)).toEqual({version:2,segment:2,gained:5,totalGained:35});
 expect(await page.evaluate(()=>window.__gameTest.G.whetBuys)).toBe(2);
});
