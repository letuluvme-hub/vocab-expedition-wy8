import {test,expect} from './game-harness.js';
test('real combat speaks English monsters and the streak impact follows announcer start',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','English impact voices');
 await game.open({speechStub:true});await game.start();await game.fight({word:'litre',enemyHp:5000});
 const foe=await page.evaluate(()=>window.__speech.spoken.find(r=>r.text.trim()&&!r.text.includes('litre'))?.u);
 expect(foe.lang).toBe('en-US');expect(foe.text).toMatch(/[A-Za-z]/);expect(foe.text).not.toMatch(/[\u3400-\u9fff]/);
 await page.evaluate(()=>{const t=window.__gameTest;t.AU.setVol(.55);t.AU.unlock();window.__annOsc=0;const create=t.AU.ac.createOscillator.bind(t.AU.ac);t.AU.ac.createOscillator=()=>{if(window.__speech.current?.text==='Triple Kill')window.__annOsc++;return create()};t.G.wordStreak={count:2,lastEventId:'seed:0'};});
 await page.keyboard.type('litre',{delay:15});
 // End the actual word utterance to release its priority; the game then announces Triple Kill.
 await page.evaluate(()=>{const s=window.__speech;const i=s.spoken.findIndex(r=>r.text==='litre');s.end(i)});
 await expect.poll(()=>page.evaluate(()=>window.__speech.texts().includes('Triple Kill'))).toBe(true);
 const ann=await page.evaluate(()=>{const r=window.__speech.spoken.find(r=>r.text==='Triple Kill');return{pitch:r.u.pitch,rate:r.u.rate,volume:r.u.volume}});
 expect(ann.pitch).toBeLessThanOrEqual(.85);expect(ann.rate).toBeGreaterThanOrEqual(1);expect(ann.volume).toBe(1);
 // End word/finisher tones before measuring the separate impact, using the real WebAudio graph.
 await page.waitForTimeout(900);
 expect(await page.evaluate(()=>window.__annOsc)).toBeGreaterThanOrEqual(3);
 const delta=await page.evaluate(()=>{
  const t=window.__gameTest,s=window.__speech,r=s.spoken.find(r=>r.text==='Triple Kill');
  const before=t.AU.voices;r.u.onstart({target:r.u});return t.AU.voices-before;
 });
 // The platform stub already delivered start: repeated starts must never make another impact.
 expect(delta).toBe(0);
});
