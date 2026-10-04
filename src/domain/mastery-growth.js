/* 知识成长：真实教材掌握词 → 新一轮远征的生命与攻击成长。**纯规则**。
 *
 * 契约（docs/feature-mastery-growth.md，逐条核对）：
 *  1) **只认真实教材词**。canonicalMasteryKeys(mastered, canonicalWords) 取交集：
 *     DB.dictationMastered 里的自定义词表词（单元 0）再多也不参与成长。理由：自定义词是
 *     玩家自己造的，500 个自定义词也算「学得多」就是自欺欺人 —— 成长必须锚定在
 *     真实教材的 259 词上。
 *  2) **身份只做 trim + lowerCase**，空格 / 连字符 / 撇号是拼写的一部分，绝不剥掉
 *     （与 domain/campaign.js 的 wordKey 同一口径）。剥掉分隔符会把
 *     ice cream 与 icecream 折叠成一个词，等于凭空多记一次掌握。
 *  3) **同一身份只算一次**：大小写重复、重复条目、前后空格全部合并。顺序按词库
 *     原序（与 campaign.unitTargets 一致），不排序不重排。
 *  4) **20 个真实教材词 = +1 生命上限，封顶 +12** → 第 240 词封顶，
 *     259 词全部掌握仍然是 +12。常数是固定的 export const 而不是可调参数：
 *     一旦允许调用方覆盖，规则就能被改出「同一存档两套成长」的历史存档问题。
 *  5) **非法入参不产生 NaN**：null / 非数组 / 对象 / 数字 / 空串一律退化成 0，
 *     绝不让 NaN 渗进文案（「NaN 个词」是玩家会截图发群里的那种话）。
 *  6) **只读**：不修改 mastered，不碰 canonicalWords（词库）、DB、run 与存储。
 *     旧存档的学习记录一个字节都不改。
 *
 * 范围：只回答「新开一轮时生命和攻击加成是多少」。正在远征中、或从存档恢复时，
 * 不补回生命、不提高本轮生命上限、跨单元不再额外增加 —— 那些是接线层的责任，
 * 攻击每 10 词 +4%，最高 +60%；伤害结算由 damage.js 读取冻结事实。
 */

/* 固定规则常数。要改数值就改这里，并同步 docs 与单测的边界断言。 */
import { learningKey } from './learning-identity.js';
import { allCatalogWords } from '../data/books.js';
export const GROWTH_VERSION = 3;
export const ATTACK_GROWTH_INTERVAL = 10;
export const ATTACK_GROWTH_STEP = 4;
export const ATTACK_GROWTH_MAX = 60;
export const attackGrowthFor = count => Math.min(ATTACK_GROWTH_MAX, Math.floor(Math.max(0, count) / ATTACK_GROWTH_INTERVAL) * ATTACK_GROWTH_STEP);

// Versions 1/2 retain the original 259-word boundary. Version 3 freezes the
// catalog total as well as the earned count, with the same HP/attack caps.
export function validGrowthFact(g) {
  if (!g || typeof g !== "object" || Array.isArray(g) || ![1,2,3].includes(g.version)) return false;
  const total = g.version === 3 ? g.catalogTotalAtStart : 259;
  if (!Number.isSafeInteger(total) || total < 0 || total > allCatalogWords().length) return false;
  if (!Number.isInteger(g.masteredAtStart) || g.masteredAtStart < 0 || g.masteredAtStart > total) return false;
  if (g.bonusHp !== Math.min(12, Math.floor(g.masteredAtStart / 20))) return false;
  return g.version === 1 || g.bonusAttackPct === attackGrowthFor(g.masteredAtStart);
}
export const growthAttackPct = run => validGrowthFact(run?.growth) && run.growth.version >= 2 ? run.growth.bonusAttackPct : 0;
export const GROWTH_INTERVAL = 20;        // 20 个真实教材词 = +1
export const GROWTH_MAX_BONUS = 12;       // 封顶 +12（259 词用不完这个额度）
export const GROWTH_TOTALS_FLOOR = GROWTH_INTERVAL * GROWTH_MAX_BONUS; // 240 = 封顶点

