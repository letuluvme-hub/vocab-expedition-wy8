/* 音频服务侧的失败观测（RED/GREEN 垂直切片 2）
 *
 * 契约：createAudio 多接受两个**可选**注入 —— capability（探测状态机）与
 * environment（已有）。老调用方只传 { getCombo } 的签名必须原样能跑。
 * 关注点只有三件：真实手势里 try+resume、resume 的 promise 拒绝要被抓到、
 * 以及不该自作主张的事（后台回来不自动 resume、closed 上下文不无限重建）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createAudio } = await import('../../src/services/audio.js');
const { createAudioCapability, CHANNEL, STATUS } =
  await import('../../src/services/audio-capability.js');

/* 假 AudioContext：只实现探测需要的那几个成员，不碰真 WebAudio。 */
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });

function fakeCtx(behaviour = {}) {
  const c = {
    state: behaviour.initialState || 'suspended',
    resumeCalls: 0,
    closeCalls: 0,
    sampleRate: 48000,
    currentTime: 0,
    destination: {},
    createWaveShaper: () => ({ curve: null, oversample: 'none', connect() {}, disconnect() {} }),
    createGain: () => ({ gain: param(), connect() {}, disconnect() {} }),
    createConvolver: () => ({ buffer: null, connect() {}, disconnect() {} }),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createOscillator: () => ({ type: 'sine', frequency: param(), connect() {}, disconnect() {}, start() {}, stop() {} }),
    createBiquadFilter: () => ({ type: 'lowpass', frequency: param(), Q: param(), connect() {}, disconnect() {} }),
    createBufferSource: () => ({ buffer: null, loop: false, playbackRate: param(), connect() {}, disconnect() {}, start() {}, stop() {} }),
    resume() {
      c.resumeCalls++;
      if (behaviour.throwSync) throw behaviour.throwSync;
      if (behaviour.reject) return Promise.reject(behaviour.reject);
      if (behaviour.staySuspended) return Promise.resolve();
      c.state = 'running';
      return Promise.resolve();
    },
    close() { c.closeCalls++; c.state = 'closed'; return Promise.resolve(); },
  };
  return c;
}

function harness(behaviour = {}, ua = '') {
  const cap = createAudioCapability({ environment: { navigator: { userAgent: ua } } });
  const made = [];
  const Ctor = function () { const c = fakeCtx(behaviour); made.push(c); return c; };
  const audio = createAudio({
    getCombo: () => 0,
    environment: { AudioContext: Ctor, navigator: { userAgent: ua } },
    capability: cap,
  });
  // 每个 AudioContext 构造都是一个**新**对象，和真浏览器一致
  return { cap, made, audio, AU: audio.AU, sfx: audio.sfx };
}

const tick = () => new Promise(r => setTimeout(r, 0));

test('the old createAudio signature still works: no capability injected, nothing throws', async () => {
  const { AU, sfx } = createAudio({ getCombo: () => 0, environment: {} });
  assert.doesNotThrow(() => { AU.unlock(); sfx.good(); sfx.ui(); });
  assert.equal(AU.ctx(), null);
});

test('a real gesture unlock that reaches running reports the sfx channel available', async () => {
  const { cap, AU } = harness();
  cap.beginProbe(CHANNEL.SFX);
  AU.unlock();
  await tick();
  assert.equal(AU.ac.resumeCalls, 1);
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
  assert.equal(cap.snapshot().channel, CHANNEL.SFX);
  // 措辞必须留余地：API 成功不等于真机能听见
  assert.equal(cap.snapshot().claim, '接口已就绪，实际播放仍需设备验证');
});

test('a rejected resume promise is caught and reported as blocked, never an unhandled rejection', async () => {
  const { cap, AU } = harness({ reject: 'NotAllowedError' });
  cap.beginProbe(CHANNEL.SFX);
  assert.doesNotThrow(() => AU.unlock());
  await tick();
  await tick();
  const s = cap.snapshot();
  assert.equal(s.state, STATUS.BLOCKED);
  assert.equal(s.reason, 'resume-rejected');
  assert.equal(s.muted, false, '被浏览器拒绝不是玩家静音');
});

test('a resume that throws synchronously is caught and reported as blocked', async () => {
  const { cap, AU } = harness({ throwSync: new Error('boom') });
  cap.beginProbe(CHANNEL.SFX);
  assert.doesNotThrow(() => AU.unlock());
  await tick();
  assert.equal(cap.snapshot().state, STATUS.BLOCKED);
  assert.equal(cap.snapshot().reason, 'resume-rejected');
});

