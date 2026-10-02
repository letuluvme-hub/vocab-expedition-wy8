// 远征状态机：开局对象、层间推进、战斗节点结算、远征结算。
// 纯规则：不读 window / localStorage / 全局 G·B·DB，也不写任何 UI。
// 搬自 runtime.js 的 newRun / buildMap 的状态部分 / advance / finishNode / endRun，
// G/B/DB 换成显式参数，DOM 与存档写入留给调用方。
import { clamp } from './math.js';
import { generateMap } from './map.js';
import { roundCompletion } from './campaign.js';
import { floorHealBonus } from './relic-rules.js';

/* ★ 轮次身份（docs/feature-rounds.md）。
 * roundId 是**持久化**的轮次身份，必须和进程内自增的 run.id（'R1'、'R2'…）区分开：
 *   进程重启后 RUN_SEQ 归零，run.id 会重复；roundId 不会。生成方是 runtime
 *   （crypto.randomUUID），domain 只接收显式事实 —— 纯层不生成 id，也不猜。
 * 脏值（数字 / 空串 / 对象）一律拒绝：绝不把垃圾变成一个看起来合法的身份。 */
export function assignRoundId(run, roundId) {
  if (!run) return null;
  const ok = typeof roundId === 'string' && roundId.length > 0;
  run.roundId = ok ? roundId : undefined;
  return ok ? run.roundId : null;
}

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

// ★ 开局成长事实（docs/feature-mastery-growth.md）。
// growth 是**开局那一刻**的成长快照，由调用方（runtime）从 growthSummary 事实转换而来：
//   { version:1, masteredAtStart, bonusHp, baseMaxhp }
// 契约：
//   - **可选**：不传时逐字等于旧行为（maxhp = 70 + 角色），旧接线/旧测试台不受影响。
//   - **只在新开一轮时读一次**：开局就把 bonusHp 加进 maxhp，之后本局内任何动作
//     （达到 20 词、跨单元、续段）都不再重算 —— 所以「中途退出重进」不会白赚一次。
//   - **脏值 fail closed**：bonusHp 必须是 0..12 的整数且与 masteredAtStart 一致，
//     否则整体按 +0 开局。存档/探针是外部输入，绝不让 NaN 渗进生命值。
//   - baseMaxhp 是**角色基础值**（遗物/成长之前），只作诊断留档，不参与任何计算 ——
//     校验上限不许拿它反推 maxhp，因为进本局后 maxhp 可能被别的合法途径抬高。
const MAX_BONUS = 12;
const INTERVAL = 20;
function readGrowth(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const { version, masteredAtStart, bonusHp } = g;
  if (version !== 1) return null;
  if (!Number.isInteger(masteredAtStart) || masteredAtStart < 0 || masteredAtStart > 259) return null;
  if (!Number.isInteger(bonusHp) || bonusHp < 0 || bonusHp > MAX_BONUS) return null;
  // bonusHp 必须真的是 floor(n/20) 的结果，否则这份「事实」是伪造的。
  if (Math.min(MAX_BONUS, Math.floor(masteredAtStart / INTERVAL)) !== bonusHp) return null;
  return g;
}

