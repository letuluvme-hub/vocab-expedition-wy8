/* 浏览器音频兼容层：探测状态机（RED/GREEN 垂直切片 1）
 *
 * 这里只测「状态怎么变」，不测 DOM、不测真机。
 * 铁律：不许拿 UA 是不是微信当失败判据 —— UA 只决定提示文案。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createAudioCapability, STATUS, CHANNEL } =
  await import('../../src/services/audio-capability.js');

/* 假环境：可控的 timer + 假 UA，不碰真浏览器。 */
function harness(over = {}) {
  const timers = new Map();
  let seq = 0;
  const cap = createAudioCapability({
    environment: over.environment || {},
    resumeTimeoutMs: over.resumeTimeoutMs != null ? over.resumeTimeoutMs : 800,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => { timers.delete(id); },
  });
  return {
    cap,
    fire(id) { const t = timers.get(id); if (!t) return false; timers.delete(id); t.fn(); return true; },
    pending() { return timers.size; },
  };
}

test('capability starts unknown and never claims to be audible before it is observed', () => {
  const { cap } = harness();
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN);
  assert.equal(cap.snapshot().channel, null);
  assert.equal(cap.snapshot().reason, null);
});

test('sfx becomes available only after a real running context is observed, and says so conservatively', () => {
  const { cap } = harness();
  cap.beginProbe(CHANNEL.SFX);
  assert.equal(cap.snapshot().state, STATUS.CHECKING);
  cap.resolveProbe(CHANNEL.SFX, { state: 'running' });
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
  // 接口就绪 ≠ 真机可听：文案必须留出这句余地
  assert.equal(cap.snapshot().claim, '接口已就绪，实际播放仍需设备验证');
});

test('a rejected resume promise is a blocked failure state, not a mute or off preference', () => {
  const { cap } = harness();
  cap.beginProbe(CHANNEL.SFX);
  cap.rejectProbe(CHANNEL.SFX, 'NotAllowedError');
  const s = cap.snapshot();
  assert.equal(s.state, STATUS.BLOCKED);
  assert.equal(s.channel, CHANNEL.SFX);
  assert.equal(s.reason, 'resume-rejected');
  // 静音 / 关闭朗读是玩家选择，永远不算故障，也不许自动改回来
  assert.equal(s.requiresUserAction, true);
  assert.equal(cap.snapshot().muted, false);
});

test('a context that stays suspended past the timeout reports blocked, and a later running resolves it', () => {
  const h = harness();
  const { cap } = h;
  cap.beginProbe(CHANNEL.SFX);
  cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });
  // 仍在挂起：还不能下结论
  assert.equal(cap.snapshot().state, STATUS.CHECKING);
  assert.equal(h.pending(), 1);
  const ok = h.fire(1);
  assert.equal(ok, true);
  assert.equal(cap.snapshot().state, STATUS.BLOCKED);
  assert.equal(cap.snapshot().reason, 'resume-timeout');
  // 之后的真实手势恢复成功 → 回到 available，提示可撤销
  cap.beginProbe(CHANNEL.SFX);
  cap.resolveProbe(CHANNEL.SFX, { state: 'running' });
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
});

test('a pending suspended timeout is cancelled once the context actually starts', () => {
  const h = harness();
  const { cap } = h;
  cap.beginProbe(CHANNEL.SFX);
  cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });
  assert.equal(h.pending(), 1);
  cap.resolveProbe(CHANNEL.SFX, { state: 'running' });
  assert.equal(h.pending(), 0, 'resolved 之后不许留下野生定时器');
  h.fire(1);
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);
});

/* ---- 两路定时器归属：音效与朗读各自只撤自己的那一个 ----
 *
 * ★ 这里修的是一个真实的静音化 bug：兼容层原来只有**一个** pendingResume 槽位。
 *   于是朗读那一路任何一次成功（observeOk）、玩家关掉朗读（setEnabled(false)）、
 *   或朗读没 API（noCapability）都会顺手把**音效**那路的挂起超时撤掉 ——
 *   而音效那路还挂在 suspended 上，从此永远停在 checking，再也不会报
 *   「浏览器放不出音效」。玩家点多少下都得不到任何说法。
 *   判据必须是「sfx 自己的超时定时器仍然活着，并且仍然能把 sfx 判成 blocked」。 */
test('a speech success never cancels the pending sfx resume watch', () => {
  const h = harness();
  const { cap } = h;
  cap.beginProbe(CHANNEL.SFX);
  cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });
  assert.equal(h.pending(), 1);
  cap.beginProbe(CHANNEL.SPEECH);
  cap.observeOk(CHANNEL.SPEECH);
  assert.equal(cap.channelState(CHANNEL.SPEECH), STATUS.AVAILABLE);
  assert.equal(h.pending(), 1, '朗读成功不许撤掉音效那路的挂起超时');
  assert.equal(h.fire(1), true, '音效的超时定时器必须还在');
  assert.equal(cap.channelState(CHANNEL.SFX), STATUS.BLOCKED);
  // 合并快照归「最需要注意」的一路：音效 blocked 压过朗读 available，且 reason 如实是音效的
  const s = cap.snapshot();
  assert.equal(s.channel, CHANNEL.SFX);
  assert.equal(s.reason, 'resume-timeout');
});

