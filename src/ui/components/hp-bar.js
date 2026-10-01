import { hpBarGeom } from '../../domain/hp.js';

/* 唯一写血条的地方：战斗页与地图页都走它，杜绝两处公式漂移。
 * 护盾层的百分比分母是「生命上限 + 当前护盾」，所以满格 = 真能挨满。
 * 只读 DOM、只画，不改 hp/shield/maxhp 任何数值。
 * 「hp/shield/maxhp」单位是「点」，换算只在这里发生一次。
 */
export function paintHpBar(fillId, shId, txtId, hp, shield, maxhp) {
  const $ = id => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const g = hpBarGeom(hp, shield, maxhp);
  const f = $(fillId); if (f) f.style.width = g.pct + '%';
  const s = $(shId);
  // 护盾层贴在生命层右边界：left = 生命层宽度，width = 总宽 − 生命层宽度
  if (s) { s.style.left = g.hpPct + '%'; s.style.width = g.shPct + '%'; s.style.display = g.sh > 0 ? '' : 'none'; }
  const t = $(txtId); if (t) t.textContent = Math.max(0, hp | 0) + '/' + maxhp + (g.sh ? ' +' + g.sh + '盾' : '');
  return g;
}