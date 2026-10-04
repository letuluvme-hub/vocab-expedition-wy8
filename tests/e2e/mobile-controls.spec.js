import { test, expect } from './game-harness.js';
for(const device of ['phone','android','desktop']){
 test(`${device} shows only relevant controls and a usable equipment panel`,async({game,page},info)=>{
  test.skip(info.project.metadata.target==='legacy','New platform UI');
  await page.setViewportSize({width:device==='desktop'?1024:390,height:844});
  if(device==='android')await page.addInitScript(()=>{window.__androidTTS={}});
  await game.open({saved:{keyboardTipSeen:false}});
  if(device==='android')await expect(page.locator('#dlAndroid')).toBeHidden();
  else await expect(page.locator('#dlAndroid')).toBeVisible();
  if(device==='desktop')await expect(page.locator('#keyboardTip')).toBeVisible();
  else {await expect(page.locator('#keyboardTip')).toHaveCount(0);await expect(page.locator('.desktopHelp')).toBeHidden();}
  await game.start();await game.fight({word:'litre',enemyHp:500});
  await page.evaluate(()=>{const t=window.__gameTest;t.G.bag={leech:2,reveal:1};t.renderFight()});
  if(device!=='desktop'){
   for(const hint of await page.locator('#fItems .kb, .keyShortcutHint').all())await expect(hint).toBeHidden();
  }
  await page.locator('#fDetailsOpen').click();
  const rows=await page.locator('#fEquipment .eq-row').evaluateAll(nodes=>nodes.map(r=>{
   const h=r.querySelector('.eq-h').getBoundingClientRect(), d=r.querySelector('.eq-d').getBoundingClientRect();
   return{left:d.left,right:d.right,top:d.top,hBottom:h.bottom,width:d.width,rowWidth:r.getBoundingClientRect().width};
  }));
  if(device!=='desktop')for(const r of rows){expect(r.width).toBeGreaterThan(r.rowWidth*.9);expect(r.top).toBeGreaterThanOrEqual(r.hBottom);}
  await expect(page.locator('#fHintShared')).toContainText('听读音');
  await expect(page.locator('#fHintShared')).toContainText('提示共用');
 });
}
test('A–Z and QWERTY layouts preserve partial input, duplicates and saved preference',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','New A–Z layout');
 await game.open({saved:{kbMode:false}});await game.start();await game.fight({word:'litre',enemyHp:500});
 await expect(page.locator('#tBankMode')).toContainText('字母序');
 const text=await page.locator('#fBank .key').allTextContents();expect(text).toEqual([...text].sort());
 await game.clickLetter('l'); const before=await game.state();
 await page.locator('#tBankMode').click();await expect(page.locator('#tBankMode')).toContainText('QWERTY');
 await page.locator('#tBankMode').click();const after=await game.state();
 expect(after.B.input).toEqual(before.B.input);expect(after.B.used).toEqual(before.B.used);expect(after.B.letters).toEqual(before.B.letters);
 for(const c of 'itre')await game.clickLetter(c);
 expect((await game.state()).DB.mastered).toContain('litre');
 await page.locator('#tPause').click();await page.reload();expect((await game.saved()).kbMode).toBe(false);
});
test('listen and letter hint spend the same displayed quota',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Shared quota copy');
 await game.open({speechStub:true});await game.start();await game.fight({word:'litre',enemyHp:500});
 const n=(await game.state()).B.hints;
 await expect(page.locator('#fHintShared')).toContainText(`剩余 ${n} 次`);
 await page.locator('#tSay').click();await expect(page.locator('#fHintShared')).toContainText(`剩余 ${n-1} 次`);
 await page.locator('#tHint').click();await expect(page.locator('#fHintShared')).toContainText(`剩余 ${n-2} 次`);
 expect((await game.state()).B.hints).toBe(n-2);
});

test('holding listen reads twice but spends only one shared hint',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','One gesture consumes one hint');
 await game.open({speechStub:true});await game.start();await game.fight({word:'litre',enemyHp:500});
 const before=(await game.state()).B.hints;
 const box=await page.locator('#tSay').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();await page.waitForTimeout(500);await page.mouse.up();
 expect((await game.state()).B.hints).toBe(before-1);
});
