import test from 'node:test';
import assert from 'node:assert/strict';
import {createRun} from '../../src/domain/run.js';
import {HEROES} from '../../src/data/heroes.js';
import {WORDS} from '../../src/data/words.js';
import {applyUnitSegment} from '../../src/domain/campaign.js';
import {encodeSnapshot,decodeSnapshot,PHASE} from '../../src/domain/run-snapshot.js';
import {whetRemaining} from '../../src/domain/whet-limit.js';
const make=()=>createRun(1,HEROES[0],WORDS.filter(w=>w.u===1),()=>.5);
test('磨砺石每图一次，整次远征两次；换图不清掉总限购',()=>{
 const r=make();assert.equal(whetRemaining(r),1);r.whetBuys=1;r.whetMapBuys=1;
 assert.equal(whetRemaining(r),0);applyUnitSegment(r,{random:()=>.5});assert.equal(whetRemaining(r),1);
 r.whetBuys=2;r.whetMapBuys=1;applyUnitSegment(r,{random:()=>.5});assert.equal(whetRemaining(r),0);
});
test('磨砺石地图额度保存恢复，旧档已有购买次数保守占用本图额度',()=>{
 const r=make();r.whetBuys=1;r.whetMapBuys=1;
 const enc=encodeSnapshot({phase:PHASE.MAP,run:r,battle:null,encounter:null});const d=decodeSnapshot(enc);
 assert.equal(d.ok,true);assert.equal(whetRemaining(d.value.run),0);
 delete enc.run.whetMapBuys;const old=decodeSnapshot(enc);assert.equal(old.ok,true);assert.equal(whetRemaining(old.value.run),0);
 for(const bad of [-1,2,'1']) {enc.run.whetMapBuys=bad;assert.equal(decodeSnapshot(enc).ok,false)}
});
