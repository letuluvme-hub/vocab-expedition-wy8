/* TTS 桥契约测试：用真的 assets/tts-shim.js + 真的 src/services/speech.js 跑一遍。
 *
 * 为什么值得单独测：Android WebView 完全没有 window.speechSynthesis，
 * 读音能出声全靠这一层。而游戏对"失败"的判定极窄 —— 只要 shim 把一次
 * 正常的 cancel 报成普通 error，玩家每读一个词就会被弹一次「浏览器无法朗读」。
 * 这条用真代码跑，不靠源码字符串匹配。
 *
 *   node --test android/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSpeech } from '../../src/services/speech.js';
import { FOE_LINES } from '../../src/data/voice-lines.js';
import { createAudioCapability, STATUS, CHANNEL } from '../../src/services/audio-capability.js';

const SHIM = readFileSync(new URL('../app/src/main/assets/tts-shim.js', import.meta.url), 'utf8');

/* Google TTS 的真名字长这样：#female_1/#male_1 是游戏猜性别的唯一线索。 */
const VOICES = [
  { name: 'en-us-x-tpf-local', lang: 'en-US', voiceURI: 'en-us-x-tpf-local', localService: true },
  { name: 'en-us-x-sfg#female_1-local', lang: 'en-US', voiceURI: 'en-us-x-sfg#female_1-local', localService: true },
  { name: 'cmn-cn-x-ccc#female_1-local', lang: 'zh-CN', voiceURI: 'cmn-cn-x-ccc#female_1-local', localService: true },
];

function makeBridge(voices = VOICES) {
  const calls = [];
  let ready = true;
  return {
    calls,
    ready: () => ready,
    unavailable: () => false,
    voices: () => JSON.stringify(voices),
    speak(id, text, lang, rate, pitch, volume, voice) {
      calls.push({ kind: 'speak', id, text, lang, rate, pitch, volume, voice });
      return 0;
    },
    stop() { calls.push({ kind: 'stop' }); },
    setReady(v) { ready = v; },
  };
}

/* 用真源码装 shim，不复制一份实现（复制出来的一定会跟实现漂移）。 */
function installShim(bridge) {
  const win = { __androidTTS: bridge };
  new Function('window', 'setTimeout', 'clearTimeout', 'JSON', 'Object', 'Number', 'isFinite', 'String', SHIM)(
    win, setTimeout, clearTimeout, JSON, Object, Number, isFinite, String);
  return win;
}

const tick = () => new Promise(r => setTimeout(r, 0));

/* speech.js 每次 speak 前都会先 cancel（T.stop），所以 bridge 里 stop 记录会排在
   speak 前面 —— 取"最后一次发声"必须过滤，不能拿 calls[0]。 */
const speaks = bridge => bridge.calls.filter(c => c.kind === 'speak');
const lastSpokenId = bridge => {
  const s = speaks(bridge);
  return s.length ? s[s.length - 1].id : undefined;
};

function makeGame(win) {
  const cap = createAudioCapability({ environment: win });
  const tts = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1, prefer: 'female' }),
    curHeroId: () => 'scholar',
    rnd: () => 0,
    voiceLines: { scholar: { atk: ['attack'], win: ['win'], lose: ['lose'] } },
    foeLineCfg: () => ({ ...FOE_LINES['词灵'], key:'k' }),
    onChange: () => {},
    environment: win,
    capability: cap,
  });
  return { tts, cap };
}

test('shim 提供 speechSynthesis / SpeechSynthesisUtterance（WebView 里本来一个都没有）', () => {
  const win = installShim(makeBridge());
  assert.equal(typeof win.speechSynthesis.speak, 'function');
  assert.equal(typeof win.SpeechSynthesisUtterance, 'function');
  assert.equal(typeof win.speechSynthesis.getVoices, 'function');
});

test('拼完一个词会把文本和语言送进原生引擎', () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const u = new win.SpeechSynthesisUtterance('cat');
  win.speechSynthesis.speak(u);

  assert.equal(bridge.calls.length, 1);
  assert.equal(bridge.calls[0].text, 'cat');
  assert.equal(bridge.calls[0].lang, 'en-US');
});

test('原生 start/end 会按顺序变成 onstart/onend，且 pending 归零', async () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const synth = win.speechSynthesis;
  const seen = [];
  const u = new win.SpeechSynthesisUtterance('hello');
  u.onstart = () => seen.push('start');
  u.onend = () => seen.push('end');
  u.onerror = e => seen.push('error:' + e.error);

  synth.speak(u);
  const id = bridge.calls[0].id;
  assert.equal(synth.pending, true);

  win.__androidTTSDispatch('start', id);
  assert.equal(synth.speaking, true);
  win.__androidTTSDispatch('end', id);
  await tick();

  assert.deepEqual(seen, ['start', 'end']);
  assert.equal(synth.speaking, false);
  assert.equal(synth.pending, false);
});

test('被 cancel 的那一句以 interrupted 收场 —— 不是故障', async () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const synth = win.speechSynthesis;
  const errors = [];
  const u = new win.SpeechSynthesisUtterance('cat');
  u.onerror = e => errors.push(e.error);

  synth.speak(u);
  win.__androidTTSDispatch('start', bridge.calls[0].id);
  synth.cancel();
  await tick();

  // 游戏只把 canceled/cancelled/interrupted 当"不是故障"，别的词都会弹窗。
  assert.deepEqual(errors, ['interrupted']);
  assert.equal(synth.speaking, false);
  assert.ok(bridge.calls.some(c => c.kind === 'stop'), 'cancel 必须真的叫停原生引擎');
});

