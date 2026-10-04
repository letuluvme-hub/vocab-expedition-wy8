import {test,expect} from './game-harness.js';
test.use({hasTouch:true});
const LONG='应用程序；应用软件；可以在手机和平板电脑上使用的程序，包含多个不同用途的工具';
for(const [width,height] of [[320,568],[375,667],[390,844],[412,915],[1024,844],[844,390]]){
 for(const kbMode of [true,false]){
  test(`input stays anchored ${width}x${height} ${kbMode?'QWERTY':'alphabet'}`,async({game,page},info)=>{
   test.skip(info.project.metadata.target==='legacy','Fixed combat input');
   await page.setViewportSize({width,height});await game.open({saved:{kbMode}});await game.start();await game.fight({word:'factory'});
   const geometry=()=>page.evaluate(()=>Object.fromEntries(['fBank','tPause','tHint','fHintShared'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x,y:r.y,width:r.width,height:r.height}]})));
   const stable=async initial=>{const now=await geometry();for(const id of Object.keys(initial))for(const dimension of ['x','y','width','height'])expect(Math.abs(now[id][dimension]-initial[id][dimension]),`${id} ${dimension}`).toBeLessThanOrEqual(1);expect(now.tPause.y+now.tPause.height).toBeLessThanOrEqual(height);};
   const initial=await geometry();
   await page.evaluate(text=>{const t=window.__gameTest;t.B.word={...t.B.word,z:text};t.B.combo=8;t.B.hintTotal=1;t.G.bag={leech:2,reveal:1,purge:1};t.renderFight()},LONG);
   await stable(initial);
   // Same physical letter target stays put as tags, HUD and empty inventory change.
   const key=()=>page.locator('#fBank .key').filter({hasText:/^f$/i}).first();const before=await key().boundingBox();
   await key().tap();expect((await game.state()).B.input).toEqual(['f']);await stable(initial);
   await page.evaluate(()=>{const t=window.__gameTest;t.G.bag={};t.B.combo=0;t.B.hintTotal=0;document.getElementById('fMsg').classList.add('on');document.getElementById('fMsg').textContent='怪物准备攻击';t.renderFight()});
   await stable(initial);const after=await key().boundingBox();expect(Math.abs(after.y-before.y)).toBeLessThanOrEqual(1);expect(Math.abs(after.x-before.x)).toBeLessThanOrEqual(1);
   // A different-size next word bank must not resize or relocate the input panel.
   await page.evaluate(()=>{const t=window.__gameTest;t.B.letters=['a','d','f'];t.B.used=[false,false,false];t.B.bad=[false,false,false];t.renderFight()});await stable(initial);
   await page.locator('#tPause').tap();await expect(page.locator('#s-pause')).toBeVisible();expect(game.errors).toEqual([]);
  });
 }
}
