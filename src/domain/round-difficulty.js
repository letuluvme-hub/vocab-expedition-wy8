/* 逐轮难度递增：**纯规则**（docs/feature-round-difficulty.md，清单 10）。
 *
 * 与清单 13（怪物蓄力自主攻击）分开：蓄力参数本身仍是 src/data/balance.js
 * 的固定值 FOE_ATTACK，本模块只回答「这一轮该把它们乘上多少」。
 *
 * 四条不能破的边界：
 *  1) **纯**：不读 window / localStorage / 全局 G·B·DB，不写 DOM，不排定时器。
 *     只接收显式事实，返回可序列化对象。返回值是全新的普通对象（不是共享引用）。
 *  2) **只认真实 roundNumber**。第 1 轮是基线（三个倍率恒为 1）。unit / segments
 *     **只被接收、不参与计算** —— 它们绝不悄悄当成新轮编号，否则「同轮跨单元/续段」
 *     会凭空升一档难度，而玩家在同一轮里并没有变强。
 *  3) **学习窗口有界**。轮次再高也只到有限最高档，且三类思考窗口
 *     （idle / telegraph / recover）各自有硬下限：怪物可以变快，但绝不把
 *     中译英回忆压成盲打 —— 打断蓄力的机会必须始终存在。
 *  4) **脏事实整体 fail closed**。任何一个字段不合法 → **三个倍率全部**回落 1，
 *     绝不部分采用。编解码（encodeDifficulty / decodeDifficulty）与
 *     validateDifficultyFact 共用同一条判定，边界必须与真实轮次事实相容：
 *     存档是外部输入，绝不允许 999999 倍血量或 0.0001 倍间隔混进来。
 *
 * 数值都是「可调的温和候选」：它们是**尚未经真机对战验证**的一组起点，
 * 接线后必须由整合者按实机手感调整；调整时只改这里的 export const。
 */
import { clamp } from './math.js';
/* 三档蓄力参数的**唯一来源**就是 data/balance.js 的 FOE_ATTACK（foe-attack.js
 * 同样直接 import 它）。本模块读它只是为了在 baseProfile 脏掉时回落到 normal ——
 * 绝不重抄一份字面量：两份数值一旦漂移，UI 显示的蓄力时间和真实伤害就会对不上。 */
import { FOE_ATTACK } from '../data/balance.js';

/* 事实版本。落盘形状变更时 +1，旧事实按未知处理（调用方回落到基线）。 */
export const DIFFICULTY_VERSION = 1;

/* 有效档位数：第 1..MAX_DIFFICULTY_ROUND 轮线性递增，之后**永久封顶**。
 * 封顶的意义是「重开第 50 轮不会变成另一款游戏」——学习向产品不能按次数惩罚玩家。 */
export const MAX_DIFFICULTY_ROUND = 9;

/* 每档的温和增量（候选值，非实机平衡结论）。 */
export const HP_STEP = 0.08;        // 敌人血量 +8% / 档
export const DAMAGE_STEP = 0.06;    // 蓄力伤害 +6% / 档
export const INTERVAL_STEP = 0.05;  // 三个窗口 -5% / 档（越往后越紧）

/* 统一上限：hp / damage 的封顶倍率、interval 的下限倍率。
 * 伤害涨得比血量慢是有意的 —— 血量决定「要打几个词」，伤害决定「错几次会死」，
 * 后者对儿童用户的容错更敏感，所以给更缓的斜率。 */
export const MAX_HP_MULTIPLIER = 1 + HP_STEP * (MAX_DIFFICULTY_ROUND - 1);
export const MAX_DAMAGE_MULTIPLIER = 1 + DAMAGE_STEP * (MAX_DIFFICULTY_ROUND - 1);
export const MIN_INTERVAL_MULTIPLIER = 1 - INTERVAL_STEP * (MAX_DIFFICULTY_ROUND - 1);

/* 三类思考窗口的硬下限（毫秒）。任何档位、任何怪物都不得越过：
 *   idle      —— 蓄力前的完整思考窗口
 *   telegraph —— 可被有效字母尝试打断的窗口（必须留够读完当前词）
 *   recover   —— 收招 / 被打断后的反打窗口
 * 下限先于倍率生效：倍率只可能让窗口更短，绝不可能让它短到不可反应。 */
export const MIN_IDLE_MS = 3500;
export const MIN_TELEGRAPH_MS = 3000;
export const MIN_RECOVER_MS = 2000;

