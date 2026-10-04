import {test,expect} from './game-harness.js';
for(const audible of [true,false])test(`charge warning uses real audio, sound ${audible?'on':'muted'}`,async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Charge warning');
 await page.addInitScript(()=>{window.__warningTones=[];const create=AudioContext.prototype.createOscillator;AudioContext.prototype.createOscillator=function(){const o=create.call(this),set=o.frequency.setValueAtTime.bind(o.frequency);o.frequency.setValueAtTime=(f,t)=>{if(f===440||f===660)window.__warningTones.push({f,t});return set(f,t)};return o}});
 await game.open();if(audible)await page.locator('#volBtn').click();await game.start();await game.fight();
 const before=await page.locator('#fBank').boundingBox();
 await page.waitForFunction(()=>window.__gameTest.B.foeAttack.phase==='telegraph',null,{timeout:15000});
 const after=await page.locator('#fBank').boundingBox();for(const dimension of ['x','y','width','height'])expect(Math.abs(after[dimension]-before[dimension])).toBeLessThanOrEqual(1);
 const tones=await page.evaluate(()=>window.__warningTones);expect(tones.map(x=>x.f)).toEqual(audible?[440,660]:[]);
 if(audible)expect(tones[1].t-tones[0].t).toBeCloseTo(.14,2);
 await page.waitForTimeout(600);expect(await page.evaluate(()=>window.__warningTones.length)).toBe(tones.length);expect(game.errors).toEqual([]);
});

test('audible countdown grows faster and louder, then stops on pause',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Countdown audio');
 await page.addInitScript(()=>{
  window.__pulses=[];window.__gains=[];
  const oscillator=AudioContext.prototype.createOscillator,gain=AudioContext.prototype.createGain;
  AudioContext.prototype.createOscillator=function(){const o=oscillator.call(this),set=o.frequency.setValueAtTime.bind(o.frequency);o.frequency.setValueAtTime=(f,t)=>{if(f>660&&f<=880)window.__pulses.push({f,t});return set(f,t)};return o};
  AudioContext.prototype.createGain=function(){const g=gain.call(this),ramp=g.gain.exponentialRampToValueAtTime.bind(g.gain);g.gain.exponentialRampToValueAtTime=(v,t)=>{window.__gains.push(v);return ramp(v,t)};return g};
 });
 await game.open();await page.locator('#volBtn').click();await game.start();await game.fight();
 await page.waitForFunction(()=>window.__pulses.length>=5,null,{timeout:16000});
 const pulses=await page.evaluate(()=>window.__pulses),gaps=pulses.slice(1).map((p,i)=>p.t-pulses[i].t);
 expect(gaps[0]).toBeGreaterThan(gaps.at(-1));expect(pulses.at(-1).f).toBeGreaterThan(pulses[0].f);
 expect(await page.evaluate(()=>window.__gains.some(v=>v>=.18))).toBe(true);
 await page.locator('#tPause').click();const count=await page.evaluate(()=>window.__pulses.length);await page.waitForTimeout(900);expect(await page.evaluate(()=>window.__pulses.length)).toBe(count);expect(game.errors).toEqual([]);
});
