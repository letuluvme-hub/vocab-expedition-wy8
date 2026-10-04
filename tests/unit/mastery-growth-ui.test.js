/* 「知识成长」只读展示的单元回归（docs/feature-mastery-growth.md）。
 *
 * 契约：
 *  1) createMasteryGrowth({getSummary, document}) → {mount, paint}，
 *     容器 id 固定为 masteryGrowth，段标题固定为「知识成长」。
 *  2) 一行固定口径文案：`教材词汇 n/259 · 下轮生命上限 +X（最多+12）`。
 *  3) 差几词说清楚：未封顶写「再学 N 个教材词 → +X+1」，封顶写明「已达上限 +12」。
 *  4) 只描述「新开一轮才生效」：不补回血、不提高当前轮生命上限、跨单元不再加。
 *  5) 纯只读：mount/paint 不写 run / DB / 存储，也不改传入的 summary 对象。
 *  6) 全部 textContent 落屏：innerHTML 一旦被赋值测试直接失败（存储型 XSS 防线）。
 *  7) 重复 mount 复用同一个节点，不产生第二个容器。
 *  8) 320px 窄屏不溢出：样式表每条选择器都在 #masteryGrowth 内，
 *     有 min-width:0 / overflow-wrap 兜底，且不含 @font-face / @keyframes /
 *     animation / 外链 url()（不联网、不引字体、不做动画）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORDS } from '../../src/data/words.js';
import { growthSummary, GROWTH_MAX_BONUS } from '../../src/domain/mastery-growth.js';
import { createMasteryGrowth, MASTERY_GROWTH_ID, MASTERY_GROWTH_TITLE } from '../../src/ui/components/mastery-growth.js';

const ALL = [...new Set(WORDS.map(w => w.w))];
const keys = n => ALL.slice(0, n);
const summaryOf = n => growthSummary(keys(n), WORDS);

/* ---------------- 轻量 DOM 桩：children 只读、classList 真实、不许 innerHTML ---------------- */

class StubClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(n => this.set.add(String(n))); }
  remove(...names) { names.forEach(n => this.set.delete(String(n))); }
  contains(name) { return this.set.has(String(name)); }
  toString() { return [...this.set].join(' '); }
}

class StubEl {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.ownerDocument = doc || null;
    this.parentElement = null;
    this.attrs = {};
    this._class = new StubClassList();
    this._kids = [];
    this._text = '';
    this._html = null;
  }
  /* children 是**只读快照**：任何 push/splice 在严格模式下直接抛 TypeError，
     所以「渲染过程不许动 children」这条契约是被桩强制的，不是靠自觉。 */
  get children() { return Object.freeze(this._kids.slice()); }
  get className() { return this._class.toString(); }
  set className(v) { this._class.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { return this._class; }
  set innerHTML(v) { this._html = v; throw new Error('innerHTML forbidden: 全部内容必须走 textContent（' + v + '）'); }
  get innerHTML() { return this._html === null ? '' : this._html; }
  get textContent() { return this._kids.length ? this._kids.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this._kids = []; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, ref) {
    const i = ref ? this._kids.indexOf(ref) : -1;
    if (i < 0) this._kids.push(node); else this._kids.splice(i, 0, node);
    node.parentElement = this;
    if (this.ownerDocument) this.ownerDocument._index(node);
    return node;
  }
  setAttribute(k, v) { this.attrs[String(k)] = String(v); }
  getAttribute(k) { return String(k) in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return String(k) in this.attrs; }
}

function createDocument(existingIds = []) {
  const reg = new Map();
  for (const id of existingIds) reg.set(id, new StubEl('div', doc));
  const doc = {
    getElementById: id => (reg.has(String(id)) ? reg.get(String(id)) : null),
    createElement: tag => new StubEl(tag, doc),
    _index(node) { if (node.id) reg.set(node.id, node); },
    _reg: reg,
  };
  return doc;
}

function withDocument(doc, fn) {
  const prev = globalThis.document;
  globalThis.document = doc;
  try { return fn(); } finally { globalThis.document = prev; }
}

