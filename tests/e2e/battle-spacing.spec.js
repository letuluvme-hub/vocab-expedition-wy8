import {test,expect} from './game-harness.js';

test.use({hasTouch:true});
const LONG='（= application）应用程序；应用软件；可以在手机和平板电脑上使用的程序';
const only=info=>test.skip(info.project.metadata.target==='legacy','Content-sized mobile battle layout');
async function setup(game,page,{long=false}={}){
 await game.open();await game.start();await game.fight({word:'factory'});
 await page.evaluate(({long,text})=>{
  const t=window.__gameTest;
  if(long){
   const w={...t.B.word,z:text};t.G.pool=t.G.pool.map(x=>x.w===w.w?w:x);t.B.word=w;
  }
  t.B.offer=[t.B.word,...t.G.pool.filter(x=>x.w!==t.B.word.w).slice(0,2)];
  t.G.bag={leech:2,reveal:1,purge:1};t.B.myHp=t.G.hp=Math.max(1,t.G.maxhp-10);t.renderFight();
 },{long,text:LONG});
}
for(const [width,height] of [[320,568],[375,667],[390,844],[412,915]]){
 test(`battle, word and controls stay together at ${width}x${height}`,async({game,page},info)=>{
  only(info);await page.setViewportSize({width,height});await setup(game,page);
  const rect=selector=>page.locator(selector).boundingBox();
  const stage=await rect('#fBattleStage'),q=await rect('#s-fight .q'),middle=await rect('#s-fight .fmid'),dock=await rect('#fActionDock');
  expect(q.y-stage.y-stage.height).toBeGreaterThanOrEqual(0);
  expect(q.y-stage.y-stage.height).toBeLessThanOrEqual(8);
  // On a short screen the word card scrolls inside the middle viewport.
  const visibleBottom=Math.min(q.y+q.height,middle.y+middle.height);
  expect(dock.y-visibleBottom).toBeGreaterThanOrEqual(0);
  expect(dock.y-visibleBottom).toBeLessThanOrEqual(12);
  expect((await rect('#tPause')).y+(await rect('#tPause')).height).toBeLessThanOrEqual(height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('grouped.png')});
  // Changing a candidate still selects that word and leaves every control usable.
  const chosen=await page.evaluate(()=>window.__gameTest.B.offer[2].w);
  await page.locator('#fOffer .wcCard').nth(2).tap();
  expect((await game.state()).B.word).toBe(chosen);
  await page.locator('#fItems .item').filter({hasText:'吸血獠牙'}).tap();
  expect((await game.state()).G.bag.leech).toBe(1);
  await page.locator('#fDetailsOpen').tap();await expect(page.locator('#fBattleDetails')).toBeVisible();
  await page.locator('#fDetailsClose').tap();await page.locator('#tPause').tap();await expect(page.locator('#s-pause')).toBeVisible();
 });
}
test('long meaning uses smaller readable type, then restores the short meaning size',async({game,page},info)=>{
 only(info);await page.setViewportSize({width:390,height:844});await setup(game,page,{long:true});
 const size=()=>page.locator('#fZh').evaluate(n=>parseFloat(getComputedStyle(n).fontSize));
 await expect(page.locator('#fZh')).toHaveText(LONG);
 const denseSize=await size();expect(denseSize).toBeGreaterThanOrEqual(16);expect(denseSize).toBeLessThanOrEqual(18);
 const meaning=await page.locator('#fZh').boundingBox(),middle=await page.locator('#s-fight .fmid').boundingBox();
 expect(meaning.y+meaning.height).toBeLessThanOrEqual(middle.y+middle.height);
 expect(await page.locator('#fZh').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('long-meaning.png')});
 await page.locator('#fOffer .wcCard').nth(1).tap();
 expect(await size()).toBeGreaterThan(denseSize);
 expect(await size()).toBeGreaterThanOrEqual(20);
});
