// 地图生成：纯规则，无 DOM / 无全局 G。
// 逐字搬自 runtime.js 的 buildMap()，只把 rnd/pick 换成注入的 random，
// 随机调用次数与顺序必须完全一致，否则地图形状会与旧版漂移。
const MAP_ROWS = 9;
export const MAP_EARLY_MAX = 2;   // 前期（r<=2）不出商店

export function generateMap(random = Math.random) {
  const rnd = n => Math.floor(random() * n);
  const pick = a => a[rnd(a.length)];
  const rows = [];
  for (let r = 0; r < MAP_ROWS; r++) {
    const isBoss = r === MAP_ROWS - 1;
    const isPreBoss = r === MAP_ROWS - 2;
    let cnt;
    if (isBoss) cnt = 1;
    else if (r === 0) cnt = 3;
    else cnt = 2 + rnd(2);
    // 首领战前一行先整排定型：必有「营火 + 商店」，其余位置随机
    let plan = null;
    if (isPreBoss) {
      const extra = pick(['battle', 'battle', 'event', 'elite']);
      if (cnt >= 3) {
        plan = rnd(2) ? ['rest', 'shop', extra] : [extra, 'shop', 'rest'];
      } else {
        plan = rnd(2) ? ['rest', 'shop'] : ['shop', 'rest'];
      }
    }
    const row = [];
    for (let c = 0; c < cnt; c++) {
      let type;
      if (isBoss) type = 'boss';
      // 第 0 行：开局先打一场或遇一个事件，不给营火（满血时休息没有意义）。
      // ★ 仍然调用 pick()：随机调用次数与顺序不变，地图几何与旧版逐点一致。
      else if (r === 0) type = rnd(2) ? 'battle' : pick(['event', 'event']);
      else if (isPreBoss) type = plan[c];
      else if (r <= MAP_EARLY_MAX) {
        const roll = random();
        // 前期：战斗 60% / 事件 18% / 营火 12% / 精英 10%（旧版营火 24%）
        type = roll < 0.60 ? 'battle' : roll < 0.78 ? 'event' : roll < 0.90 ? 'rest' : 'elite';
      } else {
        const roll = random();
        // 后期：战斗 52% / 事件 14% / 营火 12% / 商店 10% / 精英 12%
        // （遗物改为主要从精英/首领来，精英略增；旧版营火 14%、商店 12%）
        type = roll < 0.52 ? 'battle' : roll < 0.66 ? 'event' : roll < 0.78 ? 'rest' : roll < 0.88 ? 'shop' : 'elite';
      }
      row.push({ type, x: (c + 0.5) / cnt, row: r, done: false, links: [] });
    }
    rows.push(row);
  }
  // 连线：dx<=0.34 直连；dx<=0.60 用确定性哈希按概率连（不随重绘变化）
  const DX_DIRECT = 0.34, DX_NEAR = 0.60, P_NEAR = 0.45;
  const hash2 = (a, b) => {
    let h = (a * 73856093) ^ (b * 19349663);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const key = n => n.row * 131 + Math.round(n.x * 1000);
  for (let r = 0; r < MAP_ROWS - 1; r++) {
    const cur = rows[r], nxt = rows[r + 1];
    cur.forEach(n => {
      nxt.forEach(m => {
        const dx = Math.abs(n.x - m.x);
        if (dx <= DX_DIRECT) n.links.push(m);
        else if (dx <= DX_NEAR && hash2(key(n), key(m)) < P_NEAR) n.links.push(m);
      });
      if (!n.links.length) {                 // 兜底出边
        let best = nxt[0];
        nxt.forEach(m => { if (Math.abs(m.x - n.x) < Math.abs(best.x - n.x)) best = m; });
        n.links.push(best);
      }
    });
    nxt.forEach(m => {                        // 兜底入边：杜绝不可达死路
      if (cur.some(n => n.links.indexOf(m) >= 0)) return;
      let best = cur[0];
      cur.forEach(n => { if (Math.abs(n.x - m.x) < Math.abs(best.x - m.x)) best = n; });
      best.links.push(m);
    });
  }
  return rows;
}
