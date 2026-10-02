/* 战斗页的蓄力条（docs/product-backlog.md 清单 13）。
 *
 * 纯展示：只读 battle.foeAttack 这个事实，绝不排期、绝不改状态、绝不知道数字。
 * 蓄力是否被打断、还剩多久，全部由 app/foe-attacks.js 算好传进来。
 *
 * ── 为什么有两个 paint 口 ────────────────────────────────────────────
 *   paint(fact, win)     renderFight 走它：同相位就**原地复用**，变了才重建。
 *   paintLive(fact, win) 250ms UI 节拍走它：只改**已存在**的进度与秒数文案。
 *
 * ★ 两个口都绝不重建 DOM（相位/window 变化与节点断连这三种情况除外），
 *   这是一条硬约束，不是优化：玩家点一个字母的途中按钮被换掉，点击落空、
 *   键盘焦点丢失，每秒四次。所以「刷新」与「重建」必须是两个不同的口。
 *
 * 「蓄力时尝试一个可用字母可打断」这句话是**如实描述**当前机制：
 * 蓄力期间真的能打断，而已用/已试过的字母打断不了。所以文案只说「可用字母」，
 * 绝不说「按任意键」—— 那是骗玩家去 spam 退格和方向键。
 *
 * ── 为什么进度走 transform 而不是 width（用户实测卡顿的根因）─────────
 * 旧实现每 250ms 写一次 fill.style.width，配 transition:width .12s linear。
 * 节拍 250ms 比过渡 120ms 长，于是每拍「动 120ms、停 130ms」——
 * 半程静止的阶梯感。真实 Chrome 50ms 间隔取样 29 帧，10 帧宽度完全不变。
 * 而且 width 是 **layout 属性**：每帧都要重排；实测里 renderFight 还在
 * 同一时刻把节点整个重建一遍，动画从 0 重新开始。
 *
 * 现在：width 恒为满宽（交给 CSS），进度只由 transform: scaleX(ratio) 表示。
 * transform 是合成属性 —— 不触发布局、不重绘光栅，交给合成器跑，每帧都动。
 * CSS 的过渡时长（.26s）略长于 250ms 节拍，相邻两拍首尾重叠，于是任何时刻
 * 画面上都**有一个正在进行的**过渡，不存在静止间隙。
 *
 * ── reduced-motion 的降级在 CSS 里，不在这里 ────────────────────────
 * 这个组件绝不查询 matchMedia。两处真相（JS 判一次、CSS 再判一次）迟早打架，
 * 而降级只需要「不显示跳动条、保留显眼秒数」—— 纯 CSS 一处就够。
 * JS 侧对两种偏好一视同仁地写 scaleX；reduce 时那条过渡被关掉、条被藏起来。
 */
import { FOE_PHASE } from '../../domain/foe-attack.js';

export const INTERRUPT_HINT = '蓄力时尝试一个可用字母可打断；重复已试字母不算';

