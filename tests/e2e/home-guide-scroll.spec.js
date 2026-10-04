import {test,expect} from './game-harness.js';
for(const [width,height,resume] of [[320,568,false],[390,844,true],[1024,768,false]]){
 test(`reopened tutorial clears the sticky start at ${width}x${height}${resume?' with a saved run':''}`,async({game,page},info)=>{
  test.skip(info.project.metadata.target==='legacy','Home tutorial scroll clearance');
  await page.setViewportSize({width,height});await game.open({saved:{homeTutorialSeen:true,future:{keep:true}}});
  if(resume){await game.start();await page.locator('#mPause').click();await page.locator('#pzHome').click();await expect(page.locator('#continueRun')).toBeVisible()}
  const before=await game.saved();
  await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
  await page.locator('#homeHowTo').click();await expect(page.locator('#homeTutorial')).toBeVisible();
  const row=await page.locator('#startRow').boundingBox(),guide=await page.locator('#homeTutorial').boundingBox();
  expect(guide.y).toBeGreaterThanOrEqual(row.y+row.height);
  expect(guide.y+guide.height).toBeLessThanOrEqual(height);
  expect(await page.locator('#homeTutorial h2').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})).toBe(true);
  await page.screenshot({path:info.outputPath('reopened-guide.png')});
  await page.locator('#homeTutorialDismiss').click();await expect(page.locator('#homeTutorial')).toBeHidden();
  const after=await game.saved();expect(after.homeTutorialSeen).toBe(true);expect(after.future).toEqual({keep:true});expect(after.runs).toBe(before.runs);
  if(resume)expect({...after.activeRun,savedAt:before.activeRun.savedAt}).toEqual(before.activeRun);
 });
}
