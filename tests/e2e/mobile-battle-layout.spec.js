import {test,expect} from './game-harness.js';

test.use({hasTouch:true,reducedMotion:'no-preference'});
const only=info=>test.skip(info.project.metadata.target==='legacy','Compact mobile combat and paused equipment dialog');
const LONG='（= application）应用程序；应用软件；可以在手机和平板电脑上使用的程序';
async function setup(game,page,{full=false}={}){
 await game.open();await game.start();await game.fight({word:'factory'});
 await page.evaluate(({long,full})=>{
  const t=window.__gameTest;
  // Keep an actual run-pool record so the pause snapshot remains valid.
  const w={...t.B.word,z:long};t.G.pool=t.G.pool.map(x=>x.w===w.w?w:x);t.B.word=w;t.B.offer=[w];
  t.G.bag=Object.fromEntries(t.ITEMS.map(i=>[i.id,3]));t.G.relics=t.RELICS.map(r=>r.id);
  if(full){t.B.letters=[...'abcdefghijklmnopqrstuvwxyz'];t.B.used=t.B.letters.map(()=>false);t.B.bad=t.B.letters.map(()=>false)}
  t.renderFight();
 },{long:LONG,full});
 await page.locator('#s-fight').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished.catch(()=>{}))));
}
const hit=locator=>locator.evaluate(n=>{const r=n.getBoundingClientRect();return r.height>0&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))});
for(const [width,height] of [[320,568],[375,667],[390,844]]){
 test(`compact stage, readable meaning and persistent usable items at ${width}x${height}`,async({game,page},info)=>{
  only(info);await page.setViewportSize({width,height});await setup(game,page);
  const stage=await page.locator('#fBattleStage').boundingBox();expect(stage.height).toBeLessThanOrEqual(155);
  const middle=await page.locator('#s-fight .fmid').boundingBox();expect(middle.height).toBeGreaterThanOrEqual(119);
  await expect(page.locator('#fZh')).toHaveText(LONG);
  const meaning=await page.locator('#fZh').boundingBox();expect(meaning.y).toBeGreaterThanOrEqual(stage.y+stage.height);expect(meaning.y+meaning.height).toBeLessThanOrEqual(middle.y+middle.height);
  await page.screenshot({path:info.outputPath('initial.png')});
  const itemTop=await page.locator('#fItems').evaluate(n=>n.getBoundingClientRect().top);
  await page.locator('#s-fight .fmid').evaluate(n=>n.scrollTop=n.scrollHeight);
  expect(await page.locator('#fItems').evaluate(n=>n.getBoundingClientRect().top)).toBeCloseTo(itemTop,0);
  // Every owned item is reachable by touch; horizontal scrolling never moves combat or keys.
  for(const item of await page.locator('#fItems .item').all()){
   await item.scrollIntoViewIfNeeded();expect(await hit(item)).toBe(true);
   const r=await item.boundingBox();expect(r.height).toBeGreaterThanOrEqual(44);expect(r.width).toBeGreaterThanOrEqual(44);
  }
  const stone=page.locator('#fItems .item').filter({hasText:'磐石之躯'});await stone.scrollIntoViewIfNeeded();await stone.tap();
  expect((await game.state()).G.bag.stone).toBe(2);
  expect(await hit(page.locator('#tPause'))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('compact.png')});
 });
 for(const kbMode of [true,false]) test(`26 touch keys fit ${kbMode?'QWERTY':'A-Z'} at ${width}x${height}`,async({game,page},info)=>{
  only(info);await page.setViewportSize({width,height});await setup(game,page,{full:true});
  await page.evaluate(kbMode=>{window.__gameTest.DB.kbMode=kbMode;window.__gameTest.renderFight()},kbMode);
  await expect(page.locator('#fBank .key')).toHaveCount(26);
  const middle=await page.locator('#s-fight .fmid').boundingBox();expect(middle.height).toBeGreaterThanOrEqual(110);
  for(const key of await page.locator('#fBank .key').all()) expect(await hit(key)).toBe(true);
  expect(await hit(page.locator('#tPause'))).toBe(true);
  await page.locator('#fBank .key').filter({hasText:/^f$/}).tap();expect((await game.state()).B.input).toEqual(['f']);
 });
}
test('equipment dialog freezes real charge, typing, hints and rewards; closing resumes the remaining window',async({game,page},info)=>{
 only(info);await page.setViewportSize({width:375,height:667});await setup(game,page);
 await page.evaluate(()=>{const t=window.__gameTest;t.B.shield=0;t.G.shield=0;t.foeAttack.restore({...t.foeAttack.captureFact(),phase:'telegraph',remainingMs:1400});t.renderFight()});
 await page.locator('#fDetailsOpen').tap();await expect(page.locator('#fBattleDetails')).toBeVisible();
 const frozen=await page.evaluate(()=>{const t=window.__gameTest;return{paused:t.progress.isPaused(),fact:t.foeAttack.captureFact(),input:[...t.B.input],hp:t.B.myHp,gold:t.G.gold,bag:{...t.G.bag},hints:t.B.hints}});
 expect(frozen.paused).toBe(true);expect(frozen.fact.phase).toBe('telegraph');
 await page.keyboard.type('f');await page.keyboard.press('F1');
 await page.evaluate(()=>{const t=window.__gameTest;t.progress.requestHint();t.progress.useItem('leech');t.progress.chooseWord(0)});
 await page.waitForTimeout(1800);
 const after=await page.evaluate(()=>{const t=window.__gameTest;return{paused:t.progress.isPaused(),fact:t.foeAttack.captureFact(),input:[...t.B.input],hp:t.B.myHp,gold:t.G.gold,bag:{...t.G.bag},hints:t.B.hints}});
 expect(after).toEqual(frozen);
 await expect(page.locator('#fBattleDetails')).toContainText('蓄力时尝试一个可用字母可打断');
 await expect(page.locator('#fFoeAtk')).not.toContainText('重复已试字母');
 await page.locator('#fEquipment .eq-row').last().scrollIntoViewIfNeeded();
 for(const id of ['fMy','fEn','fAv','fPc']){const r=await page.locator('#'+id).boundingBox();expect(r.y).toBeGreaterThanOrEqual(0);expect(r.y+r.height).toBeLessThanOrEqual((await page.locator('#fBattleDetails').boundingBox()).y)}
 expect(await hit(page.locator('#fDetailsClose'))).toBe(true);
 await page.screenshot({path:info.outputPath('details.png')});
 // Read immediately after the real resume, before rendering and the touch /
 // browser round trips spend real running time. Preserve the original call.
 await page.evaluate(()=>{
  const t=window.__gameTest,resume=t.progress.resume;
  t.progress.resume=function(...args){
   const result=resume.apply(this,args);
   window.__detailsResumeFact=t.foeAttack.captureFact();
   t.progress.resume=resume;
   return result;
  };
 });
 await page.locator('#fDetailsClose').tap();expect(await page.evaluate(()=>window.__gameTest.progress.isPaused())).toBe(false);
 const resumed=await page.evaluate(()=>window.__detailsResumeFact);expect(resumed.phase).toBe('telegraph');expect(resumed.remainingMs).toBeGreaterThan(frozen.fact.remainingMs-180);expect(resumed.remainingMs).toBeLessThanOrEqual(frozen.fact.remainingMs);
 await page.waitForTimeout(frozen.fact.remainingMs+150);
 expect((await game.state()).B.myHp).toBeLessThan(frozen.hp);
});
test('Escape closes details, restores focus and cannot leak a letter into the paused battle',async({game,page},info)=>{
 only(info);await setup(game,page);await page.locator('#fDetailsOpen').tap();await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>document.getElementById('fBattleDetails').contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.locator('#fBattleDetails')).toBeHidden();await expect(page.locator('#fDetailsOpen')).toBeFocused();
 await page.keyboard.type('f');expect((await game.state()).B.input).toEqual(['f']);
});
test('reloading open details restores the paused fight without losing partial spelling or granting equipment again',async({game,page},info)=>{
 only(info);await setup(game,page);await page.keyboard.type('fa');await page.locator('#fDetailsOpen').tap();
 const before=await page.evaluate(()=>{const t=window.__gameTest;return {word:t.B.word.w,input:[...t.B.input],gold:t.G.gold,bag:{...t.G.bag},hints:t.B.hints,shield:t.B.shield}});
 await game.reload();await expect(page.locator('#s-title')).toBeVisible();await page.locator('#continueRun').click();
 await expect(page.locator('#s-fight')).toBeVisible();await expect(page.locator('#fBattleDetails')).toBeHidden();
 expect(await page.evaluate(()=>{const t=window.__gameTest;return {word:t.B.word.w,input:[...t.B.input],gold:t.G.gold,bag:{...t.G.bag},hints:t.B.hints,shield:t.B.shield}})).toEqual(before);
 expect(await page.evaluate(()=>window.__gameTest.progress.isPaused())).toBe(false);
});
test('stone foe keeps its compact tag while both damage multipliers remain in paused details',async({game,page},info)=>{
 only(info);await setup(game,page);await page.evaluate(()=>{const t=window.__gameTest;t.B.foe={...t.B.foe,n:'石化词素'};t.renderFight()});
 await expect(page.locator('#fTags')).toContainText('硬化');await expect(page.locator('#fTags')).not.toContainText('×0.75');
 await page.locator('#fDetailsOpen').tap();await expect(page.locator('#fDetailsMechanism')).toContainText('×0.75');await expect(page.locator('#fDetailsMechanism')).toContainText('×1.5');
});
