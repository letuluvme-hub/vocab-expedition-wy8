// 单元解锁与跨单元衔接的**纯规则**。无 DOM / 无存储 / 无全局。
//
// 三条口径（docs/feature-campaign.md）：
//  1) 解锁依据有两条，满足任一即可：
//     a) 「本单元目标词全部通过无错误、无提示、无揭示的正式默写」（DB.dictationMastered 覆盖全部目标身份）；
//     b) 远征里把本单元词池全部整词拼完（recordUnitComplete 写下的、带 completedAt 的完成凭据）。
//     历史 wins / best / 纪念卡 / 部分词 / 打过首领**都不是**证据。
//     （b 是 2026-10 起恢复的：只有 a 时，只玩远征的学生永远解不开 Unit 2。）
//  2) 迁移保守且连续：旧存档按 dictationMastered 覆盖推导，Unit N 解锁要求 1..N-1 全部完成；
//     单元 3 学完但单元 2 没学完时，单元 3 仍然锁着。绝不一次授予全册。
//  3) 自定义词表（单元 0）永远可玩，但从不参与教材解锁。
//
// 词条身份只做 trim + lowerCase（与 domain/word-selection 同口径）：空格、连字符、
// 撇号是拼写的一部分，绝不剥掉 —— 剥掉会把 ice cream / icecream 折叠成同一个词。
import { generateMap } from './map.js';
import { learningCounts, isPoolComplete } from './word-selection.js';

export const CUSTOM_UNIT = 0;

export const wordKey = w => String(w == null ? '' : w).trim().toLowerCase();

