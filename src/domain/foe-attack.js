/* 怪物的蓄力自主攻击：纯状态机（docs/product-backlog.md 清单 13）。
 *
 * 不碰 DOM / 存档 / 全局。事实只有五个字段：
 *   { schemaVersion, phase, remainingMs, cycle, interrupted }
 * ★ 绝不落盘的东西：定时器 id、绝对到期时刻（dueAt/performance/Date.now）、闭包回调。
 *   「剩余时间」是唯一与时间有关的落盘事实 —— 刷新后按它精确重建，
 *   既不会补打已经过去的那一下，也不会凭空多给一次攻击。
 *
 * 相位：idle -> telegraph -> attack -> recover -> idle ...
 *   attack 是**单次瞬间**：不占时间、不排下一次定时器，进场就 yield 一个事件。
 *   所以相位本身不需要持久化成一个跨刷新的状态格 —— 但它仍然存在于事实里，
 *   因为「这一刻已经打出去了」正是防重复结算（refresh/late timer）的凭据。
 */
export const FOE_ATTACK_SCHEMA_VERSION = 1;

export const FOE_PHASE = {
  IDLE: 'idle',               // 蓄力前：站桩，等一个 idle 窗口
  TELEGRAPH: 'telegraph',     // 蓄力中：可被有效字母尝试打断
  ATTACK: 'attack',           // 单次瞬间：yield 一个伤害事件，然后立刻进 recover
  RECOVER: 'recover',         // 收招：给玩家一个喘息窗口，也是被打断后的去处
  DEFEATED: 'defeated',       // 战斗已结束：吸收态，永不再产出事件
};

const PHASES = new Set(Object.values(FOE_PHASE));

/* 三档参数只有这一份来源：src/data/balance.js 的 FOE_ATTACK。
 * domain 读数据层的纯常量（无 DOM、无状态、无存储），与 battle-rules 读
 * 学习规则同一性质，所以这里只 import 常量、不把配置当参数层层传递 ——
 * 两份「三档参数」一旦漂移，UI 显示的蓄力时间和真实伤害就会对不上。 */
import { FOE_ATTACK } from '../data/balance.js';

/* 种类 → 参数表。未登记的种类一律回落 normal（fail safe：宁可慢也不无限快）。 */
export function foeAttackProfile(kind) {
  return Object.prototype.hasOwnProperty.call(FOE_ATTACK, kind) ? FOE_ATTACK[kind] : FOE_ATTACK.normal;
}

/* 种类只由 battle 上**既有的** boss / elite 两个标记决定，不新增第四档。 */
export function foeAttackKind(battle) {
  if (battle && battle.boss) return 'boss';
  if (battle && battle.elite) return 'elite';
  return 'normal';
}

/* 新一场战斗的事实：从 idle 起手，剩余时间 = 该怪的 idle 窗口。
 * ★ 绝不从 attack 或 0 剩余起手：那等于「一进战斗就挨打」，
 *   刷新恢复时会把玩家直接推进一次伤害结算。 */
export function createFoeAttackFact(kind) {
  const cfg = FOE_ATTACK[kind] || FOE_ATTACK.normal;
  return {
    schemaVersion: FOE_ATTACK_SCHEMA_VERSION,
    phase: FOE_PHASE.IDLE,
    remainingMs: cfg.idleMs,
    cycle: 0,
    interrupted: false,
  };
}

/* 当前相位应当占多长时间。attack 是瞬间（0），defeated 不再计时。 */
export function phaseMs(phase, cfg) {
  switch (phase) {
    case FOE_PHASE.IDLE: return cfg.idleMs;
    case FOE_PHASE.TELEGRAPH: return cfg.telegraphMs;
    case FOE_PHASE.RECOVER: return cfg.recoverMs;
    case FOE_PHASE.ATTACK:
    case FOE_PHASE.DEFEATED:
    default: return 0;
  }
}

