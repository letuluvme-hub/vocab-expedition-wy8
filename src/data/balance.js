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

// 整词伤害的天花板曲线（opt/1-difficulty-curve）。
//
// 旧设计只有一个常数 560：连击 + 增伤 + 怒火叠满时不至于数值爆炸。但敌人血量按
// `base = 7 + floor(floor*0.7)` 线性增长且**没有**上限，于是 floor 40 之后玩家伤害
// 被钉死在 560、血量继续涨，「打空一个敌人需要的词数」单调恶化（实测 3.4 → 31.7）。
//
// 新设计：上限不是常数，而是**按同一个 base 等比增长**（见 domain/damage.js 的
// wordDmgCap）。敌人涨多少、伤害就允许涨多少，天花板因此不再制造难度断层。
//
// ★ WORD_DMG_CAP 保留为**浅层上限**，不是历史包袱：floor 1-9 里 base ≤ 13，
//   上限恰好保持 560（见 ANCHOR_BASE），所以那一段的手感逐位不变、没有任何构筑
//   被削弱。这次改动对浅层是纯放宽。
export const WORD_DMG_CAP = 560;

// 上限开始增长的锚点：floor 9 的 base（7 + floor(9*0.7) = 13）。
// 它是「560 还算合理」的最深一层——floor 9 满配构筑的整词伤害正好 215，远没顶到 560，
// 而 floor 10 起 base > 13，560 就再也追不上了。
export const WORD_DMG_CAP_ANCHOR_BASE = 13;
