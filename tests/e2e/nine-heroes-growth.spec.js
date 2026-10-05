import {WORDS} from '../../src/data/words.js';
import {test,expect} from './game-harness.js';
const only=info=>test.skip(info.project.metadata.target==='legacy','Nine roles and attack growth');
for(const [hero,hp] of [['berserker',60],['pyromancer',58],['assassin',55]]) {
 test(`${hero} selects a distinct silhouette, restores and predicts real long-word damage`,async({game,page},info)=>{
  only(info);await game.open({saved:{hero}});await expect(page.locator('#heroes .hcard')).toHaveCount(9);
  await game.start();await game.fight({word:'factory',enemyHp:100000});
  expect((await game.state()).G.maxhp).toBe(hp);expect((await game.state()).B.hints).toBe(2);
  await expect(page.locator('#fPc')).toHaveAttribute('data-h',hero);
  await page.locator('#tPause').click();await page.reload();await page.locator('#continueRun').click();
  const pc=await page.locator('#fPc .pc-prop').evaluate(n=>getComputedStyle(n).opacity);expect(pc).toBe('1');
  await page.evaluate(()=>{const t=window.__gameTest;t.B.offer=[t.B.word,t.G.pool.find(w=>w.w!==t.B.word.w)];t.renderFight()});
  const predicted=Number((await page.locator('#fOffer .wcCard.on').innerText()).match(/⚔(\d+)/)[1]);
  const before=(await game.state()).B.enHp;await page.keyboard.type('factory');expect(before-(await game.state()).B.enHp).toBe(predicted);expect(game.errors).toEqual([]);
 });
}
test('assassin estimate crosses the execute threshold as letters deal damage',async({game,page},info)=>{
 only(info);await game.open({saved:{hero:'assassin'}});await game.start();await game.fight({word:'litre',enemyHp:1000});
 await page.evaluate(()=>{const t=window.__gameTest;t.B.enHp=365;t.B.offer=[t.B.word,t.G.pool.find(w=>w.w!==t.B.word.w)];t.renderFight()});
 const predicted=Number((await page.locator('#fOffer .wcCard.on').innerText()).match(/⚔(\d+)/)[1]);await page.keyboard.type('litre');expect(365-(await game.state()).B.enHp).toBe(predicted);
});
test('formal textbook mastery grants frozen attack growth; practice history does not',async({game,page},info)=>{
 only(info);const words=WORDS.slice(0,100).map(w=>w.w);
 await game.open({saved:{dictationMastered:words,mastered:words,hero:'healer'}});
 await expect(page.locator('#masteryGrowth .mgrowth-attack')).toContainText('+40%');await game.start();await game.fight({enemyHp:100000});
 expect(await page.evaluate(()=>window.__gameTest.G.growth.bonusAttackPct)).toBe(40);const before=(await game.state()).B.enHp;
 await page.evaluate(()=>{window.__gameTest.DB.dictationMastered=window.__gameTest.WORDS.map(w=>w.w)});
 await page.locator('#tPause').click();await page.reload();await page.locator('#continueRun').click();expect(await page.evaluate(()=>window.__gameTest.G.growth.bonusAttackPct)).toBe(40);
 await page.locator('#fDetailsOpen').click();await expect(page.locator('#fEquipment')).toContainText('攻击 +40%');await page.locator('#fDetailsClose').click();
 await page.keyboard.type('litre');expect(before-(await game.state()).B.enHp).toBeGreaterThan(100);
});
for(const [hero,word,hp] of [['warrior','factory',85],['berserker','presentation',30]]) {
 test(`${hero} preview includes shield and healing milestones before its finisher`,async({game,page},info)=>{
  only(info);await game.open({saved:{hero}});await game.start();await game.fight({word,enemyHp:100000});
  await page.evaluate(hp=>{const t=window.__gameTest;t.B.myHp=hp;t.B.shield=0;t.G.milestones={};t.B.offer=[t.B.word,t.G.pool.find(w=>w.w!==t.B.word.w)];t.renderFight()},hp);
  const predicted=Number((await page.locator('#fOffer .wcCard.on').innerText()).match(/⚔(\d+)/)[1]);
  const before=(await game.state()).B.enHp;await page.keyboard.type(word);expect(before-(await game.state()).B.enHp).toBe(predicted);
 });
}

// 2026-10 预习模式起统一「学会」口径：远征整词拼对的 150 词同样带来攻击成长（每 10 词 +4%，封顶 60%）。
test('expedition-learned history grants permanent attack growth under the unified count',async({game,page},info)=>{
 only(info);await game.open({saved:{mastered:WORDS.slice(0,150).map(w=>w.w),hero:'healer'}});
 await expect(page.locator('#masteryGrowth .mgrowth-attack')).toContainText('+60%');
 await game.start();expect(await page.evaluate(()=>window.__gameTest.G.growth.bonusAttackPct)).toBe(60);
});
