/* 主页声音设置区（音效 + 单词朗读）的 DOM 契约。
 *
 * 只断言「画了什么、按了交回什么」：两个开关互相独立，状态与存档字段的归属
 * 仍在 runtime（DB.vol / DB.mute / DB.voice），本模块只读 getter、只派发回调。
 * ★ 顺带钉死两条结构约束（这正是本任务要改掉的东西）：
 *   1) 按钮不许带任何内联 style —— 旧的浮动开关是 position:fixed 内联钉在右上角；
 *   2) 不许用 innerHTML 拼 DOM —— 一律 createElement，文本走 textContent。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  VOL_STEPS, nearestVolStep, volState, voiceState, createAudioSettings,
} from '../../src/ui/components/audio-settings.js';

/* ---------------- 轻量 DOM 桩：内联 style 与 innerHTML 都会被记录下来 ---------------- */
class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.onclick = null;
    this.oncontextmenu = null;
    this.parentElement = null;
    this._text = '';
    this._html = null;                       // 一旦被写过就说明走了 innerHTML 注入
    this.cssText = '';
    this.styleWrites = [];                   // 任何内联样式赋值都会留痕
    /* 朴素 Proxy 会被 Object.keys 骗过去（ownKeys 落在 target 上，写入不显形），
       所以这里显式记下每一次赋值 —— 「没有内联样式」这条断言必须真的看得到。 */
    const target = { cssText: '' };
    this.style = new Proxy(target, {
      set(t, key, value) { t[key] = value; el.styleWrites.push(key + '=' + String(value)); return true; },
      get(t, key) { return t[key] === undefined ? '' : t[key]; },
      ownKeys: () => Object.keys(t),
      getOwnPropertyDescriptor: (t, k) => (k in t ? { value: t[k], enumerable: true, configurable: true } : undefined),
    });
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html === null ? '' : this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const CONTAINER = 'audioSettings';
function makeDoc({ withContainer = true } = {}) {
  const reg = new Map();
  if (withContainer) reg.set(CONTAINER, new StubEl('div'));
  return {
    getElementById: id => (reg.has(id) ? reg.get(id) : null),
    createElement: tag => new StubEl(tag),
    querySelectorAll: () => [],
    _reg: reg,
  };
}
const withDoc = (doc, fn) => {
  const prev = globalThis.document;
  globalThis.document = doc;
  try { return fn(doc); } finally { globalThis.document = prev; }
};
const walk = (el, out = []) => { out.push(el); el.children.forEach(c => walk(c, out)); return out; };
const byId = (root, id) => walk(root).find(e => e.id === id) || null;

function fakeAudio(vol, muted) { return { vol: () => vol, muted: () => muted }; }
function fakeTts(supported, on) { return { supported: () => supported, on: () => on }; }

/* ============================================================
   纯函数：档位与文案
   ============================================================ */
test('VOL_STEPS keeps the archived 55/30/12/mute ladder', () => {
  assert.deepEqual(VOL_STEPS, [.55, .3, .12, 0]);
});
test('nearestVolStep snaps a stored value onto the ladder and clamps out-of-range', () => {
  assert.equal(nearestVolStep(.55), 0);
  assert.equal(nearestVolStep(.3), 1);
  assert.equal(nearestVolStep(.12), 2);
  assert.equal(nearestVolStep(0), 3);
  assert.equal(nearestVolStep(.31), 1);
  assert.equal(nearestVolStep(.9), 0, '比最大档还大 → 取最大档');
  assert.equal(nearestVolStep(-3), 3, '负值 → 静音档');
});
test('volState names the icon, the number and the whole ladder in the tooltip', () => {
  assert.deepEqual(volState(.55, false), { icon: '🔊', text: '55%', title: '音量 55%（点击切换：55% → 30% → 12% → 静音）' });
  assert.deepEqual(volState(.3, false), { icon: '🔉', text: '30%', title: '音量 30%（点击切换：55% → 30% → 12% → 静音）' });
  assert.deepEqual(volState(.12, false), { icon: '🔉', text: '12%', title: '音量 12%（点击切换：55% → 30% → 12% → 静音）' });
  assert.equal(volState(0, true).text, '静音');
  assert.equal(volState(0, true).icon, '🔇');
  // 存档里 mute=true 但 vol 还留着 0.55 的老组合：也必须显示成静音
  assert.equal(volState(.55, true).text, '静音');
});
test('voiceState distinguishes unsupported / off / on', () => {
  assert.deepEqual(voiceState(false, true), {
    icon: '🔇', text: '不可用', note: '当前浏览器不支持语音朗读（不影响游戏）', title: '当前浏览器不支持语音朗读（不影响游戏）', disabled: true,
  });
  assert.deepEqual(voiceState(true, false), {
    icon: '🔇', text: '已关', note: '', title: '单词朗读：关（点击开启）', disabled: false,
  });
  assert.deepEqual(voiceState(true, true), {
    icon: '🗣', text: '开启', note: '', title: '单词朗读：开（点击关闭）', disabled: false,
  });
});

