import {test,expect} from './game-harness.js';
const only=info=>test.skip(info.project.metadata.target==='legacy','Start first and one-time home guide');
for(const [width,height] of [[320,568],[375,667],[390,844],[1024,768]]){
 test(`start is prominent and stays above the choices at ${width}x${height}`,async({game,page},info)=>{
  only(info);await page.setViewportSize({width,height});await game.open();
  await expect(page.locator('#homeRange')).toContainText('Unit 1');
  const start=page.locator('#startRun');
  const initial=await start.boundingBox();expect(initial.y+initial.height).toBeLessThanOrEqual(185);
  await page.screenshot({path:info.outputPath('first-visit.png')});
  expect(await page.evaluate(()=>{
   const row=document.getElementById('startRow'),range=document.getElementById('textbookPicker');
   return !!(row.compareDocumentPosition(range)&Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  const sticky=await start.boundingBox();expect(sticky.y).toBeGreaterThanOrEqual(0);expect(sticky.y+sticky.height).toBeLessThanOrEqual(160);
  expect(await start.evaluate(n=>{const r=n.getBoundingClientRect();return[.2,.5,.8].every(x=>n.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height/2)))})).toBe(true);
  await page.screenshot({path:info.outputPath('sticky-start.png')});
  await start.click();await expect(page.locator('#s-map')).toBeVisible();expect((await game.state()).DB.homeTutorialSeen).toBe(true);
 });
}
test('the simple guide appears once, survives reload and can be reopened deliberately',async({game,page},info)=>{
 only(info);await game.open({saved:{future:{keep:true}}});
 await expect(page.locator('#homeTutorial')).toBeVisible();
 await expect(page.locator('#homeTutorial')).toContainText('发亮的节点');await expect(page.locator('#homeTutorial')).toContainText('拼英文');
 await page.locator('#homeTutorialDismiss').click();await expect(page.locator('#homeTutorial')).toBeHidden();
 expect((await game.saved()).homeTutorialSeen).toBe(true);expect((await game.saved()).future).toEqual({keep:true});
 await game.reload();await expect(page.locator('#homeTutorial')).toBeHidden();await page.locator('#homeHowTo').click();await expect(page.locator('#homeTutorial')).toBeVisible();
 await page.locator('#homeTutorialDismiss').click();await game.start();await page.locator('#mPause').click();await page.locator('#pzHome').click();
 await expect(page.locator('#homeTutorial')).toBeHidden();await expect(page.locator('#continueRun')).toBeVisible();
 expect(await page.locator('#continueRun').evaluate(n=>!!n.closest('#startRow'))).toBe(true);
});
test('the visible current range follows the book, unit and hero without retargeting a saved run',async({game,page},info)=>{
 only(info);await game.open({saved:{homeTutorialSeen:true}});
 await expect(page.locator('#homeTutorial')).toBeHidden();await expect(page.locator('#homeRange')).toContainText('45 词');
 await page.locator('#textbookSelect').selectOption('wy8b');await expect(page.locator('#homeRange')).toContainText('八下');await expect(page.locator('#homeRange')).toContainText('29 词');
 await page.locator('#heroes .hcard').filter({hasText:'狂战士'}).click();await expect(page.locator('#homeRange')).toContainText('狂战士');
 await page.locator('#units [data-unit="0"]').click();await expect(page.locator('#homeRange')).toContainText('我的词表');
 await page.locator('#units [data-unit="1"]').click();await page.locator('#startRun').click();await page.locator('#mPause').click();await page.locator('#pzHome').click();
 const frozen=(await game.saved()).activeRun;await page.locator('#textbookSelect').selectOption('wy8a');await expect(page.locator('#homeRange')).toContainText('45 词');
 const updated=(await game.saved()).activeRun;
 // Saving a home preference refreshes the checkpoint timestamp, not the run.
 expect({...updated,savedAt:frozen.savedAt}).toEqual(frozen);await page.locator('#continueRun').click();expect((await game.saved()).activeRun.run.bookId).toBe('wy8b');
});
