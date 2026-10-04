// Complete QWERTY keys, independent of answer letters. Mouse/touch and physical
// keyboards both dispatch the same onInput callback; keys are never consumed.
export function createDictationKeyboard({ document: doc = globalThis.document, onInput }) {
  let allowed = new Set();
  let container = null;
  const dispatch = key => { if (allowed.has(key)) onInput(key); };
  function render(root, word) {
    container = root;
    root.replaceChildren();
    root.className = 'dictation-keyboard';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', '完整字母键盘');
    const text = String(word && typeof word === 'object' ? word.w ?? '' : word ?? '');
    const separators = [' ', '-', "'", '.'].filter(ch => text.includes(ch) || (ch === "'" && text.includes('’')));
    allowed = new Set([...('abcdefghijklmnopqrstuvwxyz'), ...separators, 'Backspace']);
    for (const rowKeys of ['qwertyuiop'.split(''), 'asdfghjkl'.split(''), 'zxcvbnm'.split(''), [...separators, 'Backspace']]) {
      const row = doc.createElement('div');
      row.className = 'dictation-keyboard-row';
      for (const key of rowKeys) {
        const button = doc.createElement('button');
        button.type = 'button'; button.className = 'dictation-key';
        button.dataset.key = key;
        button.textContent = key === 'Backspace' ? '退格' : key === ' ' ? '空格' : key.toUpperCase();
        button.setAttribute('aria-label', button.textContent);
        button.onclick = () => dispatch(key);
        row.appendChild(button);
      }
      root.appendChild(row);
    }
  }
  function handleKey(event) {
    if (!container || !event || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return false;
    const target = event.target;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName) || target.isContentEditable)) return false;
    const key = event.key === 'Backspace' ? event.key : event.key === '’' ? "'" : String(event.key ?? '').toLowerCase();
    if (!allowed.has(key)) return false;
    event.preventDefault();
    dispatch(key);
    return true;
  }
  function destroy() { allowed.clear(); container = null; }
  return { render, handleKey, destroy };
}
