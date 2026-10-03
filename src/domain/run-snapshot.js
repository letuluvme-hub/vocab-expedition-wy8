import { validGrowthFact } from './mastery-growth.js';
/* 版本化进度快照：纯编解码，无 DOM / 无存储 / 无全局。
 *
 * 三个不能破的约束：
 *  1) Set 不直接 JSON：G.done 存成数组，回来时必须重新是 Set（drawWord 用
 *     `run.done.has()` 判退休，数组会让「已答对的词」重新出现）。
 *  2) 节点必须保身份：旧版 UI 的判定是 `G.avail.indexOf(n) >= 0`、`G.node === n`
 *     这类**对象身份**比较。只复制值的话，恢复后所有可选节点与当前节点都失配，
 *     地图变成一层都点不动的死局。所以 links 落盘成 nodeID，回来时重新指向 rows 里
 *     同一批对象；avail / cur / node / battle.node 也必须是这些对象本身。
 *  3) 拒绝面 fail closed：非法引用、乱 id、脏数值、不支持的版本号一律不执行。
 *     恢复成「看起来能玩但点一下就崩」的远征，比明确告诉玩家不能恢复更糟。
 *
 * 不落盘的东西（有意为之）：计时器、闭包回调、DOM/innerHTML、keyEls、纯 UI 派生
 * 缓存（availSig 之类）。它们要么无法序列化，要么恢复时重算即可。
 */
import { norm } from './text.js';
import { ADV_LOCK_MS } from './run.js';
import { encodeFoeAttack, decodeFoeAttack } from './foe-attack.js';
import { encodeWordQ, decodeWordQ, encodeQStats, decodeQStats } from './word-quality.js';
import { normalizeWordStreakState, STREAK_STAGE_LIMIT } from './word-streak.js';
/* 逐轮难度（清单 10）：难度事实**可选**，编解码规则全在 domain/round-difficulty.js。
   ★ 编解码绝不剥字段洗白：脏形状是 undefined（=整份 fail closed），不是「修正」过的对象。 */
import { encodeDifficulty, decodeDifficulty } from './round-difficulty.js';
import { comboMilestoneLadder } from './combo-milestones.js';
// 磨砺石的限购上限只有这一份来源（与 foe-attack 读 FOE_ATTACK 同一性质：
// domain 读数据层的**纯常量**，无 DOM / 无状态 / 无存储）。
// 编解码必须知道上限才能把「超出上限的计数」判成脏值 —— 硬编码 2 会让
// 数据层改上限之后，旧存档里那些合法计数突然变成「损坏」。
import { WHET_MAX_PER_RUN } from '../data/balance.js';
import { HERO_BALANCE } from '../data/hero-balance.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;

/* 完整词连胜（docs/feature-word-streak.md）的快照编解码。
 *
 * 编码只写**两个事实**：count（0..8 的整数）与 lastEventId（原样字符串或 null）。
 * 绝不写 UI 状态、utterance 句柄、定时器句柄 —— 那些跨刷新全是死的，写进去
 * 只会让「这份存档长出第二种形状」。缺字段/脏值在解码侧显式回落。
 *
 * ★ 编码侧**绝不**用 normalizeWordStreakState 掩坏：它会把 {count:99} 夹成
 *   {count:8}，让一份内存态已经坏掉的存档**看起来合法**地落盘 —— 玩家凭空
 *   得了满级连胜，而存档本身看不出被动过。脏值一律整份拒绝（见 encodeSnapshot
 *   的原值守卫，与 growth / foeAttack 同一口径）：宁可明确存不下，
 *   也不写一份内容说谎的存档。lastEventId 原样保留（身份按字面，不归一）。
 */
function encodeWordStreak(s) {
  if (s === undefined || s === null) return normalizeWordStreakState(null);
  // 已由 encodeSnapshot 的守卫判过合法：原样拷贝，绝不规范化身份。
  return { count: s.count, lastEventId: s.lastEventId };
}
function decodeWordStreak(s) {
  // 缺失（旧快照）合法 → 0 / null。脏值已被 validRun 整份拒掉，不在这里猜。
  if (s === undefined || s === null) return normalizeWordStreakState(null);
  return normalizeWordStreakState(s);
}
function validWordStreak(s) {
  if (!isObj(s) || Array.isArray(s)) return false;
  if (!isInt(s.count) || s.count < 0 || s.count > STREAK_STAGE_LIMIT) return false;
  // lastEventId 只判**类型**：合法字符串（含控制符、含空格）一律原样保留 ——
  //   本模块从不把它渲染进 DOM（播报通道只走 label），所以不存在 XSS 面，
  //   也不该在这里替父层归一身份（' a ' 与 'a' 是两个不同的事件身份）。
  if (s.lastEventId !== null && typeof s.lastEventId !== 'string') return false;
  return true;
}
/* wordEventSeq：事件身份靠它单调递增，所以必须是**安全整数**且非负。
   ★ 只查 isInt 不够：1e21 通过 Number.isInteger，而 `++1e21 === 1e21` ——
     事件身份从此永久重复，域层的单槽去重会把之后每一次真实完成都误判成
     「重复投递」，连胜彻底卡死。
   ★ 上界刻意留一格（MAX_SAFE_INTEGER - 1）：正好卡在 MAX_SAFE_INTEGER 上的
     存档，其下一次 ++ 就会溢出成同一个值。宁可这一局明确存不下，
     也不写一份「下一次必然重复身份」的存档。publisher 侧另有明确降级
     （runtime 的 wordEventId 到顶就换身份，绝不重复 token）。 */
const WORD_EVENT_SEQ_MAX = Number.MAX_SAFE_INTEGER - 1;
const validWordEventSeq = v => Number.isSafeInteger(v) && v >= 0 && v <= WORD_EVENT_SEQ_MAX;

export const PHASE = {
  MAP: 'map',                 // 地图上等玩家选节点
  BATTLE: 'battle',           // 战斗中（可能已拼了一半）
  REWARD: 'reward',           // 战斗已赢，奖励卡已展开、尚未领取
  ENCOUNTER: 'encounter',     // 事件/营火/商店已展开、尚未选择
  ENCOUNTER_DONE: 'encounter-done',   // 选择已生效、等待推进到下一层
  // 结算已发生（BOSS 奖励已发 / 已判负），但 endRun 还没跑：run.result 仍是
  // undefined。这是「已经赢了或输了，却还没记账」的窗口，必须能被快照带走 ——
  // 少存这一相，刷新就会让玩家重打一场已经结束的战斗。
  // outcome 是本相位唯一的额外事实：true 赢、false 输。
  // ★ 反过来，run.result 一旦是布尔就说明 endRun 已经跑过：那时的正确做法
  //   是删掉快照（encodeSnapshot 返回 null），而不是存一份等着重发奖励。
  ENDING: 'ending',
  // 本单元词汇已全部完成（词池抽干），但战斗还没打完。
  // ★ 这**不是**通关：怪物血还在、kills 不加、wins 不加、run.result 仍是
  //   undefined。带上 battle 是为了把 B.myHp / B.shield / B.enHp 原样带回来 ——
  //   「怪物还剩多少血」是这个屏必须如实说出的事实，不能在刷新后凭空重算。
  //   恢复时它只重建这个检查点屏，绝不重发奖励、绝不重新抽词。
  LEARNING_COMPLETE: 'learning-complete',
};

