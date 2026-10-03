/* 选词条（docs/feature-word-choice.md）：战斗词框顶部的 2–3 张候选卡。
 *
 * 只画不结算：候选、预估伤害、能不能换，全部由调用方算好传进来；
 * 点哪张卡只交回索引，换词本身在 app 层（走 progress 闸门）。
 *
 * ★ 卡面只写中文释义 + 字母数 + 预估伤害，绝不回显英文 —— 中译英回忆是考点。
 * ★ 锁定后（已经开始拼）整行**保留高度**只是变暗：如果这时把行收起来，
 *   字母盘会在玩家手指底下往上跳。
 */
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function createWordOffer({ $ }) {
  /**
   * @param {object} view
   *   offer    —— 候选词条数组（已按字母数升序）
   *   current  —— 当前出招的词条
   *   cards    —— 每张卡的 { letters, total, lethal }（与 offer 同序）
   *   canSwitch—— 还能不能换
   *   onPick(i)
   */
  function paint(view) {
    const box = $('fOffer');
    if (!box) return null;
    const offer = (view && view.offer) || [];
    if (offer.length < 2) { box.hidden = true; box.innerHTML = ''; return box; }
    box.hidden = false;
    box.className = 'wc' + (view.canSwitch ? '' : ' locked');
    box.innerHTML = '';
    offer.forEach((w, i) => {
      const c = view.cards[i] || {};
      const on = view.current && w.w === view.current.w;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wcCard' + (on ? ' on' : '') + (c.lethal ? ' kill' : '');
      b.dataset.idx = String(i);
      b.disabled = !view.canSwitch && !on;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = w.z + '：' + (c.letters | 0) + ' 个字母，拼完约造成 ' + (c.total | 0) + ' 伤害' + (c.lethal ? '（足以击败敌人）' : '');
      b.innerHTML = '<span class="wcZh">' + esc(w.z) + '</span>'
        + '<span class="wcMeta">' + (c.letters | 0) + '字母 · '
        + (c.lethal ? '<b class="wcKill">可斩杀</b>' : '⚔' + (c.total | 0)) + '</span>';
      if (view.canSwitch) b.onclick = () => view.onPick(i);
      box.appendChild(b);
    });
    const tip = document.createElement('div');
    tip.className = 'wcTip';
    tip.textContent = view.canSwitch ? '选一个词出招 · 词越长打得越疼' : '已出招，拼完这个词';
    box.appendChild(tip);
    return box;
  }
  return { paint };
}
