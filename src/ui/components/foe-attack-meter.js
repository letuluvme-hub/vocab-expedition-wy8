/* 战斗页的蓄力条（docs/product-backlog.md 清单 13）。
 *
 * 纯展示：只读 battle.foeAttack 这个事实，绝不排期、绝不改状态、绝不知道数字。
 * 蓄力是否被打断、还剩多久，全部由 app/foe-attacks.js 算好传进来。
 *
 * ── 为什么有两个 paint 口 ────────────────────────────────────────────
 *   paint(fact, win)     整块重建（renderFight 走它）。相位真的变了才用。
 *   paintLive(fact, win) 只改**已存在的**进度条宽度与秒数文案（250ms UI 节拍走它）。
 *
 * ★ paintLive 绝不重建 DOM，这是一条硬约束，不是优化：
 *   蓄力条每 250ms 刷一次。如果每次都 innerHTML='' 重建，战斗屏会被反复重排 ——
 *   玩家点一个字母的途中按钮被换掉，点击落空、键盘焦点丢失，每秒四次。
 *   所以「刷新」与「重建」必须是两个不同的口。
 *
 * 「蓄力时尝试一个可用字母可打断」这句话是**如实描述**当前机制：
 * 蓄力期间真的能打断，而已用/已试过的字母打断不了。所以文案只说「可用字母」，
 * 绝不说「按任意键」—— 那是骗玩家去 spam 退格和方向键。
 */
import { FOE_PHASE } from '../../domain/foe-attack.js';

export const INTERRUPT_HINT = '蓄力时尝试一个可用字母可打断；重复已试字母不算';

export function createFoeAttackMeter({ $ = id => document.getElementById(id), doc } = {}) {
  const D = () => doc || (typeof document !== 'undefined' ? document : null);
  // 最近一次 paint 建出来的元素引用。paintLive 只碰这三个，绝不 appendChild。
  let refs = null;

  /* 事实 → 展示量。剩余/总窗口夹在 0..1：存档里的 remainingMs 是外部输入，
     直接拿去画会算出负宽度或 >100% 的条。 */
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

  /* 整块重建。只在 renderFight（相位变化 / 换词 / 恢复）时走。 */
  function paint(fact, window) {
    const box = $('fFoeAtk');
    if (!box) { refs = null; return null; }
    if (!fact) { refs = null; box.hidden = true; box.textContent = ''; return null; }
    const d = D();
    if (!d) return null;
    const v = view(fact, window);
    box.hidden = false;
    box.className = 'foeAtk' + (v.telegraphing ? ' tel' : ' ' + fact.phase);
    box.innerHTML = '';
    const bar = d.createElement('div');
    bar.className = 'foeAtkBar';
    const fill = d.createElement('i');
    fill.style.width = (v.telegraphing ? (v.ratio * 100).toFixed(1) : '0') + '%';
    bar.appendChild(fill);
    box.appendChild(bar);
    const txt = d.createElement('div');
    txt.className = 'foeAtkTxt';
    // textContent 而不是 innerHTML：这里拼的是数字与固定短语，绝不回显单词。
    txt.textContent = v.text;
    box.appendChild(txt);
    refs = { box, bar, fill, txt, phase: fact.phase, damage: v.damage };
    return { telegraphing: v.telegraphing, ratio: v.ratio, secs: v.secs, damage: v.damage };
  }

  /* 只刷新已有元素：宽度 + 秒数文案。DOM 结构一个都不动。
     相位/伤害与上次画的不一致（说明期间真的换了相位）时退回整块重建 ——
     宁可多花一次，也绝不把上一相位的残骸留在屏幕上。 */
  function paintLive(fact, window) {
    if (!fact) return null;
    const box = $('fFoeAtk');
    if (!box || !refs || refs.box !== box) return paint(fact, window);
    const v = view(fact, window);
    if (refs.phase !== fact.phase || refs.damage !== v.damage) return paint(fact, window);
    box.className = 'foeAtk' + (v.telegraphing ? ' tel' : ' ' + fact.phase);
    refs.fill.style.width = (v.telegraphing ? (v.ratio * 100).toFixed(1) : '0') + '%';
    refs.txt.textContent = v.text;
    return { telegraphing: v.telegraphing, ratio: v.ratio, secs: v.secs, damage: v.damage };
  }

  return { paint, paintLive };
}