test('a context that stays suspended is left to the capability timeout, not declared working', async () => {
  const { cap, AU } = harness({ staySuspended: true });
  cap.beginProbe(CHANNEL.SFX);
  AU.unlock();
  await tick();
  assert.equal(AU.ac.state, 'suspended');
  assert.equal(cap.snapshot().state, STATUS.CHECKING, '还没结论，不能报可用');
});

test('returning to the foreground does not autonomously resume the context', async () => {
  const { AU } = harness({ staySuspended: true });
  AU.unlock();
  await tick();
  const before = AU.ac.resumeCalls;
  // 页面切后台再回来：绝不能自己 resume（那会绕过自动播放策略）
  assert.equal(AU.handleVisibility(true), null);
  assert.equal(AU.ac.resumeCalls, before, '后台返回不许自动 resume');
  // 下一个真实手势才允许再试
  AU.unlock();
  await tick();
  assert.equal(AU.ac.resumeCalls, before + 1);
});

test('a closed context is replaced by rebuilding, and rebuilds are bounded', async () => {
  const { cap, AU, made } = harness({});
  cap.beginProbe(CHANNEL.SFX);
  AU.unlock();
  await tick();
  const first = AU.ac;
  assert.equal(first.resumeCalls, 1);
  // 浏览器把上下文关掉后，声音永远不会回来：必须能换一个新的
  first.state = 'closed';
  AU.unlock();
  await tick();
  assert.notEqual(AU.ac, first, 'closed 的上下文必须被换掉');
  assert.equal(made.length, 2, '真的重新构造了一个 AudioContext');
  assert.equal(AU.rebuilds, 1);
  assert.equal(AU.ctx().state, 'running', '新上下文要真的能用');
});

test('rebuilds stop at the cap so a browser killing contexts cannot leak or loop', async () => {
  const { AU } = harness({});
  for (let i = 0; i < 12; i++) { if (AU.ac) AU.ac.state = 'closed'; AU.unlock(); }
  assert.ok(AU.rebuilds <= AU.maxRebuilds, '重建次数必须封顶：rebuilds=' + AU.rebuilds);
  assert.ok(AU.maxRebuilds >= 1 && AU.maxRebuilds <= 5, '封顶值要小而够用');
});

test('voice bookkeeping only ever decrements a positive count', async () => {
  const { AU } = harness({});
  AU.unlock();
  await tick();
  AU.voices = 0;
  AU.cleanup([]);
  assert.equal(AU.voices, 0, '计数不许被扣成负数');
  AU.voices = 3;
  AU.cleanup([]);
  assert.equal(AU.voices, 2);
});

test('muting the player is never reported as an audio failure', async () => {
  const { cap, AU, sfx } = harness({});
  cap.beginProbe(CHANNEL.SFX);
  AU.unlock();
  await tick();
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
  AU.setVol(0);
  assert.equal(AU.muted, true);
  sfx.good();
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
  assert.equal(cap.snapshot().muted, false, '静音是偏好，不是故障');
});

test('a missing AudioContext reports unsupported on the sfx channel instead of silence', async () => {
  const cap = createAudioCapability({ environment: {} });
  const audio = createAudio({ getCombo: () => 0, environment: {}, capability: cap });
  audio.AU.unlock();
  await tick();
  const s = cap.snapshot();
  assert.equal(s.state, STATUS.UNSUPPORTED);
  assert.equal(s.channel, CHANNEL.SFX);
  assert.equal(s.reason, 'no-api');
});

/* ================= 迟到 promise：同一上下文重试时的旧回调 =================
 *
 * ★ 真实场景：连点两下屏幕 → 同一个 AudioContext 上有两次 resume()，
 *   第一次那个 promise 迟到地 reject（自动播放策略竞态）。
 *   原来的守卫只有 `if(this.ac!==a) return` —— 它只挡得住「上下文被换掉」，
 *   挡不住「同一个上下文上的旧 promise」：迟到的 reject 会把第二次已经拿到的
 *   available 覆盖成 blocked，玩家看着一个明明能出声的浏览器被反复告知放不出声。
 *   判据：第二次成功之后，第一个 promise 迟到落地不许改动任何状态。 */