/* 按 class 找后代（真实 DOM 里用 querySelector，这里桩里手写同义遍历） */
function byClass(root, cls) {
  const out = [];
  (function walk(node) {
    for (const c of node.children) {
      if (c.classList.contains(cls)) out.push(c);
      walk(c);
    }
  })(root);
  return out;
}
function byIdDeep(root, id) {
  let found = null;
  (function walk(node) {
    for (const c of node.children) {
      if (c.id === id) { found = c; return; }
      walk(c);
    }
  })(root);
  return found;
}
const allText = root => root.textContent;

/* ---------------- 垂直 1：mount + 首屏文案 ---------------- */

test('mount 出 id=masteryGrowth 的容器，段标题是「知识成长」', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => summaryOf(0), document: doc });
    const el = view.mount(host);
    assert.ok(el, 'mount 必须返回容器');
    assert.equal(el.id, MASTERY_GROWTH_ID);
    assert.equal(el.id, 'masteryGrowth');
    assert.equal(MASTERY_GROWTH_TITLE, '知识成长');
    const head = byClass(el, 'mgrowth-h')[0];
    assert.ok(head, '必须有段标题节点');
    assert.equal(head.textContent, '知识成长');
  });
  assert.equal(host.children.length, 1, '容器挂到传入的宿主下');
  assert.equal(host.children[0].id, 'masteryGrowth');
});

test('首屏文案：教材词汇 n/259 · 下轮生命上限 +X（最多+12）', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  let n = 12;
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => summaryOf(n), document: doc });
    view.mount(host);
    view.paint();
    assert.equal(byClass(host, 'mgrowth-count')[0].textContent,
      '教材词汇 12/259 · 下轮生命上限 +0（最多+' + GROWTH_MAX_BONUS + '）');

    /* 同一容器重画：内容跟着 getSummary 走，节点不新建。 */
    n = 259;
    view.paint();
    assert.equal(byClass(host, 'mgrowth-count').length, 1, '重画复用同一行');
    assert.equal(byClass(host, 'mgrowth-count')[0].textContent, '教材词汇 259/259 · 下轮生命上限 +12（最多+12）');
  });
});

/* ---------------- 垂直 2：差几词 / 封顶 / 只在新开轮生效 ---------------- */

test('未封顶时写清「再学 N 个教材词」，封顶后写明已达上限', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => summaryOf(12), document: doc });
    view.mount(host);
    view.paint();
    assert.equal(byClass(host, 'mgrowth-next')[0].textContent, '再学 8 个教材词，下轮生命上限 +1');

    view.paint(); // 重画不改变容器
    assert.equal(byClass(host, 'mgrowth-next').length, 1);
  });

  const doc2 = createDocument();
  const host2 = doc2.createElement('section');
  withDocument(doc2, () => {
    const view = createMasteryGrowth({ getSummary: () => summaryOf(259), document: doc2 });
    view.mount(host2);
    view.paint();
    assert.equal(byClass(host2, 'mgrowth-next')[0].textContent,
      '已达上限 +12（封顶），继续学教材词不再提升生命上限');
  });
});

test('说明文字只讲「新开一轮生效」，不含补血 / 当前轮加血的承诺', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => summaryOf(40), document: doc });
    view.mount(host);
    view.paint();
    const note = byClass(host, 'mgrowth-note')[0].textContent;
    assert.match(note, /学会的教材词/);
    assert.match(note, /预习里不看提示拼对/);
    assert.match(note, /新开一轮/);
    assert.match(note, /不会补回生命/);
    assert.match(note, /不会提高本轮生命上限/);
    assert.match(note, /跨单元不再额外增加/);
  });
});

/* ---------------- 垂直 3：只读 + 文本安全 + 复用 + 样式作用域 ---------------- */

test('paint 只读：不改传入的 summary，也不写任何 run / DB / 存储', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  const summary = summaryOf(30);
  const before = JSON.stringify(summary);
  const beforeMastered = JSON.stringify(ALL);
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => summary, document: doc });
    view.mount(host);
    view.paint();
    view.paint();
  });
  assert.equal(JSON.stringify(summary), before, 'summary 对象是只读输入');
  assert.equal(JSON.stringify(ALL), beforeMastered, '词库不动');
  assert.deepEqual(Object.keys(summary).sort(), Object.keys(summaryOf(0)).sort(), '不得凭空加字段');
});

