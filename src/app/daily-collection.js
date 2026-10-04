import { shanghaiDate } from '../domain/daily-learning.js';
import { initializeCollection, syncPartner, collectionView, atlasCards, completeCollection,
  applyMakeup, equipCosmetic } from '../domain/daily-collection.js';

// Events compose after the learning ledger, before its existing single save.
export function createDailyCollection({getDB,getWords,now=Date.now,random=Math.random,persist=()=>false,onChange=()=>{}}={}) {
  initializeCollection(getDB());let saved=null;
  function practiced({session,at}) {
    if(!session.collection||typeof session.collection!=='object'||Array.isArray(session.collection))session.collection={};
    if(!Array.isArray(session.collection.practicedDates))session.collection.practicedDates=[];
    const date=shanghaiDate(at);if(!session.collection.practicedDates.includes(date))session.collection.practicedDates.push(date);
  }
  function commit() {
    try{const result=persist(getDB());saved=result===true||result?.ok===true;}catch{saved=false;}
    onChange();
  }
  return {view:()=>collectionView(getDB(),now()),cards:(unit,bookId)=>atlasCards(getDB(),getWords(undefined,bookId),unit),saved:()=>saved,
    equip:(id,type)=>{if(!equipCosmetic(getDB(),id,type))return false;commit();return true;},
    makeup:date=>{const result=applyMakeup(getDB(),date,now());if(result.ok)commit();return result;},
    ports:{onPractice:practiced,onFailure:practiced,onAttempt:({db})=>syncPartner(db),
      onComplete:({session,db,at})=>completeCollection(db,{at,practiced:session.collection?.practicedDates?.includes(shanghaiDate(at))===true,random})},
  };
}
