import test from 'node:test';
import assert from 'node:assert/strict';
import {HEROES} from '../../src/data/heroes.js';
import {WORDS} from '../../src/data/words.js';
import {createRun,finishBattleNode} from '../../src/domain/run.js';
import {heroFinisherMultiplier,heroOpeningGrant} from '../../src/domain/hero-rules.js';
import {encodeSnapshot,decodeSnapshot,PHASE} from '../../src/domain/run-snapshot.js';
const make=(id='healer',growth)=>createRun(1,HEROES.find(h=>h.id===id),WORDS.filter(w=>w.u===1),()=>.5,growth);
const clean={wrong:0,hint:0,listen:0,revealed:0};
const fight=(r,extra={})=>({won:true,myHp:r.hp,shield:0,node:{done:false},...extra});
const snapshot=r=>encodeSnapshot({phase:PHASE.MAP,run:r,battle:null,encounter:null},{now:100});
test('焰术师六字母触发，五字母不触发，新局生命58',()=>{
 const r=make('pyromancer');assert.equal(r.maxhp,58);
 for(const [w,m] of [['apple',1],['desert',1.4],['ice-cream',1.4]]) assert.equal(heroFinisherMultiplier(r,{word:{w},wordQ:clean}),m);
});
test('治愈师只在新远征半血起步，掌握成长先计入上限',()=>{
 const r=make();assert.equal(r.maxhp,65);assert.equal(r.hp,33);assert.deepEqual(r.healerGrowth,{version:1,gained:0});
 const grown=make('healer',{version:2,masteredAtStart:100,bonusHp:5,bonusAttackPct:40});assert.equal(grown.hp,35);assert.equal(grown.maxhp,70);
 assert.deepEqual(heroOpeningGrant(r,{myHp:r.hp,shield:0}),{heal:10,shield:0});
 for(const h of HEROES.filter(h=>h.id!=='healer')) assert.equal(make(h.id).hp,make(h.id).maxhp);
});
test('真实胜利+5上限不额外回血，重复结算不发，六胜累计最多30',()=>{
 const r=make();const b=fight(r,{myHp:20});assert.equal(finishBattleNode(r,b), 'advance');
 assert.equal(r.maxhp,70);assert.equal(r.hp,20);assert.equal(r.healerGrowth.gained,5);
 finishBattleNode(r,b);assert.equal(r.maxhp,70);
 for(let i=0;i<10;i++) finishBattleNode(r,fight(r));
 assert.equal(r.maxhp,95);assert.equal(r.healerGrowth.gained,30);
});
test('逃跑、跳过、战败和旧局不获得新治愈成长；重复Boss结算同样不发',()=>{
 for(const won of [false,undefined]) {const r=make();finishBattleNode(r,fight(r,{won}));assert.equal(r.maxhp,65);assert.equal(r.healerGrowth.gained,0)}
 const old=make();delete old.healerGrowth;old.hp=65;finishBattleNode(old,fight(old));assert.equal(old.maxhp,65);
 const r=make();finishBattleNode(r,fight(r,{boss:true}));assert.equal(r.maxhp,70);finishBattleNode(r,fight(r,{boss:true}));assert.equal(r.maxhp,70);
});
test('治愈成长的零值、胜利值和半血原样存取，旧局缺失不补填',()=>{
 const r=make();for(const gained of [0,5,30]) {r.healerGrowth.gained=gained;r.maxhp=65+gained;r.hp=23;const enc=snapshot(r);assert.ok(enc);const d=decodeSnapshot(JSON.parse(JSON.stringify(enc)));assert.equal(d.ok,true);assert.equal(d.value.run.hp,23);assert.deepEqual(d.value.run.healerGrowth,r.healerGrowth)}
 delete r.healerGrowth;const enc=snapshot(r);assert.ok(!('healerGrowth' in enc.run));const d=decodeSnapshot(enc);assert.equal(d.value.run.healerGrowth,undefined);
});
test('伪造治愈额度和其他角色携带治愈成长拒绝保存及恢复',()=>{
 for(const fact of [null,{version:2,gained:0},{version:1,gained:-5},{version:1,gained:1},{version:1,gained:35},{version:1,gained:'5'}]) {
  const r=make();const good=snapshot(r);r.healerGrowth=fact;assert.equal(snapshot(r),null);good.run.healerGrowth=fact;assert.equal(decodeSnapshot(good).ok,false);
 }
 const r=make('scholar');const good=snapshot(r);r.healerGrowth={version:1,gained:0};assert.equal(snapshot(r),null);good.run.healerGrowth=r.healerGrowth;assert.equal(decodeSnapshot(good).ok,false);
});