const PHASES = new Set(Object.values(PHASE));

/* 节点身份：row + 量化后的 x。同层同 x 的兄弟节点在生成器里不存在，
   量化取 1e6 足以区分 (c+0.5)/cnt 的不同取值。 */
export function nodeId(node) {
  if (!node || typeof node.row !== 'number' || typeof node.x !== 'number') return null;
  return 'r' + node.row + '_x' + Math.round(node.x * 1e6);
}

/* ---------------- 小工具：校验一律 fail closed ---------------- */
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isInt = v => isNum(v) && Number.isInteger(v);
const isStr = v => typeof v === 'string' && v.length > 0;
const isBool = v => v === true || v === false;
const num = (v, min, max) => (isNum(v) && v >= min && v <= max);
/* 提示次数：先知卡是布尔 true，其余是次数。缺省归 0（未持有），但 true 必须原样留。 */
const encodeHint = v => (v === true ? true : (isNum(v) && v >= 0 ? v : 0));
/* 解码侧只做形状判定：合法形状是 true 或非负数字。不在这里改写数值。 */
const validHint = v => v === true || (isNum(v) && v >= 0);
const strArr = v => Array.isArray(v) && v.every(isStr);
/* letters 里混入 null / 数字 / undefined 时这里不能顺着读 .length —— 旧写法
   `ch.length === 1` 会在解码器里抛 TypeError，而解码器跑在主页加载路径上。 */
const letter = ch => typeof ch === 'string' && ch.length === 1 && ch >= 'a' && ch <= 'z';

/* ---------------- 编码 ---------------- */
function encodeRows(rows) {
  return rows.map(row => row.map(n => ({
    id: nodeId(n), type: n.type, x: n.x, row: n.row,
    done: !!n.done, links: (n.links || []).map(nodeId),
  })));
}
/* 教材词都有 th（音标/主题），自定义词可能没有 —— undefined 是合法值，
   不许在编解码时凭空补一个，也不许把它变成字符串以外的形状。 */
function encodeWord(w) {
  return { w: w.w, u: w.u, d: w.d, z: w.z, th: w.th };
}
/* campaign：单元解锁主线（docs/feature-campaign.md）。startedUnit = 这一轮从哪个
 * 单元开始（跨单元过渡时不变），segments = 这一轮走过几段学习地图（不是次数）。
 * 旧快照没有这个字段：解码时按 r.unit 保守回落，绝不凭空改成别的单元。 */
/* 本轮完成范围（docs/feature-rounds.md）。合法值是 0..6 的单元号（0 = 自定义词表）：
 *   编码侧去重 + 排序（跨刷新后顺序不该漂移）；脏项直接丢掉而不是原样发布 ——
 *   快照是外部输入，run 上的字段可能已经被改坏。
 *   缺失 / 空数组都是合法形状（这一轮还没有任何整词完成的证据）。 */
function encodeCompletedUnits(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  for (const u of list) {
    if (isInt(u) && u >= 0 && u <= 6) seen.add(u);
  }
  return Array.from(seen).sort((a, b) => a - b);
}
function decodeCompletedUnits(list) {
  // 形状已在 validRun 里 fail closed 过；这里只做去重（存档里出现重复不算损坏）。
  return Array.from(new Set(list)).sort((a, b) => a - b);
}

function encodeCampaign(c, unit) {
  if (!isObj(c)) return { startedUnit: unit, segments: 1 };
  return {
    startedUnit: isInt(c.startedUnit) && c.startedUnit > 0 ? c.startedUnit : unit,
    segments: isInt(c.segments) && c.segments > 0 ? c.segments : 1,
  };
}
/* growth（docs/feature-mastery-growth.md）：**可选**的开局成长事实。
 *   旧快照完全没有它 —— 那是合法形状，解码后保持 undefined，绝不补填成 +0
 *   （补一个 0 会让「这一局从来没有成长加成」与「加成是 0」再也分不开）。
 *   一旦出现就必须形状合法，且 bonusHp 必须与 masteredAtStart 自洽：
 *   存档是外部输入，伪造的成长值会让玩家凭空拿到 +12 上限。
 *   ★ 绝不用 baseMaxhp 反推 maxhp：进本局之后 maxhp 可能被别的合法途径抬高
 *   （遗物等），强行相等会把一份合法存档判成损坏。 */
const GROWTH_MAX = 12, GROWTH_INTERVAL = 20;
function encodeGrowth(g) {
  if (!isObj(g) || !validGrowthFact(g)) return undefined;
  if (!isInt(g.masteredAtStart) || g.masteredAtStart < 0 || g.masteredAtStart > 259) return undefined;
  if (!isInt(g.bonusHp) || g.bonusHp < 0 || g.bonusHp > GROWTH_MAX) return undefined;
  if (Math.min(GROWTH_MAX, Math.floor(g.masteredAtStart / GROWTH_INTERVAL)) !== g.bonusHp) return undefined;
  if (!isNum(g.baseMaxhp) || g.baseMaxhp < 1 || g.baseMaxhp > 9999) return undefined;
  return { version: g.version, masteredAtStart: g.masteredAtStart, bonusHp: g.bonusHp, baseMaxhp: g.baseMaxhp, ...(g.version === 2 ? {bonusAttackPct:g.bonusAttackPct} : {}) };
}
function validGrowth(g) {
  return encodeGrowth(g) !== undefined;
}

/* milestones（docs/feature-combo-milestones.md）：**可选**的一轮事实 ——
 *   「战意·连击里程碑」这一轮哪些阶已经发过（`id → true`）。
 *
 * ★ 它必须落盘。不落盘时「暂停 → 刷新 → 继续」会把整张表清空，接线层按
 *   「本轮一阶都没发过」重新发一遍：护盾/生命被生命上限夹住，最坏只是顶满（无害），
 *   而 **B.hints 没有任何上限** —— 那是可以无限白嫖的实质性漏洞。
 *
 * 合法形状是**普通对象**（不是 Set：AGENTS.md 不许把 Set 直接 JSON 保存），
 * 每一项都必须是 `true`，键必须是规则层**校验过的**阶梯里真实存在的 id。
 * ★ 形状与内存态逐字段相同，所以恢复出来的 run.milestones 可以直接交给
 *   app/combat.js 与战意条 —— 接线层与展示层一行都不用改，也不会长出第二种形状。
 *
 * ★ id 取自 comboMilestoneLadder()（门槛严格递增的那一段前缀）而不是数据层原表：
 *   数据漂移时宁可少认几个 id，也不把没登记的键原样带进游戏状态。
 *   编码侧按阶梯顺序重建，键序固定 → JSON 往返前后字节一致，存档 diff / deepEqual 都稳。
 */
