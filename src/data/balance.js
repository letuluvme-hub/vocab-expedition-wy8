// 玩家可主动付出的固定代价（数据层唯一来源）。
// 这里只放**数值常量**：不含 DOM、不含状态、不含存档。
//
// SKIP_HP_COST = 跳过一场战斗的固定生命代价。固定点数而不是百分比：
// 百分比在低血时会退化成「扣一点点还能苟住」，玩家可以无限白嫖撤退，
// 于是「跳过」比认真打完更划算。固定 50 让低血撤退成为一次真实决策：
// 付得起就撤，付不起就战败。
export const SKIP_HP_COST = 50;

// 怪物的蓄力自主攻击（docs/product-backlog.md 清单 13）。三档，键名与
// domain/foe-attack.js 的 foeAttackKind() 一一对应：
//   idleMs      —— 蓄力前站桩多久（玩家有喘息、能读词的窗口）
//   telegraphMs —— 蓄力窗口：这段时间内一次有效字母尝试可打断
//   recoverMs   —— 收招/被打断后的窗口（反打机会）
//   damage      —— 蓄满打出的固定伤害（先护盾后生命）
// ★ 本项固定值，不随轮次递增 —— 递增是清单 10 的任务，两件事不许混在一次改动里。
// ★ 上限意识：最坏组合 boss 是 4s idle + 3.5s 蓄力，节奏已经比旧版紧一档，
//   但仍然留着完整的 idle 窗口；不再往上加速，否则中译英回忆会被压成盲打。
//   打断窗口是 telegraphMs 的全部时长（不设独立时间窗），
//   所以「一直按同一个错字母」并不能永远安全：已用/已试的字母打断不了。
export const FOE_ATTACK = {
  normal: { idleMs: 6000, telegraphMs: 5000, recoverMs: 2500, damage: 4 },
  elite:  { idleMs: 5000, telegraphMs: 4000, recoverMs: 2500, damage: 6 },
  boss:   { idleMs: 4000, telegraphMs: 3500, recoverMs: 2500, damage: 8 },
};

// 敌人形象的放大上限：怪物变大（清单 13）只允许把 #fAv 放大到 ≤ 1.2 倍。
// 手机竖屏上字母盘必须留在可视区内，所以这个上限由数据层钉死，
// CSS 与 UI 组件都只读它 —— 没人能顺手写一个更大的值进去。
export const FOE_ART_SCALE_MAX = 1.2;

// ============ 遗物稀有度分级（文档见 docs/feature-relic-depth.md）============
//
// 以前 12 件遗物在商店里一律 80 金币，事件与战斗奖励又是均匀洗牌 ——
// 「好坏一个价」让遗物只剩下"捡到就穿"的捡拾感。这里把三件事钉死：
//   price  —— 商店标价。定价只在这里，遗物对象本身不重复一份（relics.js 里
//             没有 price 字段就是防这个），面板与文案一律经 relicPrice() 读。
//   weight —— 出现在事件 / 营火 / 战斗奖励候选池里的相对权重。
//             注意这是**每件遗物**的权重，不是每档的：同一档里每件等权，
//             实际出现率 = 该档权重 / 池内全部候选权重之和。
//             当前数据：普通 7 件 ×62、稀有 5 件 ×30、传说 1 件 ×8，
//             全池权重和 634，传说约 1.3% 的单次抽取、稀有合计约 23.7%。
//   order  —— 展示与排序用的固定档序，别用对象的键序。
export const RELIC_RARITY = {
  common:    { label: '普通', price: 60,  weight: 62 },
  rare:      { label: '稀有', price: 110, weight: 30 },
  legendary: { label: '传说', price: 175, weight: 8 },
};
export const RELIC_RARITY_ORDER = ['common', 'rare', 'legendary'];

// 加稀有度之前商店的固定标价。**只**用于旧存档恢复：老快照里的商店卡
// 写的是「· 80 金币」，点下去就必须还是 80，刷新一次凭空涨价是不能接受的。
export const LEGACY_RELIC_SHOP_PRICE = 80;

// ============ 组合技数值 ============
// 组合技刻意只挑 3-5 组有主题的搭配（见 src/domain/relic-rules.js），
// 而不是 12 件遗物的两两笛卡尔积 —— 66 种组合里能讲出故事的不到五种，
// 剩下的只是把数字换个地方写一遍。
export const RELIC_SYNERGY = {
  // 荆棘壁垒（护盾符文 + 荆棘护符）：反弹伤害抬到 8，并把其中 4 点转成护盾。
  // 效果不是"多打 3 点"：挨打本身变成了回盾的循环，打得越狠盾越厚。
  thornReflect: 8,
  thornShield: 4,
  // 连击共鸣（连击徽章 + 专注头环）：答错保留的那一半连击，每点换 3% 本场增伤。
  // 没有这一步，组合技就只是把专注头环的效果念了两遍。
  resonancePerCombo: 3,
  // 铁血循环（永动电池 + 锻造台）：推进一层额外回 6、每场胜利额外回 4。
  enduranceFloorHeal: 6,
  enduranceWinHeal: 4,
  // 点金术（聚宝盆 + 学者之书）：胜利额外金币 25 → 45，且必定掉先知卡。
  alchemistGold: 45,
};

// 聚宝盆单件的基础胜利金币（在 data/nodes 或旧逻辑里原本是写死的 25）。
export const BASE_PURSE_GOLD = 25;
