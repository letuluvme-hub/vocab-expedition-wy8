// Shortcuts activate the same visible buttons as pointer input. All game rules,
// costs and persistence remain in the existing button actions and controllers.
export function isTextEntry(target) {
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(target?.tagName || '') || !!target?.isContentEditable;
}

export function shortcutToken(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.ctrlKey || event.altKey || event.metaKey || isTextEntry(event.target)) return null;
  if (event.shiftKey && /^Digit[1-3]$/.test(event.code || '')) return 'Shift+' + event.code.slice(-1);
  return (event.shiftKey ? 'Shift+' : '') + event.key;
}

export function createGameShortcuts({ document: doc = globalThis.document, Observer = globalThis.MutationObserver } = {}) {
  let marked = new Set();
  const visible = node => !!node && !!node.getClientRects().length &&
    doc.defaultView.getComputedStyle(node).visibility !== 'hidden';

  function bindings() {
    const out = new Map();
    const add = (key, selector) => {
      const node = [...doc.querySelectorAll(selector)].find(visible);
      if (node) out.set(key, node);
      return !!node;
    };
    const group = (selector, prefix = '') => {
      [...doc.querySelectorAll(selector)].filter(visible).slice(0, 9)
        .forEach((node, i) => out.set(prefix + (i + 1), node));
    };
    const screen = doc.querySelector('.screen.on')?.id;
    if (screen === 's-title') {
      if (!add('Enter', '#continueRun')) add('Enter', '#startRun');
      add('F2', '#growthDailyOpen');
    } else if (screen === 's-map') {
      group('#map .node.pick'); add('Escape', '#mPause');
    } else if (screen === 's-fight') {
      group('#fItems .item');
      if (!doc.getElementById('fOffer')?.classList.contains('locked')) group('#fOffer .wcCard', 'Shift+');
      add('F2', '#tHint'); add('F3', '#tSay');
      add('F8', '#tSkip'); add('F9', '#tFlee'); add('Escape', '#tPause');
    } else if (screen === 's-pause') {
      add('Enter', '#pzResume'); add('Escape', '#pzResume'); add('F4', '#pzHome');
    } else if (screen === 's-pick') {
      group('#pPicks .pick'); add('F8', '#pSkip');
    } else if (screen === 's-event') {
      group('#ePicks .pick');
    } else if (screen === 's-rest') {
      group('#rPicks .pick'); add('Escape', '#rPicks [data-opt="shop:leave"]');
    } else if (screen === 's-over') {
      if (!add('Enter', '#oNext')) if (!add('Enter', '#oAgain')) add('Enter', '#oHome');
      add('Escape', '#oHome');
    } else if (screen === 's-daily') {
      add('Enter', '#dailyResume, #dailyNext, #dailyFormal, #dailyStart, #dailyDoneHome');
      if (!add('Escape', '#dailyResume')) if (!add('Escape', '#dailyPause')) add('Escape', '#dailyHome');
      add('F2', '#dailyHint'); add('F8', '#dailyDefer'); add('Backspace', '#dailyUndo');
    } else if (screen === 's-learning-complete') {
      if (!add('Enter', '#lcBtnNext')) add('Enter', '#lcBtnHome');
      add('Escape', '#lcBtnHome');
    } else if (screen === 's-relics') add('Escape', '#s-relics [data-back]');
    else if (screen === 's-import') add('Escape', '#s-import [data-back]');
    return out;
  }

  function refresh() {
    const labels = new Map();
    for (const [key, node] of bindings()) {
      if (!labels.has(node)) labels.set(node, []);
      labels.get(node).push(key);
    }
    const tip = doc.querySelector('#fOffer:not(.locked) .wcTip');
    if (visible(tip)) labels.set(tip, ['Tab', 'Shift+Tab']);
    for (const node of marked) if (!labels.has(node)) {
      node.classList.remove('keyShortcutHost'); node.removeAttribute('data-shortcut'); node.removeAttribute('aria-keyshortcuts');
      node.querySelector(':scope > .keyShortcutHint')?.remove();
    }
    for (const [node, keys] of labels) {
      node.classList.add('keyShortcutHost');
      node.setAttribute('data-shortcut', keys.map(k => k === 'Escape' ? 'Esc' : k).join(' / '));
      node.setAttribute('aria-keyshortcuts', keys.join(' '));
      let hint = node.querySelector(':scope > .keyShortcutHint');
      if (!hint) {
        hint = doc.createElement('kbd'); hint.className = 'keyShortcutHint';
        hint.setAttribute('aria-hidden', 'true'); node.appendChild(hint);
      }
      const label = node.getAttribute('data-shortcut');
      // Keep the button's own label and text-based automation unchanged.
      // The visual badge is decorative; aria-keyshortcuts carries semantics.
      if (hint.getAttribute('data-label') !== label) hint.setAttribute('data-label', label);
    }
    marked = new Set(labels.keys());
  }

  function handle(event) {
    const key = shortcutToken(event);
    if (!key || event.repeat) return false;
    const node = bindings().get(key);
    if (!node || node.disabled || node.classList.contains('off')) return false;
    // Enter still activates a deliberately focused button/link/summary natively.
    if (key === 'Enter' && visible(event.target?.closest?.('button,a,summary,[role="button"]'))) return false;
    event.preventDefault(); node.click(); return true;
  }

  // Dynamic cards and daily screens replace their children. Only observe child
  // changes, so animation styles and our own attributes cannot create a loop.
  const observer = Observer ? new Observer(refresh) : null;
  const root = doc.getElementById('app');
  if (root) observer?.observe(root, { childList: true, subtree: true });
  refresh();
  return { handle, refresh, destroy: () => observer?.disconnect() };
}