const MILESTONE_LADDER = comboMilestoneLadder();
const MILESTONE_IDS = new Set(MILESTONE_LADDER.map(m => m.id));
function validMilestones(m) {
  if (!isObj(m)) return false;
  return Object.keys(m).every(k => MILESTONE_IDS.has(k) && m[k] === true);
}
function encodeMilestones(m) {
  if (!validMilestones(m)) return undefined;
  const out = {};
  for (const step of MILESTONE_LADDER) if (m[step.id] === true) out[step.id] = true;
  return out;
}

/* prophecyUsed / whetBuys：两个**可选**的一轮事实，形状都是「默认值与缺失同义」。
 *
 *   prophecyUsed —— 预知残卷（传说）本轮那唯一一次全词揭示是否已经用掉。
 *   whetBuys     —— 商店的磨砺石（生命上限 +10）本轮已经买过几次，上限 WHET_MAX_PER_RUN。
 *
 * 两者都必须落盘的理由是同一条：只活在内存里时，「暂停 → 刷新 → 继续」会把它们
 * 清回初始值 —— 前者变成每局白嫖一次完整答案，后者变成无限买生命上限。
 *
 * 默认值与缺失同义，所以 false / 0 两种默认值都**不写这个键**（与 milestones 的
 * 空表口径一致）：旧存档里根本没有这两个键，写与不写必须产生同样的一份 JSON，
 * 否则「解码 → 再编码」的深比较会恒假。
 *
 * 脏值一律 fail closed（返回 false / undefined 让调用方拒绝整份快照）：
 * 把「读不懂」当成「还没用 / 还没买」会给玩家白送额度，方向搞反了。 */
function validProphecyUsed(v) {
  return v === true || v === false;
}
function encodeProphecyUsed(v) {
  if (!validProphecyUsed(v)) return undefined;
  return v ? true : undefined;               // false 与「缺失」同义 → 不写键
}
function validWhetBuys(v) {
  return isInt(v) && v >= 0 && v <= WHET_MAX_PER_RUN;
}
function encodeWhetBuys(v) {
  if (!validWhetBuys(v)) return undefined;
  return v > 0 ? v : undefined;              // 0 与「缺失」同义 → 不写键
}

