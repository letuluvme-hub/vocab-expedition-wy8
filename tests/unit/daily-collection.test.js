import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { createDailyDictationController } from '../../src/app/daily-dictation.js';
import { createDailyLearning } from '../../src/app/daily-learning.js';
import { recordExposure, recordReviewSuccess, recordReviewFailure } from '../../src/domain/daily-learning.js';
const api = () => import('../../src/domain/daily-collection.js');
const app = () => import('../../src/app/daily-collection.js');
const at = date => Date.parse(`${date}T04:00:00Z`);
const cat = {w:'cat',z:'猫'}, dog = {w:'dog',z:'狗'};
const fresh = () => ({mastered:[],dictationMastered:[],reviewQueue:[],custom:[cat,dog]});

// 2026-10 预习模式起，远征整词拼对与预习不看提示拼对（都写 mastered）也算学会，墨芽一起长。
test('learned words from expedition or preview grow partner; identities deduplicate trim and case across both lists',async()=>{
 const m=await api(),db=fresh();db.mastered=WORDS.map(w=>w.w);m.initializeCollection(db);let v=m.collectionView(db,at('2026-10-03'));
 assert.equal(v.partner.count,WORDS.length);assert.equal(v.partner.stage,m.PARTNER_STAGES.length-1);
 const d=fresh();d.dictationMastered=['cat',' CAT ','Cat'];d.mastered=['dog',' Cat '];m.syncPartner(d);v=m.collectionView(d,at('2026-10-03'));assert.equal(v.partner.count,2);assert.equal(v.partner.remaining,3);
});
test('every formal threshold advances original partner and next gap is exact',async()=>{
 const m=await api(),db=fresh();for(const [i,threshold] of m.PARTNER_STAGES.entries()){
  db.dictationMastered=Array.from({length:threshold.required},(_,n)=>`word${n}`);m.syncPartner(db);const p=m.collectionView(db,at('2026-10-03')).partner;
  assert.equal(p.stage,i);assert.equal(p.remaining,m.PARTNER_STAGES[i+1]?m.PARTNER_STAGES[i+1].required-threshold.required:0);
 }
});
test('review failure keeps earned forms and cosmetics but next threshold uses current count',async()=>{
 const m=await api(),db=fresh();db.dictationMastered=Array.from({length:20},(_,n)=>`word${n}`);m.syncPartner(db);m.completeCollection(db,{at:at('2026-10-03'),practiced:true,random:()=>0});
 const forms=[...db.dailyCollection.unlockedStages],cosmetics=[...db.dailyCollection.cosmetics];db.dictationMastered=[];m.syncPartner(db);const v=m.collectionView(db,at('2026-10-04'));
 assert.deepEqual(db.dailyCollection.unlockedStages,forms);assert.deepEqual(db.dailyCollection.cosmetics,cosmetics);assert.equal(v.partner.stage,2);assert.equal(v.partner.remaining,50);
});
test('atlas preserves all259 original cards and order with five honest states',async()=>{
 const m=await api(),db=fresh(),words=WORDS.filter(w=>w.u===1),[a,b,c,d,e]=words;
 recordExposure(db,b);recordExposure(db,c,true);db.dictationMastered=[d.w,e.w];db.reviewSchedule={[e.w.toLowerCase()]:{stable:true,pendingFailure:false}};
 const cards=m.atlasCards(db,WORDS,1);assert.equal(m.atlasCards(db,WORDS).length,259);assert.deepEqual(cards.map(x=>x.word),words);
 assert.deepEqual(cards.slice(0,5).map(x=>x.level),[0,1,2,3,4]);assert.deepEqual([a,b,c,d,e].map(w=>m.cardLevel(db,w)),[0,1,2,3,4]);
});
test('a learned word is learned; seen and half input only mean seen or practiced',async()=>{
 const m=await api(),db=fresh();recordExposure(db,cat);assert.equal(m.cardLevel(db,cat),1);recordExposure(db,cat,true);assert.equal(m.cardLevel(db,cat),2);db.mastered=[' DOG '];assert.equal(m.cardLevel(db,dog),3);
 assert.equal(m.CARD_LABELS[3],'学会了');assert.equal(m.collectionView(db,at('2026-10-03')).partner.count,1);
});
test('stable requires formal mastery and completion of entire due review ladder',async()=>{
 const m=await api(),db=fresh();db.dictationMastered=['cat'];let time=at('2026-10-03');recordReviewSuccess(db,{word:cat,at:time,token:'first'});assert.equal(m.cardLevel(db,cat),3);
 for(let n=1;n<=5;n++){time=at(db.reviewSchedule.cat.dueDate);recordReviewSuccess(db,{word:cat,at:time,token:`r${n}`});assert.equal(m.cardLevel(db,cat),n===5?4:3);}
 recordExposure(db,cat,true);recordReviewFailure(db,{word:cat,at:time,token:'wrong'});assert.equal(m.cardLevel(db,cat),2);db.reviewSchedule.cat.stable=true;assert.equal(m.cardLevel(db,cat),2);
});
test('past custom exposure snapshots stay in collection after replacing custom list',async()=>{
 const m=await api(),db=fresh();recordExposure(db,cat,true);db.custom=[dog];const cards=m.atlasCards(db,WORDS,0);assert.equal(cards.some(c=>c.word.w==='cat'&&c.word.z==='猫'&&c.level===2),true);
});
test('current custom atlas includes every unseen word and replacement keeps historical snapshots',async()=>{
 const m=await api(),db=fresh();db.custom=Array.from({length:25},(_,n)=>({w:`custom${n}`,z:`词${n}`}));recordExposure(db,cat,true);
 const cards=m.atlasCards(db,WORDS,0);assert.equal(cards.length,26);assert.equal(cards.filter(c=>c.level===0).length,25);assert.deepEqual(cards.slice(0,25).map(c=>c.word),db.custom);
 db.custom=[dog];const next=m.atlasCards(db,WORDS,0);assert.deepEqual(next.map(c=>c.word.w),['dog','cat']);
});
test('old checkins without first date retain actual earliest date and recent missed candidates',async()=>{
 const m=await api(),db=fresh();db.dailyCollection={checkins:{'2026-10-01':'practice'},unknown:'keep'};m.completeCollection(db,{at:at('2026-10-03'),practiced:true,random:()=>0});
 assert.equal(db.dailyCollection.firstCheckinDate,'2026-10-01');assert.equal(m.collectionView(db,at('2026-10-04')).checkin.candidates.includes('2026-10-02'),true);assert.equal(m.applyMakeup(db,'2026-10-02',at('2026-10-04')).ok,true);
});
test('empty finish gets no checkin or cosmetic; real practice receives both',async()=>{
 const m=await api(),db=fresh();assert.equal(m.completeCollection(db,{at:at('2026-10-03'),practiced:false,random:()=>0}).awarded,false);
 assert.equal(m.collectionView(db,at('2026-10-03')).checkin.checkedToday,false);assert.equal(db.dailyCollection.cosmetics.length,0);
 const result=m.completeCollection(db,{at:at('2026-10-03'),practiced:true,random:()=>0});assert.equal(result.awarded,true);assert.equal(result.cosmetic.type,'partner');assert.equal(m.collectionView(db,at('2026-10-03')).checkin.streak,1);
});
test('same Shanghai date finish and reload cannot repeat reward or checkin',async()=>{
 const m=await api(),db=fresh();m.completeCollection(db,{at:at('2026-10-03'),practiced:true,random:()=>0});const before=structuredClone(db.dailyCollection);
 const result=m.completeCollection(db,{at:at('2026-10-03')+1000,practiced:true,random:()=>0.99});assert.equal(result.awarded,false);assert.deepEqual(db.dailyCollection,before);
 const reload=JSON.parse(JSON.stringify(db));m.initializeCollection(reload);m.completeCollection(reload,{at:at('2026-10-03'),practiced:true,random:()=>0.5});assert.deepEqual(reload.dailyCollection,before);
});
test('reward prefers uncollected cosmetics and honestly repeats only after pool is exhausted',async()=>{
 const m=await api(),db=fresh();for(let n=0;n<m.COSMETICS.length;n++)m.completeCollection(db,{at:at(`2026-10-${String(n+1).padStart(2,'0')}`),practiced:true,random:()=>0});
 assert.equal(new Set(db.dailyCollection.cosmetics).size,m.COSMETICS.length);const r=m.completeCollection(db,{at:at('2026-10-20'),practiced:true,random:()=>0});assert.equal(r.repeated,true);assert.equal(db.dailyCollection.cosmetics.length,m.COSMETICS.length);
});
test('cosmetics can be equipped only when earned; slots and game stats stay separate',async()=>{
 const m=await api(),db={...fresh(),runs:9,wins:4,best:18,gold:90,activeRun:{hp:45,shield:8,relics:['original']},unknown:{kept:true},rewards:[{id:'old'}]};const before=structuredClone(db);
 assert.equal(m.equipCosmetic(db,'sky-scarf'),false);const r=m.completeCollection(db,{at:at('2026-10-03'),practiced:true,random:()=>0});assert.equal(m.equipCosmetic(db,r.cosmetic.id),true);assert.equal(db.dailyCollection.equipped.partner,r.cosmetic.id);
 for(const key of Object.keys(before))assert.deepEqual(db[key],before[key]);assert.equal(m.equipCosmetic(db,'none','partner'),true);assert.equal(db.dailyCollection.equipped.partner,null);
});
test('continuous checkins count current day or yesterday; gap does not clear collection',async()=>{
 const m=await api(),db=fresh();for(const date of ['2026-10-01','2026-10-02'])m.completeCollection(db,{at:at(date),practiced:true,random:()=>0});const before=structuredClone(db.dailyCollection.cosmetics);
 assert.equal(m.collectionView(db,at('2026-10-03')).checkin.streak,2);assert.equal(m.collectionView(db,at('2026-10-04')).checkin.streak,0);assert.deepEqual(db.dailyCollection.cosmetics,before);
 m.completeCollection(db,{at:at('2026-10-04'),practiced:true,random:()=>0});assert.equal(m.collectionView(db,at('2026-10-04')).checkin.streak,1);
});
test('Shanghai midnight uses separate checkin dates',async()=>{
 const m=await api(),db=fresh();m.completeCollection(db,{at:Date.parse('2026-10-03T15:59:59Z'),practiced:true,random:()=>0});m.completeCollection(db,{at:Date.parse('2026-10-03T16:00:00Z'),practiced:true,random:()=>0});assert.deepEqual(Object.keys(db.dailyCollection.checkins),['2026-10-03','2026-10-04']);
});
test('week uses Monday date across year boundary without ambiguous week number',async()=>{
 const m=await api();assert.equal(m.weekStart('2026-12-31'),'2026-12-28');assert.equal(m.weekStart('2027-01-03'),'2026-12-28');assert.equal(m.weekStart('2027-01-04'),'2027-01-04');
});
test('one makeup per current calendar week, repairs streak without fake report/mastery',async()=>{
 const m=await api(),db=fresh();for(const date of ['2026-10-01','2026-10-03'])m.completeCollection(db,{at:at(date),practiced:true,random:()=>0});db.dailyReports={unknown:'preserve',days:{}};const reports=structuredClone(db.dailyReports);
 assert.deepEqual(m.applyMakeup(db,'2026-10-02',at('2026-10-04')),{ok:true,date:'2026-10-02'});assert.equal(m.collectionView(db,at('2026-10-04')).checkin.streak,3);
 assert.equal(m.applyMakeup(db,'2026-10-04',at('2026-10-05')).ok,true);assert.equal(m.applyMakeup(db,'2026-10-05',at('2026-10-06')).ok,false);assert.deepEqual(db.dailyReports,reports);assert.deepEqual(db.dictationMastered,[]);
});
for(const target of ['2026-10-04','2026-10-05','2026-09-25','2026-09-30','bad','2026-02-30'])test(`makeup rejects future/today/before-first/outdated/malformed target ${target}`,async()=>{
 const m=await api(),db=fresh();m.completeCollection(db,{at:at('2026-10-01'),practiced:true,random:()=>0});const before=structuredClone(db.dailyCollection);assert.equal(m.applyMakeup(db,target,at('2026-10-04')).ok,false);assert.deepEqual(db.dailyCollection,before);
});
test('makeup cannot earn reward, overwrite signed day or predate first real use',async()=>{
 const m=await api(),db=fresh();assert.equal(m.applyMakeup(db,'2026-10-02',at('2026-10-03')).ok,false);m.completeCollection(db,{at:at('2026-10-01'),practiced:true,random:()=>0});const cosmetics=[...db.dailyCollection.cosmetics];assert.equal(m.applyMakeup(db,'2026-10-01',at('2026-10-03')).ok,false);m.applyMakeup(db,'2026-10-02',at('2026-10-03'));assert.deepEqual(db.dailyCollection.cosmetics,cosmetics);assert.equal(db.dailyCollection.gifts['2026-10-02'],undefined);
});
test('read views are pure and unknown collection fields survive updates',async()=>{
 const m=await api(),db=fresh();db.dailyCollection={unknown:{retained:true},equipped:{future:'kept'},schemaVersion:1};m.initializeCollection(db);const before=structuredClone(db);m.collectionView(db,at('2026-10-03'));m.atlasCards(db,WORDS);assert.deepEqual(db,before);m.completeCollection(db,{at:at('2026-10-03'),practiced:true,random:()=>0});assert.deepEqual(db.dailyCollection.unknown,{retained:true});assert.equal(db.dailyCollection.equipped.future,'kept');
});

