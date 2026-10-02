/* 连胜播报 toast（#streakAnnouncement）的单元回归（docs/feature-word-streak.md）。
 *
 * 契约：
 *  1) showStreakAnnouncement(host, {count,label}) → {el, hide}。
 *     host 是**调用方自己的宿主**（战斗页文档流里的一小块），组件只往里加一个子节点，
 *     绝不 position:fixed 浮在 HUD 上面。
 *  2) 只落 label，**不拼当前英文单词**：学习答案不能被播报/展示通道拿走。
 *     count 只作为纯数字出现在结构里（data 属性 / 无障碍读数），不参与文案拼接以外的用途。
 *  3) 全部 textContent 落屏：innerHTML 一旦被赋值直接抛（存储型 XSS 防线）。
 *  4) 没有 streak display / 没有宿主 / 坏 label 时 hidden（安静不抛）。
 *  5) 定时器返回可取消句柄：hide() 只取消**自己**那一个，绝不广停全局生命周期。
 *  6) reduced-motion（构造参数 reducedMotion:true 或系统偏好）时不加动画 class，
 *     但文字照样出现、照样会被 hide / 到期收掉，不会 hang 住不消失。
 *  7) 320px 窄屏安全：长 label（300+ 字符）在 DOM 里完整存在且靠 CSS 换行，
 *     组件自身不截断成「...」（截断会骗人：玩家看不到自己达到了哪一级）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { showStreakAnnouncement, STREAK_ANNOUNCEMENT_ID, STREAK_ANNOUNCEMENT_CLASS } from '../../src/ui/components/streak-announcement.js';

/* ---------------- 轻量 DOM 桩：children 只读、innerHTML 禁用 ---------------- */
class StubClassList {
  constructor() { this.set = new Set(); }
  add(...n) { n.forEach(x => this.set.add(String(x))); }
  remove(...n) { n.forEach(x => this.set.delete(String(x))); }
  contains(n) { return this.set.has(String(n)); }
  toString() { return [...this.set].join(' '); }
}
class StubEl {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.ownerDocument = doc || null;
    this.parentElement = null;
    this.attrs = {};
    this.dataset = {};
    this._class = new StubClassList();
    this._kids = [];
    this._text = '';
    this._hidden = false;
  }
  get children() { return Object.freeze(this._kids.slice()); }
  get className() { return this._class.toString(); }
  set className(v) { this._class.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get classList() { return this._class; }
  set innerHTML(v) { throw new Error('innerHTML forbidden: 全部内容必须走 textContent（' + v + '）'); }
  get innerHTML() { return ''; }
  get textContent() { return this._kids.length ? this._kids.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this._kids = []; }
  get hidden() { return this._hidden; }
  set hidden(v) { this._hidden = !!v; }
  appendChild(n) { return this.insertBefore(n, null); }
  insertBefore(n, ref) {
    const i = ref ? this._kids.indexOf(ref) : -1;
    if (i < 0) this._kids.push(n); else this._kids.splice(i, 0, n);
    n.parentElement = this;
    return n;
  }
  setAttribute(k, v) { this.attrs[String(k)] = String(v); }
  getAttribute(k) { return String(k) in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return String(k) in this.attrs; }
  removeAttribute(k) { delete this.attrs[String(k)]; }
}
function createDocument() {
  const reg = new Map();
  const doc = { createElement: t => new StubEl(t, doc), getElementById: id => reg.get(String(id)) || null, _reg: reg };
  return doc;
}
const byClass = (root, cls) => { const out = []; (function w(n) { for (const c of n.children) { if (c.classList.contains(cls)) out.push(c); w(c); } })(root); return out; };

/* 可控调度器 + 时钟：记录 cancelSchedule 句柄，证明只取消自己那一个 */
function clock() {
  let t = 0; const map = new Map(); const cancelled = []; let seq = 0;
  return {
    cancelled,
    schedule(fn, ms) { const id = ++seq; map.set(id, { fn, at: t + (ms || 0) }); return id; },
    cancelSchedule(id) { cancelled.push(id); map.delete(id); },
    tick(ms) { t += ms; let n = 0; for (;;) { const due = [...map.entries()].filter(([, v]) => v.at <= t); if (!due.length) return n; due.sort((a, b) => a[1].at - b[1].at); const [id, v] = due[0]; map.delete(id); v.fn(); n++; } },
    size: () => map.size,
  };
}

/* ---------------- 垂直 1：基本渲染 ---------------- */

