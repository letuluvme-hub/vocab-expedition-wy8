// 远征状态机：开局对象、层间推进、战斗节点结算、远征结算。
// 纯规则：不读 window / localStorage / 全局 G·B·DB，也不写任何 UI。
// 搬自 runtime.js 的 newRun / buildMap 的状态部分 / advance / finishNode / endRun，
// G/B/DB 换成显式参数，DOM 与存档写入留给调用方。
import { clamp } from './math.js';
import { generateMap } from './map.js';

export const ADV_LOCK_MS = 400;   // 双击去重窗口：够挡住连点，又短到不挡正常推进

// run id 序号：仅供诊断（日志、报错里说清是哪一次远征），不是计数幂等的依据 ——
// 幂等依据是 run.countedStart / run.clearedRun。进程内单调递增即可，不需要跨存档
// 持久化，也不进 JSON。
let RUN_SEQ = 0;

// ★ 「这是不是一次真正的新开一轮」的判据。
// 重复触发只有一种形态：连点「开始远征 / 再来一次 / 下一单元」，两次调用之间
// 上一次 newRun 已经换上了新 run，而这个新 run 还没结束（没有 result）。
// 玩家主动放弃（mQuit / 回主页，G 置 null）或上一轮已结算（result 是布尔）都不算重复，
// 所以这里只看「有没有一场正在进行、且刚刚才开起来的远征」，而不是时间窗 ——
// 时间窗会误伤「打完 → 放弃 → 立刻重开」这种正常操作。
export function isDuplicateRunStart(run) {
  return !!run && typeof run.result !== 'boolean';
}

// 开局：返回与旧 newRun() 等价的 run（含地图与首层可选节点）
export function createRun(unit, hero, pool, random = Math.random) {
  const M = (hero && hero.mod) || {};
  const maxhp = 70 + (M.hp || 0);           // 角色差异：生命上限
  const run = {
    unit, hp: maxhp, maxhp,
    id: 'R' + (++RUN_SEQ).toString(36),     // 诊断标识：区分这一次和上一次远征
    countedStart: false,                    // 远征次数是否已记（同一 run 只能记一次）
    clearedRun: false,                      // 通关次数是否已记（同一 run 只能记一次）
    // ★ clearedSegment 与 clearedRun 是**两个独立事实**，必须分开记：
    //   clearedRun     = 这一整轮有没有通关过（DB.wins 的唯一依据，终身只 +1）。
    //   clearedSegment = **当前这一段学习地图**的 BOSS 是否已结算（换段即重置）。
    //   学习主线里同一轮可以连打多段（Unit 1→…→6，或者同单元续段），每段都有自己的
    //   BOSS 结算（回血 / 标记节点），但 DB.wins 全程只加一次。旧版只有 clearedRun，
    //   于是第二段的 BOSS 永远拿不到结算 —— 那正是「打完第一段就再也结不了账」的原因。
    //   布尔：缺字段（老存档 / 老快照）按 clearedRun 保守回落，见 finishBattleNode。
    clearedSegment: false,
    // 本轮纪念卡的 id：持久化在 run 上，让「再次结算」能认出同一张卡而不是再发一张。
    // 可缺（旧存档 / 尚未结算）；首次生成时由 endRunProgress 写上。
    rewardId: undefined,
    shield: M.shield || 0, gold: M.gold || 0,
    floor: 1, maxFloor: 1,
    relics: [], skipFree: false,
    // ★ 影分身额度是 **run 级**，不是 battle 级：一轮远征只能免费撤退一次。
    //   旧实现把标记放在 B.ghostUsed（每场战斗重建），于是每场都能白嫖一次。
    //   放在 run 上意味着换战斗不会重置、重复拿到影分身也不会重置；
    //   createRun 是**唯一**把它置回 false 的地方，所以「新一局」永远拿到新额度。
    //   布尔而不是次数：语义就是 1 次，缺字段（老存档/旧快照）回落为未使用。
    ghostUsed: false,
    heroId: hero && hero.id, hm: M.hint || 0, hnoise: M.noise || 0,
    // 单元解锁主线（见 docs/feature-campaign.md）：
    //   startedUnit = 这一轮是从哪个单元开始的；跨单元过渡时它不变（**仅诊断**）。
    //     ⚠ 它**不再**是幂等判据：拿它当永久守卫会让 Unit 3→4 永远接不上。
    //     过渡的幂等现在由 applyUnitTransition 入口的 run.unit === facts.from 保证。
    //   segments    = 这一轮已经走过几段学习地图（开局 1，之后每次过渡 +1）。
    // 它**不是**次数：DB.runs 只在真正新开一轮时 +1，跨单元不加。
    campaign: { startedUnit: unit, segments: 1 },
    hcombo: M.combo || 1, hregen: M.regen || 0, hleech: M.leech || 0,
    pool: (pool || []).slice(), kills: 0, att: 0, attOk: 0,
    deckHint: 0, history: [], avail: null, node: null,
    done: new Set(),      // 本局已答对的词：不再出现
    wrong: [],            // 答错过的词：下一场优先复习
    bag: { leech: 2 },    // 新手送 2 个吸血獠牙
  };
  const rows = generateMap(random);
  run.rows = rows; run.cur = null; run.floor = 1; run.maxFloor = 1;
  run.avail = rows[0].slice();
  run.pending = null;
  return run;
}