/* 校验边界用的浮点余量：1 + 0.08*4 在 JS 里是 1.3199999999999998 这类二进制近似值，
 * 而存档往返走十进制文本。判合法时允许 1e-9 的表示误差，只为让「派生出来的那个数」
 * 与「从 JSON 读回来的同一个数」互认 —— 真正的伪造值（999999）远在这个量级之外。 */
const FLOAT_SLOP = 1e-9;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = v => isNum(v) && Number.isInteger(v);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/* 缩放结果统一夹到「下限 + 至少 1ms」，保证正整数。 */
function msAt(value, multiplier, floor) {
  return Math.max(floor, Math.round(value * multiplier));
}

/* 轮号 → 有效档位。缺失 / NaN / Infinity / 字符串 / 0 / 负数 / **小数** 一律保守
 * 按第 1 轮，绝不因为「读不出来」就当成高轮次给玩家上难度。
 * ★ 小数是脏形状而不是「四舍五入的轮号」：存档里的 roundNumber 必须**是整数**
 *   （run-snapshot 的校验就是 isInt），所以 3.9 只可能来自损坏或伪造的存档 ——
 *   按整数部分猜一档恰恰就是「读不出来还升难度」。 */
function readRoundNumber(raw) {
  if (!isInt(raw) || raw < 1) return 1;
  return raw;
}

/* 轮号 → 三个倍率（deriveRoundDifficulty 的内核；编解码校验复用同一份，
 * 所以「派生」与「认这份事实」永远用同一条曲线，不会漂移）。 */
function multipliersFor(roundAtStart) {
  const steps = clamp(roundAtStart - 1, 0, MAX_DIFFICULTY_ROUND - 1);
  return {
    hpMultiplier: clamp(1 + HP_STEP * steps, 1, MAX_HP_MULTIPLIER),
    damageMultiplier: clamp(1 + DAMAGE_STEP * steps, 1, MAX_DAMAGE_MULTIPLIER),
    intervalMultiplier: clamp(1 - INTERVAL_STEP * steps, MIN_INTERVAL_MULTIPLIER, 1),
  };
}

/* ★ 严格形状判定：这份 difficulty 是不是「自己能派生出来的那个」。
 *   五项全中才算合法：自己的版本、合法整数轮号、三个有限倍率，且三个倍率都落在
 *   与轮次相容的区间内（hp/damage 不低于 1、不超最高档，interval 不高于 1、
 *   不破下限），并与该轮号**派生出的值**一致。
 *   最后这一条是防伪造的关键：只夹上下界的话，一份 roundAtStart: 1 却带
 *   hpMultiplier: 1.64 的存档仍能通过 —— 那是「基线轮 + 最高难度」，没人设计过，
 *   也没有任何地方会自愈。与派生值逐字比对（允许浮点表示误差）才能保证
 *   「轮号与倍率永远互相对得上」。 */
export function validateDifficultyFact(d) {
  if (!isObj(d)) return false;
  if (d.version !== DIFFICULTY_VERSION) return false;
  if (!isInt(d.roundAtStart) || d.roundAtStart < 1) return false;
  if (!isNum(d.hpMultiplier) || d.hpMultiplier < 1 || d.hpMultiplier > MAX_HP_MULTIPLIER) return false;
  if (!isNum(d.damageMultiplier) || d.damageMultiplier < 1 || d.damageMultiplier > MAX_DAMAGE_MULTIPLIER) return false;
  if (!isNum(d.intervalMultiplier) || d.intervalMultiplier < MIN_INTERVAL_MULTIPLIER || d.intervalMultiplier > 1) return false;
  const expect = multipliersFor(d.roundAtStart);
  return Math.abs(d.hpMultiplier - expect.hpMultiplier) <= FLOAT_SLOP
    && Math.abs(d.damageMultiplier - expect.damageMultiplier) <= FLOAT_SLOP
    && Math.abs(d.intervalMultiplier - expect.intervalMultiplier) <= FLOAT_SLOP;
}

/* 编解码：合法 → 全新对象（只带那五个键）；不合法 → undefined。
 * ★ encode **绝不剥字段洗白**：一份脏事实不能变成「看起来干净」的存档，否则损坏
 *   就被静默修好了 —— 那比明确存不下更糟（fail closed 口径）。
 *   缺失 / null（旧的 run 没有这个键）是**合法形状**，decode 返回 undefined，调用方
 *   按基线处理，绝不按当前 DB.runs 重算（否则刷新一次就凭空升一档）。 */