test('恶意 / 未知文本只经 textContent 落屏（不会变成元素，也不会污染数字）', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  const hostile = '<img src=x onerror="alert(1)">';
  const s = summaryOf(5);
  s.totalCount = hostile;      // 未知来源塞进来的字段
  s.masteredCount = hostile;
  s.bonusHp = hostile;
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => s, document: doc });
    view.mount(host);
    view.paint();              // innerHTML 若被赋值，这里就会抛
    const el = byIdDeep(host, 'masteryGrowth');
    assert.equal(el.children.length, 6, '只有 6 个子节点，恶意串没有被解析成元素');
    const text = allText(host);
    assert.doesNotMatch(text, /<img|onerror|alert/, '坏值被数值化，绝不进 DOM 也不进文案');
    assert.match(text, /教材词汇 0\/0 · 下轮生命上限 \+0/, '降级成 0 而不是 NaN');
    const walkAll = [];
    (function walk(n) { for (const c of n.children) { walkAll.push(c); walk(c); } })(host);
    assert.equal(walkAll.filter(c => c.tagName === 'IMG').length, 0, '绝不生成 IMG 元素');
  });
});

test('没有容器可挂时安静返回 null，不抛异常（父层未接线场景）', () => {
  const doc = createDocument();
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => summaryOf(0), document: doc });
    assert.equal(view.mount(null), null);
    assert.equal(view.paint(), null);
  });
});

test('getSummary 返回坏形状时降级为 0 进度，不显示 NaN', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => null, document: doc });
    view.mount(host);
    view.paint();
    const text = allText(host);
    assert.doesNotMatch(text, /NaN|undefined/, '坏 summary 不许把 NaN 写上屏');
    assert.doesNotMatch(text, /已达上限|封顶/, '没有成长摘要是未知，不是已封顶 +0');
  });
});

test('重复 mount 复用同一个容器节点', () => {
  const doc = createDocument();
  const host = doc.createElement('section');
  withDocument(doc, () => {
    const view = createMasteryGrowth({ getSummary: () => summaryOf(30), document: doc });
    const a = view.mount(host);
    const b = view.mount(host);
    assert.equal(a, b, '复用同一个节点，不重建');
    assert.equal(host.children.length, 1);
    assert.equal(byClass(host, 'mgrowth-h').length, 1);
  });
});

/* ---------------- 样式表：作用域 + 窄屏 + 不联网/不引字体/不动画 ---------------- */

const css = readFileSync(new URL('../../src/styles/mastery-growth.css', import.meta.url), 'utf8');

test('样式表每条选择器都在 #masteryGrowth 命名空间内', () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const selectors = [...bare.matchAll(/(^|\})\s*([^{}]*?)\s*\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(selectors.length > 0, '样式表不能是空的');
  for (const sel of selectors) {
    for (const one of sel.split(',')) {
      assert.match(one.trim(), /^#masteryGrowth\b/, '越界选择器：' + one);
    }
  }
});

test('320px 窄屏不溢出：有换行兜底且不靠固定宽度', () => {
  assert.match(css, /#masteryGrowth[^{]*\{[^}]*overflow-wrap:\s*anywhere/, '长串不许撑破窄屏');
  assert.match(css, /min-width:\s*0/);
  assert.doesNotMatch(css, /\bwidth:\s*\d+px/, '不使用固定像素宽度');
});

test('不联网 / 不引字体 / 不做动画', () => {
  assert.doesNotMatch(css, /url\(/, '不加载任何外部资源');
  assert.doesNotMatch(css, /@font-face|@import\s+url/, '不引外部字体');
  assert.doesNotMatch(css, /@keyframes|animation(-name)?\s*:/, '不做动画');
  assert.doesNotMatch(css, /transition\s*:/, '不做过渡动效');
});
