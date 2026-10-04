import {test,expect} from './game-harness.js';

async function openDetails(game,page,info){
 test.skip(info.project.metadata.target==='legacy','The independently scrolling stage belongs to the current game');
 await game.open();await game.start();await game.fight();
 await page.evaluate(()=>{const t=window.__gameTest;t.G.relics=t.RELICS.map(r=>r.id);t.G.bag=Object.fromEntries(t.ITEMS.map(i=>[i.id,3]));t.renderFight()});
 await page.locator('#fDetailsOpen').click();await expect(page.locator('#fBattleDetails')).toBeVisible();expect(await page.evaluate(()=>window.__gameTest.progress.isPaused())).toBe(true);
 const details=page.locator('#fDetailsBody');
 expect(await details.evaluate(n=>n.scrollHeight-n.clientHeight)).toBeGreaterThan(100);
 return details;
}

async function checkScroll(details,page,touch=false){
 await details.evaluate(n=>n.scrollTop=0);
 const before=await details.evaluate(n=>n.scrollTop);
 if(touch){const r=await details.boundingBox(),cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height*.8}]});for(const ratio of [.7,.6,.5,.4,.3,.2]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height*ratio}]});await page.waitForTimeout(20)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach()}
 else {await details.hover();await page.mouse.wheel(0,300)}
 await expect.poll(()=>details.evaluate(n=>n.scrollTop)).toBeGreaterThan(before);
 await page.locator('#fEquipment .eq-row').last().scrollIntoViewIfNeeded();
 for(const id of ['fAv','fPc','fMy','fEn']){
  const r=await page.locator('#'+id).boundingBox();expect(r.y,id).toBeGreaterThanOrEqual(0);expect(r.y+r.height,id).toBeLessThanOrEqual((await page.locator('#fBattleDetails').boundingBox()).y);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#fDetailsClose').click();await expect(page.locator('#fBattleDetails')).toBeHidden();expect(await page.evaluate(()=>window.__gameTest.progress.isPaused())).toBe(false);
 const hit=await page.locator('#tPause').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))});expect(hit).toBe(true);
 await page.locator('#tPause').click();await expect(page.locator('#s-pause')).toBeVisible();
}

test('desktop details have a slim translucent scrollbar and still accept the mouse wheel',async({game,page},info)=>{
 await page.setViewportSize({width:1122,height:1064});const details=await openDetails(game,page,info);
 await page.mouse.move(0,0);
 const css=await details.evaluate(n=>{const s=getComputedStyle(n),bar=getComputedStyle(n,'::-webkit-scrollbar'),track=getComputedStyle(n,'::-webkit-scrollbar-track'),thumb=getComputedStyle(n,'::-webkit-scrollbar-thumb'),button=getComputedStyle(n,'::-webkit-scrollbar-button');return {color:s.scrollbarColor,width:s.scrollbarWidth,barWidth:bar.width,track:track.backgroundColor,thumb:thumb.backgroundColor,button:button.display}});
 expect(css.color).not.toBe('auto');expect(css.color).toContain('rgba');expect(css.width).toBe('thin');expect(css.barWidth).toBe('6px');expect(css.track).toBe('rgba(0, 0, 0, 0)');expect(css.thumb).toBe('rgba(206, 196, 226, 0.3)');expect(css.button).toBe('none');
 await page.screenshot({path:info.outputPath('scrollbar.png')});await checkScroll(details,page);
});

test.describe('touch details',()=>{
 test.use({hasTouch:true});
 for(const [width,height] of [[390,844],[320,568],[844,390]]){
  test(`hide the rail while details still scroll at ${width}x${height}`,async({game,page},info)=>{
   await page.setViewportSize({width,height});const details=await openDetails(game,page,info);
   const css=await details.evaluate(n=>({width:getComputedStyle(n).scrollbarWidth,bar:getComputedStyle(n,'::-webkit-scrollbar').display}));
   expect(css.width).toBe('none');expect(css.bar).toBe('none');await page.screenshot({path:info.outputPath('scrollbar.png')});await checkScroll(details,page,true);
  });
 }
});
