/* 词组排版微调：让「最长的那个单词」也能自己占满一整行。
 * 为什么需要：living conditions 的 conditions 有 10 个字母，320px 屏上按默认
 * 槽宽（27px + 5px 间距）需要 10×27+9×5 = 315px，而可用宽只有 278px ——
 * flex 只能从单词中间断开，排成 LIVING|COND / ITIONS，短语就散架了。
 *
 * 做法：按单词分段量出「最长的那段有几个槽位」，超宽就整体等比收窄槽位与间距
 * （最多收到 68%，不至于缩成看不清），换「每个单词都不被拆开」。
 * 单个单词（没有空格）时直接返回 —— 普通词保持原槽宽，视觉不变。
 * 全程只改 style.width / style.gap：不动 DOM 结构、不动 class、不动判定。
 * Node 的 DOM 桩没有 getComputedStyle，所以必须 typeof 守卫。
 */
export function fitPhraseSlots(sl, gapBefore) {
  try {
    if (typeof getComputedStyle !== 'function') return;
    // ★ 必须先把上一次留下的行内 gap 清掉再量。
    //   #fSlots 是常驻元素，而槽位每次渲染都是新建的 —— 所以槽位上没有残留，
    //   只有 sl.style.gap 会留下来。不清的话上一句缩过的间距会被当成这次的
    //   基准，越缩越窄（实测 4.32px → 3.80px → … 累叠），排版会越玩越歪。
    if (sl.style) sl.style.gap = '';
    if (!gapBefore || !gapBefore.some(Boolean)) return;      // 不是词组 → 不碰
    const kids = sl.children; if (!kids || kids.length < 3) return;
    const slotEls = [], seps = [];
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i].className || '';
      if (c === 'slotsep') seps.push(kids[i]);
      else if (c.split(' ').indexOf('slot') >= 0) slotEls.push(kids[i]);
    }
    if (!slotEls.length) return;
    const box = sl.getBoundingClientRect();
    const avail = (box && box.width) || sl.clientWidth || 0;
    if (avail < 40) return;                                    // 量不到宽度（未布局）就放弃
    // 每个单词占几个槽位
    const runs = []; let run = 1;
    for (let i = 1; i < gapBefore.length; i++) { if (gapBefore[i]) { runs.push(run); run = 1; } else run++; }
    runs.push(run);
    const maxRun = Math.max.apply(null, runs);
    if (maxRun < 2) return;
    const w0 = slotEls[0].getBoundingClientRect().width || 0;
    if (!w0) return;
    const csSl = getComputedStyle(sl);
    const g0 = parseFloat(csSl.columnGap || csSl.gap) || 0;
    const sepW = seps.length ? (seps[0].getBoundingClientRect().width || 0) : 0;
    // 最长的单词要多宽：槽宽×个数 + 间距×(个数-1) + 它前面那个间隔
    const need = maxRun * w0 + (maxRun - 1) * g0 + sepW;
    if (need <= avail + 0.5) return;
    const k = Math.max(0.68, avail / need);
    if (k >= 0.995) return;
    for (let i = 0; i < slotEls.length; i++) slotEls[i].style.width = (w0 * k) + 'px';
    if (g0) sl.style.gap = (g0 * k) + 'px';
  } catch (e) { /* 量不到就按默认排，绝不能因为排版把战斗页搞崩 */ }
}