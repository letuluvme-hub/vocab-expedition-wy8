import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeLearning, recordExposure, recordPractice, recordReviewFailure,
  recordReviewSuccess, dueReviewWords, todayReport } from '../../src/domain/daily-learning.js';
import { cardLevel, atlasCards, collectionView } from '../../src/domain/daily-collection.js';
import { createDailyLearning } from '../../src/app/daily-learning.js';
import { createDailyCollection } from '../../src/app/daily-collection.js';
import { createDailyDictationController } from '../../src/app/daily-dictation.js';
import { createDailyCollectionView } from '../../src/ui/components/daily-collection.js';

const upper = { w:'rest', z:'休息', u:1 };
const lower = { w:'rest', z:'其余部分', u:1, bookId:'wy8b' };
const stamp = Date.parse('2026-10-04T04:00:00Z');
const fresh = () => ({ mastered:[], dictationMastered:[], reviewQueue:[], custom:[] });

test('same spelling in two books has independent exposure, card level and formal evidence', () => {
  const db=fresh();recordExposure(db,upper,true);
  assert.equal(cardLevel(db,upper),2);assert.equal(cardLevel(db,lower),0);
  db.dictationMastered=['rest'];db.reviewSchedule={rest:{stable:true,pendingFailure:false}};
  assert.equal(cardLevel(db,upper),4);assert.equal(cardLevel(db,lower),0);
  recordExposure(db,lower,true);assert.equal(cardLevel(db,lower),2);
  assert.deepEqual(Object.keys(db.wordExposure).sort(),['rest','wy8b:rest']);
  db.dictationMastered.push({...lower});db.reviewSchedule['wy8b:rest']={stable:false};
  assert.equal(cardLevel(db,lower),3);assert.equal(collectionView(db,stamp).partner.count,2);
});

test('a lower-book failure removes only its formal mastery and keeps the upper-book schedule', () => {
  const db=fresh();db.dictationMastered=['REST',{...lower}];
  db.reviewSchedule={rest:{word:upper,intervalIndex:4,dueDate:'2026-10-04',stable:true,pendingFailure:false}};
  const saved=structuredClone(db.reviewSchedule.rest);
  recordReviewFailure(db,{word:lower,at:stamp,token:'lower-failure'});
  assert.deepEqual(db.dictationMastered,['REST']);assert.deepEqual(db.reviewSchedule.rest,saved);
  assert.deepEqual(db.reviewQueue,[{...lower}]);
  assert.equal(db.reviewSchedule['wy8b:rest'].dueDate,'2026-10-05');
  assert.deepEqual(dueReviewWords(db,stamp),[upper]);
  recordReviewSuccess(db,{word:lower,at:stamp+86400000,token:'lower-clean'});
  assert.deepEqual(db.reviewQueue,[]);assert.equal(db.reviewSchedule.rest.intervalIndex,4);
});

test('daily reports count same-spelling words from both books separately without changing old keys', () => {
  const db=fresh();recordPractice(db,upper,stamp);recordPractice(db,lower,stamp);
  recordPractice(db,lower,stamp+1);
  assert.equal(todayReport(db,stamp).practicedWords,2);
  assert.deepEqual(Object.keys(db.dailyReports.days['2026-10-04'].words).sort(),['rest','wy8b:rest']);
});

test('legacy and new review evidence migrate with the correct book meaning and unknown fields intact', () => {
  const db=fresh();db.reviewQueue=['REST',{...lower}];db.activeRun={unknown:'paused'};
  initializeLearning(db,[upper,lower],stamp);
  assert.deepEqual(dueReviewWords(db,stamp),[upper,lower]);
  assert.equal(db.reviewSchedule['wy8b:rest'].word.z,'其余部分');
  assert.deepEqual(db.activeRun,{unknown:'paused'});
});

test('custom atlas excludes both textbook books even when the current atlas is the other book', () => {
  const db=fresh();const custom={w:'dragonfruit',z:'火龙果',u:0};
  db.custom=[custom];recordExposure(db,upper,true);recordExposure(db,lower,true);
  recordExposure(db,{w:'hobby',z:'爱好',u:2,bookId:'wy8b'},true);
  recordExposure(db,{w:'old custom',z:'旧自定义',u:0},true);
  assert.deepEqual(atlasCards(db,[upper],0).map(c=>c.word.w),['dragonfruit','old custom']);
  assert.deepEqual(atlasCards(db,[lower],0).map(c=>c.word.w),['dragonfruit','old custom']);
});