/* 词条身份。
 *   - 非字符串一律当空：把 Object / Number 变成 key 是往存档口径里喂垃圾，
 *     而且 String({}) === '[object object]' 会让所有坏条目塌成「同一个词」。
 *   - 内部空白原样保留，身份与词队列、单元解锁一致；只去首尾空白并转小写。
 *   - 'ice cream' 与 'icecream'、'ice   cream' 均是不同身份。
 */
export function growthKey(w) {
  if (typeof w !== 'string') return '';
  return w.trim().toLowerCase();
}

/* 一条词记录 → 身份。词库条目是 {w,...}，DB.mastered 里两种形状都在流通。 */
function keyOf(w) {
  return learningKey(w);
}

/* 词库身份表：去重 + 保持原序。非法条目静默跳过。 */
function canonicalSet(canonicalWords) {
  const set = new Set();
  if (!Array.isArray(canonicalWords)) return set;
  for (const w of canonicalWords) {
    const k = keyOf(w);
    if (k) set.add(k);
  }
  return set;
}

/* 掌握词与词库的交集：只返回真实教材身份，自定义独有词被丢弃。
 * 大小写 / 重复 / 空格重复只留一条，顺序按词库原序。 */
export function canonicalMasteryKeys(mastered, canonicalWords) {
  const canon = canonicalSet(canonicalWords);
  if (!canon.size) return [];
  const owned = new Set();
  if (Array.isArray(mastered)) {
    for (const w of mastered) {
      const k = keyOf(w);
      if (k) owned.add(k);
    }
  }
  const out = [];
  for (const k of canon) if (owned.has(k)) out.push(k);
  return out;
}

/* 台阶名：同一台阶内文案一致，跨台阶必变。纯展示用的分段标签。 */
const TIERS = [[0, '未启程'], [1, '初识'], [4, '进阶'], [8, '精熟'], [12, '满阶']];
export function tierOf(bonusHp) {
  let name = TIERS[0][1];
  for (const [at, label] of TIERS) if (bonusHp >= at) name = label;
  return name;
}

/* 成长摘要。UI 与 runtime 共用的规则入口，攻击与生命门槛分别返回。
 * nextThreshold / toNext 只回答「离下一个台阶还差几词」；封顶后为 null / 0。 */
export function growthSummary(mastered, canonicalWords) {
  const canon = canonicalSet(canonicalWords);
  const totalCount = canon.size;
  const keys = canonicalMasteryKeys(mastered, canonicalWords);
  const masteredCount = keys.length;

  const bonusHp = Math.min(GROWTH_MAX_BONUS, Math.floor(masteredCount / GROWTH_INTERVAL));
  const capped = bonusHp >= GROWTH_MAX_BONUS;
  const nextThreshold = capped ? null : (bonusHp + 1) * GROWTH_INTERVAL;
  const toNext = capped ? 0 : Math.max(0, nextThreshold - masteredCount);
  const progress = totalCount > 0
    ? Math.min(1, Math.round((masteredCount / totalCount) * 1e4) / 1e4)
    : 0;

  const bonusAttackPct = attackGrowthFor(masteredCount);
  const attackCapped = bonusAttackPct >= ATTACK_GROWTH_MAX;
  const attackNextThreshold = attackCapped ? null : (Math.floor(masteredCount / ATTACK_GROWTH_INTERVAL) + 1) * ATTACK_GROWTH_INTERVAL;
  return {
    bonusAttackPct, maxBonusAttackPct: ATTACK_GROWTH_MAX, attackInterval: ATTACK_GROWTH_INTERVAL, attackStep: ATTACK_GROWTH_STEP, attackCapped, attackNextThreshold, attackToNext: attackCapped ? 0 : attackNextThreshold - masteredCount,
    version: GROWTH_VERSION,
    catalogTotalAtStart: totalCount,
    masteredCount, totalCount,
    tier: tierOf(bonusHp),
    bonusHp, maxBonusHp: GROWTH_MAX_BONUS, interval: GROWTH_INTERVAL,
    capped, nextThreshold, toNext, progress,
  };
}
