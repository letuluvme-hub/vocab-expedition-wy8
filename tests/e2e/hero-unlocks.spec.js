// 2026-10 起界面新开的是预习；这里显式开旧版默写会话，守住旧存档恢复后的默写界面与掌握规则。
import {test,expect} from './game-harness.js';
const zero={words:0,cleanWords:0,kills:0,damage:0,healing:0};
const only=info=>test.skip(info.project.metadata.target==='legacy','Role unlocks');
test('fresh roles show conditions, cannot select a lock, scholar has beginner survival and hints',async({game,page},info)=>{
 only(info);await game.open({saved:{heroStats:{...zero},hero:'assassin'}});
 await expect(page.locator('#heroes [data-hero="scholar"]')).toBeEnabled();
 await expect(page.locator('#heroes [data-hero="scholar"]')).toContainText('开荒推荐');
 for(const hero of ['warrior','scout','lucky','healer','ranger','berserker','pyromancer','assassin'])await expect(page.locator(`#heroes [data-hero="${hero}"]`)).toBeDisabled();
 await expect(page.locator('#heroes [data-hero="scout"]')).toContainText('完整拼词 0/20');
 await expect(page.locator('#heroes [data-hero="assassin"]')).toContainText('完整拼词 0/500');
 await game.start();await game.fight({word:'factory'});
 expect(await page.evaluate(()=>[window.__gameTest.G.heroId,window.__gameTest.G.maxhp,window.__gameTest.B.hints])).toEqual(['scholar',80,5]);
 await page.locator('#tHint').click();expect(await page.evaluate(()=>window.__gameTest.B.hintUsed)).toBe(2);
 await page.locator('#tPause').click();await page.reload();await page.locator('#continueRun').click();expect(await page.evaluate(()=>window.__gameTest.G.maxhp)).toBe(80);
});
test('real complete word and kill count once, actual damage is capped and survives reload',async({game,page},info)=>{
 only(info);await game.open({saved:{heroStats:{...zero}}});await game.start();await game.fight({word:'factory',enemyHp:1});
 await page.keyboard.type('fact');expect(await page.evaluate(()=>window.__gameTest.DB.heroStats.words)).toBe(0);
 await page.keyboard.type('ory');await expect(page.locator('#s-pick')).toBeVisible();
 const read=()=>page.evaluate(()=>window.__gameTest.DB.heroStats);expect(await read()).toEqual({words:1,cleanWords:1,kills:1,damage:1,healing:0});
 await page.keyboard.type('factory');expect(await read()).toEqual({words:1,cleanWords:1,kills:1,damage:1,healing:0});
 await page.locator('#pSkip').click();await page.locator('#mPause').click();await page.reload();await page.locator('#continueRun').click();expect(await read()).toEqual({words:1,cleanWords:1,kills:1,damage:1,healing:0});
});
test('actual healing unlocks healer; full-health item cannot inflate healing and locked progress remains readable on phone',async({game,page},info)=>{
 only(info);await page.setViewportSize({width:390,height:844});await game.open({saved:{heroStats:{...zero,words:150,healing:72},heroUnlocks:{}}});
 await expect(page.locator('#heroes [data-hero="healer"]')).toContainText('完整拼词 150/150 · 实际回血 72/80');await game.start();await game.fight({word:'factory'});
 await page.evaluate(()=>{const t=window.__gameTest;t.G.bag={leech:3};t.renderFight()});
 await page.locator('#fItems .item').first().click();expect(await page.evaluate(()=>window.__gameTest.DB.heroStats.healing)).toBe(72);
 await page.evaluate(()=>{const t=window.__gameTest;t.B.myHp=72;t.renderFight()});await page.locator('#fItems .item').first().click();expect(await page.evaluate(()=>window.__gameTest.DB.heroStats.healing)).toBe(80);
 await page.locator('#tPause').click();await page.locator('#pzHome').click();await expect(page.locator('#heroes [data-hero="healer"]')).toBeEnabled();await page.locator('#heroes [data-hero="healer"]').click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('daily warmup does not double-count and formal completion survives refresh once',async({game,page},info)=>{
 only(info);await game.open({saved:{heroStats:{...zero}}});await page.locator('#dailyEntry > summary').click();await page.locator('#dailyOpen').click();await page.locator('#dailyCustomText').fill('cat 猫');await page.locator('#dailyImport').click();await page.evaluate(()=>window.__gameTest.dailyController.start({unit:Number(document.getElementById('dailyUnit').value),bookId:document.getElementById('dailyBook').value,mode:'dictation'}));
 await page.keyboard.type('cat');await page.locator('#dailyNext').click();await page.locator('#dailyFormal').click();expect(await page.evaluate(()=>window.__gameTest.DB.heroStats.words)).toBe(0);
 await page.keyboard.type('cat');expect(await page.evaluate(()=>[window.__gameTest.DB.heroStats.words,window.__gameTest.DB.heroStats.cleanWords])).toEqual([1,1]);await page.reload();expect(await page.evaluate(()=>[window.__gameTest.DB.heroStats.words,window.__gameTest.DB.heroStats.cleanWords])).toEqual([1,1]);
});
