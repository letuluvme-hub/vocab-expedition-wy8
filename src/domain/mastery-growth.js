/* 知识成长：真实教材掌握词 → 新一轮远征的生命上限成长。**纯规则**。
 *
 * 契约（docs/feature-mastery-growth.md，逐条核对）：
 *  1) **只认真实教材词**。canonicalMasteryKeys(mastered, canonicalWords) 取交集：
 *     DB.mastered 里的自定义词表词（单元 0）再多也不参与成长。理由：自定义词是
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
 *     旧存档的 mastered 一个字节都不改。
 *
 * 范围：只回答「新开一轮时生命上限是多少」。正在远征中、或从存档恢复时，
 * 不补回生命、不提高本轮生命上限、跨单元不再额外增加 —— 那些是接线层的责任，
 * 本模块不提供任何函数去改 HP（低风险：只抬生命上限值，不动当前血量）。
 */

/* 固定规则常数。要改数值就改这里，并同步 docs 与单测的边界断言。 */
export const GROWTH_VERSION = 1;
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
  if (w && typeof w === 'object') return growthKey(w.w);
  return growthKey(w);
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

/* 成长摘要。唯一对外的规则入口：UI 只读它，runtime 只取 bonusHp。
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

  return {
    version: GROWTH_VERSION,
    masteredCount, totalCount,
    tier: tierOf(bonusHp),
    bonusHp, maxBonusHp: GROWTH_MAX_BONUS, interval: GROWTH_INTERVAL,
    capped, nextThreshold, toNext, progress,
  };
}
