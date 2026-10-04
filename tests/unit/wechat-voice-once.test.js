import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioCapability, CHANNEL, STATUS } from '../../src/services/audio-capability.js';
import { createSpeech } from '../../src/services/speech.js';
import { createAudioCompatibility, compatNoticeText } from '../../src/ui/components/audio-compatibility.js';
import { voiceState } from '../../src/ui/components/audio-settings.js';

function doc() {
  return { getElementById: () => null, createElement(tag) {
    return { tagName: tag, children: [], hidden: false, textContent: '',
      setAttribute() {}, appendChild(n) { this.children.push(n); return n; },
      get firstChild() { return this.children[0] || null; },
      removeChild(n) { this.children.splice(this.children.indexOf(n), 1); } };
  } };
}
const find = (n, id) => n.id === id ? n : n.children.map(c => find(c, id)).find(Boolean);
const wx = { navigator: { userAgent: 'Mozilla/5.0 MicroMessenger/8.0.50' } };

test('restoring a wanted speech preference reports a missing API without a gesture or any utterance', () => {
  const cap = createAudioCapability({ environment: wx });
  const speech = createSpeech({ environment: wx, capability: cap });
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN, 'construction precedes preference restoration');
  speech.setOn(false);
  assert.equal(cap.snapshot().state, STATUS.UNKNOWN, 'the player chose silence');
  speech.setOn(true);
  assert.equal(cap.channelState(CHANNEL.SPEECH), STATUS.UNSUPPORTED);
  assert.equal(cap.snapshot().reason, 'no-api');
  assert.equal(speech._spoke, 0);
  assert.equal(speech.unlocked, false, 'capability reporting must not fabricate a gesture');
});

test('each failed channel publishes even when another failure still wins the merged rank', () => {
  const events = [];
  const cap = createAudioCapability({ environment: wx, onStatus: s => events.push(s) });
  cap.rejectProbe(CHANNEL.SFX, 'blocked');
  const before = events.length;
  cap.reportUtteranceFailure(CHANNEL.SPEECH, 'utterance-error', 'not-allowed');
  assert.equal(events.length, before + 1, 'settings must learn that speech also failed');
  assert.equal(cap.channelSnapshot(CHANNEL.SPEECH).reason, 'utterance-error');
  assert.equal(cap.channelSnapshot(CHANNEL.SFX).reason, 'resume-rejected');
  cap.dismiss(CHANNEL.SFX);
  assert.equal(cap.isDismissed(CHANNEL.SFX), true);
  assert.equal(cap.isDismissed(CHANNEL.SPEECH), false, 'closing a sound-effect notice cannot hide speech');
});

test('closing a real failure delegates one channel fact, keeps a readable help section and survives remount', () => {
  const document = doc(), host = document.createElement('main');
  const cap = createAudioCapability({ environment: wx });
  cap.noCapability(CHANNEL.SPEECH);
  const seen = { future: 'preserve' }, writes = [];
  const ports = { capability: cap, document, getNoticeSeen: channel => seen[channel] === true,
    onNoticeSeen: channel => { writes.push(channel); seen[channel] = true; } };
  const first = createAudioCompatibility(ports).mount(host);
  assert.equal(first.root.hidden, false);
  find(first.root, 'acomp-dismiss').onclick();
  assert.deepEqual(writes, ['speech']);
  assert.equal(first.root.hidden, true);
  const help = find(host, 'audioCompatibility-help');
  assert.ok(help, 'there must still be an accessible route to the browser instructions');
  assert.equal(help.hidden, false);
  assert.equal(help.open, false, 'help must not reopen itself after dismissal');
  const cap2 = createAudioCapability({ environment: wx });
  cap2.noCapability(CHANNEL.SPEECH);
  const nextHost = document.createElement('main');
  const next = createAudioCompatibility({ ...ports, capability: cap2 }).mount(nextHost);
  assert.equal(next.root.hidden, true, 'persisted true is authoritative after reload');
  assert.equal(find(nextHost, 'audioCompatibility-help').hidden, false);
  assert.equal(seen.future, 'preserve');
});

test('a seen sound-effect failure cannot mask an unseen speech failure', () => {
  const document = doc(), cap = createAudioCapability({ environment: wx });
  cap.rejectProbe(CHANNEL.SFX, 'blocked');
  cap.reportUtteranceFailure(CHANNEL.SPEECH, 'utterance-error', 'not-allowed');
  const view = createAudioCompatibility({ capability: cap, document,
    getNoticeSeen: channel => channel === CHANNEL.SFX }).mount(document.createElement('main'));
  assert.equal(view.root.hidden, false);
  assert.match(view.title.textContent, /朗读/);
});

test('a failed speech interface remains switchable and has a static status even after the prompt was seen', () => {
  const state = voiceState(true, true, STATUS.BLOCKED);
  assert.equal(state.text, '暂不可用');
  assert.equal(state.disabled, false, 'failure is not the player choosing to turn voice off');
  assert.match(state.note, /朗读|语音/);
  assert.equal(voiceState(true, false, STATUS.BLOCKED).text, '已关');
  assert.equal(voiceState(true, true, STATUS.AVAILABLE).text, '开启');
});

test('WeChat failure advice names real alternatives without promising that sound is guaranteed', () => {
  const view = compatNoticeText({ state: STATUS.BLOCKED, channel: CHANNEL.SPEECH, wechat: true });
  assert.match(view.body, /Chrome/);
  assert.match(view.body, /Edge/);
  assert.match(view.body, /Safari/);
  assert.match(view.body, /安卓版/);
  assert.doesNotMatch(view.body, /一定|保证|必须下载/);
  assert.deepEqual(view.actions.map(a => a.id), ['dismiss']);
});

test('missing or throwing notice callbacks never block practice, and a WeChat UA alone stays quiet', () => {
  const document = doc(), cap = createAudioCapability({ environment: wx });
  const mount = () => createAudioCompatibility({ capability: cap, document,
    getNoticeSeen() { throw new Error('unavailable'); },
    onNoticeSeen() { throw new Error('quota'); } }).mount(document.createElement('main'));
  assert.equal(mount().root.hidden, true);
  cap.observeOk(CHANNEL.SPEECH);
  assert.equal(mount().root.hidden, true);
  cap.noCapability(CHANNEL.SPEECH);
  const view = mount();
  assert.equal(view.root.hidden, false);
  assert.doesNotThrow(() => find(view.root, 'acomp-dismiss').onclick());
  assert.equal(view.root.hidden, true);
});

test('WeChat retains voluntary collapsed help without claiming an observed-successful interface failed', () => {
  const document = doc(), cap = createAudioCapability({ environment: wx });
  cap.observeOk(CHANNEL.SPEECH);
  const host = document.createElement('main');
  const view = createAudioCompatibility({ capability: cap, document }).mount(host);
  assert.equal(view.root.hidden, true, 'UA alone must not produce a failure banner');
  const help = find(host, 'audioCompatibility-help');
  assert.equal(help.hidden, false, 'the player may still hear nothing even when the API says started');
  assert.equal(help.open, false);
  assert.match(help.children[1].children[0].textContent, /如果没有听见读音/);
  assert.doesNotMatch(help.children[1].children[0].textContent, /不支持朗读|暂未能朗读/);
});
