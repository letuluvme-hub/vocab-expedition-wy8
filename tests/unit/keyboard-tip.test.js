/* 主页一次性键盘提示的契约。
 *
 *  1) **只出现一次**：看过并关掉之后不再出现（状态由调用方经 isSeen 提供）。
 *  2) **可关闭**，点关闭先写状态、再收起自己 —— 存储写失败也不能把玩家困在卡上。
 *  3) **纯只读展示**，全部 textContent 落屏，不拼 HTML。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboardTip, KEYBOARD_TIP_ID } from '../../src/ui/components/keyboard-tip.js';

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.className = ''; this.id = '';
    this._text = ''; this.onclick = null;
  }
  get textContent() {
    return this.children.length ? this.children.map(c => c.textContent).join('') : this._text;
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  get innerHTML() { throw new Error('这个组件不该写 innerHTML'); }
  set innerHTML(v) { throw new Error('这个组件不该写 innerHTML：' + v); }
}
const doc = { createElement: tag => new El(tag) };
const findById = (node, id) => {
  if (!node) return null;
  if (node.id === id) return node;
  for (const c of node.children) { const hit = findById(c, id); if (hit) return hit; }
  return null;
};

test('没看过时画出提示，容器与组件自建的 id 不冲突', () => {
  const host = new El('div');
  const view = createKeyboardTip({ isSeen: () => false, onDismiss: () => {}, document: doc });
  view.mount(host);
  view.paint();
  assert.equal(host.children.length, 1, '应当画出提示');
  const tip = host.children[0];
  assert.equal(tip.id, KEYBOARD_TIP_ID);
  assert.match(tip.textContent, /电脑键盘/, '要说清是「用电脑键盘玩」');
  assert.match(tip.textContent, /练打字/, '要说出附带好处');
  // 容器 id（宿主）与组件 id 必须是两个不同的盒子，否则 getElementById 会指错
  assert.notEqual(KEYBOARD_TIP_ID, 'keyboardTipHost');
});

test('看过之后再 paint 不再出现', () => {
  const host = new El('div');
  let seen = true;
  const view = createKeyboardTip({ isSeen: () => seen, onDismiss: () => {}, document: doc });
  view.mount(host);
  view.paint();
  assert.equal(host.children.length, 0, '看过就不该再画出来');
  // 反向确认：把状态翻回去仍然能画（证明上面不是「永远画不出」的假通过）
  seen = false;
  view.paint();
  assert.equal(host.children.length, 1);
});

test('点关闭：先写状态，再把卡片收起来', () => {
  const host = new El('div');
  const calls = [];
  let seen = false;
  const view = createKeyboardTip({
    isSeen: () => seen,
    onDismiss: () => { calls.push('dismiss'); seen = true; },
    document: doc,
  });
  view.mount(host);
  view.paint();
  findById(host, 'keyboardTipOk').onclick();
  assert.deepEqual(calls, ['dismiss'], '关闭必须把「看过了」写出去');
  assert.equal(host.children.length, 0, '关闭后卡片要从 DOM 里收起来');
});

test('写状态失败也要能关掉 —— 不能把玩家困在这张卡上', () => {
  const host = new El('div');
  const failing = () => { throw new Error('存储不可用'); };
  const view = createKeyboardTip({ isSeen: () => false, onDismiss: failing, document: doc });
  view.mount(host);
  view.paint();
  assert.doesNotThrow(() => findById(host, 'keyboardTipOk').onclick(),
    '存储抛错不该从点击回调里冒出去');
  assert.equal(host.children.length, 0, '关得掉才是可关闭的提示');
});

test('没有宿主容器时安静返回，不抛错', () => {
  const view = createKeyboardTip({ isSeen: () => false, onDismiss: () => {}, document: doc });
  assert.equal(view.paint(), null);
});
