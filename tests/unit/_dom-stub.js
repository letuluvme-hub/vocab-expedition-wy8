/* 把 over-screen-copy.test.js 的 DOM 桩挂到 globalThis.document 上。
 * over.js 的 `$` 直接用全局 document（不像 encounters.js 那样有 ports.makeButton），
 * 所以这个测试必须提供全局 document。装/卸都收在一个 helper 里，避免漏卸。
 */
import { after, before } from 'node:test';

const ORIGINAL = globalThis.document;

function mkEl(tag) {
  const el = {
    tagName: tag, children: [], dataset: {}, style: {}, className: '',
    textContent: '', innerHTML: '', hidden: false, disabled: false,
    onclick: null, title: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    querySelector() { return null; },
  };
  return el;
}

export function installDocument(ids) {
  const els = new Map();
  for (const id of ids) els.set(id, mkEl('div'));
  globalThis.document = {
    getElementById: id => els.get(id) || null,
    createElement: tag => mkEl(tag),
    body: mkEl('body'),
  };
  return els;
}

export function uninstallDocument() {
  if (ORIGINAL === undefined) delete globalThis.document;
  else globalThis.document = ORIGINAL;
}

before(() => {});
after(() => uninstallDocument());