/* ============================================================
   createAudioSettings：画出设置区
   ============================================================ */
test('mount draws one settings block with two labelled rows and keeps the legacy ids', async () => {
  await withDoc(makeDoc(), doc => {
    const panel = createAudioSettings({
      audio: fakeAudio(.55, false), tts: fakeTts(true, true),
      onVolumeStep: () => {}, onVoiceToggle: () => {},
    }).mount();
    const root = doc.getElementById(CONTAINER);
    assert.equal(root.children.length, 1, '设置区由模块自己建一层，不追加到 body');
    const scope = root.children[0];
    assert.equal(scope.id, 'audioSettings-root');
    // 玩家在手机上要能一眼看懂两个开关分别管什么
    const labels = walk(scope).filter(e => e.className === 'aset-lbl').map(e => e.textContent);
    assert.deepEqual(labels, ['音效', '单词朗读']);
    // 老 id 必须继续存在（存档、既有 E2E、导出单文件都还指着它们）
    for (const id of ['volBtn', 'volVal', 'voiceBtn', 'voiceVal']) {
      assert.ok(byId(scope, id), '缺少 #' + id);
    }
    assert.equal(byId(scope, 'volBtn').tagName, 'BUTTON');
    assert.equal(byId(scope, 'voiceBtn').tagName, 'BUTTON');
    assert.equal(panel.volBtn.id, 'volBtn');
    assert.equal(panel.voiceBtn.id, 'voiceBtn');
  });
});

test('mount paints the live prefs it is handed and never reads globals', async () => {
  await withDoc(makeDoc(), doc => {
    let vol = .3, muted = false, on = false;
    const panel = createAudioSettings({
      audio: { vol: () => vol, muted: () => muted },
      tts: { supported: () => true, on: () => on },
      onVolumeStep: () => {}, onVoiceToggle: () => {},
    }).mount();
    const root = doc.getElementById(CONTAINER).children[0];
    assert.equal(byId(root, 'volVal').textContent, '30%');
    assert.equal(byId(root, 'volBtn').textContent, '🔉');
    assert.equal(byId(root, 'voiceVal').textContent, '已关');
    assert.equal(byId(root, 'voiceBtn').textContent, '🔇');

    // prefs 是父层的状态所有者：paint 只反映，不缓存旧值
    vol = .55; muted = false; on = true;
    panel.paint();
    assert.equal(byId(root, 'volVal').textContent, '55%');
    assert.equal(byId(root, 'voiceVal').textContent, '开启');
    assert.equal(byId(root, 'voiceBtn').textContent, '🗣');
  });
});