test('showStreakAnnouncement 在自己的宿主里画出 id=streakAnnouncement 的节点，文案只有 label', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, { count: 3, label: 'Triple Kill', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule });
  assert.ok(v && v.el, '必须返回节点');
  assert.equal(v.el.id, STREAK_ANNOUNCEMENT_ID);
  assert.equal(STREAK_ANNOUNCEMENT_ID, 'streakAnnouncement');
  assert.ok(v.el.classList.contains(STREAK_ANNOUNCEMENT_CLASS));
  assert.equal(v.el.textContent, 'Triple Kill', '只显示台阶名，不含任何单词');
  assert.equal(host.children.length, 1, '只往宿主里加一个子节点');
  assert.equal(host.children[0], v.el, '挂在调用方给的宿主里（不浮在文档根部）');
  assert.equal(v.el.hidden, false);
});

test('label 里的当前英文单词不会被拼进播报文本', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, { count: 1, label: 'First Blood', word: 'apple', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule });
  assert.doesNotMatch(v.el.textContent, /apple/);
  assert.equal(v.el.textContent, 'First Blood');
});

test('恶意 / 未知 label 只经 textContent 落屏（不生成元素）', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, { count: 2, label: '<img src=x onerror="alert(1)">', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule });
  assert.equal(v.el.textContent, '<img src=x onerror="alert(1)">');
  const all = []; (function w(n) { for (const c2 of n.children) { all.push(c2); w(c2); } })(host);
  assert.equal(all.filter(x => x.tagName === 'IMG').length, 0);
});

/* ---------------- 垂直 2：定时器与 reduced motion ---------------- */

test('自带到期收掉：只排一个定时器，到期后节点隐藏', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, { count: 1, label: 'First Blood', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 1200 });
  assert.equal(c.size(), 1, '只排一个定时器');
  assert.equal(v.el.hidden, false);
  c.tick(1300);
  assert.equal(v.el.hidden, true, '到期自动隐藏，不会永远挂在屏幕上');
});

test('hide() 只取消自己那一个定时器句柄，不广停别的东西', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const a = showStreakAnnouncement(host, { count: 1, label: 'First Blood', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 1000 });
  a.hide();
  assert.deepEqual(c.cancelled, [1], '只取消句柄 1');
  assert.equal(c.size(), 0);
  /* 再次 show 会复用同一个节点并排一个新的到期定时器：旧的不会被重复取消两次。 */
  const b = showStreakAnnouncement(host, { count: 2, label: 'Double Kill', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 1000 });
  assert.equal(a.el, b.el, '复用同一个节点');
  assert.equal(c.size(), 1, '只挂着一个定时器');
  assert.equal(b.el.hidden, false, '重新播报会重新显示');
  b.hide();
  assert.deepEqual(c.cancelled, [1, 2], '各自只取消自己那一个句柄');
});

test('reduced-motion：不加动画 class，但文字照常出现并会收掉（不 hang）', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, {
    count: 8, label: 'Godlike', reducedMotion: true,
    document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 900,
  });
  assert.equal(v.el.classList.contains('streak-toast--anim'), false, '无运动时不加动画 class');
  assert.equal(v.el.textContent, 'Godlike', '文字照样给');
  c.tick(1000);
  assert.equal(v.el.hidden, true, '照样会消失，不留一块挂着的死文字');
});

test('正常情况下加动画 class（父层/样式自己决定是否降级）', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, { count: 2, label: 'Double Kill', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 900 });
  assert.equal(v.el.classList.contains('streak-toast--anim'), true);
});

test('系统 prefers-reduced-motion 为 true 时也走无动画分支', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, {
    count: 1, label: 'First Blood', document: doc,
    matchMedia: q => ({ matches: String(q).includes('prefers-reduced-motion') }),
    schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 900,
  });
  assert.equal(v.el.classList.contains('streak-toast--anim'), false);
});

/* ---------------- 垂直 3：降级 / 幂等 / 长文案 ---------------- */

test('没有宿主或坏 label 时安静返回 null，不抛（父层没接线不崩）', () => {
  const doc = createDocument();
  const c = clock();
  const opts = { document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule };
  assert.equal(showStreakAnnouncement(null, { count: 1, label: 'First Blood', ...opts }), null);
  const host = doc.createElement('div');
  assert.equal(showStreakAnnouncement(host, { count: 1, label: '', ...opts }), null);
  assert.equal(showStreakAnnouncement(host, { count: 1, label: null, ...opts }), null);
  assert.equal(showStreakAnnouncement(host, { count: 1, ...opts }), null);
  assert.equal(showStreakAnnouncement(host, { ...opts }), null);
  assert.equal(host.children.length, 0, '没画任何东西');
  assert.equal(c.size(), 0, '也没排定时器');
});

