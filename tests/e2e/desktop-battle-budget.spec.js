import {test,expect} from './game-harness.js';
for(const [width,height] of [[1024,700],[1366,768],[1920,1080]]){
 test(`desktop word and slots visible beside stable input ${width}x${height}`,async({game,page},info)=>{
  test.skip(info.project.metadata.target==='legacy','Desktop battle budget');
  await page.setViewportSize({width,height});await game.open();await game.start();await game.fight({word:'factory'});
  await page.evaluate(()=>{const t=window.__gameTest;t.B.offer=[t.B.word,...t.G.pool.filter(w=>w.w!==t.B.word.w).slice(0,2)];t.renderFight()});
  const middle=await page.locator('#s-fight .fmid').boundingBox();
  for(const selector of ['#fOffer','#fZh','#fSlots']){
   const r=await page.locator(selector).boundingBox();expect(r.y).toBeGreaterThanOrEqual(middle.y);expect(r.y+r.height).toBeLessThanOrEqual(middle.y+middle.height);
  }
  const bank=await page.locator('#fBank').boundingBox();expect(bank.x).toBeGreaterThanOrEqual(middle.x+middle.width);
  expect((await page.locator('#tPause').boundingBox()).y+(await page.locator('#tPause').boundingBox()).height).toBeLessThanOrEqual(height);
  await page.screenshot({path:info.outputPath('desktop.png')});
 });
}
