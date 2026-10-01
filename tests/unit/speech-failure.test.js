/* 朗读（Web Speech）这一路的失败观测（RED/GREEN 垂直切片 3）
 *
 * 微信里最常见的症状：speak() 不抛错、也不出声，一直静默。
 * 所以失败信号有三个来源：speak 抛错、utterance 的 onerror、以及「念完了但
 * onend/onerror 一个都没来」。三者都要能变成 failure state。
 * 另有一条铁律：装监听器**不许覆盖** utterance 上原有的 onend/onerror ——
 * 那是别的模块（例如动画节奏）可能已经挂上去的回调。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createSpeech } = await import('../../src/services/speech.js');
const { createAudioCapability, CHANNEL, STATUS } =
  await import('../../src/services/audio-capability.js');

class Utt {
  constructor(text) { this.text = text; }
}

/* 手动控制 harness：speak() 只把 utterance 收进 spoken，不自动 end/error，
   这样「谁先开口、谁先结束、旧事件迟到」都能被测试精确排出来。 */
function manual(behaviour = {}) {
  const spoken = [];
  const cap = createAudioCapability({ environment: {} });
  const synth = {
    paused: false,
    speak(u) { spoken.push(u); if (behaviour.throwOnSpeak) throw new Error('speak refused'); },
    cancel() { if (behaviour.onCancel) behaviour.onCancel(); },
    getVoices: () => [],
    addEventListener() {},
  };
  const speech = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['go'] } }, foeLineCfg: () => null, onChange: () => {},
    environment: { speechSynthesis: synth, SpeechSynthesisUtterance: Utt },
    capability: cap, utteranceTimeoutMs: behaviour.timeoutMs,
  });
  return { speech, cap, spoken, wait: ms => new Promise(r => setTimeout(r, ms)) };
}

function harness(behaviour = {}) {
  const spoken = [];
  const cap = createAudioCapability({ environment: {} });
  const synth = {
    paused: false,
    speak(u) {
      spoken.push(u);
      if (behaviour.throwOnSpeak) throw new Error('speak refused');
      if (behaviour.silent) return;                 // 接了但什么也不做：真机上的静默失败
      if (behaviour.autoEnd !== false) {
        setTimeout(() => { if (u.onend) u.onend({ target: u }); }, 0);
      }
    },
    cancel() {},
    getVoices: () => [{ lang: 'en-US', name: 'Samantha', localService: true }],
    addEventListener() {},
  };
  const speech = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['go'] } }, foeLineCfg: () => null, onChange: () => {},
    environment: { speechSynthesis: synth, SpeechSynthesisUtterance: Utt },
    capability: cap,
  });
  return { speech, cap, spoken, synth };
}

const tick = () => new Promise(r => setTimeout(r, 0));

test('a successful utterance marks the speech channel available', async () => {
  const { speech, cap, spoken } = harness();
  cap.beginProbe(CHANNEL.SPEECH);
  assert.equal(speech.word('apple'), true);
  await tick(); await tick();
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
  assert.equal(cap.snapshot().channel, CHANNEL.SPEECH);
  assert.equal(cap.snapshot().claim, '接口已就绪，实际播放仍需设备验证');
  assert.ok(spoken.length > 0);
});

test('a speak() that throws is reported as a failure state instead of being swallowed', async () => {
  const { speech, cap } = harness({ throwOnSpeak: true });
  cap.beginProbe(CHANNEL.SPEECH);
  assert.equal(speech.word('apple'), false);
  await tick();
  assert.equal(cap.snapshot().state, STATUS.BLOCKED);
  assert.equal(cap.snapshot().reason, 'utterance-error');
});

test('an utterance onerror is reported as a failure state', async () => {
  const { speech, cap, spoken } = harness({ autoEnd: false });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  await tick();
  const u = spoken[spoken.length - 1];
  u.onerror({ error: 'synthesis-failed' });
  assert.equal(cap.snapshot().state, STATUS.BLOCKED);
  assert.equal(cap.snapshot().reason, 'utterance-error');
});

test('an utterance that never ends nor errors is reported by a timeout, not silently accepted', async () => {
  const { speech, cap } = harness({ silent: true });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  await tick();
  assert.equal(cap.snapshot().state, STATUS.CHECKING, '还没超时之前不许下结论');
  speech._probeTimers && speech._probeTimers.forEach(clearTimeout);
  // 用注入的短超时重跑一遍，验证超时真的会翻成 blocked
  const cap2 = createAudioCapability({ environment: {} });
  const s2 = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: {} }, foeLineCfg: () => null, onChange: () => {},
    environment: {
      speechSynthesis: { speak() {}, cancel() {}, getVoices: () => [], addEventListener() {} },
      SpeechSynthesisUtterance: Utt,
    },
    capability: cap2, utteranceTimeoutMs: 20,
  });
  cap2.beginProbe(CHANNEL.SPEECH);
  s2.word('apple');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(cap2.snapshot().state, STATUS.BLOCKED);
  assert.equal(cap2.snapshot().reason, 'utterance-timeout');
});

