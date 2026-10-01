// 远征状态机：开局对象、层间推进、战斗节点结算、远征结算。
// 纯规则：不读 window / localStorage / 全局 G·B·DB，也不写任何 UI。
// 搬自 runtime.js 的 newRun / buildMap 的状态部分 / advance / finishNode / endRun，
// G/B/DB 换成显式参数，DOM 与存档写入留给调用方。
import { clamp } from './math.js';
import { generateMap } from './map.js';

export const ADV_LOCK_MS = 400;   // 双击去重窗口：够挡住连点，又短到不挡正常推进

// 开局：返回与旧 newRun() 等价的 run（含地图与首层可选节点）
export function createRun(unit, hero, pool, random = Math.random) {
  const M = (hero && hero.mod) || {};
  const maxhp = 70 + (M.hp || 0);           // 角色差异：生命上限
  const run = {
    unit, hp: maxhp, maxhp,
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

// 战斗节点结算：结转生命/护盾、标记节点完成。
// 返回 'ignored'（无 run/battle 或已结算过）/ 'boss-win' / 'boss-loss' / 'advance'
export function finishBattleNode(run, battle, db) {
  if (!run || !battle || battle.finished) return 'ignored';
  battle.finished = true;
  const n = battle.node;
  if (n) n.done = true;
  run.hp = clamp(battle.myHp, 1, run.maxhp);   // 战斗中的生命结转回远征状态
  run.shield = battle.shield;                  // 护盾跨战斗保留
  // 只有「真打赢」才算通关 BOSS；逃跑/跳过不算
  if (battle.boss && battle.won) {
    run.hp = Math.min(run.maxhp, run.hp + 30);
    if (db) { db.wins++; db.best = Math.max(db.best, 9); }
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
