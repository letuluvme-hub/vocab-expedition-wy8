/* 主页「显示方式」：平板上在自动 / 手机版式 / 电脑版式之间切换。
 *
 * 契约：只画、只派发回调。方式的读写与 viewport 改写都在 services/display-mode.js，
 * 这里通过 getter 读当前值、通过 onSelect 交回去。不写 innerHTML，不带内联 style。
 * 不是平板（eligible() 为假）就整块隐藏：手机和电脑上这个选项没有意义。
 */

export const DISPLAY_OPTIONS = [
  { id: 'auto', label: '自动', title: '按屏幕宽度自动选择' },
  { id: 'phone', label: '手机版式', title: '单列大按钮，适合手指点' },
  { id: 'desktop', label: '电脑版式', title: '左右分栏，一屏看全' },
];

const CONTAINER_ID = 'displaySettings';

function el(doc, tag, className, id, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  if (text != null) node.textContent = text;
  return node;
}

/* opts:
 *   getMode   () => 'auto'|'phone'|'desktop'
 *   eligible  () => boolean            是否平板
 *   onSelect  (mode) => void           父层负责落盘与改 viewport
 */
export function createDisplaySettings({ getMode, eligible, onSelect } = {}) {
  let refs = null;
  const read = (fn, fallback) => { try { return typeof fn === 'function' ? fn() : fallback; } catch { return fallback; } };

  function paint() {
    if (!refs) return refs;
    const show = !!read(eligible, false);
    refs.host.hidden = !show;
    const mode = read(getMode, 'auto');
    for (const [id, btn] of refs.buttons) btn.setAttribute('aria-pressed', String(id === mode));
    return refs;
  }

  function mount(container) {
    const doc = typeof document !== 'undefined' ? document : null;
    const host = container || (doc ? doc.getElementById(CONTAINER_ID) : null);
    if (!doc || !host) return { root: null, paint };

    const root = el(doc, 'div', 'dset', CONTAINER_ID + '-root');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-labelledby', 'displaySettingsHd');
    root.appendChild(el(doc, 'span', 'dset-hd', 'displaySettingsHd', '显示方式'));
    const buttons = new Map();
    for (const opt of DISPLAY_OPTIONS) {
      const btn = el(doc, 'button', 'dset-btn', 'display-' + opt.id, opt.label);
      btn.setAttribute('type', 'button');
      btn.title = opt.title;
      btn.onclick = () => { if (onSelect) onSelect(opt.id); paint(); };
      root.appendChild(btn);
      buttons.set(opt.id, btn);
    }
    host.appendChild(root);
    refs = { host, root, buttons };
    paint();
    return { ...refs, paint };
  }

  return { mount, paint };
}
