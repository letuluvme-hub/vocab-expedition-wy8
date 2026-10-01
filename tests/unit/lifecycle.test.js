import {test} from 'node:test';
import assert from 'node:assert/strict';

test('run reset cancels delayed settlement, stale callback cannot execute even if timer raced', async () => {
  const {createLifecycle} = await import('../../src/app/lifecycle.js');
  const jobs=new Map(); const cleared=[];let next=0;let calls=0;
  const lifecycle=createLifecycle({setTimer:fn=>{jobs.set(++next,fn);return next},clearTimer:id=>cleared.push(id)});
  lifecycle.scheduleRun(()=>calls++,900);
  const stale=jobs.get(1);
  lifecycle.resetRun();
  stale();
  assert.equal(calls,0);
  assert.deepEqual(cleared,[1]);
});
test('battle change cancels battle tasks but retains current-run tasks',async()=>{
  const {createLifecycle}=await import('../../src/app/lifecycle.js');
  const jobs=new Map();let next=0;const calls=[];
  const lifecycle=createLifecycle({setTimer:fn=>{jobs.set(++next,fn);return next},clearTimer:()=>{}});
  lifecycle.scheduleRun(()=>calls.push('run'),700);
  lifecycle.scheduleBattle(()=>calls.push('old battle'),260);
  lifecycle.resetBattle();
  lifecycle.scheduleBattle(()=>calls.push('new battle'),260);
  for(const fn of jobs.values())fn();
  assert.deepEqual(calls,['run','new battle']);
});
test('completed lifecycle tasks are removed and reset does not clear unrelated completed timers',async()=>{
  const {createLifecycle}=await import('../../src/app/lifecycle.js');
  const jobs=[];const cleared=[];
  const lifecycle=createLifecycle({setTimer:fn=>{jobs.push(fn);return jobs.length},clearTimer:id=>cleared.push(id)});
  lifecycle.scheduleRun(()=>{},1);jobs[0]();lifecycle.resetRun();
  assert.deepEqual(cleared,[]);
});
