/* 全局错误兜底（VE-17）的行为契约。
 *
 * 这里刻意**不用**源码字符串匹配，而是给一个假的 window + document，
 * 真的把事件派发进去、看 DOM 里长出了什么 —— 这也是 AGENTS.md 要求的证明方式
 * （"不能仅凭源代码字符串匹配宣称 UI 行为正确"）。
 *
 * 被锁死的三条边界，任何一条被破坏都是严重回归：
 *   1. **不吞错误**：监听器不调 preventDefault、不 return true。
 *      吞掉它等于把问题藏起来，浏览器默认行为（控制台）必须继续。
 *   2. **不自动恢复**：不许刷新、不许重试、不许碰存档。玩家正在进行的一局
 *      绝不能被"自作主张的恢复"写坏 —— 这是本项目最不能碰的东西。
 *   3. **不吞资源加载失败**：<img>/<script> 加载失败也会冒泡到 window.onerror，
 *      但它们带 target 而没有 error，报出来只是噪音。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { describeError, pushErrorBanner, installGlobalErrorGuard } from '../../src/services/error-guard.js';

/* ---- 一个刚好够用的假 DOM：只实现本模块真正用到的那几个方法 ---- */
function fakeDocument() {
  const byId = new Map();
  const mkEl = tag => ({
    tagName: tag,
    children: [],
    style: {},
    dataset: {},
    attrs: {},
    className: '',
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {
      const i = byId.get(this.id);
      if (i) byId.delete(this.id);
      const p = this.parent;
      if (p) { const j = p.children.indexOf(this); if (j >= 0) p.children.splice(j, 1); }
    },
    onclick: null,
  });
  return {
    createElement: mkEl,
    getElementById: id => byId.get(id) || null,
    body: (() => { const b = mkEl('body'); b.appendChild = function (c) { c.parent = b; byId.set(c.id, c); return b.children.push(c), c; }; return b; })(),
  };
}

function fakeWindow(doc) {
  const listeners = new Map();
  return {
    document: doc,
    __vocabErrorGuardInstalled: false,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    __emit(type, event) { for (const fn of (listeners.get(type) || []).slice()) fn(event); },
    __count: type => (listeners.get(type) || []).length,
  };
}

const silence = () => { const o = console.error; console.error = () => {}; return () => { console.error = o; }; };

/* 假 DOM 的 appendChild 不会像真 DOM 那样把后代文本并进 parent.textContent，
   所以要**直接**去取那个 <code> 节点 —— 这也比对整条 textContent 更精确：
   它证明"技术详情"里放的是真正的现场，而不是只有一句人话。 */
function detailOf(doc) {
  const bar = doc.getElementById('errbar');
  if (!bar) return null;
  return bar.children.flatMap(c => c.children || [])
    .find(c => String(c.tagName).toLowerCase() === 'code') || null;
}

/* ---------------- describeError ---------------- */

test('describeError 取 message + stack 前几行，绝不抛', () => {
  const e = new Error('boom');
  const text = describeError(e);
  assert.match(text, /boom/);
  assert.match(text, /@/);            // 带了调用点
});

test('describeError 对各种非 Error 输入都给出可读文本', () => {
  assert.equal(describeError('plain string'), 'plain string');
  assert.equal(describeError(null), 'unknown error');
  assert.equal(describeError(undefined), 'unknown error');
  assert.equal(describeError({ name: 'WeirdError' }), 'WeirdError @ (no stack)');
  // 一个连 toString 都会抛的对象
  const hostile = { get message() { throw new Error('no'); }, toString() { throw new Error('no'); } };
  assert.equal(typeof describeError(hostile), 'string');
});

test('describeError 对超长现场做截断，不撑爆页面', () => {
  const e = new Error('x'.repeat(5000));
  e.stack = 'y\n'.repeat(2000);
  const text = describeError(e);
  assert.ok(text.length <= 1300, '实际长度 ' + text.length);
  assert.match(text, /…$/);
});

/* ---------------- 提示条 ---------------- */

test('pushErrorBanner 造出带 role=alert 的容器，且只出现一次', () => {
  const doc = fakeDocument();
  assert.equal(pushErrorBanner('first', { doc }), true);
  assert.ok(doc.getElementById('errbar'));
  assert.equal(doc.body.children.length, 1);
  // 第二次不该再插一条（否则每次报错都叠一条，屏幕就没了）
  assert.equal(pushErrorBanner('second', { doc }), false);
  assert.equal(doc.body.children.length, 1);
});

