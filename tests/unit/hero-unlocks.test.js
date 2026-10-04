import test from 'node:test';
import assert from 'node:assert/strict';
import {HEROES} from '../../src/data/heroes.js';
import {HERO_UNLOCKS,HERO_UNLOCK_ORDER} from '../../src/data/hero-unlocks.js';
const rules=()=>import('../../src/domain/hero-unlocks.js');
const fresh=async()=>{const {initializeHeroProgress}=await rules();const db={heroStats:{words:0,cleanWords:0,kills:0,damage:0,healing:0},heroUnlocks:{}};initializeHeroProgress(db);return db};
test('fresh player has scholar, every other hero has an explicit reachable condition',async()=>{
 const {heroUnlockState}=await rules();for(const h of HEROES){const s=heroUnlockState({},h.id);assert.equal(s.unlocked,h.id==='scholar');if(h.id!=='scholar')assert.ok(s.requirements.length)}
 assert.deepEqual([...HERO_UNLOCK_ORDER].sort(),HEROES.map(h=>h.id).sort());
});
test('later heroes need strictly more complete words, so they open one by one instead of in a burst',async()=>{
 const words=HERO_UNLOCK_ORDER.slice(1).map(id=>HERO_UNLOCKS[id].find(([m])=>m==='words')?.[1]);
 assert.ok(words.every(Number.isFinite),'every hero after scholar has a words requirement');
 for(let i=1;i<words.length;i++)assert.ok(words[i]-words[i-1]>=30,`${HERO_UNLOCK_ORDER[i+1]} needs at least 30 more words than the previous hero`);
});
test('progress is cumulative and visible on every card; compound conditions need all metrics; unknown heroes fail closed',async()=>{
 const {heroUnlockState,recordHeroProgress}=await rules();const db=await fresh();
 recordHeroProgress(db,'words',19);assert.equal(heroUnlockState(db,'scout').unlocked,false);
 for(const id of HERO_UNLOCK_ORDER.slice(1)){const r=heroUnlockState(db,id).requirements.find(r=>r.metric==='words');assert.equal(r.current,19,`${id} shows the running total`)}
 recordHeroProgress(db,'words',1);assert.equal(heroUnlockState(db,'scout').unlocked,true);
 recordHeroProgress(db,'words',30);assert.equal(heroUnlockState(db,'warrior').unlocked,false,'warrior also needs kills');
 recordHeroProgress(db,'kills',3);assert.equal(heroUnlockState(db,'warrior').unlocked,true);assert.equal(heroUnlockState(db,'lucky').unlocked,false);
 for(const id of ['fake','__proto__','toString'])assert.equal(heroUnlockState(db,id).unlocked,false);
});
test('unlocks are latched, so a later threshold change never takes a hero away',async()=>{
 const {heroUnlockState,recordHeroProgress}=await rules();const db=await fresh();recordHeroProgress(db,'words',20);
 assert.ok(db.heroUnlocks.scout);db.heroStats.words=0;assert.equal(heroUnlockState(db,'scout').unlocked,true);
});
test('old saves keep every hero the legacy totals had unlocked; sequential-era records stay valid',async()=>{
 const {initializeHeroProgress,heroUnlockState}=await rules();
 const db={heroStats:{words:100,cleanWords:7,kills:5,damage:4907,healing:86}};initializeHeroProgress(db);
 assert.deepEqual(Object.keys(db.heroUnlocks).sort(),['healer','lucky','scholar','scout','warrior']);
 const r=heroUnlockState(db,'ranger');assert.equal(r.unlocked,false);assert.deepEqual(r.requirements.map(x=>x.current),[100,86]);
 const again=JSON.parse(JSON.stringify(db));initializeHeroProgress(again);assert.deepEqual(again.heroUnlocks,db.heroUnlocks);
});
test('unknown unlock fields survive normalization and dirty records cannot unlock heroes',async()=>{
 const {initializeHeroProgress,heroUnlockState}=await rules();
 const db={heroStats:{words:0},heroUnlocks:{futureHero:{words:3},assassin:'yes',scout:{words:-3,note:'keep'}}};initializeHeroProgress(db);
 assert.deepEqual(db.heroUnlocks.futureHero,{words:3});assert.equal(db.heroUnlocks.assassin,'yes');assert.deepEqual(db.heroUnlocks.scout,{words:-3,note:'keep'});
 assert.equal(heroUnlockState(db,'assassin').unlocked,false);assert.equal(heroUnlockState(db,'scout').unlocked,true);
 for(const id of ['futureHero','__proto__','toString'])assert.equal(heroUnlockState(db,id).unlocked,false);
});
test('old learning records migrate conservatively; dirty metrics and fake increments do not unlock',async()=>{
 const {initializeHeroProgress,recordHeroProgress}=await rules();const db={mastered:['Apple','apple','pear'],future:{keep:true}};initializeHeroProgress(db);assert.equal(db.heroStats.words,2);assert.equal(db.heroStats.kills,0);assert.equal(db.heroStats.damage,0);assert.equal(db.heroStats.healing,0);assert.deepEqual(db.future,{keep:true});const before=JSON.stringify(db.heroStats);for(const n of [-1,NaN,Infinity,'100',0])recordHeroProgress(db,'kills',n);assert.equal(JSON.stringify(db.heroStats),before);initializeHeroProgress(db);assert.equal(db.heroStats.words,2);
});
test('scholar survival and hints replace the conflicting clean-word bonus',async()=>{
 const h=HEROES.find(h=>h.id==='scholar');assert.equal(h.mod.hp,10);assert.equal(h.mod.hint,2);const {heroFinisherMultiplier,heroHintWidth}=await import('../../src/domain/hero-rules.js');const run={heroId:'scholar'};assert.equal(heroHintWidth(run),2);for(const hint of [0,1])assert.equal(heroFinisherMultiplier(run,{wordQ:{wrong:0,hint,listen:0,revealed:0}}),1);
});