// 开局：返回与旧 newRun() 等价的 run（含地图与首层可选节点）
export function createRun(unit, hero, pool, random = Math.random, growth = null) {
  const M = (hero && hero.mod) || {};
  const baseMaxhp = 70 + (M.hp || 0);       // 角色差异：生命上限（成长之前的 base）
  const g = readGrowth(growth);
  const bonus = g ? g.bonusHp : 0;
  const maxhp = baseMaxhp + bonus;         // ★ 成长只在这里加一次，之后本局不再重算
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
    // 本轮学习范围里**已被整词完成**的单元（见 domain/campaign 的
    //   recordRoundUnitComplete）。开局恒为空：到过某个单元、打过 BOSS、跳过节点
    //   都不是完成证据。旧存档 / 旧快照缺它时按「没有完成记录」回落。
    completedUnits: [],
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
    // ★ 本轮「战意·连击里程碑」已达成的阶（docs/feature-combo-milestones.md）。
    //   id → true 的普通对象，**不是 Set**：AGENTS.md 明确不许把 Set 直接 JSON 保存。
    //   ★ 它**跟着快照走**（run-snapshot.js 的可选字段 milestones，合法才写、
    //     缺失回落成空表、脏值整份 fail closed）。早先它只活在内存里，于是
    //     「暂停 → 刷新 → 继续」把整张表清空，每一阶都能再领一次 ——
    //     护盾/生命被上限夹住只是顶满，而提示次数没有上限，那是无限白嫖。
    //   一轮只发一次的原因：护盾跨战斗结转（finishBattleNode 把 B.shield 写回
    //   run.shield），每场都发就是滚雪球。
    milestones: {},
    // ★ 预知残卷（传说遗物）本轮那**唯一一次**全词揭示是否已经用掉。
    //   它必须跟着快照走：不落盘的话「暂停 → 刷新 → 继续」会把它清回 false，
    //   于是每局又能白嫖一次完整答案 —— 和影分身当初的漏洞是同一个形状。
    //   布尔而不是次数：语义就是 1 次，缺字段（老存档/旧快照）回落为未使用。
    prophecyUsed: false,
    // ★ 磨砺石（商店：生命上限 +10 并回满）本轮已经买过几次。
    //   上限是 data/balance.js 的 WHET_MAX_PER_RUN。同样必须落盘 ——
    //   只活在内存里的话，刷新一次就能把买满一轮重新变回 0 次。
    //   0 与「缺失」同义，落盘时两者都不写这个键。
    whetBuys: 0,
    pool: (pool || []).slice(), kills: 0, att: 0, attOk: 0,
    deckHint: 0, history: [], avail: null, node: null,
    done: new Set(),      // 本局已答对的词：不再出现
    wrong: [],            // 答错过的词：下一场优先复习
    bag: { leech: 2 },    // 新手送 2 个吸血獠牙
    // ★ 开局成长事实：合法时才带（脏值一律不写，run.growth 保持 undefined）。
    //   它是**诊断留档**，不是重算入口 —— 恢复路径绝不拿它或当前 DB 重算 maxhp。
    growth: g ? { version: 1, masteredAtStart: g.masteredAtStart,
                  bonusHp: g.bonusHp, baseMaxhp } : undefined,
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
  // 铁血循环（永动电池 + 锻造台）在永动电池之外**额外**回这一份。
  // 电池本身的 +8 留在上面不动 —— 两笔是叠加关系，不是同一笔被改写。
  const floorHeal = floorHealBonus(run.relics);
  if (floorHeal > 0) run.hp = Math.min(run.maxhp, run.hp + floorHeal);
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
  // ★ 轮次编号**只在这里**取，而且取的是「这一轮真正开局之后」的 DB.runs。
  //   不按卡片数量 / wins 猜；恢复路径（restored=true）绝不补填 —— 一个从旧存档
  //   恢复出来的 run 本来就没有「这是第几轮」这个事实。
  //   countedStart 已经是幂等闸门：同轮重复登记 / 恢复都碰不到这一行，编号因此固定。
  run.roundNumber = db.runs;
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

/* ★ 把「本轮完成范围 / 轮次身份」这些**元数据**同步到这一轮**已经存在**的纪念卡上。
 *
 * 它解决的是「打完 BOSS 先拿到卡，之后又把 Unit 2..6 学完」这类顺序：
 *   卡是在结算时发的，而完成范围是在这一局剩下的时间里继续长出来的。
 *   如果只在 endRunProgress 里更新，那这张卡在玩家**结束学习之前**永远是过时的；
 *   玩家在词汇完成检查点按下「结束本轮学习」（明确放弃、不做战败结算），
 *   存档里就永远留下一张「本轮完成单元：尚无」的卡 —— 已学完的事实被丢掉。
 *
 * 三条不能破的边界：
 *  1) **只同步已存在的卡**：找 run.rewardId 或 run.reward 指向的那张，找不到返回
 *     null。它绝不 mint 新卡、绝不动 db.rewards 长度。
 *  2) **不结算**：不碰 run.result / db.wins / db.best，不动卡上 earnedAt 与 id
 *     （那是「什么时候拿到这张卡」的事实，同步不是重新获得）。统计不在这里更新 ——
 *     统计属于一次真实战绩，由 endRunProgress 的 win 分支负责。
 *  3) **不改未知字段**，也不凭空补编号：roundId / roundNumber 只在卡上还没有时补一次，
 *     已有编号的卡绝不改编号（旧卡就是旧卡）。 */
export function syncRoundCard(run, db) {
  if (!run || !db || !Array.isArray(db.rewards)) return null;
  const knownId = (typeof run.rewardId === 'string' && run.rewardId)
    || (run.reward && typeof run.reward.id === 'string' ? run.reward.id : null);
  if (!knownId) return null;                     // 这一轮还没有卡：不凭空 mint
  const card = db.rewards.filter(r => r && r.id === knownId)[0];
  if (!card) return null;                        // ★ 只同步真实存在的卡
  if (!run.reward) run.reward = card;            // 内存侧也认同一张卡，避免再发一张
  if (card.roundId === undefined && typeof run.roundId === 'string' && run.roundId) card.roundId = run.roundId;
  if (card.roundNumber === undefined && typeof run.roundNumber === 'number' && run.roundNumber > 0) {
    card.roundNumber = run.roundNumber;
  }
  const scope = roundCompletion(run);
  const done = Array.isArray(card.completedUnits) ? card.completedUnits.slice() : [];
  for (const u of scope.done) if (done.indexOf(u) < 0) done.push(u);
  done.sort((a, b) => a - b);
  card.completedUnits = done;
  // 只有本轮范围**真的**全部完成时才置 true；曾经完成过之后再跑出去不算取消。
  card.roundComplete = card.roundComplete === true || scope.complete;
  return card;
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
  const knownId = (typeof run.rewardId === 'string' && run.rewardId)
    || (run.reward && typeof run.reward.id === 'string' ? run.reward.id : null);
  const existing = knownId && db && Array.isArray(db.rewards)
    ? db.rewards.filter(r => r && r.id === knownId)[0]
    : null;
  if (win && !run.reward) {
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
  // ★ 一轮**最多一张卡**，但这张卡的内容会随本轮真实进度继续更新。
  //   打完 BOSS 先发卡、之后又把 Unit 2..6 学完（或者反过来先学完词再打 BOSS），
  //   都必须落回**同一张卡**：id 与 earnedAt 固定（它们是「什么时候拿到这张卡」的事实，
  //   第二次结算不是重新获得），completedUnits / roundComplete / 统计按**同一轮**
  //   的最新真实事实更新。绝不因为范围后来完成了就再 push 一张。
  //   战败 / 撤退不会写 card（没有卡就没卡），但不会把以前已获的卡弄掉。
  //   元数据同步走 syncRoundCard：它只动**已有**卡，绝不 mint，所以这里的
  //   「先发卡再同步」不会变成「无卡时凭空发一张」。
  const card = syncRoundCard(run, db);
  if (card && win) {
    // 统计只在真败 BOSS 时更新（那才是一次真实战绩）；卡的面子不被一次败结算拉低。
    card.accuracy = acc; card.kills = run.kills; card.floor = run.maxFloor;
  }
  if (db) db.best = Math.max(db.best, run.maxFloor);
  run.result = !!win;
  return run.reward || null;
}
