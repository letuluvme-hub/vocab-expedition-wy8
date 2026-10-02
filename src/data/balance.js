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
