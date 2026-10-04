/* 遗物规则层：稀有度定价、加权抽取、组合技。
 *
 * 分层理由（AGENTS.md）：
 *   - 数值常量在 src/data/balance.js，这里只做规则；
 *   - 这里**不读 window / localStorage / 全局远征状态**，一律显式传参，
 *     所以整条「定价 → 抽取 → 组合技」链路都能在 Node 里逐条断言。
 *
 * 三条必须守住的不变量：
 *  1) **档位永远能解析**。relicRarity() 对缺失 / 未知的 rarity 回落到 common，
 *     绝不返回 undefined —— 定价会变成 NaN、权重会变成 NaN、抽取会整池抽空。
 *     这是旧数据、外部输入、以及"以后删掉某档"的兜底。
 *  2) **组合技只看 id**。存档里只有一串遗物 id，组合技由它们当场推导，
 *     所以旧存档里早就凑齐的两件遗物，刷新后立刻享有组合效果。
 *  3) **组合技是"有没有"，不是"有几层"**。重复持有同一件遗物不会叠加。
 */
import { RELIC_RARITY, RELIC_RARITY_ORDER, RELIC_SYNERGY, BASE_PURSE_GOLD } from '../data/balance.js';
import { RELICS } from '../data/relics.js';

/* ================= 稀有度 ================= */

/** 归一化档位：认不出一律按普通算（宁可便宜少见，也不出现 NaN 定价）。 */
export function relicRarity(relic) {
  const r = relic && relic.rarity;
  return RELIC_RARITY_ORDER.indexOf(r) >= 0 ? r : 'common';
}
/** 商店标价。定价唯一来源是 balance 的档位表，遗物对象上不得自带 price。 */
export function relicPrice(relic) {
  return RELIC_RARITY[relicRarity(relic)].price;
}
/** 出现权重（每件遗物各自一份，不是每档一份）。 */
export function relicWeight(relic) {
  return RELIC_RARITY[relicRarity(relic)].weight;
}
export function relicRarityLabel(relic) {
  return RELIC_RARITY[relicRarity(relic)].label;
}

/** 权重和；池子非法时返回 0，让调用方走"退回均匀"的兜底而不是 NaN。 */
function weightSum(pool) {
  let total = 0;
  for (const r of pool) total += relicWeight(r);
  return total;
}

/**
 * 按稀有度加权抽一件。rnd 必须可注入（测试里不允许出现真 Math.random）。
 * 返回遗物对象本身；池子为空返回 null。
 */
export function pickRelicWeighted(pool, rnd = Math.random) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const total = weightSum(pool);
  if (!(total > 0)) return pool[0];                 // 防御：全 0 权重时退回第一个
  let t = rnd() * total;
  for (const r of pool) {
    t -= relicWeight(r);
    if (t < 0) return r;
  }
  return pool[pool.length - 1];                     // 浮点残差兜底，不越界
}

/**
 * 不重复的加权抽样（战斗奖励一次给 3 件遗物候选）。
 * 抽掉一件就从池子里拿掉再抽，所以后抽的不会比先抽的更容易中。
 */
export function sampleRelicsWeighted(pool, count, rnd = Math.random) {
  if (!Array.isArray(pool) || !pool.length || !(count > 0)) return [];
  const rest = pool.slice();
  const out = [];
  const n = Math.min(count, rest.length);
  for (let i = 0; i < n; i++) {
    const r = pickRelicWeighted(rest, rnd);
    if (!r) break;
    out.push(r);
    const k = rest.indexOf(r);
    if (k >= 0) rest.splice(k, 1);
  }
  return out;
}

/* ================= 组合技 ================= */

/*
 * 只挑 3-5 组有主题的搭配，不做两两笛卡尔积：12 件遗物有 66 种两两组合，
 * 其中能讲出一句完整战术的话的不到五种，其余都只是把数字换个地方写。
 * 一件遗物只允许出现在一组里 —— 玩家应该能一眼说出自己走的是哪条路。
 */