export function createFoeAttackMeter({ $ = id => document.getElementById(id), doc } = {}) {
  const D = () => doc || (typeof document !== 'undefined' ? document : null);
  // 最近一次建出来的元素引用。两个 paint 口只碰这几个，绝不 appendChild（除重建）。
  let refs = null;

  /* 事实 → 展示量。剩余/总窗口夹在 0..1：存档里的 remainingMs 是外部输入，
     直接拿去画会算出负进度或 >100% 的条。 */
  function view(fact, window) {
    const telegraphing = !!fact && fact.phase === FOE_PHASE.TELEGRAPH;
    const total = (window && window.telegraphMs) || 0;
    const ratio = telegraphing && total > 0
      ? Math.max(0, Math.min(1, (fact.remainingMs || 0) / total))
      : 0;
    const secs = Math.max(0, Math.ceil((fact.remainingMs || 0) / 1000));
    const dmg = (window && window.damage) || 0;
    const text = telegraphing
      ? ('⚠ 蓄力中 ' + secs + 's · 打出 ' + dmg + ' 伤害 · ' + INTERRUPT_HINT)
      : fact.phase === FOE_PHASE.RECOVER
        ? (fact.interrupted ? '已被打断，怪在收招' : '怪在收招')
        : fact.phase === FOE_PHASE.DEFEATED ? '' : '怪在观察你';
    return { telegraphing, ratio, secs, damage: dmg, text };
  }

  /* 比例 → scaleX。留 4 位小数：1 位量化会让每一跳肉眼可见地跳一格，
     4 位又短到不会让样式字符串无谓地变长。 */
  const scaleOf = ratio => 'scaleX(' + ratio.toFixed(4) + ')';
  const clsOf = (fact, telegraphing) => 'foeAtk' + (telegraphing ? ' tel' : ' ' + fact.phase);
  const totalOf = window => (window && window.telegraphMs) || 0;

  /* 还能不能拿上一批节点接着画？
     必须同时成立：同一个容器、节点仍接在文档上（换屏后旧的已断开）、
     相位相同、伤害相同、总窗口相同（telegraphMs 一变，旧比例的含义就不同了）。
     任何一条不成立都退回整块重建 —— 宁可多花一次，也绝不留下上一相位的残骸。 */
  function reusable(box, fact, damage, total) {
    return !!refs && refs.box === box && refs.bar.isConnected !== false
      && refs.fill.isConnected !== false && refs.txt.isConnected !== false
      && refs.phase === fact.phase && refs.damage === damage && refs.total === total;
  }

  /* 原地把已有节点刷成当前事实：class / 进度 / 秒数，全部「变了才写」。
     ★ 复用路径绝不能先把进度弹回满格再动 —— 那正是要消灭的可见跳动。 */
  function update(box, fill, txt, fact, v) {
    const cls = clsOf(fact, v.telegraphing);
    if (box.className !== cls) box.className = cls;
    fill.style.transform = scaleOf(v.ratio);
    // 250ms 节拍每秒四次，而秒数每秒只变一次：不跨秒就别重写这段长文案。
    if (txt.textContent !== v.text) txt.textContent = v.text;
  }

  /* 整块重建或原地复用：renderFight（相位变化 / 换词 / 恢复 / 打字母）走它。 */
  function paint(fact, window) {
    const box = $('fFoeAtk');
    if (!box) { refs = null; return null; }
    if (!fact) { refs = null; box.hidden = true; box.textContent = ''; return null; }
    const d = D();
    if (!d) return null;
    const v = view(fact, window);
    box.hidden = false;

    // 打一个字母就会触发 renderFight。相位没变时**原地复用**：
    // 重建节点等于把动画从 0 重新开始，那一下玩家看得见。
    if (reusable(box, fact, v.damage, totalOf(window))) {
      update(box, refs.fill, refs.txt, fact, v);
      return { telegraphing: v.telegraphing, ratio: v.ratio, secs: v.secs, damage: v.damage };
    }

    box.className = clsOf(fact, v.telegraphing);
    box.innerHTML = '';
    const bar = d.createElement('div');
    bar.className = 'foeAtkBar';
    const fill = d.createElement('i');
    // width 交给 CSS（满宽）；这里只给初始进度，避免第一帧是满格。
    fill.style.transform = scaleOf(v.telegraphing ? v.ratio : 0);
    bar.appendChild(fill);
    box.appendChild(bar);
    const txt = d.createElement('div');
    txt.className = 'foeAtkTxt';
    // textContent 而不是 innerHTML：这里拼的是数字与固定短语，绝不回显单词。
    txt.textContent = v.text;
    box.appendChild(txt);
    refs = {
      box, bar, fill, txt, phase: fact.phase, damage: v.damage, total: totalOf(window),
    };
    return { telegraphing: v.telegraphing, ratio: v.ratio, secs: v.secs, damage: v.damage };
  }

  /* 只刷新已有元素：进度 + 秒数文案。DOM 结构一个都不动。
     相位 / 伤害 / window 与上次画的不一致（说明期间真的换了相位）时退回整块重建。 */
  function paintLive(fact, window) {
    if (!fact) return null;
    const box = $('fFoeAtk');
    if (!box || !reusable(box, fact, (window && window.damage) || 0, totalOf(window))) {
      return paint(fact, window);
    }
    const v = view(fact, window);
    update(box, refs.fill, refs.txt, fact, v);
    return { telegraphing: v.telegraphing, ratio: v.ratio, secs: v.secs, damage: v.damage };
  }

  return { paint, paintLive };
}