export function encodeDifficulty(d) {
  if (!validateDifficultyFact(d)) return undefined;
  return {
    version: d.version, roundAtStart: d.roundAtStart,
    hpMultiplier: d.hpMultiplier, damageMultiplier: d.damageMultiplier,
    intervalMultiplier: d.intervalMultiplier,
  };
}
export function decodeDifficulty(raw) {
  return encodeDifficulty(raw);
}

/* 读一份难度事实用于缩放。**整体** fail closed：任一字段不合法就整份回落基线
 * （三个倍率全 1 = 本轮不缩放），而不是逐字段部分采用 —— 部分采用会让一份半坏的
 * 存档产生没人设计过的难度，也让 999999 倍血量潜进来。绝不返回 NaN：NaN 渗进
 * setTimeout 或生命值，玩家只会看到「怪永远不动」或「NaN 点伤害」。 */
function readDifficulty(d) {
  if (!validateDifficultyFact(d)) {
    return { hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 };
  }
  return {
    hpMultiplier: d.hpMultiplier, damageMultiplier: d.damageMultiplier,
    intervalMultiplier: d.intervalMultiplier,
  };
}

/* ★ 唯一的规则入口。
 *   facts = { roundNumber, unit, segments }
 *     roundNumber —— 真实轮号（run.roundNumber / DB.runs），唯一参与计算的入参。
 *     unit / segments —— **只被接收**：同轮跨单元、续段都不重算，跨段不该升难度。
 *   返回：{ version, roundAtStart, hpMultiplier, damageMultiplier, intervalMultiplier }
 *     roundAtStart 是这次派生**所依据的轮号事实**（合法整数，最小 1）。
 *     轮号可以远超最高档（1e9），但倍率只封顶到有限最高档 —— 轮号不被改写，
 *     因为「第几轮」是真实事实，替它改小会让存档自相矛盾。 */
export function deriveRoundDifficulty(facts = {}) {
  const f = (facts && typeof facts === 'object' && !Array.isArray(facts)) ? facts : {};
  const roundAtStart = readRoundNumber(f.roundNumber);
  const mult = multipliersFor(roundAtStart);
  return {
    version: DIFFICULTY_VERSION,
    roundAtStart,
    hpMultiplier: mult.hpMultiplier,
    damageMultiplier: mult.damageMultiplier,
    intervalMultiplier: mult.intervalMultiplier,
  };
}

/* 攻击档案 → 本轮的攻击档案。
 *   窗口 × intervalMultiplier（再按下限夹住），伤害 × damageMultiplier。
 *   baseProfile 缺失 / 脏值 → 回落 FOE_ATTACK.normal（fail safe：宁可慢也别 NaN）。
 *   ★ 返回全新对象：不改 baseProfile，不返回入参引用（调用方改了不会串到别处）。 */
export function scaleFoeAttackProfile(baseProfile, difficulty) {
  const base = (baseProfile && typeof baseProfile === 'object' && !Array.isArray(baseProfile)) ? baseProfile : {};
  const d = readDifficulty(difficulty);
  const fallback = FOE_ATTACK.normal;
  const pick = (field) => {
    const v = base[field];
    return (isNum(v) && v > 0) ? v : fallback[field];
  };
  return {
    idleMs: msAt(pick('idleMs'), d.intervalMultiplier, MIN_IDLE_MS),
    telegraphMs: msAt(pick('telegraphMs'), d.intervalMultiplier, MIN_TELEGRAPH_MS),
    recoverMs: msAt(pick('recoverMs'), d.intervalMultiplier, MIN_RECOVER_MS),
    damage: Math.max(1, Math.round(pick('damage') * d.damageMultiplier)),
  };
}

/* 敌人血量 → 本轮血量。四舍五入取整，最小 1。
 *   baseHp 非法（NaN / 非数 / 负数）→ 1（最小可玩值，绝不返回 NaN）。
 *   脏 difficulty → 原值（倍率全 1，等于没缩放）。 */
export function scaleEnemyHealth(baseHp, difficulty) {
  if (!isNum(baseHp) || baseHp <= 0) return 1;
  const d = readDifficulty(difficulty);
  return Math.max(1, Math.round(baseHp * d.hpMultiplier));
}