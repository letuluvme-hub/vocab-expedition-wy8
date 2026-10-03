// Cosmetic collection and calendar facts only. No combat values or browser APIs.
import { dictationWordKey } from './dictation.js';
import { shanghaiDate, addDays } from './daily-learning.js';

export const PARTNER_STAGES = Object.freeze([
  {required:0,name:'初醒'}, {required:5,name:'发芽'}, {required:20,name:'结叶'},
  {required:50,name:'微光'}, {required:100,name:'流星'}, {required:200,name:'星冠'},
].map(Object.freeze));
export const COSMETICS = Object.freeze([
  {id:'leaf-ribbon',type:'partner',name:'叶间丝带'},
  {id:'sky-scarf',type:'partner',name:'晴空围巾'},
  {id:'star-pin',type:'partner',name:'小星徽针'},
  {id:'dawn-frame',type:'frame',name:'晨曦卡框'},
  {id:'mint-frame',type:'frame',name:'薄荷卡框'},
  {id:'night-frame',type:'frame',name:'夜星卡框'},
].map(Object.freeze));
export const CARD_LABELS = Object.freeze(['未收集','见过','练过','默写对','复习稳固']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (map,key) => object(map) && Object.hasOwn(map,key) ? map[key] : undefined;
const put = (map,key,value) => Object.defineProperty(map,key,{value,enumerable:true,configurable:true,writable:true});
const validDate = date => {
  try { return typeof date==='string' && addDays(date,0)===date; } catch { return false; }
};
const identities = values => new Set((Array.isArray(values)?values:[]).map(dictationWordKey).filter(Boolean));
const signed = (collection,date) => ['practice','makeup'].includes(own(collection?.checkins,date));
const cosmetic = id => COSMETICS.find(c=>c.id===id);
const currentStage = count => PARTNER_STAGES.reduce((stage,item,index)=>count>=item.required?index:stage,0);

export function initializeCollection(db) {
  if (!object(db.dailyCollection)) db.dailyCollection = {};
  const c=db.dailyCollection;
  if (c.schemaVersion===undefined) c.schemaVersion=1;
  for(const key of ['checkins','makeupWeeks','gifts','equipped']) if(!object(c[key])) c[key]={};
  if(!Array.isArray(c.cosmetics))c.cosmetics=[];
  if(!Array.isArray(c.unlockedStages))c.unlockedStages=[0];
  syncPartner(db);return c;
}
export function syncPartner(db) {
  if(!object(db.dailyCollection))return initializeCollection(db);
  const c=db.dailyCollection;if(!Array.isArray(c.unlockedStages))c.unlockedStages=[0];
  const stage=currentStage(identities(db.dictationMastered).size);
  for(let i=0;i<=stage;i++)if(!c.unlockedStages.includes(i))c.unlockedStages.push(i);
  return c;
}
export function weekStart(date) {
  const validated=addDays(date,0),day=new Date(`${validated}T00:00:00Z`).getUTCDay();
  return addDays(validated,-((day+6)%7));
}
function firstDate(c) {
  const real=Object.keys(object(c?.checkins)?c.checkins:{}).filter(d=>validDate(d)&&own(c.checkins,d)==='practice').sort();
  return [real[0],validDate(c?.firstCheckinDate)?c.firstCheckinDate:null].filter(Boolean).sort()[0];
}
function checkinView(c,date) {
  let cursor=signed(c,date)?date:addDays(date,-1),streak=0;
  while(signed(c,cursor)){streak++;cursor=addDays(cursor,-1);}
  const first=firstDate(c),week=weekStart(date),used=own(c?.makeupWeeks,week)!==undefined;
  const candidates=[];
  if(first&&!used)for(let i=1;i<=7;i++){const target=addDays(date,-i);if(target>=first&&!signed(c,target))candidates.push(target);}
  return {date,checkedToday:signed(c,date),streak,week,makeupUsed:used,candidates,firstCheckinDate:first||null};
}
export function collectionView(db,at) {
  const c=object(db.dailyCollection)?db.dailyCollection:{},count=identities(db.dictationMastered).size;
  const stages=Array.isArray(c.unlockedStages)?c.unlockedStages:[];
  const stage=Math.max(currentStage(count),...stages.filter(n=>Number.isInteger(n)&&n>=0&&n<PARTNER_STAGES.length),0);
  const next=PARTNER_STAGES[stage+1],owned=Array.isArray(c.cosmetics)?c.cosmetics:[],equipped={};
  for(const type of ['partner','frame']){const item=cosmetic(c.equipped?.[type]);equipped[type]=item?.type===type&&owned.includes(item.id)?item.id:null;}
  const date=shanghaiDate(at),gift=own(c.gifts,date);
  return {partner:{name:'墨芽',count,stage,stageName:PARTNER_STAGES[stage].name,nextName:next?.name||null,remaining:next?Math.max(0,next.required-count):0,
    unlockedStages:[...new Set([...stages.filter(n=>Number.isInteger(n)&&n>=0&&n<PARTNER_STAGES.length),currentStage(count)])].sort((a,b)=>a-b)},
    cosmetics:COSMETICS.filter(c=>owned.includes(c.id)).map(c=>({...c})),equipped,
    checkin:checkinView(c,date),gift:object(gift)?{...gift,cosmetic:cosmetic(gift.cosmeticId)?{...cosmetic(gift.cosmeticId)}:null}:null};
}
export function completeCollection(db,{at,practiced,random}) {
  const c=initializeCollection(db);if(!practiced)return {awarded:false};
  const date=shanghaiDate(at);
  if(!signed(c,date))put(c.checkins,date,'practice');
  c.firstCheckinDate=[firstDate(c),date].filter(Boolean).sort()[0];
  if(Object.hasOwn(c.gifts,date))return {awarded:false};
  const fresh=COSMETICS.filter(item=>!c.cosmetics.includes(item.id)),pool=fresh.length?fresh:COSMETICS;
  const value=random(),roll=Number.isFinite(value)?Math.min(0.999999999,Math.max(0,value)):0;
  const item=pool[Math.floor(roll*pool.length)],repeated=!fresh.length;
  if(!c.cosmetics.includes(item.id))c.cosmetics.push(item.id);
  put(c.gifts,date,{cosmeticId:item.id,repeated});
  return {awarded:true,cosmetic:{...item},repeated};
}
export function applyMakeup(db,date,at) {
  const today=shanghaiDate(at),c=object(db.dailyCollection)?db.dailyCollection:{},view=checkinView(c,today);
  if(!validDate(date)||!view.candidates.includes(date))return {ok:false,reason:view.makeupUsed?'本周已补签一次':'请选择最近 7 天内使用后的漏签日'};
  const value=initializeCollection(db);put(value.checkins,date,'makeup');put(value.makeupWeeks,view.week,date);
  return {ok:true,date};
}
export function equipCosmetic(db,id,type) {
  const c=object(db.dailyCollection)?db.dailyCollection:null;
  if(id==='none'&&['partner','frame'].includes(type)){if(!c)return false;initializeCollection(db).equipped[type]=null;return true;}
  const item=cosmetic(id);if(!c||!item||!Array.isArray(c.cosmetics)||!c.cosmetics.includes(id))return false;
  initializeCollection(db).equipped[item.type]=id;return true;
}
export function cardLevel(db,word) {
  const key=dictationWordKey(word);if(!key)return 0;
  if(identities(db.dictationMastered).has(key)){
    const review=own(db.reviewSchedule,key);return review?.stable===true&&review.pendingFailure!==true?4:3;
  }
  const exposure=own(db.wordExposure,key);
  if(exposure?.practiced===true||identities(db.mastered).has(key))return 2;
  return exposure?.seen===true?1:0;
}
export function atlasCards(db,words,unit) {
  const source=Array.isArray(words)?words:[],original=new Set(source.map(dictationWordKey));
  let pool;
  if(unit===0){
    const seen=new Set();pool=[];
    const currentEntries=(Array.isArray(db.custom)?db.custom:[]).map(word=>({word,isCurrent:true}));
    const history=Object.values(object(db.wordExposure)?db.wordExposure:{}).map(entry=>({word:entry?.word,isCurrent:false}));
    for(const {word,isCurrent} of [...currentEntries,...history]){
      const key=dictationWordKey(word);
      if(!key||!object(word)||typeof word.z!=='string'||seen.has(key)||!isCurrent&&original.has(key)&&Number.isInteger(word.u)&&word.u>0)continue;
      seen.add(key);pool.push(word);
    }
  }else pool=unit===undefined?source:source.filter(word=>word.u===unit);
  return pool.map(word=>{const level=cardLevel(db,word);return {word:{...word},key:dictationWordKey(word),level,label:CARD_LABELS[level]};});
}