// 推进到下一层。返回 'locked'（400ms 内重复点击）/ 'ended'（没有出边）/ 'map'
export function advanceRun(run, now = Date.now()) {
  // 幂等保护用时间窗而不是布尔锁：布尔锁一旦漏清就永久卡死。
  if (run.advAt && now - run.advAt < ADV_LOCK_MS) return 'locked';
  run.advAt = now;
  run.floor++;
  run.maxFloor = Math.max(run.maxFloor, run.floor);
  if (run.relics.indexOf('battery') >= 0) run.hp = Math.min(run.maxhp, run.hp + 8);
  run.hp = clamp(run.hp, 1, run.maxhp);
  run.avail = (run.node && run.node.links.length) ? run.node.links.slice() : [];
  run.cur = run.node;
  if (!run.avail.length) return 'ended';
  return 'map';
}

// ★ 次数计数的唯一入口。
//   远征次数（DB.runs）：只在「真正新开一轮」时 +1。
//   restored=true 表示「把一条已经开过、已计数过的远征恢复回来」（刷新/读档/未来快照恢复）。
//   恢复不是新开一轮，所以 db.runs 不动；但它仍然要「占住」这一轮的计数名额 ——
//   即置 countedStart=true。于是先恢复、后又被当成新开一轮调用的顺序也不会把
//   这条 run 记成新的一次远征（幂等依据是 countedStart，不是调用顺序或时间窗）。
//   历史 totals 一律原样保留，不回填、不折算、不根据现有存档重算。
export function registerRunStart(db, run, { restored = false } = {}) {
  if (!db || !run) return false;
  if (run.countedStart) return false;   // 已记过（无论是被恢复还是被正常新开）
  run.countedStart = true;
  if (restored) return false;           // 恢复：占住名额但不 +1
  db.runs = (db.runs | 0) + 1;
  return true;
}

// ★ 通关次数（DB.wins）的唯一入口：同一 run 最多 +1。
// 幂等依据是 run.clearedRun（run 级标记），而不是战斗对象 —— 一轮里理论上只会有一场
// BOSS 战，但重复结算、迟到回调、旧战斗对象都可能让 finishBattleNode 再走一次，
// 只靠 battle.finished 挡不住「同一 run 的另一场战斗对象」。run.id 只是诊断标识。
export function registerRunWin(db, run) {
  if (!db || !run || run.clearedRun) return false;
  run.clearedRun = true;
  db.wins = (db.wins | 0) + 1;
  return true;
}