function encodeRun(run) {
  // rewardId（可缺）：本轮纪念卡的 id。没有它就无法跨刷新认出同一张卡。
  //   旧内存态（卡在内存里但字段还没有）从 reward.id 取，绝不凭空造一个。
  const rewardId = (typeof run.rewardId === 'string' && run.rewardId)
    || (run.reward && typeof run.reward.id === 'string' ? run.reward.id : '');
  const out = {
    unit: run.unit, id: run.id,
    // roundId / roundNumber / completedUnits 是**可选**的一组新字段（docs/feature-rounds.md）：
    //   roundId      —— 持久轮次身份（crypto.randomUUID，由 runtime 注入）。空串 = 没有。
    //   roundNumber  —— 真正开局之后从 DB.runs 取的轮次编号。0 = 没有（旧 run / 旧快照）。
    //   completedUnits —— 本轮**整词完成**的单元。到过某个单元、打过 BOSS 都不算。
    roundId: (typeof run.roundId === 'string' && run.roundId) ? run.roundId : '',
    roundNumber: (isInt(run.roundNumber) && run.roundNumber > 0) ? run.roundNumber : 0,
    completedUnits: encodeCompletedUnits(run.completedUnits),
    // ★ 完整词连胜（可选新字段，docs/feature-word-streak.md）：
    //   wordStreak  = {count,lastEventId}，只序列化**事实**，绝不带上
    //                 UI 状态 / utterance 句柄 / 定时器句柄（那些跨刷新全是死的）。
    //   wordEventSeq = run 级自增事件序号（整词完成或真实打错 +1），快照缺省 0。
    //   两个键**总是**写出来（缺字段回落成 0 / 空身份），这样内存信封与
    //   JSON 往返后的信封形状永远一致。
    wordStreak: encodeWordStreak(run.wordStreak),
    wordEventSeq: (run.wordEventSeq === undefined || run.wordEventSeq === null) ? 0 : run.wordEventSeq,
    campaign: encodeCampaign(run.campaign, run.unit),
    countedStart: !!run.countedStart, clearedRun: !!run.clearedRun,
    // clearedSegment（可缺）：旧 run 没有就按 clearedRun 保守回落 —— 宁可少结算一次，
    //   也不因为缺字段给同一段发两次回血。新段重建后的 false 必须原样落盘。
    clearedSegment: typeof run.clearedSegment === 'boolean' ? run.clearedSegment : !!run.clearedRun,
    rewardId,
    hp: run.hp, maxhp: run.maxhp, shield: run.shield, gold: run.gold,
    floor: run.floor, maxFloor: run.maxFloor,
    relics: (run.relics || []).slice(), skipFree: !!run.skipFree, ghostUsed: !!run.ghostUsed,
    heroId: run.heroId, hm: run.hm, hnoise: run.hnoise, hcombo: run.hcombo,
    hregen: run.hregen, hleech: run.hleech,
    kills: run.kills, att: run.att, attOk: run.attOk, deckHint: run.deckHint,
    // nextHint 有两个合法形状：先知卡写的 true，和水壶/卷轴累加的数字。
    // `|| 0` 会把 undefined/false 归零（对），但也说明这里不能顺手把 true
    // 变成 1 —— 那是篡改 runtime 里的提示次数。true 原样落盘。
    shieldGiven: !!run.shieldGiven, nextHint: encodeHint(run.nextHint), shopHints: run.shopHints || 0,
    pool: (run.pool || []).map(encodeWord),
    done: Array.from(run.done || []),          // Set → 数组
    wrong: (run.wrong || []).slice(),
    // run.history 在真实代码里始终是数组（domain/run.js 建局时置 []，
    // 只被追加数字），这里只做「数组就拷贝、非数组就落空」的净化，不加工内容。
    history: Array.isArray(run.history) ? run.history.slice() : [],
    bag: Object.assign({}, run.bag),
    rows: encodeRows(run.rows || []),
    avail: (run.avail || []).map(nodeId),
    cur: nodeId(run.cur), node: nodeId(run.node),
  };
  // growth 是**可选**字段：合法时才写这个键，缺失时**整个键都不出现**
  // （写成 undefined 经 JSON.stringify 后也会消失，但内存态与落盘态会长出
  //   两个形状，深比较会因此恒假 —— 与 outcome 字段同一处理口径）。
  const growth = encodeGrowth(run.growth);
  if (growth) out.growth = growth;
  // difficulty（清单 10）同样是**可选**：合法才写，缺失（旧 run / 旧快照）
  //   整个键都不出现，解码后保持 undefined —— 由调用方按**基线**处理，
  //   绝不按当前 DB.runs 重算（否则刷新一次就给老玩家凭空升一档）。
  //   脏形状不写：内存态自己解不开时宁可整份快照都不写（见 encodeSnapshot）。
  const difficulty = encodeDifficulty(run.difficulty);
  if (difficulty) out.difficulty = difficulty;
  // milestones 同样可选，但比 growth 多一条：**空表与缺失语义相同**（「这一轮
  //   一阶都没发过」），所以两者都不写这个键。写成 undefined 经 JSON.stringify
  //   后虽然也会消失，但内存态与落盘态会长出两个形状，深比较恒假 ——
  //   与 growth / outcome 字段同一处理口径。
  const milestones = encodeMilestones(run.milestones);
  if (milestones && Object.keys(milestones).length) out.milestones = milestones;
  // prophecyUsed / whetBuys 同属「默认值与缺失同义」的可选字段：
  //   false / 0 都不写键，写了反而让「解码→再编码」与旧存档对不上。
  const prophecyUsed = encodeProphecyUsed(run.prophecyUsed);
  if (prophecyUsed) out.prophecyUsed = prophecyUsed;
  const whetBuys = encodeWhetBuys(run.whetBuys);
  if (whetBuys !== undefined) out.whetBuys = whetBuys;
  const qStats = encodeQStats(run.qStats);
  if (qStats) out.qStats = qStats;
  return out;
}
// Optional balance facts prevent refresh from replenishing earned-letter rewards
// or per-battle hero budgets. Missing fields remain valid for pre-balance saves.
function validBalanceFacts(b) {
  if (b.letterProgress !== undefined && (!Number.isSafeInteger(b.letterProgress)
    || b.letterProgress < (b.input || []).length || b.letterProgress > norm(b.word.w).length)) return false;
  for (const [key, max] of [['heroHealed', HERO_BALANCE.rangerBattleHealCap], ['heroShieldGained', HERO_BALANCE.warriorBattleShieldCap]]) {
    if (b[key] !== undefined && (!Number.isSafeInteger(b[key]) || b[key] < 0 || b[key] > max)) return false;
  }
  return true;
}
function copyBalanceFacts(from, to) {
  for (const key of ['letterProgress', 'heroHealed', 'heroShieldGained']) {
    if (from[key] !== undefined) to[key] = from[key];
  }
}
function encodeBattle(b) {
  const out = {
    word: encodeWord(b.word), letters: b.letters.slice(),
    used: b.used.slice(), bad: b.bad.slice(),
    myHp: b.myHp, enHp: b.enHp, enMax: b.enMax, shield: b.shield,
    input: b.input.slice(), sel: b.sel,
    hints: b.hints, hintUsed: b.hintUsed, hintTotal: b.hintTotal,
    combo: b.combo, maxCombo: b.maxCombo, dmgBonus: b.dmgBonus,
    firstWrong: !!b.firstWrong, lethUsed: b.lethUsed,
    wordsDone: b.wordsDone, over: !!b.over, won: !!b.won,
    mistaken: (b.mistaken || []).slice(), wordStreak: b.wordStreak,
    rageLeft: b.rageLeft, freezeWord: !!b.freezeWord, chainNext: !!b.chainNext,
    goldMult: b.goldMult, usedThisFight: Object.assign({}, b.usedThisFight),
    boss: !!b.boss, elite: !!b.elite,
    foe: { n: b.foe.n, ic: b.foe.ic, tint: b.foe.tint },
    node: nodeId(b.node),
    finished: !!b.finished, rewardTaken: !!b.rewardTaken,
  };
  // foeAttack（清单 13）：**可选**事实。旧快照完全没有它 —— 那是合法形状，
  //   编码时整个键都不出现（而不是写 undefined：那会让内存态与 JSON 往返态
  //   长出两个形状，deepEqual 恒假）。合法时才写，脏值时写 undefined（=不写），
  //   绝不把「认不出来」伪装成「没有攻击状态」。 */
  const foeAttack = encodeFoeAttack(b.foeAttack);
  if (foeAttack) out.foeAttack = foeAttack;
  const wordQ = encodeWordQ(b.wordQ);
  if (wordQ) out.wordQ = wordQ;
  // 选词出招（docs/feature-word-choice.md）：候选与开场自动揭示数都是**可选**事实。
  //   没有候选（旧战斗 / 词池只剩一个词）时整个键不出现，与 foeAttack 同一口径。
  if (Array.isArray(b.offer) && b.offer.length) out.offer = b.offer.map(encodeWord);
  if (Number.isInteger(b.autoHint) && b.autoHint > 0) out.autoHint = b.autoHint;
  if (b.wordLocked === true) out.wordLocked = true;
  copyBalanceFacts(b, out);
  return out;
}
function encodeEncounter(e) {
  if (!e) return null;
  // ★ title/text/icon 不是装饰：encounters.js 恢复事件屏靠
  //   `EVENTS.filter(x => x.t === desc.title)` 找回**原来的选项对象**（含 fn）。
  //   编码漏掉 title，恢复后 optionById 一张卡都映射不出来，事件屏变空屏。
  return {
    kind: e.kind, gold: e.gold, unfinished: e.unfinished,
    title: e.title, text: e.text, icon: e.icon,
    chosenId: e.chosenId, nodeId: nodeId(e.node),
    options: (e.options || []).map(o => ({
      id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d, tip: o.tip, leave: !!o.leave,
    })),
  };
}

/* 组一份可 JSON 化的信封。now 注入是为了测试时固定 savedAt。 */
/* 组一份可 JSON 化的信封。now 注入是为了测试时固定 savedAt。
 *
 * 返回 null 是**合法契约**，不是失败：run.result 是布尔说明 endRun 已经跑过，
 * 这一局不该再有快照 —— 调用方据此走一次 clear。否则存档里躺着一份已结算的
 * 远征，恢复后会对着 battle.over 再走一遍结算，白白发第二次奖励。
 *
 * ★ 调用方必须处理这个 null（本仓库 app 层用的是 save()/pause() 那侧的守卫）。
 */