test('an unsupported platform disables the voice row with a note but leaves the game controls usable', async () => {
  await withDoc(makeDoc(), doc => {
    let toggled = 0;
    const panel = createAudioSettings({
      audio: fakeAudio(.55, false), tts: fakeTts(false, true),
      onVolumeStep: () => {}, onVoiceToggle: () => { toggled++; },
    }).mount();
    const root = doc.getElementById(CONTAINER).children[0];
    const voice = byId(root, 'voiceBtn');
    assert.equal(voice.disabled, true);
    assert.equal(byId(root, 'voiceVal').textContent, '不可用');
    assert.match(byId(root, 'audioNote').textContent, /不支持语音朗读/);
    assert.equal(byId(root, 'audioNote').hidden, false);
    // 音效那一路照常可用：平台缺语音不等于没有声音
    assert.equal(byId(root, 'volBtn').disabled, false);
    assert.doesNotThrow(() => panel.paint());
    // 按钮禁用时点击不得触发任何切换
    voice.onclick();
    assert.equal(toggled, 0, '禁用的语音开关不许改状态');
  });
});

/* ============================================================
   createAudioSettings：动作全部交回父层
   ============================================================ */
test('clicks are delegated to callbacks: forward, backward and the voice toggle', async () => {
  await withDoc(makeDoc(), doc => {
    const steps = [], toggles = [];
    const panel = createAudioSettings({
      audio: fakeAudio(.55, false), tts: fakeTts(true, true),
      onVolumeStep: dir => steps.push(dir),
      onVoiceToggle: force => toggles.push(force),
    }).mount();
    const root = doc.getElementById(CONTAINER).children[0];
    byId(root, 'volBtn').onclick();
    byId(root, 'volBtn').oncontextmenu({ preventDefault() {} });
    assert.deepEqual(steps, [1, -1], '左键前进一档、右键后退一档');
    byId(root, 'voiceBtn').onclick();
    byId(root, 'voiceBtn').oncontextmenu({ preventDefault() {} });
    assert.deepEqual(toggles, [undefined, true], '左键切换、右键直接开');
    assert.ok(panel.root, 'panel 暴露 root 供父层按需重画');
  });
});

/* ============================================================
   结构约束：没有浮动内联样式，没有 innerHTML 注入
   ============================================================ */
test('no inline styles anywhere — the old control was position:fixed on body', async () => {
  await withDoc(makeDoc(), doc => {
    createAudioSettings({
      audio: fakeAudio(.55, false), tts: fakeTts(true, false),
      onVolumeStep: () => {}, onVoiceToggle: () => {},
    }).mount();
    for (const el of walk(doc.getElementById(CONTAINER))) {
      assert.equal(el.cssText, '', el.id + ' 带了内联 cssText');
      // cssText 也算：旧的浮动开关正是靠 root.style.cssText 定位的
      assert.equal(el.style.cssText, '', el.id + ' 带了内联 style.cssText');
      assert.deepEqual(el.styleWrites, [], el.id + ' 带了内联 style：' + JSON.stringify(el.styleWrites));
    }
  });
});

test('the DOM is built element by element, never through innerHTML', async () => {
  await withDoc(makeDoc(), doc => {
    createAudioSettings({
      audio: fakeAudio(.55, false), tts: fakeTts(true, false),
      onVolumeStep: () => {}, onVoiceToggle: () => {},
    }).mount();
    for (const el of walk(doc.getElementById(CONTAINER))) {
      assert.equal(el._html, null, el.id + ' 用了 innerHTML 注入');
    }
  });
});

test('a missing container is a silent no-op (Node boot, legacy export) — never throws', async () => {
  await withDoc(makeDoc({ withContainer: false }), () => {
    let panel;
    assert.doesNotThrow(() => {
      panel = createAudioSettings({
        audio: fakeAudio(.55, false), tts: fakeTts(true, true),
        onVolumeStep: () => {}, onVoiceToggle: () => {},
      }).mount();
    });
    assert.doesNotThrow(() => panel.paint());
    assert.equal(panel.root, null);
  });
  // 连 document 都没有（纯 Node）也必须安静
  const prev = globalThis.document;
  delete globalThis.document;
  try {
    let panel;
    assert.doesNotThrow(() => { panel = createAudioSettings({}).mount(); panel.paint(); });
    assert.equal(panel.root, null);
  } finally { globalThis.document = prev; }
});

