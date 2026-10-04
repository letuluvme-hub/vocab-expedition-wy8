import {HERO_UNLOCKS,HERO_UNLOCK_ORDER,LEGACY_HERO_UNLOCKS,HERO_METRIC_LABELS} from '../data/hero-unlocks.js';
const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
const METRICS=Object.keys(HERO_METRIC_LABELS);
const snapshot=stats=>Object.fromEntries(METRICS.map(k=>[k,count(stats?.[k])]));
const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const met=(rules,stats,base)=>rules.every(([m,t])=>count(stats[m])-count(base?.[m])>=t);
// heroUnlocks: {heroId: 解锁那一刻的 heroStats 快照}。只认 HERO_UNLOCK_ORDER 里的 id，
// 存档里别的键和快照里多出的字段原样保留（新版客户端写的东西不能被旧版抹掉），读的时候再 count()。
const unlockedIn=(unlocks,id)=>Object.hasOwn(unlocks,id)&&isObj(unlocks[id]);
function initializeUnlocks(db,stats){
 if(!isObj(db.heroUnlocks)){
  // 老存档第一次迁移：按旧累计门槛认定的角色全部保留，起点都记为现在。
  db.heroUnlocks={};
  for(const id of HERO_UNLOCK_ORDER)if(met(LEGACY_HERO_UNLOCKS[id],stats,null))db.heroUnlocks[id]=snapshot(stats);
 }
 if(!unlockedIn(db.heroUnlocks,'scholar'))db.heroUnlocks.scholar=snapshot(stats);
 return db.heroUnlocks;
}
// 解锁前沿：顺序里第一个还没解锁的角色。整条链上只有它在计数，哪怕老存档里它后面有越级保留的角色。
const frontierOf=unlocks=>HERO_UNLOCK_ORDER.find(id=>id!=='scholar'&&!unlockedIn(unlocks,id))||null;
// 计数起点取所有已解锁快照的逐项最大值。统计只增不减，所以这就是最近一次解锁时的统计：
// 前沿刚往前挪，新前沿从这一刻起算，不会把迁移以来攒下的量一并算进去。
const baseOf=unlocks=>Object.fromEntries(METRICS.map(k=>[k,Math.max(0,...HERO_UNLOCK_ORDER.filter(id=>unlockedIn(unlocks,id)).map(id=>count(unlocks[id][k])))]));
export function initializeHeroProgress(db){
 if(!isObj(db.heroStats)){
  const keys=new Set((Array.isArray(db.mastered)?db.mastered:[]).filter(w=>typeof w==='string').map(w=>w.trim().toLowerCase()).filter(Boolean));
  db.heroStats={words:keys.size,cleanWords:0,kills:0,damage:0,healing:0};
 }
 for(const key of METRICS)db.heroStats[key]=count(db.heroStats[key]);
 initializeUnlocks(db,db.heroStats);
 return db.heroStats;
}
// 只检查解锁前沿；一次最多开一位，新前沿的起点就是当前统计，不会连锁。
function latchNext(db){
 const unlocks=db.heroUnlocks,id=frontierOf(unlocks);
 if(id&&met(HERO_UNLOCKS[id],db.heroStats,baseOf(unlocks))){unlocks[id]=snapshot(db.heroStats);return id}
 return null;
}
export function recordHeroProgress(db,key,amount=1){
 if(!Object.hasOwn(HERO_METRIC_LABELS,key)||!Number.isFinite(amount)||typeof amount!=='number'||amount<=0)return false;
 const stats=initializeHeroProgress(db),add=Math.floor(amount);if(!add)return false;
 stats[key]=Math.min(Number.MAX_SAFE_INTEGER,stats[key]+add);latchNext(db);return true;
}
// 返回 {unlocked, requirements, waitingFor}。只有解锁前沿的 requirements.current 是最近一次解锁后新增的量；
// 前沿之后的角色不计数，waitingFor 是它前面最近一位还没解锁的角色。只读，不改存档。
export function heroUnlockState(db,id){
 const rules=Object.hasOwn(HERO_UNLOCKS,id)?HERO_UNLOCKS[id]:null;if(!rules)return {unlocked:false,requirements:[]};
 const stats=db?.heroStats||{},unlocks=isObj(db?.heroUnlocks)?db.heroUnlocks:{};
 const unlocked=id==='scholar'||unlockedIn(unlocks,id),counting=!unlocked&&frontierOf(unlocks)===id;
 const base=counting?baseOf(unlocks):null;
 const waitingFor=unlocked||counting?null:HERO_UNLOCK_ORDER.slice(1,HERO_UNLOCK_ORDER.indexOf(id)).reverse().find(h=>!unlockedIn(unlocks,h))||null;
 const requirements=rules.map(([metric,target])=>({metric,target,label:HERO_METRIC_LABELS[metric],
  current:unlocked?target:counting?Math.max(0,count(stats[metric])-base[metric]):0}));
 return {unlocked,requirements,waitingFor};
}
export function availableHeroId(db,id){return heroUnlockState(db,id).unlocked?id:'scholar';}