export function encodeSnapshot(env, { now = Date.now() } = {}) {
  const run = env && env.run;
  if (!run || typeof run.result === 'boolean') return null;
  if (run.growth !== undefined && run.growth !== null && !validGrowth(run.growth)) return null;
  // difficulty（清单 10）同理：内存态有一份解不开的难度事实时**不写整份快照**，
  //   而不是写一份缺了难度的 —— 那会让玩家刷新回来发现怪物忽然变回基线档，
  //   而存档里看不出发生过什么。
  if (run.difficulty !== undefined && run.difficulty !== null && encodeDifficulty(run.difficulty) === undefined) return null;
  // milestones 脏值同理：内存态自己解不开时**不写整份快照**。照 growth 的口径 ——
  //   如果还硬写一份「没有里程碑」的快照，恢复后接线层会把整张表当成空的，
  //   于是每一阶都能再领一次（提示次数没有上限 = 无限白嫖）。
  //   **把「认不出来」伪装成「还没发过」正是这个漏洞本身**，所以宁可明确存不下。
  //   缺失 / null / 空表 {} 都是合法形状（这一轮确实一阶都没发过），不拦。
  if (run.milestones !== undefined && run.milestones !== null
    && encodeMilestones(run.milestones) === undefined) return null;
  // prophecyUsed / whetBuys 同理，但判据必须用 valid* 而不是 encode* ——
  //   这两个 encode 对「非法」和「默认值（false / 0）」都返回 undefined，
  //   用 `encodeX(x) === undefined` 会把一份正常的「还没用 / 还没买过」
  //   当成脏值，于是每一局远征都存不下快照。默认值与缺失同义，不是损坏。
  if (run.prophecyUsed !== undefined && run.prophecyUsed !== null
    && !validProphecyUsed(run.prophecyUsed)) return null;
  if (run.whetBuys !== undefined && run.whetBuys !== null
    && !validWhetBuys(run.whetBuys)) return null;
  // foeAttack 脏值同理：内存态自己解不开时**不写整份快照**（而不是写一份缺了
  //   攻击事实的快照）。缺了它看着能恢复，实际是把「蓄力还剩多久」丢掉 ——
  //   玩家会发现刷新后攻击时机凭空变了，这比明确存不下更糟。
  if (env.battle && env.battle.foeAttack !== undefined && env.battle.foeAttack !== null
    && encodeFoeAttack(env.battle.foeAttack) === undefined) return null;
  // Optional P0 facts follow foeAttack: dirty present values reject the whole snapshot.
  if (run.qStats != null && encodeQStats(run.qStats) === undefined) return null;
  if (env.battle && env.battle.wordQ != null && encodeWordQ(env.battle.wordQ) === undefined) return null;
  if (env.battle && !validBalanceFacts(env.battle)) return null;
  // 完整词连胜同样**按原值** fail closed（与 growth / foeAttack 同一口径）：
  //   绝不 normalize 掩坏 —— {count:99} 被夹成 {count:8} 会让存档看起来正常，
  //   却凭空记了一个满级连胜；1e21 这类不安全序号会让 ++ 之后身份永久重复。
  //   内存态解不开时明确「这一局存不下」，比写一份内容说谎的存档诚实。
  if (run.wordStreak !== undefined && run.wordStreak !== null
    && !validWordStreak(run.wordStreak)) return null;
  if (run.wordEventSeq !== undefined && run.wordEventSeq !== null
    && !validWordEventSeq(run.wordEventSeq)) return null;
  const savedAt = isStr(env && env.savedAt) ? env.savedAt : new Date(now).toISOString();
  const envelope = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    savedAt,
    phase: env.phase,
    run: encodeRun(run),
    battle: env.battle ? encodeBattle(env.battle) : null,
    encounter: encodeEncounter(env.encounter),
  };
  // outcome 只在 ENDING 相位存在。其它相位**完全不写这个键**（而不是写
  // undefined）—— 否则内存里的信封与 JSON 往返后的信封 deepEqual 不相等，
  // 「同一份存档」在测试和实际落盘之间会长出两个形状。
  if (env.phase === PHASE.ENDING) envelope.outcome = env.outcome;
  return envelope;
}

/* ---------------- 解码：先整份拒掉，再逐层还原 ---------------- */
const bad = reason => ({ ok: false, reason });

function validRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return false;
  const seen = new Set();
  for (const row of rows) {
    if (!Array.isArray(row)) return false;
    for (const n of row) {
      if (!isObj(n) || !isStr(n.id) || !isStr(n.type)) return false;
      if (!isNum(n.x) || !isInt(n.row) || !isBool(n.done)) return false;
      if (!Array.isArray(n.links) || n.links.some(l => !isStr(l))) return false;
      if (seen.has(n.id)) return false;          // nodeID 必须唯一
      seen.add(n.id);
    }
  }
  return true;
}
function validRun(r) {
  if (!isObj(r)) return false;
  if (!isInt(r.unit) || !isStr(r.heroId)) return false;
  // id 只是诊断标识，decode 侧会在缺失时补一个；脏类型不许进存档。
  if (r.id !== undefined && r.id !== null && typeof r.id !== 'string') return false;
  if (!num(r.hp, 0, r.maxhp) || !num(r.maxhp, 1, 9999)) return false;
  if (!num(r.shield, 0, r.maxhp)) return false;
  if (!isInt(r.gold) || r.gold < 0) return false;
  if (!isInt(r.floor) || r.floor < 1 || !isInt(r.maxFloor) || r.maxFloor < 1) return false;
  if (!Array.isArray(r.relics) || r.relics.some(x => !isStr(x))) return false;
  if (!isBool(r.skipFree) || !isBool(r.ghostUsed)) return false;
  if (![r.hm, r.hnoise, r.hregen, r.hleech, r.kills, r.att, r.attOk, r.deckHint].every(isNum)) return false;
  if (!num(r.hcombo, 0, 100) || r.attOk < 0 || r.attOk > r.att + 1e9) return false;
  if (!isBool(r.countedStart) || !isBool(r.clearedRun) || !isBool(r.shieldGiven)) return false;
  // clearedSegment / rewardId 都是**可选**的新字段：缺失合法（旧快照），
  // 但一旦出现就必须是合法形状 —— 出现 1 / 'yes' / 对象这类脏值时 fail closed，
  // 绝不让「半恢复」的 run 去结算 BOSS 或发纪念卡。
  if (r.clearedSegment !== undefined && r.clearedSegment !== null && !isBool(r.clearedSegment)) return false;
  // 空串是编码侧的「还没有卡」表示，合法；非字符串（数字/对象/布尔）才是脏值。
  if (r.rewardId !== undefined && r.rewardId !== null && typeof r.rewardId !== 'string') return false;
  // 轮次字段同样可选：旧快照完全没有它们是合法的（解码后保持 undefined，绝不补填）。
  // 一旦出现就必须形状合法 —— 「有编号但不是整数」这类脏值整份 fail closed。
  if (r.roundId !== undefined && r.roundId !== null && typeof r.roundId !== 'string') return false;
  if (r.roundNumber !== undefined && r.roundNumber !== null
    && !(isInt(r.roundNumber) && r.roundNumber >= 0)) return false;
  if (r.completedUnits !== undefined && r.completedUnits !== null) {
    if (!Array.isArray(r.completedUnits)) return false;
    if (r.completedUnits.some(u => !isInt(u) || u < 0 || u > 6)) return false;
  }
  // growth 同样可选：缺失合法（旧快照），出现就必须合法形状 —— 脏值整份 fail closed，
  // 绝不静默改成 +0（那会让玩家凭空/莫名丢掉一次上限，且看不出存档被人动过）。
  if (r.growth !== undefined && r.growth !== null && !validGrowth(r.growth)) return false;
// wordStreak / wordEventSeq 同样可选：旧快照完全没有它们是合法的（解码后
  // 回落成 0）。一旦出现就必须形状合法 —— 「count 是字符串」「序号是负数」
  // 这类脏值整份 fail closed，绝不静默夹成 0（那会凭空抹掉玩家真实的连胜）。
  if (r.wordStreak !== undefined && r.wordStreak !== null && !validWordStreak(r.wordStreak)) return false;
  if (r.wordEventSeq !== undefined && r.wordEventSeq !== null && !validWordEventSeq(r.wordEventSeq)) return false;
  // difficulty（清单 10）同样可选：缺失合法（旧快照），一旦出现就必须完整合法 ——
  //   脏值或「与 roundAtStart 不相容的倍率」整份 fail closed，绝不静默丢成
  //   undefined：那会让一份难度已被改坏的存档看起来能恢复，而玩家会发现怪物
  //   忽然变回基线档，没人说得清发生了什么。
  if (r.difficulty !== undefined && r.difficulty !== null && decodeDifficulty(r.difficulty) === undefined) return false;
  // milestones 同样可选：缺失合法（旧快照，解码回落成空表），出现就必须每一项都合法。
  //   脏值整份 fail closed —— 绝不静默当成「本轮一阶都没发过」：静默丢弃一张
  //   被改坏的「已发放」表，等于把每一阶奖励都退回成可再领一次的状态。
  if (r.milestones !== undefined && r.milestones !== null && !validMilestones(r.milestones)) return false;
  // prophecyUsed / whetBuys 同样可选：缺失合法（旧快照），出现就必须合法形状。
  if (r.prophecyUsed !== undefined && r.prophecyUsed !== null && !validProphecyUsed(r.prophecyUsed)) return false;
  if (r.whetBuys !== undefined && r.whetBuys !== null && !validWhetBuys(r.whetBuys)) return false;
  if (r.qStats != null && encodeQStats(r.qStats) === undefined) return false;
  if (!Array.isArray(r.pool) || !r.pool.length) return false;
  // th：教材词都有，自定义词允许缺失（undefined）；出现对象/数字是损坏。
  if (r.pool.some(w => !isObj(w) || !isStr(w.w) || !isInt(w.u) || !isInt(w.d) || !isStr(w.z)
    || (w.th !== undefined && w.th !== null && typeof w.th !== 'string'))) return false;
  if (!Array.isArray(r.done) || r.done.some(w => !isStr(w))) return false;
  if (new Set(r.done).size !== r.done.length) return false;   // 重复退休项 = 损坏
  if (!strArr(r.wrong)) return false;
  if (!isObj(r.bag) || Object.values(r.bag).some(v => !isInt(v) || v < 0)) return false;
  if (!validHint(r.nextHint) || !isNum(r.shopHints) || r.shopHints < 0) return false;
  // history 是「纯数字序列」（真实代码里只被追加计数）。只校验形状，不设上限：
  // 真实一局的长度由玩家推进决定，凭空加地板/上限会误拒合法存档。
  if (!Array.isArray(r.history) || r.history.some(h => !isNum(h))) return false;
  if (!validRows(r.rows)) return false;
  if (!Array.isArray(r.avail) || r.avail.some(id => !isStr(id))) return false;
  return true;
}
/* 还原 rows 并按 nodeID 重新接线；随后所有引用都必须能解析到 rows 里的对象。 */
function rebuildRows(rows) {
  const byId = new Map();
  for (const row of rows) for (const n of row) {
    byId.set(n.id, { type: n.type, x: n.x, row: n.row, done: n.done, links: [] });
  }
  for (const row of rows) for (const n of row) {
    const target = byId.get(n.id);
    for (const id of n.links) {
      const next = byId.get(id);
      if (!next) return null;                    // 乱 id：整份拒绝
      target.links.push(next);
    }
  }
  return byId;
}
function decodeRun(r, byId) {
  const ref = id => (id === null || id === undefined ? null : byId.get(id) || undefined);
  const run = {
    unit: r.unit, id: isStr(r.id) ? r.id : 'R-restored',
    // 轮次身份/编号：0 与空串都是「没有」→ undefined，绝不从 DB.runs 之类的别处补。
    roundId: isStr(r.roundId) ? r.roundId : undefined,
    roundNumber: (isInt(r.roundNumber) && r.roundNumber > 0) ? r.roundNumber : undefined,
    completedUnits: Array.isArray(r.completedUnits) ? decodeCompletedUnits(r.completedUnits) : [],
    countedStart: r.countedStart, clearedRun: r.clearedRun,
    // clearedSegment：旧快照缺这个字段 → 保守按 clearedRun 回落（宁可少结算一次）。
    clearedSegment: isBool(r.clearedSegment) ? r.clearedSegment : !!r.clearedRun,
    // rewardId：空串等价于「还没有纪念卡」，不写 undefined（内存里用 undefined 判定）。
    rewardId: isStr(r.rewardId) ? r.rewardId : undefined,
    // growth：缺失就是 undefined（旧快照），**绝不由当前 DB 或 mastered 现算补填** ——
    //   恢复必须原样尊重盘上的 maxhp，否则「中途退出重进」会白赚一次上限。
    growth: encodeGrowth(r.growth),
// 旧快照缺这两个字段 → 规范回落（0 / 空身份），绝不从当前 DB 现算。
    wordStreak: decodeWordStreak(r.wordStreak),
    wordEventSeq: validWordEventSeq(r.wordEventSeq) ? r.wordEventSeq : 0,
    qStats: decodeQStats(r.qStats),
    // difficulty（清单 10）：同样**绝不**由当前 DB.runs 或 r.roundNumber 现算补填 ——
    //   缺键就是旧存档，按基线跑完全程，绝不因为刷新一次就凭空升一档。
    difficulty: decodeDifficulty(r.difficulty),
    // milestones：缺失（旧快照）/ null 回落成**空表**，而不是 undefined ——
    //   接线层与战意条都直接读这个字段，空表是「本轮一阶都没发过」唯一诚实的表示，
    //   undefined 只会把判空的责任推给每一个读者（而且 UI 一旦漏判就上屏 undefined）。
    //   ★ 绝不按当前阶梯现算补填：补出来的 id 是「这一局发过」，不是「盘上写着发过」。
    //   形状已在 validRun 里 fail closed 过，这里只做按阶梯顺序的规范化重建。
    milestones: encodeMilestones(r.milestones) || {},
    // prophecyUsed / whetBuys：缺失（旧快照）/ null 都回落成**默认值**，
    //   而不是 undefined —— 接线层（combat 的 prophecyReveal、商店的 buyWhetstone）
    //   直接读这两个字段，拿到 undefined 会让 `| 0` 之外的地方出现「NaN 次」。
    //   默认值就是「还没用 / 还没买过」，旧存档因此照常可玩。
    prophecyUsed: r.prophecyUsed === true,
    whetBuys: validWhetBuys(r.whetBuys) ? r.whetBuys : 0,
    hp: r.hp, maxhp: r.maxhp, shield: r.shield, gold: r.gold,
    floor: r.floor, maxFloor: r.maxFloor,
    relics: r.relics.slice(), skipFree: r.skipFree, ghostUsed: r.ghostUsed,
    heroId: r.heroId, hm: r.hm, hnoise: r.hnoise, hcombo: r.hcombo,
    hregen: r.hregen, hleech: r.hleech,
    kills: r.kills, att: r.att, attOk: r.attOk, deckHint: r.deckHint,
    shieldGiven: r.shieldGiven, nextHint: r.nextHint, shopHints: r.shopHints,
    pool: r.pool.map(w => ({ w: w.w, u: w.u, d: w.d, z: w.z, th: w.th })),
    done: new Set(r.done),                      // 数组 → Set
    wrong: r.wrong.slice(), history: r.history.slice(),   // 形状已在 validRun 里定死
    bag: Object.assign({}, r.bag),
    rows: [], avail: [], cur: null, node: null,
    advAt: 0,                                    // 400ms 双击去重窗口不跨刷新继承
  };
  for (const row of r.rows) run.rows.push(row.map(n => byId.get(n.id)));
  for (const id of r.avail) {
    const n = byId.get(id);
    if (!n) return null;                         // 可选节点乱指 = 死局
    run.avail.push(n);
  }
  if (r.cur !== null && r.cur !== undefined) {
    run.cur = ref(r.cur);
    if (run.cur === undefined) return null;
  }
  if (r.node !== null && r.node !== undefined) {
    run.node = ref(r.node);
    if (run.node === undefined) return null;
  }
  // campaign 是**可选**字段：旧快照没有它，脏数据也只回落成 {startedUnit: unit, segments: 1}。
  // 它不参与任何引用校验，所以缺字段/脏值都不该把正在进行的一局判成损坏。
  return Object.assign(run, { campaign: encodeCampaign(r.campaign, r.unit) });
}
function validBattle(b, run, byId) {
  if (!isObj(b)) return false;
  // 词条先验形状再读字段：旧写法直接 norm(b.word.w)，battle.word 被删掉就是
  // 「读 undefined 的属性」→ TypeError。这里 fail closed 成 invalid。
  if (!isObj(b.word) || !isStr(b.word.w) || !isStr(b.word.z) || !isInt(b.word.u) || !isInt(b.word.d)) return false;
  if (b.word.th !== undefined && b.word.th !== null && typeof b.word.th !== 'string') return false;
  if (!Array.isArray(b.letters) || !b.letters.every(letter)) return false;
  if (!Array.isArray(b.used) || b.used.length !== b.letters.length || !b.used.every(isBool)) return false;
  if (!Array.isArray(b.bad) || b.bad.length !== b.letters.length || !b.bad.every(isBool)) return false;
  if (!Array.isArray(b.input) || !b.input.every(letter)) return false;
  if (b.input.length > norm(b.word.w).length) return false;
  // 战斗词必须是本局词池里真实存在的那一条。
  // ★ 判据是「**至少有一条**精确匹配，且战斗词的每一个字段都与**第一条**精确匹配
  //   词条一致」，不是「恰好一条」。玩家把同一行 'cat 猫' 导入两次就会得到两条
  //   w/u/d/z 全同的词条；旧的 `length !== 1` 判据会把这份**合法**存档整份拒掉，
  //   于是自定义单元的暂停/保存/刷新每次都报「存档损坏」。
  //   抽词侧对重复条目只出第一条（见 word-selection 的 uniquePool），所以这里
  //   也只认第一条 —— 引用校验仍然 fail closed：不在词池里的词、字段对不上的词
  //   一律拒绝，不接受任何字段的「近似匹配」。
  const entry = run.pool.filter(w => w.w === b.word.w)[0];
  if (!entry) return false;
  if (b.word.u !== entry.u || b.word.d !== entry.d) return false;
  if (b.word.z !== entry.z) return false;
  if ((b.word.th || null) !== (entry.th || null)) return false;
  if (!isObj(b.foe) || !isStr(b.foe.n) || !isStr(b.foe.ic) || !isStr(b.foe.tint)) return false;
  if (!num(b.myHp, 0, run.maxhp) || !num(b.shield, 0, run.maxhp)) return false;
  if (!isNum(b.enHp) || !isNum(b.enMax) || b.enMax <= 0) return false;   // enHp 可为负（致命一击）
  if (!isInt(b.sel) || b.sel < 0 || b.sel >= b.letters.length) return false;
  if (![b.hints, b.hintUsed, b.hintTotal, b.combo, b.maxCombo, b.dmgBonus, b.lethUsed,
    b.wordsDone, b.wordStreak, b.rageLeft].every(isInt)) return false;
  if (b.hints < 0 || b.hintUsed < 0 || b.hintTotal < 0 || b.combo < 0) return false;
  if (!isBool(b.firstWrong) || !isBool(b.freezeWord) || !isBool(b.chainNext)) return false;
  if (!isBool(b.over) || !isBool(b.won) || !isBool(b.boss) || !isBool(b.elite)) return false;
  if (!isBool(b.finished) || !isBool(b.rewardTaken)) return false;
  if (!num(b.goldMult, 0, 100)) return false;
  if (!isObj(b.usedThisFight) || Object.values(b.usedThisFight).some(v => !isInt(v) || v < 0)) return false;
  if (!strArr(b.mistaken)) return false;
  // foeAttack 可选：缺失合法（旧快照）。一旦出现就必须是**完整合法**的事实 ——
  //   脏值整份 fail closed，绝不静默丢成 undefined：那会让一个「蓄力还剩多久」
  //   已经不可信的存档看起来能恢复，而玩家会发现攻击时机凭空变了。
  if (b.foeAttack !== undefined && b.foeAttack !== null && decodeFoeAttack(b.foeAttack) === undefined) return false;
  if (b.wordQ != null && encodeWordQ(b.wordQ) === undefined) return false;
  // offer 可选：一旦出现，每一条都必须与词池里第一条同名词条逐字段一致（与 b.word 同一判据），
  //   且当前战斗词必须是候选之一 —— 否则恢复后「当前词」和「可换的词」会对不上。
  if (b.offer !== undefined && b.offer !== null) {
    if (!Array.isArray(b.offer) || !b.offer.length || b.offer.length > 5) return false;
    for (const o of b.offer) {
      if (!isObj(o) || !isStr(o.w) || !isStr(o.z) || !isInt(o.u) || !isInt(o.d)) return false;
      const hit = run.pool.filter(w => w.w === o.w)[0];
      if (!hit || hit.u !== o.u || hit.d !== o.d || hit.z !== o.z) return false;
      if ((o.th || null) !== (hit.th || null)) return false;
    }
    if (!b.offer.some(o => o.w === b.word.w)) return false;
  }
  if (b.autoHint !== undefined && b.autoHint !== null && !(isInt(b.autoHint) && b.autoHint >= 0)) return false;
  if (b.wordLocked !== undefined && b.wordLocked !== null && !isBool(b.wordLocked)) return false;
  if (!validBalanceFacts(b)) return false;
  if (b.node === null || b.node === undefined || !byId.has(b.node)) return false;   // 战斗必须有真实节点
  return true;
}
function decodeBattle(b, run, byId) {
  const out = {
    word: { w: b.word.w, u: b.word.u, d: b.word.d, z: b.word.z, th: b.word.th },
    letters: b.letters.slice(), used: b.used.slice(), bad: b.bad.slice(),
    myHp: b.myHp, enHp: b.enHp, enMax: b.enMax, shield: b.shield,
    input: b.input.slice(), sel: b.sel,
    hints: b.hints, hintUsed: b.hintUsed, hintTotal: b.hintTotal,
    wordQ: decodeWordQ(b.wordQ),
    combo: b.combo, maxCombo: b.maxCombo, dmgBonus: b.dmgBonus,
    firstWrong: b.firstWrong, lethUsed: b.lethUsed,
    wordsDone: b.wordsDone, over: b.over, won: b.won,
    mistaken: b.mistaken.slice(), wordStreak: b.wordStreak,
    rageLeft: b.rageLeft, freezeWord: b.freezeWord, chainNext: b.chainNext,
    goldMult: b.goldMult, usedThisFight: Object.assign({}, b.usedThisFight),
    boss: b.boss, elite: b.elite,
    foe: { n: b.foe.n, ic: b.foe.ic, tint: b.foe.tint },
    node: byId.get(b.node),
    finished: b.finished, rewardTaken: b.rewardTaken,
  };
  // 形状已在 validBattle 里 fail closed 过；缺失（旧快照）保持 undefined，
  // 由运行时按该怪的固定配置起一个干净的 idle —— 绝不默认「立刻攻击」。
  const foeAttack = decodeFoeAttack(b.foeAttack);
  if (foeAttack) out.foeAttack = foeAttack;
  // 候选解回**词池里的同一批对象**（与 run.pool 同引用），当前词也指向其中那一条。
  if (Array.isArray(b.offer) && b.offer.length) {
    out.offer = b.offer.map(o => run.pool.filter(w => w.w === o.w)[0]);
  }
  if (isInt(b.autoHint) && b.autoHint > 0) out.autoHint = b.autoHint;
  if (b.wordLocked === true) out.wordLocked = true;
  copyBalanceFacts(b, out);
  return out;
}
function validEncounter(e, byId, needChoice) {
  if (!isObj(e) || !isStr(e.kind)) return false;
  if (!Array.isArray(e.options)) return false;
  // title/text/icon 只在 kind==='event' 时必需（optionById 靠 title 找回原卡）。
  // 其它相位（shop/rest/reward）本来就没有这几个字段，不强求。
  if (e.kind === 'event') {
    if (!isStr(e.title) || !isStr(e.text) || !isStr(e.icon)) return false;
  } else {
    for (const k of ['title', 'text', 'icon']) {
      if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') return false;
    }
  }
  for (const o of e.options) {
    if (!isObj(o) || !isStr(o.id) || !isStr(o.cat) || !isStr(o.ic) || !isStr(o.t) || !isStr(o.d)) return false;
    if (o.tip !== undefined && typeof o.tip !== 'string') return false;
  }
  if (e.gold !== undefined && (!isInt(e.gold) || e.gold < 0)) return false;
  if (e.unfinished !== undefined && e.unfinished !== null && !isStr(e.unfinished)) return false;
  if (e.chosenId !== undefined && !isStr(e.chosenId)) return false;
  if (needChoice && !isStr(e.chosenId)) return false;
  if (e.nodeId !== undefined && e.nodeId !== null && !byId.has(e.nodeId)) return false;
  return true;
}
function decodeEncounter(e, byId) {
  return {
    kind: e.kind, gold: e.gold, unfinished: e.unfinished,
    title: e.title, text: e.text, icon: e.icon, chosenId: e.chosenId,
    node: e.nodeId === undefined || e.nodeId === null ? null : byId.get(e.nodeId),
    options: e.options.map(o => ({
      id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d, tip: o.tip, leave: !!o.leave,
    })),
  };
}