export const SYNERGIES = [
  {
    id: 'thornwall', ic: '🌵', n: '荆棘壁垒', need: ['shield', 'thorn'],
    d: '荆棘反弹提高到 8 点，实际反弹伤害中最多 4 点转成护盾；敌人剩 1 血时不回盾',
  },
  {
    id: 'resonance', ic: '⚡', n: '连击共鸣', need: ['combo', 'focus'],
    d: '答错保留的那一半连击，每点换 3% 本场增伤 —— 失误不再白挨',
  },
  {
    id: 'endurance', ic: '🔋', n: '铁血循环', need: ['battery', 'forge'],
    d: '每推进一层额外回复 6 点生命；每场战斗胜利额外回复 4 点生命',
  },
  {
    id: 'alchemist', ic: '💎', n: '点金术', need: ['purse', 'scholar'],
    d: '战斗胜利额外金币 25 → 45，且必定掉落「先知卡」',
  },
];

/* 组合技的字段名必须与 balance.js 的 RELIC_SYNERGY 键一一对应 ——
   synergyBonuses() 逐字段产出、relic-combat-synergy.test.js 逐字段断言。 */
export function activeSynergies(relicIds) {
  const held = Array.isArray(relicIds) ? relicIds : [];
  return SYNERGIES.filter(s => s.need.every(id => held.indexOf(id) >= 0));
}
export function hasSynergy(relicIds, id) {
  return activeSynergies(relicIds).some(s => s.id === id);
}

/** 「🌵 荆棘壁垒 · 护盾符文 + 荆棘护符」—— 面板与提示条直接用这句。 */
export function synergyLabel(syn) {
  const names = syn.need.map(id => {
    const r = RELICS.filter(x => x.id === id)[0];
    return r ? r.n : id;
  });
  return `${syn.ic} ${syn.n} · ${names.join(' + ')}`;
}

/**
 * 所有组合技派生值的唯一出口。没有组合技时每个字段都是 0（而不是 undefined），
 * 调用点因此可以无条件相加，不用到处判空。
 */
export function synergyBonuses(relicIds) {
  const on = hasSynergy(relicIds, 'thornwall');
  const res = hasSynergy(relicIds, 'resonance');
  return {
    thornReflect: on ? RELIC_SYNERGY.thornReflect : 0,
    thornShield: on ? RELIC_SYNERGY.thornShield : 0,
    resonancePerCombo: res ? RELIC_SYNERGY.resonancePerCombo : 0,
    enduranceFloorHeal: hasSynergy(relicIds, 'endurance') ? RELIC_SYNERGY.enduranceFloorHeal : 0,
    enduranceWinHeal: hasSynergy(relicIds, 'endurance') ? RELIC_SYNERGY.enduranceWinHeal : 0,
    alchemistGold: hasSynergy(relicIds, 'alchemist') ? RELIC_SYNERGY.alchemistGold : 0,
  };
}

/* ---- 三个被多处调用的派生奖励（单独导出，避免调用点重算） ---- */

/** 战斗胜利的额外金币：聚宝盆 25，凑成点金术后 45。 */
export function victoryGoldBonus(relicIds) {
  if (hasSynergy(relicIds, 'alchemist')) return RELIC_SYNERGY.alchemistGold;
  return hasRelic(relicIds, 'purse') ? BASE_PURSE_GOLD : 0;
}
/** 每推进一层的额外回血（永动电池原有的 +8 走它自己的路径，不在这里重复）。 */
export function floorHealBonus(relicIds) {
  return hasSynergy(relicIds, 'endurance') ? RELIC_SYNERGY.enduranceFloorHeal : 0;
}
/** 每场战斗胜利的额外回血。 */
export function winHealBonus(relicIds) {
  return hasSynergy(relicIds, 'endurance') ? RELIC_SYNERGY.enduranceWinHeal : 0;
}

/** 本模块自己的一行判据：数组里有没有这件遗物。旧存档可能给到 undefined。 */
function hasRelic(relicIds, id) {
  return Array.isArray(relicIds) && relicIds.indexOf(id) >= 0;
}
