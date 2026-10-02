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
  // ★ 这里曾经读 g.sh —— 而 hpBarGeom 返回的字段叫 shield，于是 g.sh 恒为 undefined：
  //   护盾层永远 display:none、文字永远没有「+N盾」。抽取阶段照抄了这个行为，
  //   并在 tests/e2e/README.md 登记为「不能悄悄修掉的旧版事实」。
  //   2026-10-02 用户要求显示护盾值，按登记的规程先补失败测试再改这里。
  if (s) { s.style.left = g.hpPct + '%'; s.style.width = g.shPct + '%'; s.style.display = g.shield > 0 ? '' : 'none'; }
  const t = $(txtId);
  // 文字如实报出护盾：玩家要从这里读出「还能挨多少」，只画一段色块不给数字等于没给。
  if (t) t.textContent = Math.max(0, hp | 0) + '/' + maxhp + (g.shield > 0 ? ' +' + g.shield + '盾' : '');
  return g;
}