/* 相位与内容必须自洽：地图相位不该带战斗，战斗相位不该缺战斗。 */
const PHASE_SHAPE = {
  [PHASE.MAP]: { battle: false, encounter: false },
  [PHASE.BATTLE]: { battle: true, encounter: false },
  [PHASE.REWARD]: { battle: true, encounter: true },
  [PHASE.ENCOUNTER]: { battle: false, encounter: true },
  [PHASE.ENCOUNTER_DONE]: { battle: false, encounter: true },
  // 结算待记账：带着**已结算的战斗**（over/finished 已置值），没有事件屏。
  // ★ 恢复时绝不重发奖励：battle.rewardTaken / over 原样带回，父层据此续跑 endRun。
  [PHASE.ENDING]: { battle: true, encounter: false },
  // 词汇完成检查点：带着**真实未打完**的战斗（enHp > 0、over=false），
  // 没有事件屏。恢复只重建检查点屏 —— 绝不重发奖励、绝不重新抽词。
  [PHASE.LEARNING_COMPLETE]: { battle: true, encounter: false },
};

export function decodeSnapshot(raw) {
  try {
    return decodeInner(raw);
  } catch {
    /* 绝不让存档损坏冒泡到调用方。decode 的入口是主页/标题页的加载路径，
       在那里抛异常等于整页白屏；返回 invalid 后上层照常显示「不能恢复」。 */
    return bad('invalid');
  }
}

