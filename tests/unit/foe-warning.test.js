import test from 'node:test';
import assert from 'node:assert/strict';
import {createFoeAttackController} from '../../src/app/foe-attacks.js';
import {createLifecycle} from '../../src/app/lifecycle.js';
import {FOE_ATTACK} from '../../src/data/balance.js';
function setup(warning=()=>{},pulse=()=>{}){
 let now=0,id=0;const jobs=new Map(),B={myHp:200,foeAttack:null};
 const life=createLifecycle({setTimer(fn,ms){const n=++id;jobs.set(n,{fn,at:now+ms});return n},clearTimer(n){jobs.delete(n)},now:()=>now});life.resetRun();life.resetBattle();
 const ctl=createFoeAttackController({state:{getBattle:()=>B},lifecycle:life,now:()=>now,foeAttackHit:()=>{},onTelegraph:warning,onWarningPulse:pulse,paintAttack:()=>{}});
 const advance=ms=>{const end=now+ms;for(;;){const due=[...jobs].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;jobs.delete(due[0]);due[1].fn()}now=end};return {ctl,B,life,advance};
}
test('one warning at each new telegraph, never on UI ticks, pause/resume or defeat',()=>{
 let calls=0;const s=setup(()=>calls++),cfg=FOE_ATTACK.normal;s.ctl.start();assert.equal(calls,0);
 s.advance(cfg.idleMs);assert.equal(s.B.foeAttack.phase,'telegraph');assert.equal(calls,1);
 s.advance(500);assert.equal(calls,1);s.ctl.pause();s.life.pause();s.advance(10000);assert.equal(calls,1);s.life.resume();s.ctl.resume();assert.equal(calls,1);
 s.advance(cfg.telegraphMs-500+cfg.recoverMs+cfg.idleMs);assert.equal(calls,2);
 s.ctl.stop();s.advance(20000);assert.equal(calls,2);
});
test('unavailable warning audio cannot block phase scheduling or damage',()=>{
 const s=setup(()=>{throw new Error('audio unavailable')});s.ctl.start();assert.doesNotThrow(()=>s.advance(FOE_ATTACK.normal.idleMs));assert.equal(s.B.foeAttack.phase,'telegraph');s.advance(FOE_ATTACK.normal.telegraphMs);assert.equal(s.B.foeAttack.phase,'recover');
});

test('warning cadence accelerates toward impact and freezes with battle time',()=>{
 const pulses=[];let elapsed=0;const s=setup(()=>{},u=>pulses.push({at:elapsed,u}));const cfg=FOE_ATTACK.normal;s.ctl.start();s.advance(cfg.idleMs);
 for(let i=0;i<cfg.telegraphMs/250;i++){elapsed+=250;s.advance(250)}
 assert.ok(pulses.length>=5, 'repeated countdown pulses');
 const gaps=pulses.slice(1).map((p,i)=>p.at-pulses[i].at);assert.ok(gaps[0]>gaps.at(-1),'cadence accelerates');assert.ok(pulses[0].u<pulses.at(-1).u);
 const count=pulses.length;s.advance(cfg.recoverMs);assert.equal(pulses.length,count);
 s.advance(cfg.idleMs+1000);s.ctl.pause();s.life.pause();const paused=pulses.length;s.advance(20000);assert.equal(pulses.length,paused);
 s.life.resume();s.ctl.resume();s.advance(250);assert.ok(pulses.length<=paused+1,'no catch-up burst');s.ctl.notifyLetterAttempted();const cut=pulses.length;s.advance(500);assert.equal(pulses.length,cut);
 s.ctl.stop();s.advance(20000);assert.equal(pulses.length,cut);
});
test('countdown sound failure cannot block an attack',()=>{const s=setup(()=>{},()=>{throw Error('audio')});s.ctl.start();assert.doesNotThrow(()=>s.advance(FOE_ATTACK.normal.idleMs+FOE_ATTACK.normal.telegraphMs));assert.equal(s.B.foeAttack.phase,'recover')});
