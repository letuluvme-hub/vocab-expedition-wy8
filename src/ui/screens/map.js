/* 地图页：节点连线 + 节点圆点 + HUD（层数/金币/血条/遗物）。
 * 地图几何全部按容器实际像素计算，保证任意层数/宽度下节点都不重叠。
 * 状态只从 getRun() 取；进入节点、提示、呼吸音都走回调，父层负责。
 */
import { NODES } from '../../data/nodes.js';
import { RELICS } from '../../data/relics.js';
import { clamp } from '../../domain/math.js';
import { paintHpBar } from '../components/hp-bar.js';
import { pixelIconSVG, relicIconKey } from '../components/pixel-art.js';

const MAP_V_GAP = 12;        // 相邻层之间的垂直净间隙（要求 ≥8）
const MAP_D_BASE = 56, MAP_D_BOSS = 70, MAP_D_MIN = 34;

const relicById = id => RELICS.filter(r => r.id === id)[0];

export function createMapScreen({ getRun, onEnter, onToast, onNodeSound }) {
  const $ = id => document.getElementById(id);

  function mapMetrics() {
    const G = getRun();
    const box = $('map');
    const W = box.clientWidth || 640;               // 容器实际像素宽
    const ROWS = G.rows.length;
    const isBoss = r => G.rows[r] && G.rows[r][0] && G.rows[r][0].type === 'boss';
    // 横向：同层最多 3 个节点，x=0.1667/0.5/0.8333，相邻中心距 = W/3
    // 直径上限 = W/3 - 4，保证窄屏（320px 及以下）横向也不重叠
    const d = clamp(Math.floor(W / 3 - 4), MAP_D_MIN, MAP_D_BASE);
    const dia = r => isBoss(r) ? MAP_D_BOSS : d;
    // 垂直：每段间距 = 上下两节点半径之和 + 净间隙（BOSS 更大，间距自动加大）
    const steps = [];
    for (let r = 0; r < ROWS - 1; r++) steps.push((dia(r) + dia(r + 1)) / 2 + MAP_V_GAP);
    const padTop = dia(0) / 2 + 16, padBot = dia(ROWS - 1) / 2 + 20;
    let H = padTop + padBot + steps.reduce((a, b) => a + b, 0);
    // 旧版固定高度 452px：不足时把余量摊进层间距（取两者较大值）
    if (H < 452) { const k = (452 - padTop - padBot) / steps.reduce((a, b) => a + b, 0);
      for (let i = 0; i < steps.length; i++) steps[i] *= k; H = 452; }
    const yOf = []; let y = padTop;
    for (let r = 0; r < ROWS; r++) { yOf.push(y); if (r < ROWS - 1) y += steps[r]; }
    H = Math.ceil(y + padBot);
    return { W, ROWS, H, d, yOf, padBot };
  }

  function renderMap() {
    const G = getRun();
    const box = $('map'); box.innerHTML = '';
    const M = mapMetrics(), W = M.W, H = M.H, yOf = M.yOf;
    box.style.height = H + 'px';
    box.style.setProperty('--nd', M.d + 'px');
    box.style.setProperty('--ndb', MAP_D_BOSS + 'px');
    // SVG 用与容器一致的像素 viewBox（1:1 映射，stroke-width 不再被横向拉伸变形）
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    G.rows.forEach((row, r) => {
      if (r === 0) return;
      G.rows[r - 1].forEach(n => {
        n.links.forEach(m => {
          const x1 = n.x * W, y1 = yOf[r - 1], x2 = m.x * W, y2 = yOf[r];
          const act = G.avail.indexOf(n) >= 0 || (G.node === n);
          svg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" vector-effect="non-scaling-stroke" stroke="' +
            (act ? '#22d3ee' : '#c7d2fe') + '" stroke-width="' + (act ? 2.2 : 1.5) +
            '" stroke-linecap="round" stroke-dasharray="' + (act ? '' : '4 5') + '" opacity="' + (act ? .65 : .42) + '"/>';
          // ★ 未来路线必须看得见：规划路线是地图存在的意义。旧版 #ffffff22 × 0.34 的虚线
          //   在深色背景上几乎消失，玩家只能一层一层盲选。
        });
      });
    });
    svg += '</svg>';
    box.insertAdjacentHTML('beforeend', svg);
    // 节点
    G.rows.forEach((row, r) => {
      row.forEach(n => {
        const el = document.createElement('div');
        const isAvail = G.avail.indexOf(n) >= 0;
        el.className = 'node ' + (n.done ? 'done ' : '') + (n.type === 'boss' ? 'boss ' : '') +
          (isAvail ? 'pick' : (G.node ? 'lock' : ''));
        el.style.left = (n.x * 100) + '%';
        el.style.top = yOf[r] + 'px';
        el.textContent = NODES[n.type].ic;
        el.title = NODES[n.type].t;
        if (isAvail) el.onclick = () => onEnter(n);
        box.appendChild(el);
      });
    });
    $('mFloor').textContent = G.floor;
    $('mGold').textContent = G.gold;
    paintHpBar('mHp', 'mHpS', 'mHpT', G.hp, G.shield, G.maxhp);
    const rb = $('mRelics'); rb.innerHTML = '';
    G.relics.forEach(id => {
      const r = relicById(id); if (!r) return;
      const d = document.createElement('div');
      d.className = 'relic';
      // 像素图标优先，认不出就退回 emoji（两者都来自固定表，不含存档字符串）。
      const icon = pixelIconSVG(relicIconKey(id));
      if (icon) d.innerHTML = icon; else d.textContent = r.ic;
      d.title = r.n + '：' + r.d;
      d.onclick = () => onToast(r.n + '：' + r.d);
      rb.appendChild(d);
    });
    $('mTip').textContent = G.avail.length ? '有 ' + G.avail.length + ' 个可选' : '';
    // 呼吸提示音：只在「可选节点集合真的变了」时响一次（避免 resize 重绘反复触发）
    const sig = G.avail.map(n => n.x + ',' + n.y).join('|');
    if (sig && sig !== G.availSig) { G.availSig = sig; onNodeSound(); }
  }

  return { mapMetrics, renderMap };
}