test('atlas initially follows the current home book, but an explicit atlas choice stays independent', () => {
  const doc={createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag)};
  const host=new Element('main'),db=fresh(),collection=createDailyCollection({getDB:()=>db,getWords:()=>[upper],now:()=>stamp});
  let currentBook='wy8b';const ui=createDailyCollectionView({host,document:doc,getView:collection.view,getBook:()=>currentBook,getCards:()=>[]});
  ui.paint();host.querySelector('#dailyAtlasToggle').onclick();assert.equal(host.querySelector('#dailyAtlasBook').value,'wy8b');
  const select=host.querySelector('#dailyAtlasBook');select.value='wy8a';select.onchange();
  currentBook='wy8b';ui.paint();assert.equal(host.querySelector('#dailyAtlasBook').value,'wy8a');
  assert.equal(currentBook,'wy8b');
});

test('collection controller requests the selected book and never changes paused session or expedition', () => {
  const db=fresh();db.dailySession={bookId:'wy8a',paused:true};db.activeRun={run:{bookId:'wy8b'}};
  const before=structuredClone(db),requests=[];
  const collection=createDailyCollection({getDB:()=>db,getWords:(unit,bookId)=>{requests.push([unit,bookId]);return bookId==='wy8b'?[lower]:[upper];},now:()=>stamp});
  const paused=structuredClone({dailySession:db.dailySession,activeRun:db.activeRun});
  const cards=collection.cards(1,'wy8b');assert.equal(cards[0].word.z,'其余部分');
  assert.equal(cards[0].key,'wy8b:rest');assert.deepEqual(requests,[[undefined,'wy8b']]);
  assert.deepEqual({dailySession:db.dailySession,activeRun:db.activeRun},paused);
  assert.deepEqual(db.dailySession,before.dailySession);
});

function setupDaily(db=fresh()) {
  const requests=[];
  const learning=createDailyLearning({getDB:()=>db,getWords:()=>[upper,lower],now:()=>stamp});
  const controller=createDailyDictationController({getDB:()=>db,getWords:(unit,bookId)=>{
    requests.push([unit,bookId]);return bookId==='wy8b'?[lower]:[upper];},
    now:()=>stamp,random:()=>0.2,persist:()=>true,...learning.ports});
  return {db,controller,requests,learning};
}
function warm(controller) {
  for(const word of controller.state().words){for(const ch of word.w.replace(/[^a-z]/g,''))controller.input(ch);controller.next();}
  controller.beginFormal();
}

test('daily session freezes lower-book range, keeps spelling bare, and restores scoped mastery', () => {
  const x=setupDaily();assert.equal(x.controller.start({unit:1,bookId:'wy8b'}),true);
  assert.equal(x.controller.state().bookId,'wy8b');assert.deepEqual(x.requests,[[1,'wy8b']]);
  warm(x.controller);assert.equal(x.controller.state().attempt.target,'rest');
  x.controller.pause();const resumed=setupDaily(structuredClone(x.db));resumed.controller.resume();
  for(const ch of 'rest')resumed.controller.input(ch);resumed.controller.next();
  assert.equal(cardLevel(resumed.db,lower),3);assert.equal(cardLevel(resumed.db,upper),0);
  assert.equal(resumed.db.dailySession.results[0].key,'wy8b:rest');
  assert.deepEqual(resumed.db.dictationMastered,[lower]);assert.deepEqual(resumed.db.mastered,[lower]);
});

test('daily failure and deferred result remain scoped to the book after a refresh', () => {
  const x=setupDaily();x.db.dictationMastered=['rest'];
  x.db.reviewSchedule.rest={word:upper,intervalIndex:4,dueDate:'2026-10-05',stable:true};
  x.controller.start({unit:1,bookId:'wy8b'});warm(x.controller);x.controller.input('x');
  assert.deepEqual(x.db.reviewQueue,[lower]);assert.deepEqual(x.db.dictationMastered,['rest']);
  x.controller.pause();const resumed=setupDaily(structuredClone(x.db));resumed.controller.resume();
  assert.equal(resumed.controller.defer(),true);assert.equal(resumed.controller.summary().deferred,1);
  assert.equal(resumed.db.dailySession.results[0].key,'wy8b:rest');
  assert.equal(resumed.learning.report().formalAttempts,1);
});

