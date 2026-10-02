// 「战意·连击里程碑」的阶梯表（数据层唯一来源，docs/feature-combo-milestones.md）。
//
// 这里只放**数值常量**：不含 DOM、不含状态、不含存档。规则在
// domain/combo-milestones.js，展示在 ui/components/combo-milestones.js。
//
// ★ 连击口径（决定门槛怎么选的关键事实）：
//   B.combo 是「**本词内**连续答对的字母数」—— combat.js 在整词拼完时把它清零，
//   答错也清零。所以连击的上限是**单词的字母数**，不是累计值。
//   259 个教材词按字母数统计：≥6 字母 175 词、≥8 字母 90 词、≥10 字母 37 词、
//   ≥12 字母 12 词、≥13 字母只有 2 词。门槛定在这三档，就是「多数词够得着、
//   最高一档稀有但真的够得着」的区间；再往上（例如 14）就只有一个词能到，
//   等于一个永远不发的奖励。
//   道具「闪电」一次 +3 连击，所以 7 字母的词配合道具也能摸到 10 这一档。
//
// ★ 为什么不是「每 5 连击 +5% 伤害」那种连续成长：连击每 5 就加一次伤害已经存在
//   （combat.js 的 dmgBonus），再叠一条伤害线只会让玩家分不清奖励从哪来。
//   这里三阶给的是**三种互不重叠的资源**：护盾（挨打前）、生命（挨打后）、
//   提示（答错后），所以每一阶的用途都不同，也不会去动难度曲线里的
//   WORD_DMG_CAP / hpMax 任何公式。
//
// ★ 每一阶**一轮远征只发一次**（接线见 app/combat.js）：护盾跨战斗结转，
//   每场都发就是滚雪球。三阶合计 +8 护盾 / +8 生命 / +1 提示，一轮之内。
export const MILESTONE_VERSION = 1;

/* 效果类型：与 domain/combo-milestones.js 的 MILESTONE_EFFECT 一一对应。
   未登记的类型一律到账 0（fail closed），绝不会凭空加伤害或改生命上限。 */
export const MILESTONE_EFFECT = {
  SHIELD: 'shield',
  HEAL: 'heal',
  HINT: 'hint',
};

export const COMBO_MILESTONES = [
  {
    id: 'steady', combo: 6, effect: MILESTONE_EFFECT.SHIELD, amount: 8,
    ic: '🛡️', n: '稳住',
    blurb: '6 连击：护盾 +8',
  },
  {
    id: 'flow', combo: 10, effect: MILESTONE_EFFECT.HEAL, amount: 8,
    ic: '💚', n: '回气',
    blurb: '10 连击：回复 8 点生命',
  },
  {
    id: 'insight', combo: 12, effect: MILESTONE_EFFECT.HINT, amount: 1,
    ic: '🔮', n: '开悟',
    blurb: '12 连击：提示 +1 次',
  },
];