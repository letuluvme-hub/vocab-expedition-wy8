import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../../src/ui/components/dictation-keyboard.js');
class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.disabled = false; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
}
const doc = { createElement: tag => new El(tag) };
const buttons = root => root.children.flatMap(row => row.children);
const event = key => ({ key, prevented: false, preventDefault() { this.prevented = true; } });

test('formal keyboard always includes full QWERTY alphabet and reusable keys', async () => {
  const { createDictationKeyboard } = await load(); const input = [];
  const kb = createDictationKeyboard({ document: doc, onInput: key => input.push(key) });
  const root = new El('div'); kb.render(root, 'letter');
  assert.equal(root.className, 'dictation-keyboard');
  const keys = buttons(root);
  assert.equal(keys.filter(b => /^[a-z]$/.test(b.dataset.key)).length, 26);
  assert.deepEqual(keys.filter(b => /^[a-z]$/.test(b.dataset.key)).map(b => b.dataset.key).join(''), 'qwertyuiopasdfghjklzxcvbnm');
  const t = keys.find(b => b.dataset.key === 't'); t.onclick(); t.onclick();
  assert.deepEqual(input, ['t', 't']); assert.equal(t.disabled, false);
});

test('only required phrase separators appear; backspace is always available', async () => {
  const { createDictationKeyboard } = await load(); const kb = createDictationKeyboard({ document: doc, onInput() {} });
  const root = new El('div');
  for (const [word, expected] of [['cat', ['Backspace']], ['ice cream', [' ', 'Backspace']], ["one's well-known", [' ', '-', "'", 'Backspace']]]) {
    kb.render(root, word);
    assert.deepEqual(buttons(root).map(b => b.dataset.key).filter(k => !/^[a-z]$/.test(k)), expected);
  }
});

test('keyboard and click use the same callback including repeated letters and separators', async () => {
  const { createDictationKeyboard } = await load(); const input = [];
  const kb = createDictationKeyboard({ document: doc, onInput: key => input.push(key) });
  const root = new El('div'); kb.render(root, 'ice cream');
  buttons(root).find(b => b.dataset.key === 'c').onclick();
  const key = event('C'); assert.equal(kb.handleKey(key), true); assert.equal(key.prevented, true);
  assert.equal(kb.handleKey(event(' ')), true);
  assert.equal(kb.handleKey(event('Backspace')), true);
  assert.deepEqual(input, ['c', 'c', ' ', 'Backspace']);
});

test('composition, modified keys, input controls and unsupported separators are ignored', async () => {
  const { createDictationKeyboard } = await load(); const input = [];
  const kb = createDictationKeyboard({ document: doc, onInput: key => input.push(key) });
  kb.render(new El('div'), 'cat');
  for (const e of [event('-'), event('Enter'), { ...event('a'), ctrlKey: true }, { ...event('a'), isComposing: true }, { ...event('a'), target: { tagName: 'TEXTAREA' } }]) {
    assert.equal(kb.handleKey(e), false);
  }
  assert.deepEqual(input, []);
  kb.destroy(); assert.equal(kb.handleKey(event('c')), false);
});
