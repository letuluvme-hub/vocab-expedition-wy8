import {test,expect} from './game-harness.js';
test.use({reducedMotion:'no-preference'});
const only=info=>test.skip(info.project.metadata.target==='legacy','Persistent combat stage');
for(const [width,height] of [[390,844],[375,667],[320,568],[844,390]]){
 test(`combat stays visible above scrolling equipment at ${width}x${height}`,async({game,page},info)=>{
  only(info);await page.setViewportSize({width,height});await game.open();await game.start();await game.fight();
  await page.evaluate(()=>{const t=window.__gameTest;t.G.relics=t.RELICS.map(r=>r.id);t.G.bag=Object.fromEntries(t.ITEMS.map(i=>[i.id,3]));t.renderFight()});
  await page.locator('#fEquipment > summary').click();await page.locator('#fEquipment .eq-row').last().scrollIntoViewIfNeeded();
  const geo=await page.evaluate(()=>({width:document.documentElement.scrollWidth,rects:['fAv','fPc','fMy','fEn','tPause'].map(id=>({id,...document.getElementById(id).getBoundingClientRect().toJSON()})),scroll:document.querySelector('.fmid').scrollTop}));
  expect(geo.width).toBeLessThanOrEqual(width);expect(geo.scroll).toBeGreaterThan(0);
  for(const r of geo.rects){expect(r.top,r.id).toBeGreaterThanOrEqual(0);expect(r.bottom,r.id).toBeLessThanOrEqual(height);expect(r.height,r.id).toBeGreaterThan(0)}
  const hit=await page.locator('#tPause').evaluate(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))});expect(hit).toBe(true);
  if(width>height){
   const controls=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();const keys=[...document.querySelectorAll('#fBank .key')];return {bar:box('.bankbar'),hint:box('#fHintShared'),keys:keys.map(n=>n.getBoundingClientRect().toJSON()),tools:box('.tools'),hits:keys.filter(n=>!n.disabled).map(n=>{const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})}});
   expect(controls.bar.bottom).toBeLessThanOrEqual(Math.min(...controls.keys.map(r=>r.top)));
   expect(controls.hint.bottom).toBeLessThanOrEqual(Math.min(...controls.keys.map(r=>r.top)));
   expect(Math.max(...controls.keys.map(r=>r.bottom))).toBeLessThanOrEqual(controls.tools.top);
   expect(controls.hits.every(Boolean)).toBe(true);
  }
  await page.locator('#tPause').click();await expect(page.locator('#s-pause')).toBeVisible();
 });
}
test('monster animation persists through real typing; eyelids open and close, reduced motion stays still',async({game,page},info)=>{
 only(info);await game.open();await game.start();await game.fight({word:'factory'});
 await page.evaluate(()=>{window.savedMonster=document.querySelector('#fAv svg');window.savedLid=document.querySelector('#fAv .pm-lid')});
 await page.keyboard.type('fa');expect(await page.evaluate(()=>window.savedMonster===document.querySelector('#fAv svg'))).toBe(true);
 expect(await page.evaluate(()=>window.savedLid===document.querySelector('#fAv .pm-lid'))).toBe(true);
 const transforms=await page.locator('#fAv .pm-lid').evaluate(async n=>{const a=n.getAnimations()[0];a.pause();const delay=a.effect.getTiming().delay;a.currentTime=delay;await new Promise(requestAnimationFrame);const open=getComputedStyle(n).transform;a.currentTime=2900+delay;await new Promise(requestAnimationFrame);return [open,getComputedStyle(n).transform]});
 expect(transforms[0]).not.toBe(transforms[1]);await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('#fAv .pm-lid').evaluate(n=>n.getAnimations().length)).toBe(0);
});

test('finisher feedback appears over opponents while HUD stays above effects',async({game,page},info)=>{
 only(info);await game.open();await game.start();await game.fight();await page.waitForTimeout(450);
 const hits=await page.evaluate(()=>{
  const probe=document.createElement('div');probe.className='finword';probe.style.cssText='width:32px;height:24px;background:gold;pointer-events:auto;transform:none';document.body.appendChild(probe);
  const check=id=>{const n=document.getElementById(id),r=n.getBoundingClientRect();probe.style.left=(r.x+r.width/2-16)+'px';probe.style.top=(r.y+r.height/2-12)+'px';return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)};
  const feedbackVisible=check('fAv')===probe;const hud=check('fMy');const hudProtected=document.getElementById('fMy').parentElement.contains(hud);probe.remove();return {feedbackVisible,hudProtected};
 });expect(hits).toEqual({feedbackVisible:true,hudProtected:true});
});
