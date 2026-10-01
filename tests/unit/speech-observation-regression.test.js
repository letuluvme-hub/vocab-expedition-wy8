import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeech} from '../../src/services/speech.js';
import {createAudioCapability,CHANNEL,STATUS} from '../../src/services/audio-capability.js';
function setup(timeoutMs){
 const utterances=[];const cap=createAudioCapability({environment:{}});
 class Utterance{constructor(text){this.text=text;}}
 const speech=createSpeech({heroVoice:()=>({rate:.9,pitch:1}),curHeroId:()=> 'scholar',rnd:()=>0,voiceLines:{scholar:{atk:['go']}},foeLineCfg:()=>null,onChange:()=>{},capability:cap,utteranceTimeoutMs:timeoutMs,environment:{SpeechSynthesisUtterance:Utterance,speechSynthesis:{speak:u=>utterances.push(u),cancel(){},getVoices:()=>[],addEventListener(){}}}});
 return {speech,cap,utterances};
}
test('an actual error after onstart still reports failure for the active utterance',()=>{
 const {speech,cap,utterances}=setup(1000);speech.word('apple');const u=utterances[0];
 u.onstart({target:u});assert.equal(cap.channelState(CHANNEL.SPEECH),STATUS.AVAILABLE);
 u.onerror({error:'network',target:u});assert.equal(cap.channelState(CHANNEL.SPEECH),STATUS.BLOCKED);
 speech.stop();
});
test('explicit zero disables the utterance timeout rather than falling back to an estimate',()=>{
 const {speech}=setup(0);speech.word('apple');const count=speech._probeTimers.length;speech.stop();assert.equal(count,0);
});
