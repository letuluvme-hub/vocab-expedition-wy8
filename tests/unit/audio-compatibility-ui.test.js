/* 兼容提示条（RED/GREEN 垂直切片 4）
 *
 * 契约（和 audio-settings.js 一致）：只画、只派发回调。
 * 不读 DB/G/B，不写 innerHTML，不带内联 style，不联网，不加载任何录音。
 *
 * 文案的三条硬约束：
 *  - 不承诺声音一定能听见（探测只看到 API 层）；
 *  - 微信 iOS 不给「跳到 Safari」的假按钮，只教用户走右上角菜单；
 *  - 其它浏览器不教微信那套，只说「再点一下 / 检查音量」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, CHANNEL } from '../../src/services/audio-capability.js';
import { createAudioCompatibility, compatNoticeText } from '../../src/ui/components/audio-compatibility.js';

/* 极小 DOM stub，但**刻意贴近真浏览器**：
 *   - children 是只读的实时集合（真 DOM 里 children.length = 0 会在严格模式下抛 TypeError）；
 *   - 没有 innerHTML（用了就在测试里炸，正好证明模块没走这条路）；
 *   - firstChild 随增删实时更新。
 * 之前这个 stub 把 children 做成普通可写数组，掩盖了 paint() 里一个真 bug，
 * 靠真浏览器 E2E 才暴露出来 —— 所以这里必须还原真语义。 */
function stubDoc() {
  const mk = () => {
    const node = {
      _kids: [], hidden: false, disabled: false, textContent: '', id: '', type: '',
      attrs: {}, style: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this._kids.push(c); return c; },
      removeChild(c) { this._kids = this._kids.filter(x => x !== c); return c; },
      get firstChild() { return this._kids[0] || null; },
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                   contains(c) { return this._s.has(c); } },
    };
    Object.defineProperty(node, 'children', { get() { return node._kids; } });   // 只读
    Object.defineProperty(node, 'className', {
      get() { return [...node.classList._s].join(' '); },
      set(v) { node.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); },
    });
    return node;
  };
  return { createElement: mk, getElementById: () => null };
}
const text = n => (n ? n.textContent : '');
const find = (n, cls) => n.children.filter(c => c.classList.contains(cls));

test('a blocked state produces a dismissible notice that does not block practice', () => {
  const t = compatNoticeText({ state: STATUS.BLOCKED, channel: CHANNEL.SFX, reason: 'resume-timeout', wechat: false });
  assert.equal(t.visible, true);
  assert.equal(t.dismissible, true);
  assert.match(t.title, /当前浏览器暂未能播放/);
  assert.match(t.body, /不影响/);
  assert.ok(t.actions.some(a => a.id === 'dismiss'), '必须能关掉');
});

test('unknown and checking never show a notice', () => {
  assert.equal(compatNoticeText({ state: STATUS.UNKNOWN }).visible, false);
  assert.equal(compatNoticeText({ state: STATUS.CHECKING }).visible, false);
});

test('available never shows a notice and never promises audible sound', () => {
  const t = compatNoticeText({ state: STATUS.AVAILABLE, claim: '接口已就绪，实际播放仍需设备验证' });
  assert.equal(t.visible, false);
  assert.equal(compatNoticeText({ state: STATUS.AVAILABLE }).visible, false);
});

test('unsupported is explained without blaming the player', () => {
  const t = compatNoticeText({ state: STATUS.UNSUPPORTED, channel: CHANNEL.SPEECH, reason: 'no-api', wechat: false });
  assert.equal(t.visible, true);
  assert.match(t.title, /不支持/);
  assert.equal(t.dismissible, true);
});

test('a WeChat notice teaches the system-browser route and offers no fake jump button', () => {
  const t = compatNoticeText({ state: STATUS.BLOCKED, channel: CHANNEL.SFX, reason: 'resume-rejected', wechat: true });
  assert.equal(t.wechat, true);
  assert.match(t.body, /右上角/);
  assert.match(t.body, /系统浏览器|浏览器打开/);
  assert.equal(t.actions.some(a => a.id === 'open-external'), false,
    '微信里点一个按钮跳到 Safari 是做不到的，不许摆一个假的出来');
  assert.ok(t.actions.some(a => a.id === 'dismiss'));
});

test('a non-WeChat notice offers retry and volume advice, not WeChat instructions', () => {
  const t = compatNoticeText({ state: STATUS.BLOCKED, channel: CHANNEL.SFX, reason: 'resume-rejected', wechat: false });
  assert.equal(t.wechat, false);
  assert.doesNotMatch(t.body, /右上角/);
  assert.doesNotMatch(t.body, /系统浏览器/);
  assert.match(t.body, /音量|静音/);
  assert.ok(t.actions.some(a => a.id === 'retry'));
});

test('the notice separates the sound-effect channel from the read-aloud channel', () => {
  const sfx = compatNoticeText({ state: STATUS.BLOCKED, channel: CHANNEL.SFX, reason: 'resume-timeout', wechat: false });
  const tts = compatNoticeText({ state: STATUS.BLOCKED, channel: CHANNEL.SPEECH, reason: 'utterance-error', wechat: false });
  assert.notEqual(sfx.title, tts.title);
  assert.match(sfx.title, /音效/);
  assert.match(tts.title, /朗读/);
});

