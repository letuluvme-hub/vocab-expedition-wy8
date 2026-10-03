import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyDictationController } from '../../src/app/daily-dictation.js';
import { createDailyLearning } from '../../src/app/daily-learning.js';
import { createDailyCollection } from '../../src/app/daily-collection.js';
import { restoreDailySession } from '../../src/domain/daily-session.js';
import { shanghaiDate, addDays } from '../../src/domain/daily-learning.js';

const cat={w:'cat',z:'猫'},dog={w:'dog',z:'狗'},pig={w:'pig',z:'猪'};
function setup(words=[cat,dog,pig], initial={}) {
  let at=Date.parse('2026-10-03T04:00:00Z'), saves=0, attempts=0, finishes=0;
  const db={mastered:[],dictationMastered:[],reviewQueue:[],...initial};
  const learning=createDailyLearning({getDB:()=>db,getWords:()=>words,now:()=>at});
  const collection=createDailyCollection({getDB:()=>db,getWords:()=>words,now:()=>at,random:()=>0.2});
  const c=createDailyDictationController({getDB:()=>db,getWords:()=>words,now:()=>at,random:()=>0.2,
    ...learning.ports,persist:()=>{saves++;return true},
    onPractice:e=>{learning.ports.onPractice(e);collection.ports.onPractice(e)},
    onFailure:e=>{learning.ports.onFailure(e);collection.ports.onFailure(e)},
    onAttempt:e=>{attempts++;learning.ports.onAttempt(e);collection.ports.onAttempt(e)},
    onComplete:e=>{finishes++;learning.ports.onComplete(e);collection.ports.onComplete(e)}});
  return {c,db,learning,saves:()=>saves,attempts:()=>attempts,finishes:()=>finishes,now:()=>at,advance:n=>at+=n};
}
const spell=(c,w)=>{for(const ch of w)c.input(ch)};
function formal(c,words) {c.start({unit:1});for(const w of words){spell(c,w.w);c.next()}c.beginFormal()}