test('count 非法时降级为 0 而不是 NaN 上屏', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const v = showStreakAnnouncement(host, { count: 'x', label: 'First Blood', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule });
  assert.doesNotMatch(v.el.textContent, /NaN|undefined/);
  assert.equal(v.el.textContent, 'First Blood');
});

test('同一台阶重复 show 不堆叠：复用同一个节点，只换文字', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const a = showStreakAnnouncement(host, { count: 1, label: 'First Blood', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 900 });
  const b = showStreakAnnouncement(host, { count: 2, label: 'Double Kill', document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule, autoHideMs: 900 });
  assert.equal(a.el, b.el, '复用同一个节点');
  assert.equal(host.children.length, 1, '不堆第二个 toast');
  assert.equal(b.el.textContent, 'Double Kill');
  assert.equal(b.el.hidden, false, '重新播报会重新显示');
  assert.equal(c.size(), 1, '旧的到期定时器被换成新的');
});

test('300+ 字符的长 label 完整保留（不截断成 ...），由 CSS 负责换行', () => {
  const doc = createDocument();
  const host = doc.createElement('div');
  const c = clock();
  const long = 'Quadra Kill ' + 'A'.repeat(300);
  const v = showStreakAnnouncement(host, { count: 4, label: long, document: doc, schedule: c.schedule, cancelSchedule: c.cancelSchedule });
  assert.equal(v.el.textContent, long, '一字不落：截断会骗玩家');
  assert.equal(v.el.textContent.includes('...'), false);
});

/* ---------------- 样式表：作用域 / 窄屏 / 不联网 / 不盖 HUD ---------------- */

const css = readFileSync(new URL('../../src/styles/streak-feedback.css', import.meta.url), 'utf8');

test('样式表每条选择器都在 .streak-toast 命名空间内', () => {
  const bare = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]+;/g, '')
    /* @keyframes 的内部选择器（from/to/百分比）是动画帧，不是页面选择器：
       它的作用范围由本文件自己的 @keyframes 块决定，扫命名空间时要剔掉。
       @media 的条件前缀同理 —— 它后面真正生效的选择器仍要逐条检查。 */
    .replace(/@keyframes[\s\S]*?\n\}/g, '')
    .replace(/@media[^{]*\{/g, '');
  const selectors = [...bare.matchAll(/(^|\})\s*([^{}]*?)\s*\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(selectors.length > 0, '样式表不能是空的');
  for (const sel of selectors) {
    for (const one of sel.split(',')) {
      assert.match(one.trim(), /^\.streak-toast\b/, '越界选择器：' + one);
    }
  }
});

test('不浮在 HUD 上面：没有 fixed/absolute/sticky，靠文档流占位', () => {
  assert.doesNotMatch(css, /position:\s*(fixed|absolute|sticky)/, 'toast 必须留在战斗页文档流里');
  assert.match(css, /\.streak-toast[^{]*\{[^}]*position:\s*static/);
});

test('320px 窄屏安全：min-width:0 + overflow-wrap 换行，不写死像素宽度', () => {
  assert.match(css, /min-width:\s*0/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /\bwidth:\s*\d+px/, '不使用固定像素宽度');
  assert.doesNotMatch(css, /white-space:\s*nowrap/, '不许禁止换行');
});

test('不联网 / 不引外部字体 / 不引外部音频', () => {
  assert.doesNotMatch(css, /url\(/, '不加载任何外部资源（音频/字体都不许）');
  assert.doesNotMatch(css, /@font-face|@import\s+url/);
});

test('动画只在 .streak-toast--anim 上，且尊重 reduced-motion', () => {
  const anims = [...css.matchAll(/animation(?:-name)?\s*:\s*([^;]+);/g)].map(m => m[1].trim());
  assert.ok(anims.length > 0, '应该有一次性入场动画');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '系统偏好无动画时必须关掉');
  const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
  assert.match(reduced, /animation:\s*none/);
});

test('隐藏态真的隐藏（hidden 属性优先），不留半透明遮住 HUD 的残影', () => {
  assert.match(css, /\.streak-toast\[hidden\][^{]*\{[^}]*display:\s*none/);
  assert.doesNotMatch(css, /\.streak-toast\b[^{]*\{[^}]*pointer-events:\s*none/, '显示时不该吃掉点击');
});
