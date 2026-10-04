// 平板显示方式：viewport 宽度规则、平板判定、本机偏好与组件契约。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  viewportWidthFor, viewportContent, isTabletLike, readDisplayMode, createDisplayMode,
  normalizeMode, AUTO_VIEWPORT, DISPLAY_KEY,
} from '../../src/services/display-mode.js';
import { createDisplaySettings, DISPLAY_OPTIONS } from '../../src/ui/components/display-settings.js';

const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}
function fakeEnv({ w = 820, h = 1180, ua = ANDROID_TAB, landscape = w > h, fine = false, touch = 5, storage = memoryStorage() } = {}) {
  const listeners = [];
  return {
    navigator: { userAgent: ua, maxTouchPoints: touch },
    screen: { width: w, height: h },
    localStorage: storage,
    matchMedia: q => ({
      matches: q.includes('orientation') ? landscape : fine,
      addEventListener: (_, fn) => listeners.push(fn),
    }),
    listeners,
  };
}
function fakeDoc(content = AUTO_VIEWPORT) {
  const meta = { attrs: { content }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; this.writes++; }, writes: 0 };
  const root = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  return { meta, documentElement: root, querySelector: s => (s.includes('viewport') ? meta : null) };
}

test('phone layout uses 480 wide in portrait and 640 in landscape; desktop crosses the 900 breakpoint', () => {
  assert.equal(viewportWidthFor('auto', { landscape: false, deviceWidth: 820 }), null);
  assert.equal(viewportWidthFor('phone', { landscape: false, deviceWidth: 820 }), 480);
  assert.equal(viewportWidthFor('phone', { landscape: true, deviceWidth: 1180 }), 640);
  assert.equal(viewportWidthFor('desktop', { landscape: false, deviceWidth: 820 }), 1024);
  // 横屏本来就够宽：电脑版式就用设备宽度，不额外缩小。
  assert.equal(viewportWidthFor('desktop', { landscape: true, deviceWidth: 1180 }), null);
  assert.equal(viewportContent(null), AUTO_VIEWPORT);
  assert.equal(viewportContent(480), 'width=480,viewport-fit=cover');
  assert.equal(normalizeMode('bogus'), 'auto');
});

test('only touch devices with a short side of 600+ count as tablets', () => {
  assert.equal(isTabletLike(fakeEnv()), true);
  assert.equal(isTabletLike(fakeEnv({ w: 390, h: 844, ua: 'iPhone Mobile' })), false);
  // 电脑浏览器忽略 meta viewport，给它选项也不起作用。
  assert.equal(isTabletLike(fakeEnv({ w: 1920, h: 1080, ua: 'Mozilla/5.0 (Windows NT 10.0)', fine: true, touch: 0 })), false);
  // iPadOS Safari 报 Macintosh UA，接了触控板还是平板。
  assert.equal(isTabletLike(fakeEnv({ w: 820, h: 1180, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', fine: true, touch: 5 })), true);
});

test('preference lives in its own key, falls back to auto, and never touches the learning save', () => {
  const storage = memoryStorage({ wy8a_rogue_v1: '{"runs":3}' });
  const env = fakeEnv({ storage });
  const doc = fakeDoc();
  const mode = createDisplayMode({ env, doc });
  assert.equal(mode.get(), 'auto');
  assert.equal(mode.set('phone'), 'width=480,viewport-fit=cover');
  assert.equal(storage.getItem(DISPLAY_KEY), 'phone');
  assert.equal(doc.meta.attrs.content, 'width=480,viewport-fit=cover');
  assert.equal(doc.documentElement.attrs['data-display'], 'phone');
  mode.set('auto');
  assert.equal(storage.getItem(DISPLAY_KEY), null);
  assert.equal(doc.meta.attrs.content, AUTO_VIEWPORT);
  assert.equal(storage.getItem('wy8a_rogue_v1'), '{"runs":3}');
  assert.equal(readDisplayMode({ localStorage: { getItem() { throw new Error('blocked'); } } }), 'auto');
});

test('rewrites the viewport only when it changes, and follows rotation', () => {
  const env = fakeEnv({ storage: memoryStorage({ [DISPLAY_KEY]: 'phone' }) });
  const doc = fakeDoc();
  const mode = createDisplayMode({ env, doc });
  mode.apply();
  mode.apply();
  assert.equal(doc.meta.writes, 1, '同样的内容不重写，避免 resize 循环');
  env.screen = { width: 1180, height: 820 };
  env.matchMedia = q => ({ matches: q.includes('orientation') ? true : false });
  env.listeners.forEach(fn => fn());
  assert.equal(doc.meta.attrs.content, 'width=640,viewport-fit=cover');
});

test('a saved choice is ignored on phones', () => {
  const env = fakeEnv({ w: 390, h: 844, ua: 'iPhone Mobile', storage: memoryStorage({ [DISPLAY_KEY]: 'desktop' }) });
  const doc = fakeDoc();
  createDisplayMode({ env, doc }).apply();
  assert.equal(doc.meta.attrs.content, AUTO_VIEWPORT);
});

/* ---- 组件：只画、只派发 ---- */
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.hidden = false; this.title = ''; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  set innerHTML(_) { throw new Error('innerHTML is not allowed'); }
}
test('display settings render three buttons, mark the current one, and hide off-tablet', () => {
  const prev = globalThis.document;
  globalThis.document = { createElement: t => new El(t), getElementById: () => null };
  try {
    let mode = 'auto', tablet = true;
    const picked = [];
    const view = createDisplaySettings({ getMode: () => mode, eligible: () => tablet, onSelect: m => { picked.push(m); mode = m; } });
    const host = new El('div');
    const refs = view.mount(host);
    const btns = [...refs.buttons.values()];
    assert.deepEqual(btns.map(b => b.textContent), DISPLAY_OPTIONS.map(o => o.label));
    assert.ok(btns.every(b => b.attrs.type === 'button' && !b.style));
    assert.deepEqual(btns.map(b => b.attrs['aria-pressed']), ['true', 'false', 'false']);
    btns[1].onclick();
    assert.deepEqual(picked, ['phone']);
    assert.deepEqual(btns.map(b => b.attrs['aria-pressed']), ['false', 'true', 'false']);
    assert.equal(host.hidden, false);
    tablet = false; view.paint();
    assert.equal(host.hidden, true);
  } finally { globalThis.document = prev; }
});
