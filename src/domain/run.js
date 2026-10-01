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
    shield: M.shield || 0, gold: M.gold || 0,
    floor: 1, maxFloor: 1,
    relics: [], skipFree: false,
    heroId: hero && hero.id, hm: M.hint || 0, hnoise: M.noise || 0,
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

// 战斗节点结算：结转生命/护盾、标记节点完成。
// 返回 'ignored'（无 run/battle、同一个战斗对象已结算、或这一轮已通关过）
//      / 'boss-win' / 'boss-loss' / 'advance'
export function finishBattleNode(run, battle, db) {
  if (!run || !battle || battle.finished) return 'ignored';
  // ★ 这一轮已经通关过：任何后续 BOSS 胜利（另一个战斗对象、迟到回调、重复结算）
  // 都不再是一次通关。必须在任何副作用之前返回 —— 不能再 +30 回血、不能再标记节点、
  // 更不能再让调用方去安排结算。battle.finished 挡不住「同一 run 的另一个战斗对象」。
  if (battle.boss && battle.won && run.clearedRun) return 'ignored';
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
export function endRunProgress(run, db, win, now = Date.now(), earnedAt = new Date(now).toISOString()) {
  if (!run) return null;
  const acc = clamp(Math.round(run.attOk / Math.max(1, run.att) * 100), 0, 100);
  if (win && !run.reward) {
    run.reward = {
      id: 'WR-' + now.toString(36) + '-' + db.runs + '-' + db.rewards.length,
      unit: run.unit, heroId: run.heroId, accuracy: acc,
      kills: run.kills, floor: run.maxFloor, earnedAt,
    };
    db.rewards.push(run.reward);
  }
  if (db) db.best = Math.max(db.best, run.maxFloor);
  run.result = !!win;
  return run.reward || null;
}