test('原生真的报错时，错误照实传给游戏（上面那条测试因此不是空转）', async () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const errors = [];
  const u = new win.SpeechSynthesisUtterance('cat');
  u.onerror = e => errors.push(e.error);

  win.speechSynthesis.speak(u);
  win.__androidTTSDispatch('error', bridge.calls[0].id);
  await tick();

  assert.deepEqual(errors, ['synthesis-failed']);
});

test('空串暖机不惊动引擎（speech.js 的 unlock 会发一个空格）', async () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  win.speechSynthesis.speak(new win.SpeechSynthesisUtterance(' '));
  await tick();

  assert.equal(bridge.calls.length, 0);
  assert.equal(win.speechSynthesis.pending, false);
});

test('音量 0 的暖机句要原样带过去，不能变成正常音量', async () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const u = new win.SpeechSynthesisUtterance('loud');
  u.volume = 0;
  win.speechSynthesis.speak(u);
  assert.equal(bridge.calls[0].volume, 0);
});

test('音色表会通过 voiceschanged 送达（空表的话中文台词整条哑掉）', () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const synth = win.speechSynthesis;
  let fired = 0;
  synth.addEventListener('voiceschanged', () => { fired++; });

  win.__androidTTSDispatch('voices');

  assert.equal(fired, 1);
  const vs = synth.getVoices();
  assert.equal(vs.length, 3);
  assert.ok(vs.some(v => v.lang === 'zh-CN' && v.localService === true));
});

test('引擎还没就绪时不假装能读：等到就绪再发，超时才报错', async () => {
  const bridge = makeBridge();
  bridge.setReady(false);
  const win = installShim(bridge);
  const errors = [];
  const u = new win.SpeechSynthesisUtterance('cat');
  u.onerror = e => errors.push(e.error);

  win.speechSynthesis.speak(u);
  await tick();
  assert.equal(bridge.calls.filter(c => c.kind === 'speak').length, 0, '未就绪时不该硬发');
  assert.deepEqual(errors, [], '未就绪也不该立刻下失败结论');

  bridge.setReady(true);
  await new Promise(r => setTimeout(r, 250));
  assert.equal(bridge.calls.filter(c => c.kind === 'speak').length, 1);
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------- 与游戏真代码合体

test('游戏层拿到 shim 后 supported 为真，单词朗读真的走到原生引擎', () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const { tts } = makeGame(win);

  assert.equal(tts.supported, true, 'WebView 里没有 shim 的话这里永远是 false');
  assert.equal(tts.word('cat'), true);
  assert.equal(speaks(bridge)[0].text, 'cat');
});

test('完整词朗读被下一次朗读打断时，兼容层不会被判成"浏览器无法朗读"', async () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const { tts, cap } = makeGame(win);

  tts.word('cat');
  win.__androidTTSDispatch('start', lastSpokenId(bridge));
  assert.equal(cap.channelState(CHANNEL.SPEECH), STATUS.AVAILABLE);

  // 第二句会先 cancel 第一句 —— 这正是最容易误报故障的那条路径。
  tts.word('dog');
  await tick();

  assert.notEqual(cap.channelState(CHANNEL.SPEECH), STATUS.BLOCKED,
    '正常打断被报成故障的话，玩家每读一个词都会被弹一次提示');
  assert.notEqual(cap.channelState(CHANNEL.SPEECH), STATUS.UNSUPPORTED);
});

test('原生真报错时兼容层会判 blocked —— 证明上一条不是恒真', async () => {
  const bridge = makeBridge();
  const win = installShim(bridge);
  const { tts, cap } = makeGame(win);

  tts.word('cat');
  win.__androidTTSDispatch('error', lastSpokenId(bridge));

  assert.equal(cap.channelState(CHANNEL.SPEECH), STATUS.BLOCKED);
});

test('原生桥用英文说怪物台词，不需要中文音色', () => {
  for(const voices of [VOICES,[VOICES[0],VOICES[1]]]) {
    const bridge=makeBridge(voices),win=installShim(bridge),game=makeGame(win);
    assert.equal(game.tts.foeLine({ic:'a1'},{force:true}),true);
    const spoken=bridge.calls.find(c=>c.kind==='speak');
    assert.equal(spoken.lang,'en-US'); assert.match(spoken.text,/[A-Za-z]/);
    assert.doesNotMatch(spoken.text,/[\u3400-\u9fff]/);
    assert.ok(spoken.voice.startsWith('en-'));game.tts.stop();
  }
});

test('非原生环境（普通浏览器）里 shim 完全不插嘴', () => {
  const win = {};
  new Function('window', 'setTimeout', 'clearTimeout', 'JSON', 'Object', 'Number', 'isFinite', 'String', SHIM)(
    win, setTimeout, clearTimeout, JSON, Object, Number, isFinite, String);
  assert.equal(win.speechSynthesis, undefined);
  assert.equal(win.__androidTTSDispatch, undefined);
});