/* ============================================================
   接线层：runtime 必须用这个模块，且不再自己造浮动开关
   ============================================================ */
test('runtime mounts the settings module and no longer builds a floating voice button', () => {
  const src = readFileSync(new URL('../../src/app/runtime.js', import.meta.url), 'utf8');
  assert.match(src, /createAudioSettings/, 'runtime 必须接线新模块');
  assert.doesNotMatch(src, /position:fixed;top:10px;right:60px/, '旧的右上角浮动定位必须删掉');
  assert.doesNotMatch(src, /document\.body\.appendChild\(b\)/, '开关不许再挂到 body 上');
  assert.doesNotMatch(src, /new MutationObserver\(syncVoiceBtn\)/, '浮动按钮的兜底观察器不再需要');
  // syncVoiceBtn 保留兼容入口，但必须是空转实现（不能再去按 screen 切 display）。
  //
  // ★ 这里曾经是一条**恒真的假阳性测试**：写的是
  //     src.slice(src.indexOf('function syncVoiceBtn'))
  //   而 indexOf 未命中时返回 -1，slice(-1) 返回**最后一个字符**（length === 1 > 0），
  //   随后 indexOf('}') 同样返回 -1、slice(0, -1) 返回**空串**。
  //   于是把 syncVoiceBtn 整个删掉之后，fn.length 仍是 1、待检片段仍是 ''，
  //   两条断言照样通过 —— 这条测试什么都防不住，而它防的恰恰是
  //   「浮动语音开关盖住战斗页两条血条」（实测盖住 59%/60% 面积）这个已修掉的 bug。
  //
  // 两处必须显式守卫：未命中直接失败；片段只取到函数体结束，不许把文件剩下的部分
  // （那里面本来就有大量 style.display）当成被检对象。
  const at = src.indexOf('function syncVoiceBtn');
  assert.notEqual(at, -1, 'syncVoiceBtn 仍需保留给 show()');
  const end = src.indexOf('}', at);
  assert.ok(end > at, 'syncVoiceBtn 必须是一个可解析的函数体');
  const fn = src.slice(at, end + 1);
  assert.doesNotMatch(fn, /style\s*\.\s*display/, 'syncVoiceBtn 不许再手工切 display');
});

test('the home screen owns the settings container, inside the title screen only', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const title = html.slice(html.indexOf('id="s-title"'), html.indexOf('<div class="screen" id="s-map"'));
  assert.match(title, /id="audioSettings"/, '设置区必须在主页');
  // 浮动开关曾经由 runtime 往 body 上追加；现在只允许主页有这一处容器
  assert.equal((html.match(/id="audioSettings"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="voiceBtn"/, 'voiceBtn 由模块建，HTML 里不再硬写');
});

test('the new stylesheet is appended after the original sheets and only styles the settings block', () => {
  const entry = readFileSync(new URL('../../src/styles/game.css', import.meta.url), 'utf8');
  const paths = [...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(m => m[1]);
  // 三张新表（pause / audio / equipment）互不重叠，各自只追加在原始七张之后，
  // 谁排在最后由整合顺序决定；这里锁的是「在原始七张之后」，不是「必须是最后一张」。
  assert.ok(paths.indexOf('./audio-settings.css') >= 7,
    '新样式必须追加在原始七张之后，实际顺序：' + paths.join(','));
  const added = readFileSync(new URL('../../src/styles/audio-settings.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const selectors = [...added.matchAll(/(^|\})\s*([^{}]*?)\s*\{/g)].map(m => m[2].trim()).filter(Boolean);
  assert.ok(selectors.length > 0, '新样式表不能是空的');
  for (const sel of selectors) for (const one of sel.split(',')) {
    assert.match(one.trim(), /^#audioSettings\b|^#audioSettings-root\b/, '只允许作用于设置区: ' + one);
  }
});
