/* 远征者形象（纯 CSS，无图片/无 emoji）。
 * 标题页卡片与战斗页 #fPcI 共用同一份部件顺序 —— 改这里必须同时核对 index.html。
 * 纯字符串函数，不依赖 DOM、不改状态。
 */
import { HEROES } from '../../data/heroes.js';
import { HERO_BALANCE } from '../../data/hero-balance.js';

export function pcHTML(id) {
  return '<div class="pc" data-h="' + id + '"><div class="pci">' +
    '<i class="pc-shadow"></i><i class="pc-cape"></i><i class="pc-torso"></i>' +
    '<i class="pc-hairb"></i><i class="pc-sash"></i><i class="pc-arm"></i>' +
    '<i class="pc-hand"></i><i class="pc-prop"></i><i class="pc-head"></i>' +
    '<i class="pc-blush"></i><i class="pc-eye pc-eyeL"></i><i class="pc-eye pc-eyeR"></i>' +
    '<i class="pc-lid"></i><i class="pc-mouth"></i><i class="pc-hair"></i>' +
    '<i class="pc-hairt"></i><i class="pc-gear"></i>' +
  '</div></div>';
}

// 卡片上的数值速览：把 mod 翻成「生命 -10 / 提示 +1」这种一眼能懂的短标签
export function heroStatLines(H) {
  const M = H.mod || {}, out = [];
  if (M.hp)      out.push('生命 ' + (M.hp > 0 ? '+' : '') + M.hp);
  if (M.hint)    out.push('提示 ' + (M.hint > 0 ? '+' : '') + M.hint);
  if (M.noise)   out.push('干扰字母 ' + (M.noise > 0 ? '+' : '') + M.noise);
  if (M.shield)  out.push('护盾 +' + M.shield);
  if (M.gold)    out.push('金币 +' + M.gold);
  if (M.regen)   out.push('开场回血 +' + M.regen);
  if (M.leech)   out.push('合格字母回血 +' + M.leech);
  if (M.combo)   out.push('连击加成 ' + (M.combo * 100 - 100).toFixed(0) + '%');
  if (H.id === 'scholar') out.push('提示揭示 ' + HERO_BALANCE.scholarHintWidth + ' 字母');
  if (H.id === 'warrior') out.push('整词护盾 +' + HERO_BALANCE.warriorWordShield + '，每战最多 ' + HERO_BALANCE.warriorBattleShieldCap);
  if (H.id === 'scout') out.push('首词大招 +' + Math.round((HERO_BALANCE.scoutFirstFinisherMultiplier - 1) * 100) + '%');
  if (H.id === 'lucky') out.push('金币收益 +' + Math.round(HERO_BALANCE.luckyGoldBonus * 100) + '%');
  if (H.id === 'healer') out.push('新远征半血起步', '胜利上限 +' + HERO_BALANCE.healerWinMaxHp + '，每图最多 +' + HERO_BALANCE.healerGrowthCap, '溢出转盾最多 ' + HERO_BALANCE.healerOverflowShieldCap);
  if (H.id === 'ranger') out.push('回血每战最多 ' + HERO_BALANCE.rangerBattleHealCap);
  if (H.id === 'warrior') out.push('有盾整词大招 +20%');
  if (H.id === 'lucky') out.push('金币蓄力大招最多 +20%');
  if (H.id === 'berserker') out.push('整词大招 +25% / 半血 +45%');
  if (H.id === 'pyromancer') out.push(HERO_BALANCE.pyromancerLetters + ' 字母起大招 +' + Math.round(HERO_BALANCE.pyromancerBonus * 100) + '%');
  if (H.id === 'assassin') out.push('准确大招 +35% / 收割 +60%');
  return out;
}

/* 兼容老存档 / 未来新增角色：认不出的 id 一律回退第一位，绝不让 undefined 渗进数值计算。 */
export const HERO_DEFAULT = HEROES[0].id;
export const heroById = id => HEROES.filter(h => h.id === id)[0] || HEROES[0];
