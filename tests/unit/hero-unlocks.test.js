import test from 'node:test';
import assert from 'node:assert/strict';
import {HEROES} from '../../src/data/heroes.js';
const rules=()=>import('../../src/domain/hero-unlocks.js');
test('fresh player has scholar, every other hero has an explicit reachable condition',async()=>{
 const {heroUnlockState}=await rules();for(const h of HEROES){const s=heroUnlockState({},h.id);assert.equal(s.unlocked,h.id==='scholar');if(h.id!=='scholar')assert.ok(s.requirements.length)}
});
test('thresholds are inclusive, compound conditions require all metrics, unknown heroes fail closed',async()=>{
 const {heroUnlockState,recordHeroProgress}=await rules();const db={};recordHeroProgress(db,'words',12);assert.equal(heroUnlockState(db,'scout').unlocked,true);assert.equal(heroUnlockState(db,'warrior').unlocked,false);recordHeroProgress(db,'kills',5);assert.equal(heroUnlockState(db,'warrior').unlocked,true);recordHeroProgress(db,'words',88);assert.equal(heroUnlockState(db,'pyromancer').unlocked,false);recordHeroProgress(db,'damage',6000);assert.equal(heroUnlockState(db,'pyromancer').unlocked,true);for(const id of ['fake','__proto__','toString'])assert.equal(heroUnlockState(db,id).unlocked,false);
});
test('old learning records migrate conservatively; dirty metrics and fake increments do not unlock',async()=>{
 const {initializeHeroProgress,recordHeroProgress}=await rules();const db={mastered:['Apple','apple','pear'],future:{keep:true}};initializeHeroProgress(db);assert.equal(db.heroStats.words,2);assert.equal(db.heroStats.kills,0);assert.equal(db.heroStats.damage,0);assert.equal(db.heroStats.healing,0);assert.deepEqual(db.future,{keep:true});const before=JSON.stringify(db.heroStats);for(const n of [-1,NaN,Infinity,'100',0])recordHeroProgress(db,'kills',n);assert.equal(JSON.stringify(db.heroStats),before);initializeHeroProgress(db);assert.equal(db.heroStats.words,2);
});
test('scholar survival and hints replace the conflicting clean-word bonus',async()=>{
 const h=HEROES.find(h=>h.id==='scholar');assert.equal(h.mod.hp,10);assert.equal(h.mod.hint,2);const {heroFinisherMultiplier,heroHintWidth}=await import('../../src/domain/hero-rules.js');const run={heroId:'scholar'};assert.equal(heroHintWidth(run),2);for(const hint of [0,1])assert.equal(heroFinisherMultiplier(run,{wordQ:{wrong:0,hint,listen:0,revealed:0}}),1);
});