async function fixture(date='2026-10-03') {
 const {createDailyCollection}=await app();const db=fresh();let time=at(date),commits=[];
 const learning=createDailyLearning({getDB:()=>db,getWords:()=>WORDS,now:()=>time});const collection=createDailyCollection({getDB:()=>db,getWords:()=>WORDS,now:()=>time,random:()=>0,persist:()=>{commits.push(structuredClone(db));return true}});
 const ports={...learning.ports};for(const key of Object.keys(collection.ports)){const original=ports[key];ports[key]=payload=>{original?.(payload);collection.ports[key](payload);};}
 const ctl=createDailyDictationController({getDB:()=>db,getWords:()=>WORDS,now:()=>time,random:()=>0.2,persist:()=>{commits.push(structuredClone(db));return true},...ports});
 return {db,ctl,collection,commits,clock:date=>time=at(date),warm:()=>{for(const word of ctl.state().words){for(const k of word.w)ctl.input(k);ctl.next();}ctl.beginFormal();}};
}
// 旧版默写会话里，热身干净拼完（写 mastered）按统一口径记为学会；半个词只算练过。
test('real controller half warmup stays practiced; clean warmup word counts as learned',async()=>{
 const f=await fixture();f.ctl.start({mode:'dictation',unit:0});f.ctl.input('c');assert.equal(f.collection.cards(0).find(c=>c.word.w==='cat').level,2);assert.equal(f.collection.view().partner.count,0);f.ctl.input('a');f.ctl.input('t');f.ctl.next();for(const k of 'dog')f.ctl.input(k);f.ctl.next();f.ctl.beginFormal();f.ctl.hint();for(const k of 'cat')f.ctl.input(k);f.ctl.next();assert.equal(f.collection.cards(0).find(c=>c.word.w==='cat').level,3);for(const k of 'dog')f.ctl.input(k);f.ctl.next();assert.equal(f.collection.cards(0).find(c=>c.word.w==='dog').level,3);
 assert.equal(f.commits.at(-1).dailyCollection.checkins['2026-10-03'],'practice');assert.equal(f.commits.at(-1).dailyCollection.cosmetics.length,1);assert.equal(f.commits.at(-1).dailyReports.days['2026-10-03'].sessionsCompleted,1);
});
test('blank daily finish gets no reward; finish old practice after midnight gets no new date',async()=>{
 const f=await fixture();f.ctl.start({mode:'dictation',unit:0});f.ctl.pause();f.ctl.finish();assert.equal(f.collection.view().checkin.checkedToday,false);assert.equal(f.db.dailyCollection.cosmetics.length,0);
 f.ctl.start({mode:'dictation',unit:0});f.ctl.input(f.ctl.state().attempt.target[0]);f.ctl.pause();f.clock('2026-10-04');f.ctl.finish();assert.equal(f.collection.view().checkin.checkedToday,false);assert.equal(f.db.dailyCollection.cosmetics.length,0);
});
test('app equipment and makeup persist exactly once and publish fresh view',async()=>{
 const f=await fixture();f.ctl.start({mode:'dictation',unit:0});f.ctl.input('c');f.ctl.pause();f.ctl.finish();const id=f.db.dailyCollection.cosmetics[0],n=f.commits.length;assert.equal(f.collection.equip(id),true);assert.equal(f.commits.length,n+1);f.clock('2026-10-05');const result=f.collection.makeup('2026-10-04');assert.equal(result.ok,true);assert.equal(f.commits.length,n+2);assert.equal(f.collection.saved(),true);
});
test('replacing getDB with incomplete old collection can equip safely and preserve unknown once',async()=>{
 const {createDailyCollection}=await app();let db=fresh(),saves=0;const collection=createDailyCollection({getDB:()=>db,getWords:()=>WORDS,now:()=>at('2026-10-03'),persist:()=>{saves++;return true}});
 db={...fresh(),dailyCollection:{cosmetics:['leaf-ribbon'],unknown:{keep:true}},activeRun:{hp:8},future:'kept'};
 assert.equal(collection.equip('leaf-ribbon'),true);assert.equal(saves,1);assert.equal(db.dailyCollection.equipped.partner,'leaf-ribbon');assert.deepEqual(db.dailyCollection.unknown,{keep:true});assert.deepEqual(db.activeRun,{hp:8});assert.equal(db.future,'kept');
});
