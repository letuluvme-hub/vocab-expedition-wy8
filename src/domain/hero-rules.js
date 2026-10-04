import { norm } from './text.js';
import { encodeWordQ } from './word-quality.js';
import { HERO_BALANCE, ITEM_BALANCE } from '../data/hero-balance.js';

const points = n => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
const hpRoom = (run, battle) => Math.max(0, points(run?.maxhp) - points(battle?.myHp));
const shieldRoom = (run, battle) => Math.max(0, points(run?.maxhp) - points(battle?.shield));

export const heroHintWidth = run => run?.heroId === 'scholar' ? HERO_BALANCE.scholarHintWidth : 1;

// 旧局使用已保存的 hregen，不因新版角色表而重算基础属性。
export function heroOpeningGrant(run, battle) {
  const regen = points(run?.hregen);
  const heal = Math.min(regen, hpRoom(run, battle));
  const shield = run?.heroId === 'healer'
    ? Math.min(regen - heal, HERO_BALANCE.healerOverflowShieldCap, shieldRoom(run, battle)) : 0;
  return { heal, shield };
}

// 这里只计算本次实际到账额，调用方同时写入护盾和本场累计额度。
export function heroWordShield(run, battle) {
  if (run?.heroId !== 'warrior') return 0;
  return Math.min(HERO_BALANCE.warriorWordShield, shieldRoom(run, battle),
    Math.max(0, HERO_BALANCE.warriorBattleShieldCap - points(battle?.heroShieldGained)));
}

export function rangerHealAmount(run, battle, { fresh, revealed } = {}) {
  if (fresh !== true || revealed) return 0;
  const q = battle?.wordQ;
  if (!q || q.wrong !== 0 || q.listen !== 0) return 0;
  // 自动首字母提示是一笔既有事件。它不禁止后面的独立回忆；已揭示的
  // 具体字母由 revealed 排除。主动再问一次提示则整词失去回血资格。
  const autoHint = battle.autoHint > 0 ? 1 : 0;
  if (!Number.isSafeInteger(q.hint) || q.hint < 0 || q.hint > autoHint) return 0;
  return Math.min(points(run?.hleech), hpRoom(run, battle),
    Math.max(0, HERO_BALANCE.rangerBattleHealCap - points(battle?.heroHealed)));
}

export function heroFinisherMultiplier(run, battle) {
  const q = encodeWordQ(battle?.wordQ);
  const perfect = q && q.wrong === 0 && q.hint === 0 && q.listen === 0 && q.revealed === 0;
  switch (run?.heroId) {
    case 'scholar': return 1;
    case 'warrior': return points(battle?.shield) > 0 ? 1 + HERO_BALANCE.warriorShieldBonus : 1;
    case 'scout': return battle?.wordsDone === 0 ? HERO_BALANCE.scoutFirstFinisherMultiplier : 1;
    case 'lucky': return 1 + Math.min(HERO_BALANCE.luckyDamageCap, Math.floor(points(run.gold) / HERO_BALANCE.luckyGoldStep) * HERO_BALANCE.luckyDamageStep);
    case 'berserker': return 1 + (Number.isFinite(battle?.myHp) && battle.myHp > 0 && battle.myHp <= points(run.maxhp) / 2 ? HERO_BALANCE.berserkerLowHpBonus : HERO_BALANCE.berserkerBonus);
    case 'pyromancer': return norm(battle?.word?.w || '').length >= HERO_BALANCE.pyromancerLetters ? 1 + HERO_BALANCE.pyromancerBonus : 1;
    case 'assassin': return perfect ? 1 + (Number.isFinite(battle?.enHp) && battle.enMax > 0 && battle.enHp <= battle.enMax * HERO_BALANCE.assassinExecuteRatio ? HERO_BALANCE.assassinExecuteBonus : HERO_BALANCE.assassinBonus) : 1;
    default: return 1;
  }
}

// 职业与遗物百分比相加后只取整一次，重复遗物不会增加层数。
export function goldGainAmount(run, amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return 0;
  const heroBonus = run?.heroId === 'lucky' ? HERO_BALANCE.luckyGoldBonus : 0;
  const relicBonus = Array.isArray(run?.relics) && run.relics.includes('greed') ? 0.5 : 0;
  return Math.round(amount * (1 + heroBonus + relicBonus));
}

// 先封顶钱币的额外奖励，再交给 goldGainAmount 结算职业和遗物。
// 旧存档可能仍有 goldMult=3，同样受额外 60 金币限制。
export function battleGoldBase(base, battle) {
  const amount = points(base), mult = battle?.goldMult;
  if (typeof mult !== 'number' || !Number.isFinite(mult) || mult <= 1) return amount;
  return amount + Math.min(Math.round(amount * (mult - 1)), ITEM_BALANCE.greedBonusCap);
}

// 缺失代表早于成长技能的旧局，不能补填。v1 是旧的整次远征额度；
// v2 同时记录当前地图和累计成长，刷新只复制额度，不重发成长。
export function validHealerGrowth(fact) {
  const valid = fact !== null && typeof fact === 'object' && !Array.isArray(fact)
    && Number.isSafeInteger(fact.gained) && fact.gained >= 0
    && fact.gained <= HERO_BALANCE.healerGrowthCap
    && fact.gained % HERO_BALANCE.healerWinMaxHp === 0;
  if (!valid) return false;
  if (fact.version === 1) return true;
  return fact.version === 2 && Number.isSafeInteger(fact.segment) && fact.segment > 0
    && Number.isSafeInteger(fact.totalGained) && fact.totalGained >= fact.gained
    && fact.totalGained <= fact.segment * HERO_BALANCE.healerGrowthCap
    && fact.totalGained - fact.gained <= (fact.segment - 1) * HERO_BALANCE.healerGrowthCap
    && fact.totalGained % HERO_BALANCE.healerWinMaxHp === 0;
}
export function healerGrowthFact(run, segment = run?.campaign?.segments || 1) {
  const fact = run?.healerGrowth;
  if (!Number.isSafeInteger(segment) || segment < 1) return null;
  if (run?.heroId !== 'healer' || !validHealerGrowth(fact)) return null;
  if (fact.version === 2) return fact.segment === segment ? {...fact} : null;
  // v1 没有每图明细。保留累计与生命，仅为已经进入的后续地图开放额度。
  return {version:2, segment, gained:segment === 1 ? fact.gained : 0, totalGained:fact.gained};
}
export function advanceHealerMapGrowth(run) {
  const segment = run?.campaign?.segments;
  const fact = healerGrowthFact(run, segment - 1);
  if (fact) run.healerGrowth = {...fact,segment,gained:0};
}
export function healerWinGrowth(run) {
  const fact = healerGrowthFact(run);
  return fact ? Math.min(HERO_BALANCE.healerWinMaxHp, HERO_BALANCE.healerGrowthCap - fact.gained) : 0;
}