test('a due word from the other book can coexist with the same-spelling selected word through warmup and formal restore', () => {
  const x=setupDaily();x.db.reviewQueue=['rest'];
  assert.equal(x.controller.start({unit:1,bookId:'wy8b'}),true);
  assert.deepEqual(x.controller.state().words,[upper,lower]);assert.deepEqual(x.controller.state().reviewKeys,['rest']);
  warm(x.controller);assert.deepEqual(x.db.dailySession.warmupDone,['rest','wy8b:rest']);
  for(const ch of 'rest')x.controller.input(ch);x.controller.next();
  assert.equal(x.controller.state().words[x.controller.state().index].bookId,'wy8b');
  x.controller.pause();const resumed=setupDaily(structuredClone(x.db));assert.equal(resumed.controller.resume(),true);
  for(const ch of 'rest')resumed.controller.input(ch);resumed.controller.next();
  assert.deepEqual(resumed.db.dailySession.results.map(r=>r.key),['rest','wy8b:rest']);
  assert.deepEqual(resumed.db.dictationMastered,['rest',lower]);
  assert.equal(resumed.learning.report().practicedWords,2);assert.equal(resumed.learning.report().formalAttempts,2);
  assert.equal(cardLevel(resumed.db,upper),3);assert.equal(cardLevel(resumed.db,lower),3);
});

test('daily cursor and carry from one textbook book do not advance or replace the other book', () => {
  const x=setupDaily();x.db.dailyCursor={1:0,'wy8b:1':7};
  x.controller.start({unit:1,bookId:'wy8b'});warm(x.controller);
  for(const ch of 'rest')x.controller.input(ch);x.controller.next();
  const upperCursor=x.db.dailyCursor[1];assert.equal(x.controller.start({unit:1,bookId:'wy8a'}),true);
  assert.equal(x.controller.state().words[0].z,'休息');assert.equal(x.controller.state().bookId??'wy8a','wy8a');
  assert.equal(upperCursor,0);assert.equal(x.db.dailyCursor['wy8b:1'],0);
});

class Element {
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this._text='';}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  setAttribute(key,value){this.attributes[key]=String(value);}
  querySelector(selector){return this.children.flatMap(c=>[c,...descendants(c)]).find(c=>selector[0]==='#'?c.id===selector.slice(1):false)||null;}
}
const descendants = root => root.children.flatMap(c=>[c,...descendants(c)]);
test('atlas exposes upper/lower book selection locally, then shows that book unit cards', () => {
  const doc={createElement:tag=>new Element(tag),createElementNS:(_ns,tag)=>new Element(tag)};
  const host=new Element('main'),calls=[],collection=createDailyCollection({getDB:()=>fresh(),getWords:()=>[upper],now:()=>stamp});
  const ui=createDailyCollectionView({host,document:doc,getView:collection.view,getCards:(unit,bookId)=>{
    calls.push([unit,bookId]);return [{word:bookId==='wy8b'?lower:upper,key:'rest',level:0,label:'未收集'}];}});
  ui.paint();host.querySelector('#dailyAtlasToggle').onclick();
  const select=host.querySelector('#dailyAtlasBook');assert.ok(select);
  assert.deepEqual(select.children.map(n=>n.value),['wy8a','wy8b']);
  select.value='wy8b';select.onchange();
  assert.deepEqual(calls.at(-1),[1,'wy8b']);assert.match(host.querySelector('#dailyAtlasCards').textContent,/其余部分/);
  host.querySelector('#dailyAtlasUnit').value='6';host.querySelector('#dailyAtlasUnit').onchange();
  assert.deepEqual(calls.at(-1),[6,'wy8b']);
  ui.paint();assert.equal(host.querySelector('#dailyAtlasBook').value,'wy8b');
});
