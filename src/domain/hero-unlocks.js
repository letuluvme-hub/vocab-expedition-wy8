import {HERO_UNLOCKS,HERO_UNLOCK_ORDER,LEGACY_HERO_UNLOCKS,HERO_METRIC_LABELS} from '../data/hero-unlocks.js';
const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
const METRICS=Object.keys(HERO_METRIC_LABELS);
const snapshot=stats=>Object.fromEntries(METRICS.map(k=>[k,count(stats?.[k])]));
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const met=(rules,stats,base)=>rules.every(([m,t])=>count(stats[m])-count(base?.[m])>=t);
// heroUnlocks: {heroId: 解锁那一刻的 heroStats 快照}。快照是下一位角色的计数起点。
function initializeUnlocks(db,stats){
 if(!isObj(db.heroUnlocks)){
  // 老存档第一次迁移：按旧累计门槛认定的角色全部保留，起点都记为现在。
  db.heroUnlocks={};
  for(const id of HERO_UNLOCK_ORDER)if(met(LEGACY_HERO_UNLOCKS[id],stats,null))db.heroUnlocks[id]=snapshot(stats);
 }
 for(const id of Object.keys(db.heroUnlocks)){
  if(!Object.hasOwn(HERO_UNLOCKS,id)||!isObj(db.heroUnlocks[id]))delete db.heroUnlocks[id];
  else db.heroUnlocks[id]=snapshot(db.heroUnlocks[id]);
 }
 if(!db.heroUnlocks.scholar)db.heroUnlocks.scholar=snapshot(stats);
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
// 顺着解锁链检查下一位；一次最多开一位，新角色的起点就是当前统计，不会连锁。
function latchNext(db){
 const unlocks=db.heroUnlocks,stats=db.heroStats;
 for(let i=1;i<HERO_UNLOCK_ORDER.length;i++){
  const id=HERO_UNLOCK_ORDER[i],prev=HERO_UNLOCK_ORDER[i-1];
  if(unlocks[id]||!unlocks[prev])continue;
  if(met(HERO_UNLOCKS[id],stats,unlocks[prev])){unlocks[id]=snapshot(stats);return id}
  return null;
 }
 return null;
}
export function recordHeroProgress(db,key,amount=1){
 if(!Object.hasOwn(HERO_METRIC_LABELS,key)||!Number.isFinite(amount)||typeof amount!=='number'||amount<=0)return false;
 const stats=initializeHeroProgress(db),add=Math.floor(amount);if(!add)return false;
 stats[key]=Math.min(Number.MAX_SAFE_INTEGER,stats[key]+add);latchNext(db);return true;
}
// 返回 {unlocked, requirements, waitingFor}。requirements.current 是上一位解锁后新增的量；
// waitingFor 是还没解锁的上一位角色 id（此时本角色不计数）。只读，不改存档。
export function heroUnlockState(db,id){
 const rules=Object.hasOwn(HERO_UNLOCKS,id)?HERO_UNLOCKS[id]:null;if(!rules)return {unlocked:false,requirements:[]};
 const stats=db?.heroStats||{},unlocks=isObj(db?.heroUnlocks)?db.heroUnlocks:{};
 const i=HERO_UNLOCK_ORDER.indexOf(id),prev=i>0?HERO_UNLOCK_ORDER[i-1]:null;
 const unlocked=id==='scholar'||isObj(unlocks[id]);
 const prevUnlocked=prev==='scholar'||isObj(unlocks[prev]);
 const base=prevUnlocked?unlocks[prev]:null,waitingFor=!unlocked&&!prevUnlocked?prev:null;
 const requirements=rules.map(([metric,target])=>({metric,target,label:HERO_METRIC_LABELS[metric],
  current:unlocked?target:prevUnlocked?Math.max(0,count(stats[metric])-count(base?.[metric])):0}));
 return {unlocked,requirements,waitingFor};
}
export function availableHeroId(db,id){return heroUnlockState(db,id).unlocked?id:'scholar';}