function decodeInner(raw) {
  if (!isObj(raw)) return bad('invalid');
  if (raw.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return bad('version');
  if (!isStr(raw.savedAt) || Number.isNaN(Date.parse(raw.savedAt))) return bad('invalid');
  if (!PHASES.has(raw.phase)) return bad('invalid');
  // outcome 只有 ENDING 相位需要，且必须是布尔：它是「赢了还是输了」的唯一凭据，
  // 缺失就必须拒绝 —— 猜错方向会让玩家看到相反的结局。
  const needOutcome = raw.phase === PHASE.ENDING;
  if (needOutcome ? !isBool(raw.outcome) : raw.outcome !== undefined) return bad('invalid');
  if (!validRun(raw.run)) return bad('invalid');
  const byId = rebuildRows(raw.run.rows);
  if (!byId) return bad('invalid');
  const run = decodeRun(raw.run, byId);
  if (!run) return bad('invalid');

  const shape = PHASE_SHAPE[raw.phase];
  if (shape.battle !== !!raw.battle) return bad('invalid');
  if (shape.encounter !== !!raw.encounter) return bad('invalid');
  if (raw.battle) {
    if (!validBattle(raw.battle, run, byId)) return bad('invalid');
  }
  if (raw.encounter) {
    const needChoice = raw.phase === PHASE.ENCOUNTER_DONE;
    if (!validEncounter(raw.encounter, byId, needChoice)) return bad('invalid');
  }
  return {
    ok: true,
    value: {
      phase: raw.phase, savedAt: raw.savedAt,
      // 非 ENDING 相位是 undefined：上层只在 ENDING 时读它。
      outcome: needOutcome ? raw.outcome : undefined,
      run, battle: raw.battle ? decodeBattle(raw.battle, run, byId) : null,
      encounter: raw.encounter ? decodeEncounter(raw.encounter, byId) : null,
    },
  };
}

/* 恢复时 run.advAt 必须小于 now，否则 400ms 推进去重窗口会把第一下点击吃掉。 */
export function restoredAdvanceLock(run, now = Date.now()) {
  if (run.advAt >= now - ADV_LOCK_MS) run.advAt = 0;
  return run;
}