// 段 BOSS 是否已结算。缺字段（老存档 / 老内存态）时按 clearedRun 保守回落：
// 宁可少结算一次，也绝不因为缺字段而给同一段发两次回血/标记。
const segmentCleared = run => (typeof run.clearedSegment === 'boolean' ? run.clearedSegment : !!run.clearedRun);

// 战斗节点结算：结转生命/护盾、标记节点完成。
// 返回 'ignored'（无 run/battle、同一个战斗对象已结算、或**本段**BOSS 已结算过）
//      / 'boss-win' / 'boss-loss' / 'advance'
export function finishBattleNode(run, battle, db) {
  if (!run || !battle || battle.finished) return 'ignored';
  // ★ 本段 BOSS 已经结算过：任何后续 BOSS 胜利（另一个战斗对象、迟到回调、重复结算）
  // 都不再是一次段结算。必须在任何副作用之前返回 —— 不能再 +30 回血、不能再标记节点、
  // 更不能再让调用方去安排结算。battle.finished 挡不住「同一段的另一个战斗对象」。
  //   注意判据是 clearedSegment 而不是 clearedRun：换段之后 clearedSegment 归 false，
  //   于是新段的 BOSS 可以真正结算，而 DB.wins 由 registerRunWin 按 clearedRun 只 +1。
  if (battle.boss && battle.won && segmentCleared(run)) return 'ignored';
  // ★ 先占住「本段已结算」再做任何副作用：即使后面抛错，重复回调也不会再发一次。
  if (battle.boss && battle.won) run.clearedSegment = true;
  battle.finished = true;
  const n = battle.node;
  if (n) n.done = true;
  run.hp = clamp(battle.myHp, 1, run.maxhp);   // 战斗中的生命结转回远征状态
  run.shield = battle.shield;                  // 护盾跨战斗保留
  // 只有「真打赢」才算通关 BOSS；逃跑/跳过不算。
  // 计数走 registerRunWin：同一轮重复结算不会二次 +1。
  if (battle.boss && battle.won) {
    run.hp = Math.min(run.maxhp, run.hp + 30);
    if (db) { registerRunWin(db, run); db.best = Math.max(db.best, 9); }
    return 'boss-win';
  }
  if (battle.boss) return 'boss-loss';
  return 'advance';
}

// 远征结算：写一次纪念卡、更新 best 与 result。返回本次纪念卡（失败或已存在时为已有卡/null）
//
// ★ 纪念卡跨刷新幂等：卡的 id 由 run.rewardId 这个事实承载，而不是靠「内存里还有没有
//   run.reward」。刷新 / 恢复之后内存卡可能没了但 id 还在 —— 这时复用 db.rewards 里
//   同一 id 的那张卡，绝不 push 第二张。旧内存态（有 run.reward 但没 rewardId）取
//   reward.id 兜底；连 id 都没有的极旧快照，领域层不猜、不删、不补（由上层判定）。
export function endRunProgress(run, db, win, now = Date.now(), earnedAt = new Date(now).toISOString()) {
  if (!run) return null;
  const acc = clamp(Math.round(run.attOk / Math.max(1, run.att) * 100), 0, 100);
  if (win && !run.reward) {
    const knownId = (typeof run.rewardId === 'string' && run.rewardId)
      || (run.reward && typeof run.reward.id === 'string' ? run.reward.id : null);
    const existing = knownId && db && Array.isArray(db.rewards)
      ? db.rewards.filter(r => r && r.id === knownId)[0]
      : null;
    if (existing) {
      run.reward = existing;                       // 复用同一张卡：db.rewards 不动
    } else {
      const reward = {
        id: knownId || ('WR-' + now.toString(36) + '-' + db.runs + '-' + db.rewards.length),
        unit: run.unit, heroId: run.heroId, accuracy: acc,
        kills: run.kills, floor: run.maxFloor, earnedAt,
      };
      run.reward = reward;
      run.rewardId = reward.id;                   // ★ 首次生成就把 id 持久化在 run 上
      db.rewards.push(reward);
    }
  }
  if (db) db.best = Math.max(db.best, run.maxFloor);
  run.result = !!win;
  return run.reward || null;
}