/* 走一步。返回 { fact, event }；event 只在进入 attack 的那一步非空。 */
export function advanceFoeAttack(fact, cfg) {
  if (!fact) return { fact: null, event: null };
  // 吸收态：迟到的定时回调落在这里时什么也不做（不复活、不再排期）。
  if (fact.phase === FOE_PHASE.DEFEATED) return { fact, event: null };
  const next = {
    schemaVersion: FOE_ATTACK_SCHEMA_VERSION,
    phase: FOE_PHASE.IDLE,
    remainingMs: cfg.idleMs,
    cycle: fact.cycle,
    interrupted: false,
  };
  switch (fact.phase) {
    case FOE_PHASE.IDLE:
      next.phase = FOE_PHASE.TELEGRAPH;
      next.remainingMs = cfg.telegraphMs;
      return { fact: next, event: null };
    case FOE_PHASE.TELEGRAPH:
      next.phase = FOE_PHASE.ATTACK;
      next.remainingMs = 0;
      next.cycle = fact.cycle + 1;          // 蓄满了才算一轮：被打断不计数
      return { fact: next, event: { type: 'attack', damage: cfg.damage } };
    case FOE_PHASE.ATTACK:
      next.phase = FOE_PHASE.RECOVER;
      next.remainingMs = cfg.recoverMs;
      next.cycle = fact.cycle;
      return { fact: next, event: null };
    case FOE_PHASE.RECOVER:
    default:
      return { fact: next, event: null };   // recover -> idle
  }
}

/* 打断：只有 telegraph 相位放行，且进入 recover（2.5s 的反打窗口）。
 * 一次蓄力只可能被放行一次 —— 不是靠独立时间窗，而是靠相位本身。 */
export function interruptFoeAttack(fact, cfg) {
  if (!fact || fact.phase !== FOE_PHASE.TELEGRAPH) return null;
  return {
    schemaVersion: FOE_ATTACK_SCHEMA_VERSION,
    phase: FOE_PHASE.RECOVER,
    remainingMs: cfg.recoverMs,
    cycle: fact.cycle,              // ★ 不变：这一轮没打完
    interrupted: true,
  };
}

/* ---------------- 编解码：脏值一律 fail closed ---------------- */
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = v => isNum(v) && Number.isInteger(v);
const isBool = v => v === true || v === false;
// 剩余时间的合法上限：取三档里最长的窗口再放宽一倍。任何超过它的值都是脏的，
// 而「脏的剩余时间」最危险 —— 认成 0 会在刷新后立刻结算一次伤害。
const MAX_REMAINING_MS = 60_000;

export function encodeFoeAttack(fact) {
  if (!fact || fact.schemaVersion !== FOE_ATTACK_SCHEMA_VERSION) return undefined;
  if (!PHASES.has(fact.phase) || !isInt(fact.remainingMs) || !isInt(fact.cycle)) return undefined;
  if (fact.remainingMs < 0 || fact.remainingMs > MAX_REMAINING_MS || fact.cycle < 0) return undefined;
  if (!isBool(fact.interrupted)) return undefined;
  const out = {
    schemaVersion: FOE_ATTACK_SCHEMA_VERSION,
    phase: fact.phase,
    remainingMs: fact.remainingMs,
    cycle: fact.cycle,
    interrupted: fact.interrupted,
  };
  // timerId / dueAt / now / 任何闭包一律不写：上面这五个字段就是全部。
  return out;
}

export function decodeFoeAttack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  if (raw.schemaVersion !== FOE_ATTACK_SCHEMA_VERSION) return undefined;
  if (!PHASES.has(raw.phase)) return undefined;
  if (!isInt(raw.remainingMs) || raw.remainingMs < 0 || raw.remainingMs > MAX_REMAINING_MS) return undefined;
  if (!isInt(raw.cycle) || raw.cycle < 0) return undefined;
  // interrupted 可缺（旧快照）：缺失 = false，不是未知。
  if (raw.interrupted !== undefined && raw.interrupted !== null && !isBool(raw.interrupted)) return undefined;
  return {
    schemaVersion: FOE_ATTACK_SCHEMA_VERSION,
    phase: raw.phase,
    remainingMs: raw.remainingMs,
    cycle: raw.cycle,
    interrupted: raw.interrupted === true,
  };
}

/* timerId / dueAt / now / 任何闭包都不落盘：上面那五个字段就是全部。 */