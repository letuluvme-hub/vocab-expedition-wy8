import { test } from 'node:test';
import assert from 'node:assert/strict';

test('speech service degrades safely without browser speech APIs', async () => {
  const { createSpeech } = await import('../../src/services/speech.js');
  const speech = createSpeech({
    heroVoice: () => ({rate:0.9,pitch:1}), curHeroId: () => 'scholar',
    rnd: () => 0, voiceLines: {scholar:{atk:['go']}}, foeLineCfg: () => null,
    onChange: () => {}, environment: {},
  });
  assert.equal(speech.supported, false);
  assert.equal(speech.word('hello'), false);
  assert.equal(speech.line('atk'), false);
  assert.equal(speech.foeLine({n:'词灵'}), false);
  assert.doesNotThrow(() => speech.stop());
});

test('speech toggle persists preference through injected callback, not global DB', async () => {
  const { createSpeech } = await import('../../src/services/speech.js');
  const changes = [];
  const speech = createSpeech({heroVoice:()=>({rate:0.9,pitch:1}),curHeroId:()=> 'scholar',rnd:()=>0,voiceLines:{scholar:{}},foeLineCfg:()=>null,onChange: enabled => changes.push(enabled),environment:{}});
  assert.equal(speech.setOn(false), false);
  assert.equal(speech.toggle(), true);
  assert.deepEqual(changes, [false, true]);
});

test('speech uses injected browser APIs and approved pronunciation settings', async () => {
  const { createSpeech } = await import('../../src/services/speech.js');
  const spoken = [];
  class Utterance { constructor(text) { this.text = text; } }
  const environment = {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: {speak:u=>spoken.push(u),cancel(){},getVoices:()=>[{lang:'en-US',name:'Samantha',localService:true}],addEventListener(){}},
  };
  const speech = createSpeech({heroVoice:()=>({rate:0.85,pitch:1.05,prefer:'female'}),curHeroId:()=> 'scholar',rnd:()=>0,voiceLines:{scholar:{}},foeLineCfg:()=>null,onChange:()=>{},environment});
  assert.equal(speech.supported, true);
  assert.equal(speech.word('living conditions'), true);
  assert.equal(spoken.at(-1).text, 'living conditions');
  assert.equal(spoken.at(-1).pitch, 1.05);
  assert.equal(spoken.at(-1).lang, 'en-US');
});

test('audio service is DOM-free and silently declines unsupported AudioContext', async () => {
  const { createAudio } = await import('../../src/services/audio.js');
  const { AU, sfx, tone, noise, arp, pnote } = createAudio({getCombo:()=>0,environment:{}});
  assert.equal(AU.ctx(), null);
  assert.doesNotThrow(() => { tone(440,.1,'triangle',.1); noise(.1,'highpass',400,.1); arp([0,1],.1,.1,'triangle',.1); sfx.good(); sfx.finisher(); });
  assert.equal(pnote(0), 146.83);
  assert.equal(pnote(5), 293.66);
  AU.setVol(0);
  assert.equal(AU.muted, true);
});
