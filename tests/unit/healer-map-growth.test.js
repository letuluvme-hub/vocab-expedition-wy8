import test from 'node:test';
import assert from 'node:assert/strict';
import {HEROES} from '../../src/data/heroes.js';
import {WORDS} from '../../src/data/words.js';
import {createRun,finishBattleNode} from '../../src/domain/run.js';
import {applyUnitSegment,applyUnitTransition} from '../../src/domain/campaign.js';
import {encodeSnapshot,decodeSnapshot,PHASE} from '../../src/domain/run-snapshot.js';
const make=()=>createRun(1,HEROES.find(h=>h.id==='healer'),WORDS.filter(w=>w.u===1),()=>.5);
const win=r=>finishBattleNode(r,{won:true,myHp:r.hp,shield:r.shield,node:{done:false}});
const save=r=>encodeSnapshot({phase:PHASE.MAP,run:r,battle:null,encounter:null},{now:100});
test('治愈师每张地图六胜最多30，第二图继续成长，已有生命和资源不重发',()=>{
 const r=make();for(let i=0;i<8;i++)win(r);assert.equal(r.maxhp,95);
 r.hp=23;r.shield=7;r.gold=101;r.whetBuys=2;r.ghostUsed=true;r.milestones={};
 applyUnitSegment(r,{random:()=>.5});
 assert.deepEqual(r.healerGrowth,{version:2,segment:2,gained:0,totalGained:30});
 assert.deepEqual([r.maxhp,r.hp,r.shield,r.gold,r.whetBuys,r.ghostUsed],[95,23,7,101,2,true]);
 for(let i=0;i<8;i++)win(r);assert.equal(r.maxhp,125);assert.equal(r.healerGrowth.totalGained,60);
 const d=decodeSnapshot(save(r));assert.equal(d.ok,true);win(d.value.run);assert.equal(d.value.run.maxhp,125);
});
test('跨单元打开新成长额度，重复过渡不重置已花额度',()=>{
 const r=make();win(r);const facts={ok:true,from:1,to:2};
 assert.ok(applyUnitTransition(r,facts,{words:WORDS.filter(w=>w.u===2),random:()=>.5}));
 win(r);assert.deepEqual(r.healerGrowth,{version:2,segment:2,gained:5,totalGained:10});
 const before=JSON.stringify(r);assert.equal(applyUnitTransition(r,facts),null);assert.equal(JSON.stringify(r),before);
});
test('旧治愈额度迁移不重算生命，已在第二图的旧局可以继续成长',()=>{
 const r=make();r.campaign.segments=2;r.maxhp=95;r.hp=21;r.healerGrowth={version:1,gained:30};
 const d=decodeSnapshot(save(r));assert.equal(d.ok,true);assert.equal(d.value.run.maxhp,95);assert.equal(d.value.run.hp,21);
 assert.deepEqual(d.value.run.healerGrowth,{version:2,segment:2,gained:0,totalGained:30});
 win(d.value.run);assert.equal(d.value.run.maxhp,100);
 delete r.healerGrowth;applyUnitSegment(r,{random:()=>.5});win(r);assert.equal(r.maxhp,95);
});
test('地图身份、累计额度和当前额度必须自洽，刷新不能伪造新额度',()=>{
 for(const fact of [{version:2,segment:2,gained:0,totalGained:0},{version:2,segment:1,gained:5,totalGained:0},{version:2,segment:1,gained:0,totalGained:35}]){
  const r=make();const good=save(r);r.healerGrowth=fact;assert.equal(save(r),null);good.run.healerGrowth=fact;assert.equal(decodeSnapshot(good).ok,false);
 }
});