test('mounting renders the notice only when the state warrants it, and paints no innerHTML', () => {
  const doc = stubDoc();
  const host = doc.createElement('div');
  const seen = [];
  const ui = createAudioCompatibility({
    capability: { snapshot: () => ({ state: STATUS.BLOCKED, channel: CHANNEL.SFX, reason: 'resume-timeout', wechat: true }),
                  isDismissed: () => false, dismiss: () => {} },
    document: doc,
    onRetry: () => seen.push('retry'),
  });
  const out = ui.mount(host);
  assert.ok(out.root, '必须真的画出东西');
  assert.equal(out.root.hidden, false);
  // 遍历整棵树：既不许出现 innerHTML，也不许有内联 style
  const nodes = [];
  (function walk(n) {
    nodes.push(n);
    assert.equal(n.innerHTML, undefined, '不许用 innerHTML 拼 DOM');
    assert.equal(Object.keys(n.style || {}).length, 0, '不许带内联 style');
    (n.children || []).forEach(walk);
  })(host);
  assert.ok(nodes.length > 1, '确实画出了子节点');
  // 微信态：只有「知道了」，没有假跳转按钮
  const btnIds = find(find(out.root, 'acomp-acts')[0], 'acomp-btn').map(b => b.id);
  assert.ok(btnIds.includes('acomp-dismiss'));
  assert.equal(btnIds.includes('acomp-open-external'), false);
});

test('dismissing hides the notice for this session and fires no preference change', () => {
  const doc = stubDoc();
  const host = doc.createElement('div');
  let dismissed = false;
  const snap = () => ({ state: STATUS.BLOCKED, channel: CHANNEL.SFX, reason: 'resume-timeout', wechat: false });
  const ui = createAudioCompatibility({
    capability: { snapshot: snap, isDismissed: () => dismissed, dismiss: () => { dismissed = true; } },
    document: doc,
  });
  const out = ui.mount(host);
  assert.equal(out.root.hidden, false);
  const dismiss = find(find(out.root, 'acomp-acts')[0], 'acomp-btn').find(b => b.id === 'acomp-dismiss');
  assert.ok(dismiss, '必须有可点的关闭按钮');
  dismiss.onclick();
  assert.equal(dismissed, true, '关闭只作用于本次会话');
  ui.paint();
  assert.equal(out.root.hidden, true, '关掉之后不许再弹');
});

test('the retry action is dispatched, not self-executed', () => {
  const doc = stubDoc();
  const host = doc.createElement('div');
  const seen = [];
  const ui = createAudioCompatibility({
    capability: { snapshot: () => ({ state: STATUS.BLOCKED, channel: CHANNEL.SFX, reason: 'resume-rejected', wechat: false }),
                  isDismissed: () => false, dismiss: () => {} },
    document: doc,
    onRetry: () => seen.push('retry'),
  });
  const out = ui.mount(host);
  const retry = find(find(out.root, 'acomp-acts')[0], 'acomp-btn').find(b => b.id === 'acomp-retry');
  assert.ok(retry);
  retry.onclick();
  assert.deepEqual(seen, ['retry']);
});

test('mounting without a document or host is a safe no-op', () => {
  const ui = createAudioCompatibility({ capability: null, document: null });
  const out = ui.mount(null);
  assert.equal(out.root, null);
  assert.doesNotThrow(() => ui.paint());
});

test('a broken capability object never throws into the page', () => {
  const ui = createAudioCompatibility({
    capability: { snapshot() { throw new Error('boom'); } },
    document: stubDoc(),
  });
  const host = ui.mount(stubDoc().createElement('div'));
  assert.doesNotThrow(() => ui.paint());
  assert.equal(host.root.hidden, true);
});

/* ★ unsupported 那一支原来只说「不支持」，一个字都不提怎么办 ——
   玩家在微信里看到「这个浏览器不支持音效」只会更困惑：他不知道自己能做什么。
   微信里恰恰有明确出路（右上角菜单 → 在浏览器打开），只是**只能给文字**，
   绝不能摆一个「跳到 Safari」的假按钮（内置浏览器禁止页面自己跳出去）。
   非微信浏览器则不许提微信那一套 —— 玩家看不懂，而且他也未必在微信里。 */
test('an unsupported notice in WeChat still teaches the system-browser route, as text only', () => {
  const wx = compatNoticeText({ state: STATUS.UNSUPPORTED, channel: CHANNEL.SFX, wechat: true });
  assert.equal(wx.visible, true);
  assert.match(wx.body, /右上角/);
  assert.match(wx.body, /浏览器/);
  // 仍然只能「知道了」：没有重试（没 API，重试无用），更没有跳外部浏览器的假按钮
  assert.deepEqual(wx.actions.map(a => a.id), ['dismiss']);
});

test('an unsupported notice outside WeChat does not mention WeChat and offers nothing fake', () => {
  const plain = compatNoticeText({ state: STATUS.UNSUPPORTED, channel: CHANNEL.SPEECH, wechat: false });
  assert.equal(plain.visible, true);
  assert.doesNotMatch(plain.body, /微信/);
  assert.deepEqual(plain.actions.map(a => a.id), ['dismiss']);
});
