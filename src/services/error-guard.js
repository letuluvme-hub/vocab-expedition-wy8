/* 全局错误兜底（VE-17）。
 *
 * 审计发现：`src/` 下没有任何 `window.onerror` / `unhandledrejection` 监听。
 * 后果是**任一渲染路径抛异常 = 白屏**，而且开发者拿不到任何现场 ——
 * 玩家看到"游戏坏了"，我们只看到 CI 是绿的（因为那条路径没被测到）。
 *
 * 这一层刻意做得很薄，因为它的职责边界很清楚：
 *   ✓ 捕获未处理异常与未处理 Promise 拒绝，记下可复制的现场
 *   ✓ 给玩家一个不遮挡、不打断存档的提示条
 *   ✗ **绝不吞掉错误**（不改写 stack、不 return true 假装处理过）
 *   ✗ **绝不重试、不自动刷新、不动存档** —— 任何"自作主张的恢复"都可能
 *     把玩家正在进行的一局写坏，而这正是本项目最不能碰的东西
 *   ✗ 不改变任何正常路径的行为：没出错时这个模块就是空的
 *
 * 与既有降级风格一致：音频/语音层大量使用「失败静默降级，游戏照常可玩」。
 * 但**异常不该静默** —— 所以这里显示提示而不是吞掉，同时保证提示本身
 * 绝不影响玩法（纯展示、可关闭、不抢焦点、不阻断输入）。
 */

const MAX_DETAIL_CHARS = 1200;   // 现场摘要长度上限：足够定位，也不至于撑爆页面

const docOf = (doc, target) => doc || (target && target.document) || (typeof document !== 'undefined' ? document : null);

/** 把异常压成一行可复制文本。取不到 stack 也不许抛 —— 这一层自己不能再抛。 */
export function describeError(err) {
  try {
    if (err === null || err === undefined) return 'unknown error';
    if (typeof err === 'string') return err;
    const message = err.message || err.name || String(err);
    const stack = typeof err.stack === 'string' ? err.stack : '';
    const where = stack ? stack.split('\n').slice(0, 4).join(' | ').trim() : '(no stack)';
    const text = message + ' @ ' + where;
    return text.length > MAX_DETAIL_CHARS ? text.slice(0, MAX_DETAIL_CHARS) + '…' : text;
  } catch {
    return 'unprintable error';
  }
}

/** 追加一条错误提示。DOM 坏掉时静默放弃 —— 提示条只是锦上添花。 */
export function pushErrorBanner(text, { doc = null, target = null } = {}) {
  try {
    const d = docOf(doc, target);
    if (!d) return false;
    if (d.getElementById && d.getElementById('errbar')) return false;   // 已有则不再叠
    const bar = d.createElement('div');
    bar.id = 'errbar';
    bar.setAttribute('role', 'alert');          // 读屏器立刻播报，不等用户去看
    bar.setAttribute('aria-live', 'assertive');
    bar.textContent = '出现了一个问题（进度已保留，可刷新或继续玩）：';

    const detail = d.createElement('code');
    detail.id = 'errDetail';
    detail.textContent = text;
    // 详情默认收起：错误现场对玩家没用，但对报告 bug 有用。
    const details = d.createElement('details');
    details.style.marginTop = '6px';
    const summary = d.createElement('summary');
    summary.textContent = '技术详情（反馈问题时请附上）';
    details.appendChild(summary);
    details.appendChild(detail);

    const close = d.createElement('button');
    close.type = 'button';
    close.textContent = '关闭';
    close.setAttribute('aria-label', '关闭错误提示');
    close.onclick = () => bar.remove();

    bar.appendChild(details);
    bar.appendChild(close);
    d.body.appendChild(bar);
    return true;
  } catch {
    return false;
  }
}

/**
 * 安装全局兜底。返回一份可调用的 uninstall（测试用）。
 * 重复调用是幂等的：同一个 document 上装两次不会产生两个监听。
 */
export function installGlobalErrorGuard({ target = globalThis, doc = null } = {}) {
  const d = docOf(doc, target);
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  if (target.__vocabErrorGuardInstalled) return () => {};

  const onError = event => {
    // 资源加载失败（<img>/<script>）也会冒泡到 window.onerror，但它们带 target
    // 而没有 error。这种不报 —— 本项目不加载任何外部资源，报了只会是噪音。
    if (event && event.target && !event.error && !event.message) return;
    try { console.error('[vocab] uncaught', event && (event.error || event.message)); } catch { /* noop */ }
    pushErrorBanner(describeError(event && event.error ? event.error : event && event.message), { doc: d, target });
    // 刻意**不** preventDefault / 不 return true：让默认行为继续，
    // 控制台与任何错误上报仍能看到这次失败。吞掉它才是真的把问题藏起来。
  };

  const onRejection = event => {
    try { console.error('[vocab] unhandled rejection', event && event.reason); } catch { /* noop */ }
    pushErrorBanner(describeError(event && event.reason), { doc: d, target });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  try { target.__vocabErrorGuardInstalled = true; } catch { /* noop */ }

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    try { target.__vocabErrorGuardInstalled = false; } catch { /* noop */ }
    try { const bar = d && d.getElementById && d.getElementById('errbar'); if (bar) bar.remove(); } catch { /* noop */ }
  };
}
