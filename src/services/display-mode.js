// 平板显示方式：自动 / 手机版式 / 电脑版式（docs/feature-display-mode.md）。
//
// 做法是改 <meta name="viewport"> 的 width，而不是另写一套 CSS：
// 全站布局都由 max-width / min-width 媒体查询决定，把布局视口设成 480 宽，
// 浏览器就整页按手机断点排版再等比放大铺满平板；设成 1024 宽就走电脑分栏。
// 既有断点、覆盖顺序一条都不用动。
//
// 只是展示偏好：不进 wy8a_rogue_v1 存档，单独一个本机键，读写失败一律退回「自动」。
import { deviceProfile } from './device.js';

export const DISPLAY_KEY = 'wy8a_display_v1';
export const DISPLAY_MODES = ['auto', 'phone', 'desktop'];
export const AUTO_VIEWPORT = 'width=device-width,initial-scale=1,viewport-fit=cover';

// 竖屏 480：低于 640 断点，走手机单列；平板竖屏放大约 1.7 倍，字母键更好点。
// 横屏 640：高度落到 480 以下，走手机横握的左右分栏。640–900 之间、高度又不够的
// 中间档会把题目卡挤没，所以横屏不用更宽的值。
// 电脑 1024：跨过 900 断点，走电脑分栏。
export const PHONE_PORTRAIT_WIDTH = 480;
export const PHONE_LANDSCAPE_WIDTH = 640;
export const DESKTOP_WIDTH = 1024;
// 短边 ≥ 600 的触屏设备算平板。手机短边 320–430，不给它们这个选项。
export const TABLET_MIN_SIDE = 600;

export function normalizeMode(mode) {
  return DISPLAY_MODES.includes(mode) ? mode : 'auto';
}

// 纯函数：给定方式与当前屏幕，返回布局视口宽度；null 表示用 device-width。
export function viewportWidthFor(mode, { landscape = false, deviceWidth = 0 } = {}) {
  if (mode === 'phone') return landscape ? PHONE_LANDSCAPE_WIDTH : PHONE_PORTRAIT_WIDTH;
  if (mode === 'desktop') return deviceWidth >= DESKTOP_WIDTH ? null : DESKTOP_WIDTH;
  return null;
}

export function viewportContent(width) {
  return width ? `width=${width},viewport-fit=cover` : AUTO_VIEWPORT;
}

// screen.width/height 是设备 CSS 像素，不随 meta viewport 改变；
// iOS 不随转屏交换，所以按当前方向取长边或短边。
function screenSize(env) {
  const s = env.screen || {};
  const a = Number(s.width) || 0, b = Number(s.height) || 0;
  return { short: Math.min(a, b), long: Math.max(a, b) };
}

function isLandscape(env) {
  try {
    if (typeof env.matchMedia === 'function') return env.matchMedia('(orientation: landscape)').matches;
  } catch {}
  return (env.innerWidth || 0) > (env.innerHeight || 0);
}

// iPadOS 的 Safari 报桌面 UA，接了触控板还会命中 pointer:fine，
// 所以「Macintosh + 多点触控」单独认作平板。
function isIPadOS(env) {
  const nav = env.navigator || {};
  return /Macintosh/i.test(nav.userAgent || '') && Number(nav.maxTouchPoints) > 1;
}

export function isTabletLike(env = globalThis) {
  if (deviceProfile(env).desktop && !isIPadOS(env)) return false;
  return screenSize(env).short >= TABLET_MIN_SIDE;
}

export function readDisplayMode(env = globalThis) {
  try { return normalizeMode(env.localStorage?.getItem(DISPLAY_KEY)); } catch { return 'auto'; }
}

function writeDisplayMode(mode, env) {
  try {
    if (mode === 'auto') env.localStorage?.removeItem(DISPLAY_KEY);
    else env.localStorage?.setItem(DISPLAY_KEY, mode);
  } catch {}
}

export function createDisplayMode({ env = globalThis, doc = globalThis.document } = {}) {
  let mode = readDisplayMode(env);
  const eligible = () => isTabletLike(env);
  const meta = () => doc?.querySelector?.('meta[name="viewport"]') || null;

  function apply() {
    const tag = meta();
    if (!tag) return null;
    const { short, long } = screenSize(env);
    const landscape = isLandscape(env);
    const width = eligible() ? viewportWidthFor(mode, { landscape, deviceWidth: landscape ? long : short }) : null;
    const content = viewportContent(width);
    // 只在内容真的变了才写：写 meta 会触发 resize，resize 又会回到这里。
    if (tag.getAttribute('content') !== content) tag.setAttribute('content', content);
    doc.documentElement?.setAttribute?.('data-display', eligible() ? mode : 'auto');
    return content;
  }

  function set(next) {
    mode = normalizeMode(next);
    writeDisplayMode(mode, env);
    return apply();
  }

  // 转屏后手机版式要在 480 / 640 之间换。
  try {
    const mq = typeof env.matchMedia === 'function' ? env.matchMedia('(orientation: landscape)') : null;
    if (mq?.addEventListener) mq.addEventListener('change', apply);
    else if (mq?.addListener) mq.addListener(apply);
  } catch {}

  return { get: () => mode, set, apply, eligible };
}
