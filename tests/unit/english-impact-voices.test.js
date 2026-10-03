import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech } from '../../src/services/speech.js';
import { FOE_LINES, ELITE_LINES } from '../../src/data/voice-lines.js';
function harness(voices=[{lang:'en-US',name:'David',localService:true},{lang:'en-US',name:'Samantha',localService:true},{lang:'zh-CN',name:'Huihui',localService:true}]){
 const spoken=[],impacts=[];class Utt{constructor(text){this.text=text}}
 const speech=createSpeech({heroVoice:()=>({rate:.9,pitch:1.25,prefer:'female'}),curHeroId:()=> 'healer',rnd:()=>0,
 voiceLines:{healer:{}},foeLineCfg:()=>({...FOE_LINES['词灵'],key:'词灵'}),onChange(){},onAnnouncementStart:count=>impacts.push(count),
 environment:{SpeechSynthesisUtterance:Utt,speechSynthesis:{speak:u=>spoken.push(u),cancel(){},getVoices:()=>voices,addEventListener(){}}}});
 return{speech,spoken,impacts};
}
test('all monster and elite dialogue is English, preserving monster identities',()=>{
 assert.equal(Object.keys(FOE_LINES).length,9);
 for(const line of [...Object.values(FOE_LINES).flatMap(c=>c.lines),...ELITE_LINES]){
  assert.ok(/[A-Za-z]/.test(line));assert.ok(!/[\u3400-\u9fff]/.test(line),line);
 }
});
test('monster dialogue uses an English voice and en-US even without Chinese voices',()=>{
 const h=harness([{lang:'en-US',name:'David',localService:true}]);
 assert.equal(h.speech.foeLine({n:'词灵'},{force:true}),true);
 assert.equal(h.spoken.at(-1).lang,'en-US');assert.equal(h.spoken.at(-1).voice.lang,'en-US');h.speech.stop();
});
test('streaks use a dedicated deep announcer; impact starts only when speech actually starts',()=>{
 const h=harness(); assert.equal(h.speech.announcement('Triple Kill',{count:3}),true);
 const u=h.spoken.at(-1);assert.equal(u.voice.name,'David');assert.ok(u.pitch<=.85);assert.ok(u.rate>=1);
 assert.equal(u.volume,1);assert.deepEqual(h.impacts,[]);
 u.onstart?.({target:u});assert.deepEqual(h.impacts,[3]);
 u.onstart?.({target:u});assert.deepEqual(h.impacts,[3],'engine duplicate start cannot repeat impact');
 h.speech.stop();
});
test('word priority and mute suppress announcer and its impact',()=>{
 const h=harness();h.speech.word('litre');assert.equal(h.speech.announcement('Double Kill',{count:2}),false);
 assert.deepEqual(h.impacts,[]);h.speech.stop();h.speech.setOn(false);
 assert.equal(h.speech.announcement('Triple Kill',{count:3}),false);assert.deepEqual(h.impacts,[]);
});