test('a late promise from an earlier retry never overwrites a later success', async () => {
  const resolvers = [];
  const Ctor = function () {
    const c = fakeCtx({});
    // 同一个上下文：每次 resume() 交出一个由测试手动兑现的 promise
    c.resume = () => { c.resumeCalls++; c.state = 'suspended';
      return new Promise((res, rej) => resolvers.push({ res, rej })); };
    return c;
  };
  const cap = createAudioCapability({ environment: {} });
  const { AU } = createAudio({ getCombo: () => 0,
    environment: { AudioContext: Ctor, navigator: { userAgent: '' } }, capability: cap });

  AU.setVol(.5);
  AU.unlock();                       // 第一次尝试：promise 挂着
  AU.unlock();                       // 第二次尝试（玩家又点了一下）
  assert.equal(resolvers.length, 2);
  resolvers[1].res();                // 第二次成功落地
  AU.ac.state = 'running';           // 浏览器真的把它跑起来了
  await tick(); await tick();
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);

  resolvers[0].rej(new Error('NotAllowedError'));   // 第一次那个**迟到**地拒绝
  await tick(); await tick();
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE,
    '迟到的旧 promise 不许把已经拿到的可用状态覆盖成 blocked');
});

test('the audio graph is left alone: unlock does not retune volume or rebuild nodes', async () => {
  const { AU } = harness({});
  AU.setVol(.3);
  AU.unlock();
  await tick();
  assert.equal(AU.vol, .3, '解锁不许顺手动玩家音量');
  assert.equal(AU.muted, false);
  assert.ok(AU.master && AU.dry && AU.send && AU.conv && AU.wet, '原有节点一个都不能少');
});

/* ================= 静音偏好：暖机可以，报警不行 ================= */

test('a muted player may still warm the context up, but is never told the audio is broken', async () => {
  const { cap, AU } = harness();
  AU.setVol(0);                       // 玩家自己静音：这是偏好，不是故障
  assert.equal(AU.muted, true);
  AU.unlock();                        // 静音状态下解锁：允许暖机
  await tick(); await tick();
  assert.equal(AU.ac.resumeCalls, 1, '静音也允许把上下文唤醒，省得取消静音后还要再等一次');
  // 关键：这一路被静音关着时**一个状态都不写** —— 连 checking 都不写。
  // 「试过了」本身也是对玩家鸣笛的前提，玩家没开声就不该有任何提示。
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN, '静音期间这一路不写任何结论');
  assert.equal(cap.snapshot().requiresUserAction, false, '静音绝不该被当成要玩家处理的问题');
});

test('a muted player on a platform with no AudioContext is not nagged about a missing API', async () => {
  const cap = createAudioCapability({ environment: {} });
  const audio = createAudio({ getCombo: () => 0, environment: {}, capability: cap });
  audio.AU.setVol(0);                 // 先静音，再来一次「解锁」
  audio.AU.unlock();
  await tick();
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN,
    '玩家听都不想听，报「浏览器不支持音效」纯属噪音');
});

test('unmuting after a silent warm-up re-runs the probe and can then report available', async () => {
  const { cap, AU } = harness();
  AU.setVol(0);
  AU.unlock();
  await tick(); await tick();
  assert.notEqual(cap.snapshot().state, STATUS.AVAILABLE, '静音期间不写结论');
  AU.setVol(.5);
  AU.unlock();
  await tick(); await tick();
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE, '玩家想听了，就正常给结论');
});

test('a rejected resume while the player has sound on is still reported', async () => {
  const { cap, AU } = harness({ reject: 'NotAllowedError' });
  AU.setVol(.5);
  AU.unlock();
  await tick(); await tick();
  assert.equal(cap.snapshot().state, STATUS.BLOCKED, '想听却放不出声，必须提示');
  assert.equal(cap.snapshot().reason, 'resume-rejected');
});

test('muting clears a stale sfx failure prompt, and an observed-available channel is kept', async () => {
  const { cap, AU } = harness({ reject: 'NotAllowedError' });
  AU.setVol(.5);
  AU.unlock();
  await tick(); await tick();
  assert.equal(cap.snapshot().state, STATUS.BLOCKED);
  AU.setVol(0);                          // 玩家自己静音
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN, '静音后不该继续挂着故障提示');
  // 但真的观察到过的 available 不会被偏好抹掉：那是事实，不是提示
  const ok = harness({});
  ok.AU.setVol(.5);
  ok.AU.unlock();
  await tick(); await tick();
  assert.equal(ok.cap.snapshot().state, STATUS.AVAILABLE);
  ok.AU.setVol(0);
  assert.equal(ok.cap.snapshot().state, STATUS.AVAILABLE, '观察过可用就还是可用');
});