test('listeners are added without cancelling callbacks another module already set', async () => {
  const { speech, spoken } = harness({ autoEnd: false });
  const u = new Utt('probe');
  let mine = 0, theirs = 0;
  u.onend = () => { mine++; };
  u.onerror = () => { theirs++; };
  speech.watchUtterance(u);
  u.onend({ target: u });
  u.onerror({ error: 'x' });
  assert.equal(mine, 1, '我自己的回调必须还在');
  assert.equal(theirs, 1, '别人先挂的回调不许被覆盖掉');
});

test('watchUtterance is a no-op on a non-utterance and never throws', async () => {
  const { speech } = harness();
  assert.doesNotThrow(() => { speech.watchUtterance(null); speech.watchUtterance({}); });
});

test('the priming utterance stays silent: the probe must not shout at the player', async () => {
  const { speech, spoken } = harness();
  speech.unlock();
  await tick();
  const priming = spoken[0];
  assert.ok(priming, 'unlock 仍然要做空串暖机');
  assert.equal(priming.volume, 0, '暖机必须是 volume=0');
  assert.equal(String(priming.text).trim(), '', '暖机内容必须为空串');
});

test('watching never speaks: no extra utterance is queued by observation', async () => {
  const { speech, spoken } = harness({ autoEnd: false });
  const before = spoken.length;
  speech.watchUtterance(new Utt('x'));
  assert.equal(spoken.length, before, '观测动作本身不许发声');
});

test('turning the voice off is a preference, never a failure state', async () => {
  const { speech, cap } = harness();
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  await tick(); await tick();
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
  speech.setOn(false);
  assert.equal(speech.word('apple'), false, '关掉之后当然不念');
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE, '玩家自己关的，不是故障');
  assert.equal(cap.snapshot().muted, false);
});

test('the old createSpeech signature still works with no capability injected', async () => {
  const speech = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['go'] } }, foeLineCfg: () => null, onChange: () => {},
    environment: {},
  });
  assert.equal(speech.supported, false);
  assert.doesNotThrow(() => speech.unlock());
});

/* ================= 取消朗读不误报 / 定时探测归属 ================= */

