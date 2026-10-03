import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyDictationController } from '../../src/app/daily-dictation.js';
const api = () => import('../../src/domain/daily-learning.js');
const app = () => import('../../src/app/daily-learning.js');
const cat = {w:'cat',z:'猫',u:1}, dog = {w:'dog',z:'狗',u:1};
const stamp = date => Date.parse(`${date}T04:00:00Z`);
const fresh = () => ({mastered:['old practice'],dictationMastered:[],reviewQueue:[],custom:[cat,dog],unknown:{kept:true}});

for (const [iso, date] of [['2026-10-02T15:59:59.999Z','2026-10-02'],['2026-10-02T16:00:00Z','2026-10-03']])
  test(`Shanghai calendar ${iso}`, async () => assert.equal((await api()).shanghaiDate(Date.parse(iso)),date));
test('calendar splits active milliseconds exactly at Shanghai midnight', async()=> {
 const {splitActiveTime}=await api();
 assert.deepEqual(splitActiveTime(Date.parse('2026-10-02T16:00:02Z'),5000),[{date:'2026-10-02',ms:3000},{date:'2026-10-03',ms:2000}]);
});
test('calendar handles leapday and year boundary without local timezone',async()=>{
 const {addDays}=await api(); assert.equal(addDays('2028-02-28',1),'2028-02-29');assert.equal(addDays('2026-12-31',1),'2027-01-01');
});
test('first clean formal answer schedules one day; not yet stable',async()=>{
 const m=await api(),db=fresh();m.recordReviewSuccess(db,{word:cat,at:stamp('2026-10-02'),token:'a'});
 assert.equal(db.reviewSchedule.cat.dueDate,'2026-10-03');assert.equal(db.reviewSchedule.cat.intervalIndex,0);assert.equal(db.reviewSchedule.cat.stable,false);
 assert.deepEqual(m.dueReviewWords(db,stamp('2026-10-02')),[]);assert.deepEqual(m.dueReviewWords(db,stamp('2026-10-03')),[cat]);
});
for(const [index,days] of [1,2,4,7,15].entries())test(`due clean review uses ${days} day interval`,async()=>{
 const m=await api(),db=fresh();let at=stamp('2026-10-02');m.recordReviewSuccess(db,{word:cat,at,token:'first'});
 for(let i=1;i<=index;i++){at=stamp(db.reviewSchedule.cat.dueDate);m.recordReviewSuccess(db,{word:cat,at,token:`r${i}`});}
 assert.equal(db.reviewSchedule.cat.intervalIndex,index);assert.equal(db.reviewSchedule.cat.dueDate,m.addDays(m.shanghaiDate(at),days));assert.equal(db.reviewSchedule.cat.stable,false);
});
test('passing the scheduled 15day review becomes stable and keeps 15day maintenance',async()=>{
 const m=await api(),db=fresh();let at=stamp('2026-10-02');m.recordReviewSuccess(db,{word:cat,at,token:'first'});
 for(let i=1;i<=5;i++){at=stamp(db.reviewSchedule.cat.dueDate);m.recordReviewSuccess(db,{word:cat,at,token:`r${i}`});}
 assert.equal(db.reviewSchedule.cat.stable,true);assert.equal(db.reviewSchedule.cat.intervalIndex,4);assert.equal(db.reviewSchedule.cat.dueDate,m.addDays(m.shanghaiDate(at),15));
});
test('clean repeats before due date cannot skip an interval or delay the due date',async()=>{
 const m=await api(),db=fresh(),at=stamp('2026-10-02');m.recordReviewSuccess(db,{word:cat,at,token:'a'});const before=structuredClone(db.reviewSchedule.cat);
 m.recordReviewSuccess(db,{word:cat,at:at+3600000,token:'b'});assert.equal(db.reviewSchedule.cat.dueDate,before.dueDate);assert.equal(db.reviewSchedule.cat.intervalIndex,0);
});
test('duplicate successful callback is idempotent even when the date advances',async()=>{
 const m=await api(),db=fresh(),at=stamp('2026-10-02');m.recordReviewSuccess(db,{word:cat,at,token:'a'});const before=structuredClone(db.reviewSchedule.cat);
 m.recordReviewSuccess(db,{word:cat,at:stamp('2026-10-10'),token:'a'});assert.deepEqual(db.reviewSchedule.cat,before);
});
for(const kind of ['wrong-order','wrong-letter','hint','prophecy','vision'])test(`due ${kind} immediately resets review and removes formal mastery`,async()=>{
 const m=await api(),db=fresh();db.dictationMastered=['CAT','dog'];db.reviewSchedule={cat:{word:cat,intervalIndex:4,dueDate:'2026-10-02',stable:true,unknown:'keep'}};
 m.recordReviewFailure(db,{word:cat,at:stamp('2026-10-02'),token:kind});assert.equal(db.reviewSchedule.cat.intervalIndex,0);assert.equal(db.reviewSchedule.cat.dueDate,'2026-10-03');assert.equal(db.reviewSchedule.cat.stable,false);assert.equal(db.reviewSchedule.cat.unknown,'keep');assert.deepEqual(db.dictationMastered,['dog']);assert.deepEqual(db.reviewQueue,['cat']);assert.deepEqual(db.mastered,['old practice']);
});
test('new clean attempt after failure restores formal mastery and restarts1day without skipping',async()=>{
 const m=await api(),db=fresh(),at=stamp('2026-10-02');m.recordReviewFailure(db,{word:cat,at,token:'bad'});db.dictationMastered.push('cat');m.recordReviewSuccess(db,{word:cat,at:at+1000,token:'new'});
 assert.equal(db.reviewSchedule.cat.intervalIndex,0);assert.equal(db.reviewSchedule.cat.dueDate,'2026-10-03');assert.deepEqual(db.reviewQueue,[]);assert.deepEqual(db.dictationMastered,['cat']);
});
test('legacy wrong and formal evidence migrate due today without guessing old dates or stable facts',async()=>{
 const m=await api(),db=fresh();db.reviewQueue=['cat'];db.dictationMastered=['dog'];db.activeRun={unknown:'snapshot'};
 m.initializeLearning(db,[cat,dog],stamp('2026-10-02'));assert.equal(db.reviewSchedule.cat.dueDate,'2026-10-02');assert.equal(db.reviewSchedule.dog.dueDate,'2026-10-02');assert.equal(db.reviewSchedule.dog.intervalIndex,-1);assert.equal(db.reviewSchedule.dog.stable,false);assert.deepEqual(db.unknown,{kept:true});assert.deepEqual(db.activeRun,{unknown:'snapshot'});assert.deepEqual(db.mastered,['old practice']);
 m.initializeLearning(db,[cat,dog],stamp('2026-10-08'));assert.equal(db.reviewSchedule.cat.dueDate,'2026-10-02');
});
test('legacy word meaning is resolved from textbook/custom list, unknown missing meaning remains explicit',async()=>{
 const m=await api(),db=fresh();db.reviewQueue=[' CAT ','unrecorded'];m.initializeLearning(db,[cat,dog],stamp('2026-10-02'));const due=m.dueReviewWords(db,stamp('2026-10-02'));
 assert.equal(due.find(w=>w.w==='cat').z,'猫');assert.equal(due.find(w=>w.w==='unrecorded').z,'旧记录未保存释义');
});