/* 本单元的目标身份列表：同一条目只留第一条，顺序保持词库原序。 */
export function unitTargets(words) {
  const seen = new Set();
  const out = [];
  for (const w of words || []) {
    const k = wordKey(w && w.w !== undefined ? w.w : w);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/* unitProgress 的形状修复。绝不动 mastered / custom / rewards。 */
export function ensureProgress(db) {
  if (!db || typeof db !== 'object') return {};
  if (!db.unitProgress || typeof db.unitProgress !== 'object' || Array.isArray(db.unitProgress)) {
    db.unitProgress = {};
  }
  return db.unitProgress;
}

/* 远征完成凭据：只认 recordUnitComplete 写下的形状（complete===true 且带 completedAt 字符串）。
 * 缺时间戳的旧/手改记录不算 —— 宁可多拼一遍，也不凭一个布尔授予解锁。 */
export function expeditionComplete(unitProgress, unit) {
  const rec = unitProgress && typeof unitProgress === 'object' ? unitProgress[String(unit)] : null;
  return !!(rec && typeof rec === 'object' && rec.complete === true && typeof rec.completedAt === 'string');
}
/* 本单元是否「全部词完成」。口径只有一条：目标身份全部出现在 dictationMastered 里。 */
export function isUnitComplete({ unit, words, db }) {
  const targets = unitTargets(words);
  if (!targets.length) return false;          // 空单元不算「完成」，更不算解锁依据
  const mastered = new Set((Array.isArray(db && db.dictationMastered) ? db.dictationMastered : []).map(wordKey));
  return targets.every(k => mastered.has(k));
}

/* 已完成 / 剩余量。与 word-selection 的 counting 同源（同一份 dictationMastered + 同一份身份）。 */
export function unitCounts({ unit, words, db }) {
  const targets = unitTargets(words);
  const mastered = new Set((Array.isArray(db && db.dictationMastered) ? db.dictationMastered : []).map(wordKey));
  const done = targets.filter(k => mastered.has(k)).length;
  return { unit, total: targets.length, done, remaining: targets.length - done };
}

/* 记一次「本单元词汇全部完成」。幂等：第一次写时间戳，之后只返回 false。
 * 不改任何计数（runs / wins / best 都不属于这个事实）。 */
export function recordUnitComplete(db, unit, { now = Date.now() } = {}) {
  const progress = ensureProgress(db);
  const key = String(unit);
  if (progress[key] && progress[key].complete === true) return false;
  progress[key] = { complete: true, completedAt: new Date(now).toISOString() };
  return true;
}

/* wordsFor 缺失 / 抛错时退化成空词表：一个单元拿不到词表不等于整个解锁视图崩掉。
 * 这里是纯派生视图（UI 每帧都可能画它），绝不允许它成为异常来源。 */
function safeWords(wordsFor, unit) {
  try {
    const w = typeof wordsFor === 'function' ? wordsFor(unit) : null;
    return Array.isArray(w) ? w : [];
  } catch {
    return [];
  }
}

/* 解锁全貌。纯派生：不写任何东西，所以 UI 直接画它也不会漂移成第二套口径。 */
export function unlockProgress({ units, wordsFor, dictationMastered, unitProgress }) {
  // ★ units 排序 + 去重：解锁是一串**有序**的教材单元，输入顺序（[3,1,0,1,…]）绝不许
  //   改变连续口径。非数字项直接丢掉（脏数据不该长出一个单元）。
  const nos = Array.from(new Set((units || []).filter(n => typeof n === 'number' && Number.isFinite(n))))
    .sort((a, b) => a - b);
  const db = { dictationMastered: Array.isArray(dictationMastered) ? dictationMastered : [] };
  const byUnit = {};
  let contiguous = true;                      // 「前面每一个都完成了」还成立吗
  for (const n of nos) {
    if (n === CUSTOM_UNIT) {
      // 自定义单元：永远可玩，按**真实词表**算已学 / 剩余（不许伪报 total 0），
      // 但它的完成**从不**参与教材解锁（continue，不动 contiguous）。
      const c = unitCounts({ unit: n, words: safeWords(wordsFor, n), db });
      byUnit[n] = Object.assign({}, c, {
        complete: c.total > 0 && c.remaining === 0,
        unlocked: true, custom: true, lockedReason: null,
      });
      continue;
    }
    const c = unitCounts({ unit: n, words: safeWords(wordsFor, n), db });
    const complete = c.total > 0 && c.remaining === 0;
    const expedition = c.total > 0 && expeditionComplete(unitProgress, n);
    // passed = 正式默写全覆盖 **或** 远征整词完成 —— 解锁看它；complete 仍只表示默写覆盖。
    const passed = complete || expedition;
    // ★ 解锁只看**前面**的单元：本单元自己做完之前它就已经可玩了
    //   （Unit 1 永远可玩，Unit 2 在 Unit 1 完成时解锁）。
    const unlocked = contiguous;
    byUnit[n] = Object.assign({}, c, {
      complete, expedition, passed, unlocked,
      lockedReason: unlocked ? null : ('unit-' + (n - 1)),
    });
    if (!passed) contiguous = false;           // 从这里往后全部锁住（连续口径）
  }
  return {
    byUnit,
    isUnlocked: unit => !!(byUnit[unit] && byUnit[unit].unlocked),
    counts: unit => (byUnit[unit]
      ? { total: byUnit[unit].total, done: byUnit[unit].done, remaining: byUnit[unit].remaining,
        complete: byUnit[unit].complete, passed: !!byUnit[unit].passed }
      : { total: 0, done: 0, remaining: 0, complete: false, passed: false }),
    next: unit => nos.filter(n => n !== CUSTOM_UNIT).sort((a, b) => a - b)
      .filter(n => n > unit)[0],
  };
}

/* 运行时入口的统一闸门。UI 锁定只是显示，这里才是真正的拒绝。 */
export function canSelectUnit(progress, unit) {
  return !!(progress && progress.isUnlocked(unit));
}

/* ---------------- 跨单元衔接 ---------------- */
/* 本轮学习范围（docs/feature-rounds.md）。
 *
 * 「本轮学习范围」是**这一轮真正选的起点到本册末尾**：
 *   教材起点 Unit 3 → [3,4,5,6]；自定义起点 0 → 只有 [0]。
 * 它不是「这一轮到过的单元」也不是「1..6」：从 Unit 3 开局的这一轮从来没学过
 * Unit 1/2，声称完成了 1..6 就是虚报。 */
export const LAST_UNIT = 6;
const CUSTOM_SCOPE = [CUSTOM_UNIT];

/* 该轮的起点：campaign.startedUnit 优先，缺字段时退回当前单元（保守）。 */
function scopeStart(run) {
  const started = run && run.campaign ? run.campaign.startedUnit : undefined;
  if (Number.isInteger(started) && (started === CUSTOM_UNIT || (started >= 1 && started <= LAST_UNIT))) {
    return started;
  }
  return run && Number.isInteger(run.unit) ? run.unit : 1;
}

export function roundScopeUnits(run) {
  if (!run) return [];
  const start = scopeStart(run);
  if (start === CUSTOM_UNIT) return CUSTOM_SCOPE.slice();
  const out = [];
  for (let u = Math.max(1, Math.min(start, LAST_UNIT)); u <= LAST_UNIT; u++) out.push(u);
  return out;
}

/* 记录「本轮在这个单元把目标词全部整词完成了」。
 * 只有**本轮**的真实完成证据才写（调用方是抽词抽干 / 跨单元过渡这两条真实路径）；
 * 到过某个单元、击败 BOSS、跳过节点都不是。幂等。范围外的单元一律拒绝。
 *
 * ★ 本轮整词证据闸门（允许跨单元 ≠ 允许记本轮完成）：
 *   跨单元解锁的口径是 DB.dictationMastered 的历史覆盖 —— 一份「259 个词历史全掌握」的存档
 *   从 Unit 1 起手点一次「继续下一单元」，解锁本身完全合法（口径不许收紧）。
 *   但这条 run 里**一个词都没答过**，run.done 空、doneKeys 与该单元词池毫无交集，
 *   于是 completedUnits 必须仍然是 [] —— 否则卡上会凭空长出「本轮完成 Unit 1」，
 *   把一段根本没学过的学习写成学完了。历史掌握与本轮完成是两个独立事实。
 *   判据只有两条，且与抽词/检查点同源（word-selection）：
 *     learningCounts(...).total > 0（有词可学；空单元不算完成）
 *     isPoolComplete(...)（该词池被 run.done 真正全覆盖）
 *
 * pool 参数：调用方可以显式给出**该单元当时的真实词池**作为证据。
 *   这不是为了放宽闸门，而是因为 runtime 的真实顺序是「先 applyUnitTransition
 *   换池、再记完成」——那时 run.pool 已经是下一个单元的了。不显式传就会用
 *   新单元的覆盖去给旧单元记完成（那正好是本闸门要挡的错误）。 */
export function recordRoundUnitComplete(run, unit, { pool = run && run.pool } = {}) {
  if (!run) return false;
  if (!Number.isInteger(unit)) return false;
  if (roundScopeUnits(run).indexOf(unit) < 0) return false;   // 范围外：不是本轮的目标
  if (!Array.isArray(run.completedUnits)) run.completedUnits = [];
  if (run.completedUnits.indexOf(unit) >= 0) return false;    // 幂等
  const evidence = Object.assign({}, run, { pool: pool || [] });
  if (learningCounts(evidence).total <= 0) return false;       // 没词：无从完成
  if (!isPoolComplete(evidence)) return false;                 // 本轮没整词答完
  run.completedUnits.push(unit);
  return true;
}

/* 本轮学习范围是否真的全部完成。只看本轮的整词完成记录，绝不按到过的单元算，
 * 也绝不因为「历史存档里 Unit 1..6 的词都在 mastered 里」就说本轮完成了。
 * 名义口径是「本轮学习范围已完成」，不是「全册已掌握」。 */
export function roundCompletion(run) {
  const targets = roundScopeUnits(run);
  const done = Array.isArray(run && run.completedUnits) ? run.completedUnits : [];
  const missing = targets.filter(u => done.indexOf(u) < 0);
  return { targets, done: targets.filter(u => done.indexOf(u) >= 0), missing, complete: targets.length > 0 && missing.length === 0 };
}

/* 纯事实：只回答「能不能过渡到下一单元」，不碰 run、不碰 DB。
 * 重复调用天然安全：过渡已经发生时 run.unit 已经变了，判据随之改变。 */
export function transitionNextUnit({ run, progress }) {
  if (!run) return { ok: false, reason: 'no-run' };
  if (run.unit === CUSTOM_UNIT) return { ok: false, reason: 'custom', from: run.unit };
  // ★ 这里**不再**有「campaign.startedUnit !== unit → already」的永久守卫。
  //   那个守卫把「这一轮是从 Unit 1 开始的」当成了「已经过渡过了」，于是
  //   Unit 2→3、3→4… 永远接不上（startedUnit 恒为 1）。它只是诊断字段。
  //   过渡幂等现在由 applyUnitTransition 的入口校验（run.unit 必须等于 facts.from）保证。
  const to = progress && progress.next ? progress.next(run.unit) : undefined;
  if (!to) return { ok: false, reason: 'last-unit', from: run.unit };
  // ★ 先报「本单元还有词没学完」：这是玩家真正要解决的事，也是 locked 的上游成因。
  //   顺序反了的话，新存档上只会得到一句没有行动方向的「locked」。
  const counts = progress.counts ? progress.counts(run.unit) : null;
  if (counts && counts.complete !== true && counts.passed !== true) return { ok: false, reason: 'incomplete', from: run.unit, to, counts };
  if (!canSelectUnit(progress, to)) return { ok: false, reason: 'locked', from: run.unit, to };
  return { ok: true, from: run.unit, to };
}

/* 新学习段：重新生成地图并把楼层重置到 1，但 maxFloor（历史最好层数）不许改小。 */
function rebuildSegment(run, random) {
  run.rows = generateMap(random);
  run.cur = null;
  run.node = null;
  run.floor = 1;
  run.avail = run.rows[0].slice();
  run.pending = null;
  run.advAt = 0;                              // 400ms 推进去重窗口不跨段继承
  // ★ 新的一段有自己的 BOSS：段结算标记必须归位，否则新段的 BOSS 会被上一段
  //   的 clearedSegment 挡成 ignored（那正是本补丁要修的阻断）。
  //   clearedRun 不动 —— 这一整轮仍然只通关过一次，DB.wins 仍然只 +1。
  run.clearedSegment = false;
}

/* 过渡事实是否还可以作用在这条 run 上。
 * ★ 这是过渡幂等的**唯一**依据（旧的 startedUnit 永久守卫已删除）：
 *   facts.from 必须等于 run.unit —— 也就是说这条事实是从**当前**单元算出来的。
 *   过期事实（迟到回调、双击、恢复后重放）喂进来时 run.unit 已经变了，直接 null，
 *   地图 / 段数 / 词池 / 单元一个都不许动（no-effect，而不是「再改回去」）。
 *   facts.to 必须是合法的教材下一单元：正整数、不是自定义单元 0、不是本单元自己。
 *   调用方给了 progress 时还要满足 progress.next(from) === facts.to（不许跳单元）。 */
function transitionApplicable(run, facts, progress) {
  if (!run || !facts || facts.ok !== true) return false;
  if (!Number.isInteger(facts.from) || !Number.isInteger(facts.to)) return false;
  if (run.unit !== facts.from) return false;
  if (facts.to === CUSTOM_UNIT || facts.to <= 0) return false;
  if (facts.to === facts.from) return false;
  if (progress && typeof progress.next === 'function') {
    if (progress.next(facts.from) !== facts.to) return false;
  }
  return true;
}

/* 过渡到下一单元：换词池 + 新地图，**其余一律继承**。
 * 明确不做：createRun / registerRunStart(+次数) / applyRelicInit(重发物资) /
 *          重发新手道具 / 回血 / 补影分身额度 / 清 clearedRun / 动 wins / 生成纪念卡。
 * 返回 null 表示这份事实不适用于当前 run（过期 / 非法），此时**没有任何副作用**。 */
export function applyUnitTransition(run, facts, { words, random = Math.random, progress } = {}) {
  if (!transitionApplicable(run, facts, progress)) return null;
  run.unit = facts.to;
  run.pool = (words || []).slice();
  // 错词队列只保留仍在当前词池里的（抽词侧本来也会过滤，这里先收窄，快照更干净）。
  const keys = new Set(run.pool.map(w => wordKey(w.w)));
  run.wrong = (run.wrong || []).filter(w => keys.has(wordKey(w)));
  run.campaign = Object.assign({ startedUnit: run.campaign ? run.campaign.startedUnit : facts.from, segments: 1 }, run.campaign);
  run.campaign.startedUnit = run.campaign.startedUnit === undefined ? facts.from : run.campaign.startedUnit;
  run.campaign.segments = ((run.campaign && run.campaign.segments) || 0) + 1;
  rebuildSegment(run, random);
  return { unit: run.unit, segment: run.campaign.segments };
}

/* 同一单元的下一段（BOSS 已打完但本单元还有未完成词时继续练）：
 * 单元不变、id 不变、次数不加，只换地图继续抽未完成的词。 */
export function applyUnitSegment(run, { words, random = Math.random } = {}) {
  if (!run) return null;
  if (words) run.pool = words.slice();
  run.campaign = Object.assign({ startedUnit: run.unit, segments: 1 }, run.campaign);
  run.campaign.startedUnit = run.campaign.startedUnit === undefined ? run.unit : run.campaign.startedUnit;
  run.campaign.segments = (run.campaign.segments || 0) + 1;
  rebuildSegment(run, random);
  return { unit: run.unit, segment: run.campaign.segments };
}