test('a real cancel is not a failure: interrupting our own utterance never nags', async () => {
  const { speech, cap, spoken } = manual({ timeoutMs: 40 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  const u = spoken[0];
  speech.stop();                        // 新一句/退出会 cancel 在念的那句
  u.onerror({ error: 'interrupted' });  // 真机上 cancel 就是这么收尾的
  assert.notEqual(cap.snapshot().state, STATUS.BLOCKED, '自己叫停的取消不是故障');
  assert.equal(speech.on, true, '取消绝不许顺手动玩家的朗读开关');
});

test('the onerror classes meaning "stopped on purpose" are never a fault', async () => {
  for (const error of ['canceled', 'cancelled', 'interrupted']) {
    const { speech, cap, spoken } = manual({ timeoutMs: 40 });
    cap.beginProbe(CHANNEL.SPEECH);
    speech.word('apple');
    spoken[0].onerror({ error });
    assert.notEqual(cap.snapshot().state, STATUS.BLOCKED, error + ' 不该被判成故障');
  }
});

test('a real synthesis error is still reported even though cancels are not', async () => {
  const { speech, cap, spoken } = manual({ timeoutMs: 40 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  spoken[0].onerror({ error: 'not-allowed' });
  assert.equal(cap.snapshot().state, STATUS.BLOCKED, '真的放不出声必须看得见');
  assert.equal(cap.snapshot().reason, 'utterance-error');
});

test('a late onend from a cancelled utterance cannot clear the new utterance timer', async () => {
  const { speech, cap, spoken, wait } = manual({ timeoutMs: 40 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('first');
  const old = spoken[0];
  speech.stop();                        // 把它取消
  speech.word('second');                // 新一句开始观测
  assert.equal(spoken.length, 2);
  old.onend({ target: old });           // 旧 utterance 的 end 迟到
  await wait(90);                       // 新一句自己的超时必须仍然能触发
  assert.equal(cap.snapshot().state, STATUS.BLOCKED, '新一句的探测不许被旧 end 清掉');
  assert.equal(cap.snapshot().reason, 'utterance-timeout');
});

test('a late onerror from a superseded utterance cannot overwrite the new success', async () => {
  const { speech, cap, spoken } = manual({ timeoutMs: 40 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('first');
  const old = spoken[0];
  speech.word('second');
  spoken[1].onend({ target: spoken[1] });        // 新一句正常念完
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
  old.onerror({ error: 'synthesis-failed' });    // 旧的错误迟到
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE, '旧 utterance 的错误不许覆盖新结果');
});

test('stop() disarms the pending probe timer instead of leaving it to fire later', async () => {
  const { speech, cap, wait } = manual({ timeoutMs: 40 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  assert.ok(speech._probeTimers.length > 0, '开探测时确实有定时器');
  speech.stop();
  assert.equal(speech._probeTimers.length, 0, '取消必须把定时器收掉');
  await wait(90);
  assert.notEqual(cap.snapshot().state, STATUS.BLOCKED, '自己停的绝不翻成 blocked');
});

test('onstart means the interface works: it disarms the deadline and never claims audible', async () => {
  const { speech, cap, spoken, wait } = manual({ timeoutMs: 60 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('a very long sentence that keeps talking for a long time');
  spoken[0].onstart({ target: spoken[0] });
  const s = cap.snapshot();
  assert.equal(s.state, STATUS.AVAILABLE, '开口了就说明接口可用');
  assert.equal(s.claim, '接口已就绪，实际播放仍需设备验证', '不许声称真机能听见');
  await wait(120);
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE, '开口后不许再被固定 deadline 误判');
});

test('a long utterance that starts normally is not falsely blocked by a short deadline', async () => {
  const cap = createAudioCapability({ environment: {} });
  const spoken = [];
  const synth = {
    paused: false, cancel() {},
    speak(u) {
      spoken.push(u);
      setTimeout(() => { if (u.onstart) u.onstart({ target: u }); }, 5);
    },
    getVoices: () => [], addEventListener() {},
  };
  const speech = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['go'] } }, foeLineCfg: () => null, onChange: () => {},
    environment: { speechSynthesis: synth, SpeechSynthesisUtterance: Utt },
    capability: cap, utteranceTimeoutMs: 30,   // 比开口还短：开口就足以证明接口可用
  });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('x'.repeat(200));
  await new Promise(r => setTimeout(r, 120));
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE, '正常开口的长句不许被误报 blocked');
});

test('a silent utterance with neither start nor end still times out as blocked', async () => {
  const { speech, cap, wait } = manual({ timeoutMs: 40 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  await wait(30);
  assert.equal(cap.snapshot().state, STATUS.CHECKING, '还没到点不许下结论');
  await wait(60);
  assert.equal(cap.snapshot().state, STATUS.BLOCKED, '静默失败必须看得见');
  assert.equal(cap.snapshot().reason, 'utterance-timeout');
});

test('the previous onend handler receives the real event, not a fabricated one', async () => {
  const { speech } = manual({ timeoutMs: 40 });
  const u = new Utt('probe');
  const ev = { type: 'end', target: u, marker: 'the-real-event' };
  let got = null;
  u.onend = (e) => { got = e; };
  speech.watchUtterance(u);
  u.onend(ev);
  assert.equal(got, ev, '必须把浏览器给的那个真事件原样传下去');
  assert.equal(got.marker, 'the-real-event');
});

test('a throwing callback from another module never masks the probe result', async () => {
  const { speech, cap } = manual({ timeoutMs: 40 });
  const u = new Utt('probe');
  u.onend = () => { throw new Error('别的模块炸了'); };
  cap.beginProbe(CHANNEL.SPEECH);
  assert.doesNotThrow(() => { speech.watchUtterance(u); u.onend({ target: u }); });
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE, '别人的异常不许遮住探测结论');
});

test('no capability injected means no watch and no probe timers at all', async () => {
  const spoken = [];
  const synth = {
    paused: false, cancel() {},
    speak(u) { spoken.push(u); },            // 静默：没 cap 就没人观测，也不该留定时器
    getVoices: () => [], addEventListener() {},
  };
  const speech = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['go'] } }, foeLineCfg: () => null, onChange: () => {},
    environment: { speechSynthesis: synth, SpeechSynthesisUtterance: Utt },
  });
  assert.equal(speech.word('apple'), true);
  assert.equal(speech._probeTimers.length, 0, '没注入 capability 就不许开探测定时器');
  assert.equal(spoken[0].onend, undefined, '没注入 capability 就不许改写 utterance 回调');
});

test('an unsupported platform is not announced before the player preference is known', async () => {
  const cap = createAudioCapability({ environment: {} });
  const speech = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['go'] } }, foeLineCfg: () => null, onChange: () => {},
    environment: {},                        // 平台压根没有 speechSynthesis
    capability: cap,
  });
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN, '构造时绝不许抢先报 no-api');
  // 父层随后恢复存档：这位玩家本来就是把朗读关掉的
  speech.setOn(false);
  speech.unlock();
  assert.equal(speech.word('apple'), false);
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN, '关掉朗读的人不该被提示');
  // 玩家自己开着却还是放不出声 → 这时才判定
  speech.setOn(true);
  speech.unlock();
  assert.equal(cap.snapshot().state, STATUS.UNSUPPORTED);
  assert.equal(cap.snapshot().reason, 'no-api');
});

test('turning the voice off clears a stale failure prompt without touching the preference', async () => {
  const { speech, cap, spoken } = manual({ timeoutMs: 40 });
  cap.beginProbe(CHANNEL.SPEECH);
  speech.word('apple');
  spoken[0].onerror({ error: 'synthesis-failed' });
  assert.equal(cap.snapshot().state, STATUS.BLOCKED);
  speech.setOn(false);
  assert.equal(speech.on, false, '偏好照旧是 false');
  assert.notEqual(cap.snapshot().state, STATUS.BLOCKED, '玩家自己关的，不该继续挂着故障提示');
  assert.equal(cap.snapshot().muted, false, '关朗读是偏好，不是静音故障');
});
