/* 连胜播报 toast（#streakAnnouncement）—— 只画一个标签，纯展示。
 *
 * 契约（docs/feature-word-streak.md，逐条核对）：
 *  1) **往调用方给的宿主里加一个子节点**，节点 position:static 留在战斗页
 *     文档流里。绝不用 fixed/absolute 浮在 HUD 上盖住血条、词框和底部按钮：
 *     那块区域是移动端操作区，盖住一次就是一次误触。
 *  2) **只落 label**。当前英文单词是学习答案，绝不出现在播报通道里
 *     （`word` 参数只被用来做「不参与拼接」的契约，本组件只读 label）。
 *  3) **全部 textContent**：DOM 桩里 innerHTML 的 setter 直接抛，这条是被
 *     测试强制的，不是靠自觉。
 *  4) **坏输入安静降级**：没有宿主 / 没有 label → 返回 null 且什么都不画、
 *     不排定时器（父层没接线不该弄崩战斗页）。count 非法 → 当 0，绝不把
 *     NaN 写上屏。
 *  5) **同一个台阶 display 不堆叠**：复用同一个节点，重画只换文字 + 重排
 *     到期定时器（旧的被取消）。
 *  6) **定时器句柄由注入的 schedule/cancelSchedule 掌管**，hide() 只取消
 *     **自己那一个**句柄，绝不广停全局生命周期（暂停/队列的定时器不归它管）。
 *  7) **reduced-motion**：构造参数 reducedMotion:true，或注入的 matchMedia
 *     说系统偏好 reduce → 不加动画 class，但文字照常出现、照常到期收掉，
 *     不会留一块挂着的死文字在屏幕上。
 *  8) **长文案不截断**：300+ 字符原样进 DOM，窄屏换行交给 CSS
 *     （overflow-wrap:anywhere）。截成 "…" 会骗玩家「我到的是哪一级」。
 */
export const STREAK_ANNOUNCEMENT_ID = 'streakAnnouncement';
export const STREAK_ANNOUNCEMENT_CLASS = 'streak-toast';
export const STREAK_ANNOUNCEMENT_DEFAULT_MS = 1600;

/* label 只要是非空字符串就算合法；对象/数字/空串一律拒绝（不把对象变文案）。 */
function labelOf(label) {
  if (typeof label !== 'string') return '';
  return label.trim() ? label : '';
}
function countOf(count) {
  const n = Number(count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/* 系统是否要求减少运动。注入的 matchMedia 优先（测试可造），没有就用全局。 */
function prefersReducedMotion(matchMedia) {
  try {
    const fn = typeof matchMedia === 'function'
      ? matchMedia
      : (typeof globalThis !== 'undefined' && typeof globalThis.matchMedia === 'function'
        ? globalThis.matchMedia.bind(globalThis) : null);
    if (!fn) return false;
    return !!(fn('(prefers-reduced-motion: reduce)') || {}).matches;
  } catch (e) {
    return false;   // 判不出来就当「有动画」，不假装读到了偏好
  }
}

export function showStreakAnnouncement(host, opts = {}) {
  const {
    label, count,
    document: doc,
    autoHideMs = STREAK_ANNOUNCEMENT_DEFAULT_MS,
    schedule, cancelSchedule, matchMedia, reducedMotion,
  } = opts || {};

  const text = labelOf(label);
  if (!text) return null;                              // 没有可播的文案 → 什么都不做
  if (!host || typeof host.appendChild !== 'function') return null;  // 没宿主 → 父层没接线

  const D = doc || (typeof document !== 'undefined' ? document : null);
  if (!D || typeof D.createElement !== 'function') return null;

  const put = typeof schedule === 'function' ? schedule : (fn, ms) => setTimeout(fn, ms);
  const drop = handle => {
    if (handle == null) return;
    /* 注入的 cancelSchedule 优先；没注入就用 clearTimeout —— 否则默认
       setTimeout 排出去的隐藏定时器会变成悬挂定时器（真机上就是「关掉页面
       之后还偷偷把新一条播报藏了」）。 */
    try {
      if (typeof cancelSchedule === 'function') cancelSchedule(handle);
      else clearTimeout(handle);
    } catch (e) { /* 取消失败不该影响玩法 */ }
  };

  /* 复用同一个节点：同一时刻只有一条连胜播报，不堆叠。 */
  let el = typeof host.querySelector === 'function' ? host.querySelector('#' + STREAK_ANNOUNCEMENT_ID) : null;
  if (!el) {
    const kids = host.children || [];
    for (const k of kids) if (k && k.id === STREAK_ANNOUNCEMENT_ID) { el = k; break; }
  }
  if (!el) {
    el = D.createElement('div');
    el.id = STREAK_ANNOUNCEMENT_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    host.appendChild(el);
  }

  /* 只有「要动画」且「系统没要求减少运动」时才加动画 class。
     两者都满足不了就退化成纯文字 + 到期隐藏，绝不停在那儿不消失。 */
  const still = reducedMotion === true || prefersReducedMotion(matchMedia);
  el.classList.add(STREAK_ANNOUNCEMENT_CLASS);
  el.classList.add('streak-toast--plain');           // 始终有：无动画的基线
  el.classList.add(still ? 'streak-toast--still' : 'streak-toast--anim');
  el.classList.remove(still ? 'streak-toast--anim' : 'streak-toast--still');
  el.textContent = text;                              // 全部走 textContent
  el.setAttribute('data-stage', String(countOf(count)));
  el.hidden = false;

  /* 只挂一个到期定时器；重画时先取消旧的，不叠 N 个 hide。 */
  if (el.__streakTimer != null) drop(el.__streakTimer);
  /* ★ 代号：清掉定时器并不保证回调没进浏览器事件队列。旧那一只迟到时带着旧
     代号回来，发现自己过期就什么都不做 —— 否则「上一次展示的隐藏回调」会把
     刚画出来的新阶段整块藏掉。 */
  const token = (el.__streakToken || 0) + 1;
  el.__streakToken = token;
  let handle = null;
  handle = put(() => {
    if (el.__streakToken !== token) return;   // 过期的那一只：绝不动当前的展示
    el.__streakTimer = null;
    if (el.parentElement) el.hidden = true;          // 到期收掉：不在屏幕上留死文字
  }, Math.max(200, Number(autoHideMs) || STREAK_ANNOUNCEMENT_DEFAULT_MS));
  el.__streakTimer = handle;

  return {
    el,
    count: countOf(count),
    label: text,
    hide() {
      if (el.__streakTimer != null) { drop(el.__streakTimer); el.__streakTimer = null; }
      el.hidden = true;
    },
  };
}