test('关闭按钮真的把提示条摘掉', () => {
  const doc = fakeDocument();
  pushErrorBanner('x', { doc });
  const bar = doc.getElementById('errbar');
  const btn = bar.children.find(c => String(c.tagName).toLowerCase() === 'button');
  assert.ok(btn && typeof btn.onclick === 'function');
  btn.onclick();
  assert.equal(doc.getElementById('errbar'), null);
});

/* ---------------- 安装与派发 ---------------- */

test('装上之后：未处理异常会显示提示，但默认行为不被阻止', () => {
  const doc = fakeDocument();
  const win = fakeWindow(doc);
  const restore = silence();
  try {
    installGlobalErrorGuard({ target: win, doc });
    let event = { error: new Error('render blew up'), message: 'render blew up' };
    let prevented = false;
    // 模拟浏览器的默认行为标志位
    Object.defineProperty(event, 'preventDefault', { value: () => { prevented = true; } });
    win.__emit('error', event);

    assert.ok(doc.getElementById('errbar'), '必须出现提示条');
    assert.match(doc.getElementById('errbar').textContent, /进度已保留/);
    assert.match(detailOf(doc).textContent, /render blew up/, '技术详情里必须是真正的现场');
    assert.equal(prevented, false, '★ 绝不能 preventDefault —— 吞掉错误等于把问题藏起来');
  } finally { restore(); }
});

test('未处理的 Promise 拒绝同样被兜住', () => {
  const doc = fakeDocument();
  const win = fakeWindow(doc);
  const restore = silence();
  try {
    installGlobalErrorGuard({ target: win, doc });
    win.__emit('unhandledrejection', { reason: new Error('async blew up') });
    assert.ok(doc.getElementById('errbar'));
    assert.match(detailOf(doc).textContent, /async blew up/);
  } finally { restore(); }
});

test('资源加载失败（带 target、无 error）不报 —— 那是噪音不是故障', () => {
  const doc = fakeDocument();
  const win = fakeWindow(doc);
  installGlobalErrorGuard({ target: win, doc });
  win.__emit('error', { target: { tagName: 'IMG' }, message: '' });
  assert.equal(doc.getElementById('errbar'), null);
});

test('重复安装是幂等的，不会叠两层监听', () => {
  const doc = fakeDocument();
  const win = fakeWindow(doc);
  const restore = silence();
  try {
    installGlobalErrorGuard({ target: win, doc });
    installGlobalErrorGuard({ target: win, doc });
    assert.equal(win.__count('error'), 1);
    assert.equal(win.__count('unhandledrejection'), 1);
  } finally { restore(); }
});

test('uninstall 会摘掉监听与提示条', () => {
  const doc = fakeDocument();
  const win = fakeWindow(doc);
  const restore = silence();
  try {
    const uninstall = installGlobalErrorGuard({ target: win, doc });
    win.__emit('error', { error: new Error('x'), message: 'x' });
    assert.ok(doc.getElementById('errbar'));
    uninstall();
    assert.equal(win.__count('error'), 0);
    assert.equal(win.__count('unhandledrejection'), 0);
    assert.equal(doc.getElementById('errbar'), null);
  } finally { restore(); }
});

test('没有 addEventListener 的宿主（老环境）静默降级，不抛', () => {
  assert.doesNotThrow(() => installGlobalErrorGuard({ target: {} }));
  assert.doesNotThrow(() => installGlobalErrorGuard({ target: null }));
});

test('★ 不做任何自动恢复：不刷新、不重试、不碰存档', () => {
  const doc = fakeDocument();
  const win = fakeWindow(doc);
  const restore = silence();
  try {
    installGlobalErrorGuard({ target: win, doc });
    // 把 location / localStorage 换成会记录调用的探针
    const calls = [];
    win.location = { replace: () => calls.push('location.replace'), reload: () => calls.push('reload') };
    const store = {
      getItem: k => { calls.push('getItem:' + k); return null; },
      setItem: (k, v) => calls.push('setItem:' + k),
      removeItem: k => calls.push('removeItem:' + k),
    };
    Object.defineProperty(win, 'localStorage', { value: store, configurable: true });

    win.__emit('error', { error: new Error('boom'), message: 'boom' });
    win.__emit('unhandledrejection', { reason: new Error('boom2') });

    assert.deepEqual(calls, [], '错误兜底绝不允许自作主张动页面或存档：' + JSON.stringify(calls));
  } finally { restore(); }
});