async function fixture(at=stamp('2026-10-02')) {
 const {createDailyLearning}=await app();const db=fresh();let time=at,commits=[];
 const learning=createDailyLearning({getDB:()=>db,getWords:()=>[cat,dog],now:()=>time});
 const ctl=createDailyDictationController({getDB:()=>db,getWords:()=>[cat,dog],now:()=>time,random:()=>0.1,persist:()=>{commits.push(structuredClone(db));return true},...learning.ports});
 const start=()=>ctl.start({unit:0});
 const warm=()=>{for(const w of ctl.state().words){for(const k of w.w)ctl.input(k);ctl.next();}ctl.beginFormal();};
 return {db,ctl,learning,start,warm,commits,clock:ms=>time+=ms,setTime:n=>time=n};
}
test('daily ledger counts unique practiced words, excludes warmup from formal rate, hint cat and clean dog are50%',async()=>{
 const f=await fixture();f.start();f.clock(2000);f.warm();assert.equal(f.learning.report().practicedWords,2);assert.equal(f.learning.report().formalAttempts,0);assert.deepEqual(f.db.dictationMastered,[]);
 f.ctl.hint();for(const k of 'cat')f.ctl.input(k);f.ctl.next();for(const k of 'dog')f.ctl.input(k);f.ctl.next();
 const r=f.learning.report();assert.equal(r.formalAttempts,2);assert.equal(r.firstTry,1);assert.equal(r.firstTryRate,50);assert.deepEqual(r.wrongWords,[cat]);assert.equal(r.activeMs,2000);
 assert.equal(f.commits.at(-1).dailyReports.days['2026-10-02'].words.cat.formalAttempts,1);assert.equal(f.commits.at(-1).reviewSchedule.cat.dueDate,'2026-10-03');
});
test('partial failed formal attempt remains in report denominator and review; untouched display word does not add practice',async()=>{
 const f=await fixture();f.start();assert.equal(f.learning.report().practicedWords,0);f.warm();f.ctl.input('a');f.ctl.pause();f.ctl.finish();const r=f.learning.report();assert.equal(r.formalAttempts,1);assert.equal(r.firstTry,0);assert.deepEqual(r.wrongWords,[cat]);assert.deepEqual(f.db.reviewQueue,['cat']);
});
test('due failed attempt corrected to full word cannot regain mastery or advance interval',async()=>{
 const f=await fixture();f.db.dictationMastered=['cat'];f.db.reviewSchedule.cat={word:cat,intervalIndex:4,dueDate:'2026-10-02',stable:true};f.start();f.warm();f.ctl.input('a');for(const k of 'cat')f.ctl.input(k);f.ctl.next();assert.equal(f.db.dictationMastered.includes('cat'),false);assert.equal(f.db.reviewSchedule.cat.intervalIndex,0);assert.equal(f.learning.report().formalAttempts,1);
});
test('report repeated rendering, duplicate finish and restored session do not count twice',async()=>{
 const f=await fixture();f.start();f.warm();for(const k of 'cat')f.ctl.input(k);f.ctl.next();for(const k of 'dog')f.ctl.input(k);f.ctl.next();const before=structuredClone(f.db.dailyReports);
 f.ctl.finish();f.learning.report();f.learning.report();const {createDailyLearning}=await app();const learning=createDailyLearning({getDB:()=>f.db,getWords:()=>[cat,dog],now:()=>stamp('2026-10-02')});
 learning.ports.onAttempt({session:f.ctl.state(),result:f.ctl.state().results.at(-1),attempt:f.ctl.state().attempt,db:f.db,at:stamp('2026-10-02')});assert.deepEqual(f.db.dailyReports,before);
});
test('multiple daily sessions combine unique word count but retain per-attempt correctness denominator',async()=>{
 const f=await fixture();for(let n=0;n<2;n++){f.start();f.warm();for(const word of f.ctl.state().words){for(const k of word.w)f.ctl.input(k);f.ctl.next();}f.clock(1000);}
 const r=f.learning.report();assert.equal(r.practicedWords,2);assert.equal(r.formalAttempts,4);assert.equal(r.firstTry,4);
});
test('active timing splits Shanghai midnight and excludes paused/background waiting',async()=>{
 const f=await fixture(Date.parse('2026-10-02T15:59:57Z'));f.start();f.ctl.input('c');f.clock(5000);f.ctl.pause('background');f.clock(3600000);f.ctl.resume();f.clock(1000);f.ctl.pause();
 assert.equal(f.db.dailyReports.days['2026-10-02'].activeMs,3000);assert.equal(f.db.dailyReports.days['2026-10-03'].activeMs,3000);assert.equal(f.ctl.state().elapsedMs,6000);
});
test('30calendar days retained, older details folded into summary without old events or wrong list',async()=>{
 const m=await api(),db=fresh();m.initializeLearning(db,[cat,dog],stamp('2026-10-01'));for(let i=0;i<35;i++){const d=m.addDays('2026-10-01',i);m.recordPractice(db,cat,stamp(d));m.recordAssessment(db,{word:cat,eligible:i%2===0,at:stamp(d)});m.recordActiveTime(db,stamp(d)+1000,1000);}
 m.pruneDailyReports(db,stamp('2026-11-04'));assert.equal(Object.keys(db.dailyReports.days).length,30);assert.equal(Object.keys(db.dailyReports.days)[0],'2026-10-06');assert.equal(db.dailyReports.summary.days,5);assert.equal(db.dailyReports.summary.practicedWords,5);assert.equal(db.dailyReports.summary.formalAttempts,5);assert.equal(db.dailyReports.summary.firstTry,3);assert.equal(db.dailyReports.summary.activeMs,5000);assert.equal(JSON.stringify(db.dailyReports.summary).includes('cat'),false);
});
test('report plain text contains correct date, active duration, unique words, rate and safe CN/EN wrong list',async()=>{
 const f=await fixture();f.start();f.clock(65000);f.warm();f.ctl.hint();for(const k of 'cat')f.ctl.input(k);f.ctl.next();for(const k of 'dog')f.ctl.input(k);f.ctl.next();const text=(await api()).reportText(f.learning.report());
 assert.match(text,/2026-10-02/);assert.match(text,/1分05秒/);assert.match(text,/练习词数：2/);assert.match(text,/50%（1\/2）/);assert.match(text,/cat · 猫/);assert.doesNotMatch(text,/<[^>]+>/);
});
for(const kind of ['wrong-order','wrong-letter','hint','prophecy','vision'])test(`controller due ${kind} uses real criterion and cannot regain mastery after correction`,async()=>{
 const f=await fixture();f.db.dictationMastered=['cat'];f.db.reviewSchedule.cat={word:cat,intervalIndex:4,dueDate:'2026-10-02',stable:true};f.start();f.warm();const target=f.ctl.state().attempt.target;assert.equal(target,'cat');
 if(kind==='wrong-order')f.ctl.input(target[1]);else if(kind==='wrong-letter')f.ctl.input('x');else if(kind==='hint')f.ctl.hint();else f.ctl.assist(kind);
 assert.equal(f.db.dictationMastered.includes(target),false);assert.equal(f.db.reviewSchedule[target].dueDate,'2026-10-03');assert.equal(f.db.reviewSchedule[target].stable,false);
 for(const k of target)f.ctl.input(k);f.ctl.next();assert.equal(f.db.dictationMastered.includes(target),false);assert.equal(f.db.reviewSchedule[target].intervalIndex,0);assert.equal(f.learning.report().formalAttempts,1);assert.equal(f.learning.report().firstTry,0);assert.deepEqual(f.learning.report().wrongWords,[cat]);
});
test('corrupt or future daily snapshot words object is retained and does not crash migration',async()=>{
 const m=await api(),db=fresh();const invalid={schemaVersion:999,words:{unexpected:true},unknown:'preserve'};db.dailySession=invalid;
 assert.doesNotThrow(()=>m.initializeLearning(db,[cat,dog],stamp('2026-10-02')));assert.equal(db.dailySession,invalid);assert.deepEqual(db.dailySession.words,{unexpected:true});
});
test('prePR3 failed partial snapshot restored and finished without typing is accounted now exactly once',async()=>{
 const f=await fixture();f.start();f.warm();f.ctl.input('a');f.ctl.pause();const db=structuredClone(f.db);delete db.reviewSchedule;delete db.dailyReports;delete db.wordExposure;delete db.dailySession.learning;db.dictationMastered=['cat'];
 const {createDailyLearning}=await app();const learning=createDailyLearning({getDB:()=>db,getWords:()=>[cat,dog],now:()=>stamp('2026-10-02')});const ctl=createDailyDictationController({getDB:()=>db,getWords:()=>[cat,dog],now:()=>stamp('2026-10-02'),persist:()=>true,...learning.ports});
 ctl.finish();ctl.finish();assert.equal(db.dictationMastered.includes('cat'),false);assert.equal(db.reviewSchedule.cat.dueDate,'2026-10-03');assert.equal(learning.report().formalAttempts,1);assert.equal(learning.report().firstTry,0);assert.deepEqual(learning.report().wrongWords,[cat]);
});
test('global due reviews cross unit and old custom lists while actual half quota remains enforced',async()=>{
 const f=await fixture(),owl={w:'owl',z:'猫头鹰',u:6};f.db.reviewSchedule.owl={word:owl,intervalIndex:1,dueDate:'2026-10-01',stable:false};f.start();assert.equal(f.ctl.state().words.some(w=>w.w==='owl'&&w.u===6),true);assert.deepEqual(f.ctl.state().reviewKeys,['owl']);assert.equal(f.ctl.state().reviewKeys.length<=Math.floor(f.ctl.state().words.length/2),true);
});
test('last assisted word, pool exhaustion and duplicate attempt callback keep denominator exactly two',async()=>{
 const f=await fixture();f.start();f.warm();for(const k of f.ctl.state().attempt.target)f.ctl.input(k);f.ctl.next();f.ctl.hint();for(const k of f.ctl.state().attempt.target)f.ctl.input(k);f.ctl.next();
 assert.equal(f.ctl.state().index,f.ctl.state().words.length);const before=structuredClone(f.db.dailyReports);f.learning.ports.onAttempt({session:f.ctl.state(),attempt:f.ctl.state().attempt,result:f.ctl.state().results.at(-1),db:f.db,at:stamp('2026-10-02')});f.learning.ports.onComplete({session:f.ctl.state(),db:f.db,at:stamp('2026-10-02')});assert.deepEqual(f.db.dailyReports,before);assert.equal(f.learning.report().formalAttempts,2);assert.equal(f.learning.report().firstTry,1);
});
test('replayed earlier clean attempt after a later word does not increase report count',async()=>{
 const f=await fixture();f.start();f.warm();for(const k of f.ctl.state().attempt.target)f.ctl.input(k);const earlier=structuredClone(f.ctl.state().results[0]);f.ctl.next();for(const k of f.ctl.state().attempt.target)f.ctl.input(k);f.ctl.next();const before=structuredClone(f.db.dailyReports);
 f.learning.ports.onAttempt({session:f.ctl.state(),result:earlier,db:f.db,at:stamp('2026-10-02')});assert.deepEqual(f.db.dailyReports,before);
});