test('defer is unavailable in warmup, formal-ready, clean halfword or fullword',()=>{
  const {c}=setup([cat]);c.start({unit:1});assert.equal(c.defer(),false);
  spell(c,'cat');c.next();assert.equal(c.defer(),false);c.beginFormal();c.input('c');assert.equal(c.defer(),false);
  spell(c,'at');assert.equal(c.defer(),false);assert.equal(c.summary().completed,1);
});
test('correctword then failedword can defer and continue without losing earlier mastery',()=>{
  const x=setup();formal(x.c,[cat,dog,pig]);spell(x.c,'cat');x.c.next();x.c.input('x');x.c.input('d');
  assert.equal(x.c.defer(),true);assert.equal(x.c.state().words[x.c.state().index].w,'pig');
  assert.deepEqual(x.db.dictationMastered,['cat']);assert.equal(x.attempts(),2);
  assert.deepEqual(x.c.state().results[1],{key:'dog',word:dog,eligible:false,completed:false,deferred:true,input:'d',errors:1,hints:0,reveals:0,assistance:[],deferredAt:x.now()});
  spell(x.c,'pig');x.c.next();assert.deepEqual(x.db.dictationMastered,['cat','pig']);
  assert.equal(x.c.summary().completed,2);assert.equal(x.c.summary().deferred,1);assert.equal(x.c.summary().assessed,3);
  assert.equal(x.c.summary().firstTry,2);assert.deepEqual(x.c.summary().wrong,[dog]);assert.equal(x.attempts(),3);
  const report=x.learning.report();assert.equal(report.formalAttempts,3);assert.equal(report.firstTry,2);assert.equal(report.sessionsCompleted,1);
});
for(const kind of ['hint','prophecy','vision'])test(`${kind} may defer, never credit, and assessment stays exactly once`,()=>{
  const x=setup([cat]);formal(x.c,[cat]);x.c.assist(kind);assert.equal(x.c.defer(),true);
  assert.deepEqual(x.db.dictationMastered,[]);assert.deepEqual(x.db.reviewQueue,['cat']);assert.equal(x.c.summary().completed,0);
  assert.equal(x.c.summary().deferred,1);assert.equal(x.c.summary().assessed,1);assert.equal(x.c.state().phase,'completed');
  assert.equal(x.c.defer(),false);assert.equal(x.c.next(),false);assert.equal(x.c.finish(),false);
  assert.equal(x.attempts(),1);assert.equal(x.finishes(),1);assert.equal(x.learning.report().formalAttempts,1);
  assert.equal(x.db.reviewSchedule.cat.dueDate,addDays(shanghaiDate(x.now()),1));
});
test('due failed review resets to one day and removes mastery even when deferred',()=>{
  const x=setup([cat,dog],{dictationMastered:['cat'],reviewSchedule:{cat:{word:cat,intervalIndex:4,dueDate:'2026-10-03',stable:true,pendingFailure:false}}});
  formal(x.c,[cat,dog]);x.c.input('a');x.c.defer();assert.deepEqual(x.db.dictationMastered,[]);
  assert.equal(x.db.reviewSchedule.cat.intervalIndex,0);assert.equal(x.db.reviewSchedule.cat.stable,false);
  assert.equal(x.db.reviewSchedule.cat.dueDate,'2026-10-04');assert.equal(x.learning.report().formalAttempts,1);
});
test('failed halfword finished manually is included in assessment denominator, clean halfword is not',()=>{
  for(const failed of [true,false]) {const x=setup([cat,dog]);formal(x.c,[cat,dog]);spell(x.c,'cat');x.c.next();x.c.input(failed?'x':'d');x.c.finish();
    assert.equal(x.c.summary().completed,1);assert.equal(x.c.summary().deferred,0);assert.equal(x.c.summary().assessed,failed?2:1);
    assert.equal(x.c.summary().assessed,x.learning.report().formalAttempts);assert.equal(x.c.summary().firstTry,1);
  }
});
test('many spelling errors cannot cause defeat, replace free battle or clear clean progress',()=>{
  const free={run:{hp:7,done:['old'],future:1},battle:{myHp:7,foeAttack:{phase:'telegraph',remainingMs:1}}};
  const x=setup([cat,dog],{activeRun:free});formal(x.c,[cat,dog]);spell(x.c,'cat');x.c.next();
  for(let i=0;i<100;i++)assert.equal(x.c.input('x'),true);
  assert.equal(x.c.state().phase,'formal');assert.equal(x.c.state().attempt.errors,100);assert.deepEqual(x.db.activeRun,free);
  assert.deepEqual(x.db.dictationMastered,['cat']);x.c.defer();assert.equal(x.c.state().phase,'completed');assert.equal(x.c.summary().completed,1);
});
test('paused or time-budget defer is inert and completed facts survive stop',()=>{
  for(const timed of [false,true]) {const x=setup([cat,dog]);formal(x.c,[cat,dog]);spell(x.c,'cat');x.c.next();x.c.input('x');
    if(timed){x.advance(900001);x.c.checkTime()}else x.c.pause();const before=JSON.stringify(x.db),n=x.saves();
    assert.equal(x.c.defer(),false);assert.equal(JSON.stringify(x.db),before);assert.equal(x.saves(),n);x.c.finish();
    assert.deepEqual(x.db.dictationMastered,['cat']);assert.equal(x.c.summary().assessed,2);assert.equal(x.c.summary().completed,1);
  }
});
test('deferred snapshot restores paused without replay; legacy complete results still count completed',()=>{
  const x=setup();formal(x.c,[cat,dog,pig]);spell(x.c,'cat');x.c.next();x.c.hint();x.c.defer();x.c.pause();
  const raw=JSON.parse(JSON.stringify(x.db));delete raw.dailySession.results[0].completed;
  const reportBefore=JSON.stringify(raw.dailyReports),masterBefore=[...raw.dictationMastered];
  const restored=setup([cat,dog,pig],raw);assert.equal(restored.c.state().paused,true);assert.equal(restored.c.summary().completed,1);assert.equal(restored.c.summary().deferred,1);
  restored.c.resume();spell(restored.c,'pig');restored.c.next();assert.deepEqual(restored.db.dictationMastered,[...masterBefore,'pig']);
  assert.equal(restored.c.summary().completed,2);assert.equal(restored.learning.report().formalAttempts,3);
  assert.notEqual(JSON.stringify(restored.db.dailyReports),reportBefore);assert.equal(restored.attempts(),1);
  assert.equal(restored.db.dailySession.results[2].completed,true);
});
test('deferred restore rejects fake clean credit, failureless skip, complete input and reordered words',()=>{
  const x=setup();formal(x.c,[cat,dog,pig]);spell(x.c,'cat');x.c.next();x.c.input('x');x.c.defer();
  const raw=JSON.parse(JSON.stringify(x.c.state()));
  for(const mutate of [r=>r.eligible=true,r=>r.errors=0,r=>r.completed=true,r=>r.input='dog',r=>r.deferred=false]){
    const corrupt=structuredClone(raw);mutate(corrupt.results[1]);assert.equal(restoreDailySession(corrupt),null);
  }
  const reordered=structuredClone(raw);reordered.results.reverse();assert.equal(restoreDailySession(reordered),null);
  const restored=restoreDailySession(raw);assert.equal(restored.results[1].input,'');assert.equal(restored.phase,'formal');
});
test('undated legacy failed halfword defer records failure now and does not replay on reload',()=>{
  const x=setup([cat,dog]);formal(x.c,[cat,dog]);x.c.input('x');x.c.pause();const raw=structuredClone(x.db);
  delete raw.dailySession.learning;raw.dailyReports={schemaVersion:1,days:{},summary:{}};raw.reviewSchedule={};
  const resumed=setup([cat,dog],raw);resumed.c.resume();resumed.c.defer();assert.equal(resumed.learning.report().formalAttempts,1);
  assert.equal(resumed.db.reviewSchedule.cat.dueDate,'2026-10-04');resumed.c.pause();
  const again=setup([cat,dog],structuredClone(resumed.db));again.c.resume();spell(again.c,'dog');again.c.next();assert.equal(again.learning.report().formalAttempts,2);
});
test('deferred resolved words are excluded from immediate unfinished carry priority',()=>{
  const x=setup();formal(x.c,[cat,dog,pig]);x.c.input('x');x.c.defer();spell(x.c,'dog');x.c.next();x.c.finish();
  x.c.start({unit:1,limit:1});assert.equal(x.c.state().words[0].w,'pig');
});
test('deferring yesterday\'s already assessed error does not invent practice, reward or re-assessment today',()=>{
  const x=setup([cat]);formal(x.c,[cat]);x.c.input('x');x.c.pause();
  const yesterday=shanghaiDate(x.now()),before=structuredClone(x.db.dailyReports.days[yesterday]);
  x.advance(86400000);x.c.resume();assert.equal(x.c.defer(),true);
  const today=shanghaiDate(x.now());assert.deepEqual(x.db.dailyReports.days[yesterday],before);
  assert.equal(x.learning.report().practicedWords,0);assert.equal(x.learning.report().formalAttempts,0);
  assert.equal(x.db.dailyCollection.checkins[today],undefined);assert.equal(x.db.dailyCollection.gifts[today],undefined);
  assert.equal(x.db.reviewSchedule.cat.dueDate,today);assert.equal(x.c.summary().assessed,1);
});
