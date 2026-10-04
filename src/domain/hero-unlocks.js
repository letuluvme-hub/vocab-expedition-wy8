import {HERO_UNLOCKS,HERO_UNLOCK_ORDER,LEGACY_HERO_UNLOCKS,HERO_METRIC_LABELS} from '../data/hero-unlocks.js';
const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
const METRICS=Object.keys(HERO_METRIC_LABELS);
const snapshot=stats=>Object.fromEntries(METRICS.map(k=>[k,count(stats?.[k])]));
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const met=(rules,stats)=>rules.every(([m,t])=>count(stats?.[m])>=t);
// heroUnlocks: {heroId: 解锁那一刻的 heroStats 快照}。记下来的角色永久解锁，以后调高门槛也不收回。
// 只认 HERO_UNLOCK_ORDER 里的 id；存档里别的键和快照里多出的字段原样保留（新版客户端写的东西不能被旧版抹掉）。
const unlockedIn=(unlocks,id)=>Object.hasOwn(unlocks,id)&&isObj(unlocks[id]);
function initializeUnlocks(db,stats){
 if(!isObj(db.heroUnlocks)){
  // 老存档第一次迁移：按旧门槛认定的角色全部保留。
  db.heroUnlocks={};
  for(const id of HERO_UNLOCK_ORDER)if(met(LEGACY_HERO_UNLOCKS[id],stats))db.heroUnlocks[id]=snapshot(stats);
 }
 if(!unlockedIn(db.heroUnlocks,'scholar'))db.heroUnlocks.scholar=snapshot(stats);
 return db.heroUnlocks;
}
export function initializeHeroProgress(db){
 if(!isObj(db.heroStats)){
  const keys=new Set((Array.isArray(db.mastered)?db.mastered:[]).filter(w=>typeof w==='string').map(w=>w.trim().toLowerCase()).filter(Boolean));
  db.heroStats={words:keys.size,cleanWords:0,kills:0,damage:0,healing:0};
 }
 for(const key of METRICS)db.heroStats[key]=count(db.heroStats[key]);
 initializeUnlocks(db,db.heroStats);
 return db.heroStats;
}
function latchMet(db){
 for(const id of HERO_UNLOCK_ORDER)if(!unlockedIn(db.heroUnlocks,id)&&met(HERO_UNLOCKS[id],db.heroStats))db.heroUnlocks[id]=snapshot(db.heroStats);
}
export function recordHeroProgress(db,key,amount=1){
 if(!Object.hasOwn(HERO_METRIC_LABELS,key)||!Number.isFinite(amount)||typeof amount!=='number'||amount<=0)return false;
 const stats=initializeHeroProgress(db),add=Math.floor(amount);if(!add)return false;
 stats[key]=Math.min(Number.MAX_SAFE_INTEGER,stats[key]+add);latchMet(db);return true;
}
// 返回 {unlocked, requirements}。requirements.current 是累计统计。只读，不改存档。
export function heroUnlockState(db,id){
 const rules=Object.hasOwn(HERO_UNLOCKS,id)?HERO_UNLOCKS[id]:null;if(!rules)return {unlocked:false,requirements:[]};
 const stats=db?.heroStats||{},unlocks=isObj(db?.heroUnlocks)?db.heroUnlocks:{};
 const requirements=rules.map(([metric,target])=>({metric,target,current:count(stats[metric]),label:HERO_METRIC_LABELS[metric]}));
 return {unlocked:id==='scholar'||unlockedIn(unlocks,id)||requirements.every(r=>r.current>=r.target),requirements};
}
export function availableHeroId(db,id){return heroUnlockState(db,id).unlocked?id:'scholar';}
