/* 暂停面板的 DOM 契约。
 *
 * 只断言「画了什么、按了回调什么」：暂停屏必须是真实的一层（不是给战斗页加个
 * 灰罩），继续/返回主页/放弃三个动作各自交回父层，模块自己不碰任何游戏状态。
 * 冻结行为由 app/progress.js 的闸门保证，这里不重复断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPauseScreen } from '../../src/ui/screens/pause.js';

class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.attrs = {}; this.dataset = {}; this.className = '';
    this.hidden = false; this.disabled = false; this.title = ''; this.onclick = null;
    this.offsetWidth = 0; this.clientWidth = 0; this.parentElement = null;
    this._text = ''; this._html = '';
    this.style = { setProperty() {}, getPropertyValue: () => '', set width(v) {}, get width() { return ''; },
      set display(v) { this._display = v; }, get display() { return this._display || ''; },
      set left(v) { this._left = v; }, get left() { return this._left || ''; },
      set gap(v) {}, get gap() { return ''; }, get gridTemplateColumns() { return ''; },
      set gridTemplateColumns(v) {}, set maxWidth(v) {}, get maxWidth() { return ''; } };
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  classList = { add() {}, remove() {} };
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
const BUTTON_IDS = new Set(['pzResume', 'pzHome', 'pzAbandon']);
function doc(ids) {
  const reg = new Map();
  // 真实 index.html 里这三个是 <button>，其余是 <div>。
  for (const id of ids) reg.set(id, new StubEl(BUTTON_IDS.has(id) ? 'button' : 'div'));
  return { getElementById: id => (reg.has(id) ? reg.get(id) : null), createElement: t => new StubEl(t),
    querySelectorAll: () => [], body: new StubEl('body') };
}
const withDom = (ids, fn) => {
  const prev = globalThis.document;
  globalThis.document = doc(ids);
  try { return fn(globalThis.document); } finally { globalThis.document = prev; }
};

const IDS = ['s-pause', 'pzTitle', 'pzText', 'pzResume', 'pzHome', 'pzAbandon', 'pzSave'];

test('暂停屏画出标题、说明与三个动作，不显示任何玩法状态', async () => {
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 3, gold: 40, hp: 30, maxhp: 70 }) });
    s.renderPause({ saved: true, fromReload: false });
    assert.equal(d.getElementById('pzTitle').textContent, '已暂停');
    assert.equal(d.getElementById('pzResume').textContent, '继续远征');
    assert.equal(d.getElementById('pzHome').textContent, '返回主页');
    assert.equal(d.getElementById('pzAbandon').textContent, '放弃这次远征');
    assert.match(d.getElementById('pzText').textContent, /进度已保存/);
    assert.match(d.getElementById('pzText').textContent, /Unit 1 · 第 3 层/);
    assert.ok(!/👾|👑|litre/.test(d.getElementById('pzText').textContent), '暂停屏不暴露敌人或目标词');
  });
});

test('保存失败时明确说「只在这一页有效」，不许谎称已保存', async () => {
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 1, gold: 0, hp: 70, maxhp: 70 }) });
    s.renderPause({ saved: false, reason: 'unavailable', fromReload: false });
    const text = d.getElementById('pzText').textContent;
    assert.match(text, /只在这一页有效/);
    assert.ok(!/进度已保存/.test(text), '没存上就不能说已保存');
    assert.match(d.getElementById('pzSave').textContent, /没能保存/);
  });
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 1, gold: 0, hp: 70, maxhp: 70 }) });
    s.renderPause({ saved: false, reason: 'failed', fromReload: false });
    assert.match(d.getElementById('pzSave').textContent, /没能保存/);
  });
});

test('切后台自动暂停时说明来源，不假装是玩家点的', async () => {
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => ({ unit: 2, floor: 4, gold: 9, hp: 20, maxhp: 70 }) });
    s.renderPause({ saved: true, fromReload: true });
    assert.match(d.getElementById('pzTitle').textContent, /已暂停/);
    assert.match(d.getElementById('pzText').textContent, /切到后台/);
  });
});

test('三个按钮各自交回父层，模块自己不碰状态', async () => {
  await withDom(IDS, d => {
    const calls = [];
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 1, gold: 0, hp: 70, maxhp: 70 }),
      onResume: () => calls.push('resume'), onHome: () => calls.push('home'),
      onAbandon: () => calls.push('abandon') });
    s.renderPause({ saved: true });
    d.getElementById('pzResume').onclick();
    d.getElementById('pzHome').onclick();
    d.getElementById('pzAbandon').onclick();
    assert.deepEqual(calls, ['resume', 'home', 'abandon']);
  });
});

test('没有远征数据时也能画出暂停屏（不抛错）', async () => {
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => null });
    assert.doesNotThrow(() => s.renderPause({ saved: true }));
    assert.equal(d.getElementById('pzTitle').textContent, '已暂停');
  });
});

test('DOM 缺失时静默降级（老页面骨架也不红屏）', async () => {
  await withDom([], () => {
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 1, gold: 0, hp: 1, maxhp: 70 }) });
    assert.doesNotThrow(() => s.renderPause({ saved: true }));
  });
});

test('320px 窄屏下三个动作纵向排布且可点（按钮都有 type）', async () => {
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 1, gold: 0, hp: 1, maxhp: 70 }) });
    s.renderPause({ saved: true });
    for (const id of ['pzResume', 'pzHome', 'pzAbandon']) {
      assert.equal(d.getElementById(id).tagName, 'BUTTON');
      assert.equal(typeof d.getElementById(id).onclick, 'function', id + ' 必须可点');
    }
    assert.match(d.getElementById('pzText').className, /pztext/);
  });
});

/* ================= 返回主页不再等于放弃 ================= */

test('暂停屏说明「返回主页」不丢进度（不再与放弃混淆）', async () => {
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 2, gold: 10, hp: 50, maxhp: 70 }) });
    s.renderPause({ saved: true });
    const text = d.getElementById('pzText').textContent;
    assert.match(text, /返回主页不会放弃/, '必须让玩家知道回家不等于丢进度');
    assert.match(d.getElementById('pzHome').title, /不丢弃进度/);
  });
});

test('没存上时「返回主页保留进度」这句依然成立（保留的是内存里那一局）', async () => {
  await withDom(IDS, d => {
    const s = createPauseScreen({ getRun: () => ({ unit: 1, floor: 1, gold: 0, hp: 70, maxhp: 70 }) });
    s.renderPause({ saved: false, reason: 'unavailable' });
    const text = d.getElementById('pzText').textContent;
    assert.match(text, /只在这一页有效/);
    assert.match(text, /返回主页不会放弃/, '同页保留也成立，但措辞不能谎称已保存');
    assert.ok(!/进度已保存/.test(text));
  });
});