test('turning the voice off never cancels the pending sfx resume watch', () => {
  const h = harness();
  const { cap } = h;
  cap.beginProbe(CHANNEL.SFX);
  cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });
  cap.disableChannel(CHANNEL.SPEECH);
  assert.equal(cap.isEnabled(CHANNEL.SPEECH), false);
  assert.equal(h.pending(), 1, '关掉朗读只撤朗读自己的观察，不许碰音效');
  h.fire(1);
  assert.equal(cap.channelState(CHANNEL.SFX), STATUS.BLOCKED);
});

test('a speech failure or a missing speech API never cancels the pending sfx resume watch', () => {
  const a = harness();
  a.cap.beginProbe(CHANNEL.SFX);
  a.cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });
  a.cap.noCapability(CHANNEL.SPEECH);
  assert.equal(a.pending(), 1, '朗读没 API 不许撤掉音效的挂起超时');
  a.fire(1);
  assert.equal(a.cap.channelState(CHANNEL.SFX), STATUS.BLOCKED);

  const b = harness();
  b.cap.beginProbe(CHANNEL.SFX);
  b.cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });
  b.cap.reportUtteranceFailure(CHANNEL.SPEECH, 'utterance-error', 'network');
  assert.equal(b.pending(), 1, '朗读报错不许撤掉音效的挂起超时');
  b.fire(1);
  assert.equal(b.cap.channelState(CHANNEL.SFX), STATUS.BLOCKED);
});

test('each channel clears only its own resume watch, and dispose clears both', () => {
  const h = harness();
  const { cap } = h;
  cap.beginProbe(CHANNEL.SFX);
  cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });     // timer 1
  cap.beginProbe(CHANNEL.SPEECH);
  cap.resolveProbe(CHANNEL.SPEECH, { state: 'suspended' });   // timer 2
  assert.equal(h.pending(), 2, '两路各自一个挂起超时');
  cap.resolveProbe(CHANNEL.SFX, { state: 'running' });
  assert.equal(h.pending(), 1, 'sfx 跑通只撤 sfx 自己的那一个，朗读的仍在');
  cap.dispose();
  assert.equal(h.pending(), 0, 'dispose 必须把两路都收干净，不留野生定时器');
});

test('a retry gesture keeps an existing failure on screen instead of blanking the notice', () => {
  const h = harness();
  const { cap } = h;
  cap.beginProbe(CHANNEL.SFX);
  cap.rejectProbe(CHANNEL.SFX, 'NotAllowedError');
  assert.equal(cap.snapshot().state, STATUS.BLOCKED);
  // ★ 再来一次真实手势（玩家点「知道了」的那一下本身就是手势）：
  //   这一路已经有结论了，重试期间**必须继续显示**这条结论。
  //   曾经写成一律回 checking —— 于是「知道了」按钮被 pointerdown 触发的重试
  //   顺手藏掉，用户的 click 落在空气上，提示条又弹回来，永远关不掉。
  cap.beginProbe(CHANNEL.SFX);
  assert.equal(cap.snapshot().state, STATUS.BLOCKED, '重试期间不许把已有结论降级成 checking');
  assert.equal(cap.canRetry(), true, '但确实在重试了：canRetry 必须为真');
  // 重试成功才撤掉提示
  cap.resolveProbe(CHANNEL.SFX, { state: 'running' });
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE);

  // ★ 同一条链上的第二处：resume 落地时 state 仍是 suspended，
  //   resolveProbe 也曾一律回 checking —— 提示条照样在 click 之前被藏掉。
  const g = harness();
  g.cap.beginProbe(CHANNEL.SFX);
  g.cap.rejectProbe(CHANNEL.SFX, 'NotAllowedError');
  g.cap.beginProbe(CHANNEL.SFX);
  g.cap.resolveProbe(CHANNEL.SFX, { state: 'suspended' });
  assert.equal(g.cap.snapshot().state, STATUS.BLOCKED, '挂起期间已有结论不许被降级');
  assert.equal(g.pending(), 1, '但超时兜底照旧要挂上（结论可能被后来的成功推翻）');
  g.cap.resolveProbe(CHANNEL.SFX, { state: 'running' });
  assert.equal(g.cap.snapshot().state, STATUS.AVAILABLE);
});

test('missing platform capability is unsupported, which reads differently from blocked', () => {
  const { cap } = harness();
  cap.noCapability(CHANNEL.SPEECH);
  const s = cap.snapshot();
  assert.equal(s.state, STATUS.UNSUPPORTED);
  assert.equal(s.channel, CHANNEL.SPEECH);
  assert.equal(s.reason, 'no-api');
});

test('a WeChat user agent alone never turns into a failure state', () => {
  const { cap } = harness({
    environment: { navigator: { userAgent: 'Mozilla/5.0 (iPhone) MicroMessenger/8.0.40' } },
  });
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN);
  assert.equal(cap.snapshot().wechat, true, 'UA 只用来选文案');
  cap.beginProbe(CHANNEL.SFX);
  cap.resolveProbe(CHANNEL.SFX, { state: 'running' });
  assert.equal(cap.snapshot().state, STATUS.AVAILABLE, '真跑起来了就是可用，微信也不例外');
});

test('a plain non-WeChat user agent is not flagged as WeChat', () => {
  const { cap } = harness({
    environment: { navigator: { userAgent: 'Mozilla/5.0 (iPhone) Version/17.0 Safari/605.1' } },
  });
  assert.equal(cap.snapshot().wechat, false);
});
