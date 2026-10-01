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

export const SNAPSHOT_SCHEMA_VERSION = 1;

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
function encodeRun(run) {
  return {
    unit: run.unit, id: run.id,
    countedStart: !!run.countedStart, clearedRun: !!run.clearedRun,
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
}
function encodeBattle(b) {
  return {
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
    countedStart: r.countedStart, clearedRun: r.clearedRun,
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
  return run;
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
  const pool = run.pool.filter(w => w.w === b.word.w);
  if (pool.length !== 1) return false;           // 战斗词必须是本局词池里真实存在的那一条
  if (b.word.u !== pool[0].u || b.word.d !== pool[0].d) return false;
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
  if (b.node === null || b.node === undefined || !byId.has(b.node)) return false;   // 战斗必须有真实节点
  return true;
}
function decodeBattle(b, run, byId) {
  return {
    word: { w: b.word.w, u: b.word.u, d: b.word.d, z: b.word.z, th: b.word.th },
    letters: b.letters.slice(), used: b.used.slice(), bad: b.bad.slice(),
    myHp: b.myHp, enHp: b.enHp, enMax: b.enMax, shield: b.shield,
    input: b.input.slice(), sel: b.sel,
    hints: b.hints, hintUsed: b.hintUsed, hintTotal: b.hintTotal,
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
