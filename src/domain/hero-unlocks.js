import {HERO_UNLOCKS,HERO_METRIC_LABELS} from '../data/hero-unlocks.js';
const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
export function initializeHeroProgress(db){
 if(!db.heroStats || typeof db.heroStats!=='object' || Array.isArray(db.heroStats)){
  const keys=new Set((Array.isArray(db.mastered)?db.mastered:[]).filter(w=>typeof w==='string').map(w=>w.trim().toLowerCase()).filter(Boolean));
  db.heroStats={words:keys.size,cleanWords:0,kills:0,damage:0,healing:0};
 }
 for(const key of Object.keys(HERO_METRIC_LABELS))db.heroStats[key]=count(db.heroStats[key]);
 return db.heroStats;
}
export function recordHeroProgress(db,key,amount=1){
 if(!Object.hasOwn(HERO_METRIC_LABELS,key)||!Number.isFinite(amount)||typeof amount!=='number'||amount<=0)return false;
 const stats=initializeHeroProgress(db),add=Math.floor(amount);if(!add)return false;
 stats[key]=Math.min(Number.MAX_SAFE_INTEGER,stats[key]+add);return true;
}
export function heroUnlockState(db,id){
 const rules=Object.hasOwn(HERO_UNLOCKS,id)?HERO_UNLOCKS[id]:null;if(!rules)return {unlocked:false,requirements:[]};
 const stats=db?.heroStats||{};
 const requirements=rules.map(([metric,target])=>({metric,target,current:count(stats[metric]),label:HERO_METRIC_LABELS[metric]}));
 return {unlocked:requirements.every(r=>r.current>=r.target),requirements};
}
export function availableHeroId(db,id){return heroUnlockState(db,id).unlocked?id:'scholar';}
