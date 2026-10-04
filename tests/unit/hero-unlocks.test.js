import test from 'node:test';
import assert from 'node:assert/strict';
import {HEROES} from '../../src/data/heroes.js';
import {HERO_UNLOCK_ORDER} from '../../src/data/hero-unlocks.js';
const rules=()=>import('../../src/domain/hero-unlocks.js');
const fresh=async()=>{const {initializeHeroProgress}=await rules();const db={heroStats:{words:0,cleanWords:0,kills:0,damage:0,healing:0},heroUnlocks:{}};initializeHeroProgress(db);return db};
test('fresh player has scholar, every other hero has an explicit reachable condition',async()=>{
 const {heroUnlockState}=await rules();for(const h of HEROES){const s=heroUnlockState({},h.id);assert.equal(s.unlocked,h.id==='scholar');if(h.id!=='scholar')assert.ok(s.requirements.length)}
 assert.deepEqual([...HERO_UNLOCK_ORDER].sort(),HEROES.map(h=>h.id).sort());
});
test('thresholds are inclusive, compound conditions require all metrics, unknown heroes fail closed',async()=>{
 const {heroUnlockState,recordHeroProgress}=await rules();const db=await fresh();
 recordHeroProgress(db,'words',19);assert.equal(heroUnlockState(db,'scout').unlocked,false);
 recordHeroProgress(db,'words',1);assert.equal(heroUnlockState(db,'scout').unlocked,true);
 recordHeroProgress(db,'words',30);assert.equal(heroUnlockState(db,'warrior').unlocked,false,'warrior also needs kills');
 recordHeroProgress(db,'kills',3);assert.equal(heroUnlockState(db,'warrior').unlocked,true);
 for(const id of ['fake','__proto__','toString'])assert.equal(heroUnlockState(db,id).unlocked,false);
});
test('heroes unlock one at a time: banked progress opens only the next hero, which starts counting from zero',async()=>{
 const {heroUnlockState,recordHeroProgress}=await rules();const db=await fresh();
 recordHeroProgress(db,'kills',500);recordHeroProgress(db,'damage',99999);recordHeroProgress(db,'healing',9999);recordHeroProgress(db,'cleanWords',999);recordHeroProgress(db,'words',5000);
 const open=()=>HERO_UNLOCK_ORDER.filter(id=>heroUnlockState(db,id).unlocked);
 assert.deepEqual(open(),['scholar','scout']);
 const w=heroUnlockState(db,'warrior');assert.equal(w.waitingFor,null);assert.deepEqual(w.requirements.map(r=>r.current),[0,0]);
 assert.equal(heroUnlockState(db,'lucky').waitingFor,'warrior');assert.equal(heroUnlockState(db,'lucky').requirements[0].current,0);
 recordHeroProgress(db,'kills',3);recordHeroProgress(db,'words',29);assert.deepEqual(open(),['scholar','scout']);
 recordHeroProgress(db,'words',1);assert.deepEqual(open(),['scholar','scout','warrior']);
 assert.equal(heroUnlockState(db,'lucky').requirements[0].current,0);
});
test('old saves keep every hero the legacy totals had unlocked and the next hero counts from migration',async()=>{
 const {initializeHeroProgress,heroUnlockState,recordHeroProgress}=await rules();
 const db={heroStats:{words:100,cleanWords:7,kills:5,damage:4907,healing:86}};initializeHeroProgress(db);
 assert.deepEqual(Object.keys(db.heroUnlocks).sort(),['healer','lucky','scholar','scout','warrior']);
 const r=heroUnlockState(db,'ranger');assert.equal(r.unlocked,false);assert.deepEqual(r.requirements.map(x=>x.current),[0,0]);
 assert.equal(heroUnlockState(db,'berserker').waitingFor,'ranger');
 recordHeroProgress(db,'words',70);recordHeroProgress(db,'healing',100);assert.equal(heroUnlockState(db,'ranger').unlocked,true);assert.equal(heroUnlockState(db,'berserker').unlocked,false);
 const again=JSON.parse(JSON.stringify(db));initializeHeroProgress(again);assert.deepEqual(again.heroUnlocks,db.heroUnlocks);
});
test('dirty unlock records are cleaned and cannot unlock unknown heroes',async()=>{
 const {initializeHeroProgress,heroUnlockState}=await rules();
 const db={heroStats:{words:0},heroUnlocks:{fake:{},assassin:'yes',__proto__x:{},scout:{words:-3,kills:'9'}}};initializeHeroProgress(db);
 assert.deepEqual(Object.keys(db.heroUnlocks).sort(),['scholar','scout']);assert.deepEqual(db.heroUnlocks.scout,{words:0,cleanWords:0,kills:0,damage:0,healing:0});
 assert.equal(heroUnlockState(db,'assassin').unlocked,false);
});
test('old learning records migrate conservatively; dirty metrics and fake increments do not unlock',async()=>{
 const {initializeHeroProgress,recordHeroProgress}=await rules();const db={mastered:['Apple','apple','pear'],future:{keep:true}};initializeHeroProgress(db);assert.equal(db.heroStats.words,2);assert.equal(db.heroStats.kills,0);assert.equal(db.heroStats.damage,0);assert.equal(db.heroStats.healing,0);assert.deepEqual(db.future,{keep:true});const before=JSON.stringify(db.heroStats);for(const n of [-1,NaN,Infinity,'100',0])recordHeroProgress(db,'kills',n);assert.equal(JSON.stringify(db.heroStats),before);initializeHeroProgress(db);assert.equal(db.heroStats.words,2);
});
test('scholar survival and hints replace the conflicting clean-word bonus',async()=>{
 const h=HEROES.find(h=>h.id==='scholar');assert.equal(h.mod.hp,10);assert.equal(h.mod.hint,2);const {heroFinisherMultiplier,heroHintWidth}=await import('../../src/domain/hero-rules.js');const run={heroId:'scholar'};assert.equal(heroHintWidth(run),2);for(const hint of [0,1])assert.equal(heroFinisherMultiplier(run,{wordQ:{wrong:0,hint,listen:0,revealed:0}}),1);
});
