import {test} from 'node:test';
import assert from 'node:assert/strict';

test('visual effects are initialized explicitly and create transient safe text nodes',async()=>{
  const {createEffects}=await import('../../src/ui/effects.js');
  const nodes=[];const timers=[];const classes=new Set();const ctx=new Proxy({},{get:(_,k)=>k==='globalAlpha'?1:()=>{}});
  const fig={classList:{remove:(...xs)=>xs.forEach(x=>classes.delete(x)),add:x=>classes.add(x)},offsetWidth:10};
  const canvas={getContext:()=>ctx};
  const document={getElementById:id=>id==='fx'?canvas:fig,body:{appendChild:x=>nodes.push(x)},createElement:()=>({style:{setProperty(){}},classList:{add(){},remove(){}},remove(){},getBoundingClientRect:()=>({left:10,top:20,width:30,height:40})}),querySelector:()=>fig};
  const environment={document,innerWidth:390,innerHeight:844,devicePixelRatio:2,addEventListener(){},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},requestAnimationFrame:()=>1};
  const effects=createEffects({environment,sfx:{finisher(){}}});
  assert.equal(canvas.width,780);
  effects.floatTxt(10,20,'<img src=x>','red');
  assert.equal(nodes[0].textContent,'<img src=x>');assert.equal(nodes[0].className,'float');
  effects.animHero('fin');assert.ok(classes.has('fin'));timers.at(-1)();assert.ok(!classes.has('fin'));
  assert.deepEqual(effects.centerOf(null),{x:195,y:422});
});
