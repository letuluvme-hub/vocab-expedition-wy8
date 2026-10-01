/* 暂停/保存/恢复的应用层契约。
 *
 * 这里断言的是**顺序与副作用**，不是字段存在：
 *  1) 暂停后所有会改状态的入口都必须被挡住（不是只盖一层 CSS）——
 *     输入字母、道具、提示、跳过、逃跑、退格、点地图节点、领奖、选事件选项。
 *  2) 暂停要冻结「拥有 run/battle 的延迟任务」：整词完成后的换词、
 *     胜利后的 900ms 奖励面板、事件/营火选定后的推进、结算后的 endRun。
 *     继续时不能补跑丢失的回调，也不能补扣伤害 —— 而是重建那个稳定待办。
 *  3) 恢复不是新建：runs/wins 都不加、applyRelicInit 不跑、
 *     掌握记录不重记、已发过的奖励不重发。
 *  4) 快照与学习 DB 同一次提交；没有存储时明确报「没存上」而不是假装成功。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgressController } from '../../src/app/progress.js';
import { createLifecycle } from '../../src/app/lifecycle.js';
import { createRun, advanceRun, registerRunStart } from '../../src/domain/run.js';
import { createProgressStore } from '../../src/services/progress.js';
import { createStorage, STORAGE_KEY } from '../../src/services/storage.js';
import { PHASE } from '../../src/domain/run-snapshot.js';
import { norm } from '../../src/domain/text.js';
import { WORDS } from '../../src/data/words.js';
import { ENEMIES } from '../../src/data/enemies.js';
import { heroById } from '../../src/ui/components/hero.js';

const HERO = heroById('ranger');
const UNIT1 = WORDS.filter(w => w.u === 1);
const mulberry = seed => {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 4294967296; };
};

function memoryStorage(seed) {
  const map = new Map();
  if (seed !== undefined) map.set(STORAGE_KEY, seed);
  return { map, writes: 0, getItem: k => (map.get(k) ?? null),
    setItem(k, v) { this.writes++; map.set(k, String(v)); }, removeItem: k => map.delete(k) };
}

/* ---------------- 测试台：一个足够真实的 runtime 替身 ---------------- */
function harness({ withSnapshot = false, noStorage = false, phase = PHASE.MAP } = {}) {
  const mem = noStorage ? null : memoryStorage();
  const storage = createStorage(mem);
  const store = createProgressStore(storage);
  const DB = { runs: 0, wins: 0, mastered: [], best: 0, custom: [], rewards: [], kbMode: false, kbUpper: false, voice: false };
  if (mem) mem.map.set(STORAGE_KEY, JSON.stringify(DB));

  const log = [];
  const jobs = [];
  let now = 1_000;
  const lifecycle = createLifecycle({
    setTimer(fn, ms) { const id = jobs.length; jobs.push({ id, fn, at: now + ms }); return id; },
    clearTimer(id) { const j = jobs[id]; if (j) j.cleared = true; },
    now: () => now,
  });

  let G = null, B = null, screen = 's-title', phaseState = phase;
  let encounter = null;
  let outcome = null;
  let confirmAnswer = true;
  const state = { get DB() { return DB; }, get G() { return G; }, get B() { return B; } };

  function makeBattle(run, node) {
    const word = UNIT1[3];
    const letters = word.w.split('');
    return { word, letters, used: letters.map((_, i) => i < 2), bad: letters.map(() => false),
      node, foe: ENEMIES[0], boss: false, elite: false, myHp: 40, enHp: 100, enMax: 200, shield: 0,
      input: letters.slice(0, 2), sel: 0, hints: 3, hintUsed: 0, hintTotal: 0, combo: 2, maxCombo: 2,
      dmgBonus: 0, firstWrong: true, lethUsed: 0, wordsDone: 1, over: false, mistaken: [],
      wordStreak: 1, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
      usedThisFight: {}, finished: false, rewardTaken: false };
  }

  // 「会改状态」的原始实现。控制器在暂停时必须在这些**之前**挡住。
  const actions = {
    pressLetter(i) {
      const b = B, run = G;
      if (!b || i < 0 || i >= b.letters.length || b.used[i]) return false;
      const ch = b.letters[i];
      if (norm(ch) !== norm(b.word.w)[b.input.length]) return false;
      b.used[i] = true; b.input.push(ch); run.att++; run.attOk++; b.combo++;
      return true;
    },
    typeLetter(ch) {
      const idx = B.letters.indexOf(String(ch).toLowerCase());
      return idx < 0 ? false : actions.pressLetter(idx);
    },
    undoLetter() {
      if (!B.input.length) return false;
      const ch = B.input.pop();
      for (let i = B.letters.length - 1; i >= 0; i--) if (B.used[i] && B.letters[i] === ch) { B.used[i] = false; break; }
      G.attOk = Math.max(0, G.attOk - 1);
      return true;
    },
    useItem(id) {
      if ((G.bag[id] | 0) <= 0) return false;
      G.bag[id]--; B.myHp = Math.min(G.maxhp, B.myHp + 1); return true;
    },
    requestHint() {
      if (!B || B.hints <= 0) return false;
      B.hints--; B.hintUsed++; return true;
    },
    skipFight() { B.over = true; B.finished = true; return true; },
    fleeFight() { if (G.gold < 10) return false; G.gold -= 10; B.over = true; return true; },
    enterNode(n) {
      G.node = n; G.avail = [];
      if (n.type === 'battle' || n.type === 'elite' || n.type === 'boss') actions.startFight(n);
      else { encounter = { kind: n.type, node: n, options: [] }; phaseState = PHASE.ENCOUNTER; screen = 's-event'; }
      return true;
    },
    startFight(n) {
      lifecycle.resetBattle();
      B = makeBattle(G, n);
      phaseState = PHASE.BATTLE;
      screen = 's-fight';
      log.push(['startFight']);
    },
    // 对应 runtime 的 reopenEncounter：按描述重建卡片。
    // 这里只需要把描述记回 encounter（卡片已由测试自己摆好）。
    // 对应 runtime 的 reopenEncounter：按描述重建卡片并切到对应界面。
    reopenEncounter(d) {
      if (!d || !Array.isArray(d.options)) return false;
      encounter = d;
      screen = d.kind === 'reward' ? 's-pick' : (d.kind === 'shop' || d.kind === 'rest' ? 's-rest' : 's-event');
      return true;
    },
    chooseEncounter(id) {
      if (!encounter) return false;
      const opt = encounter.options.find(o => o.id === id);
      if (!opt) return false;
      if (opt.leave) { encounter.chosenId = id; phaseState = PHASE.ENCOUNTER_DONE; return true; }
      // 商店可重复购买：买完仍停在商店，不转成 ENCOUNTER_DONE。
      if (encounter.kind === 'shop') {
        if (id === 'item:potion') { G.gold -= 45; G.hp = Math.min(G.maxhp, G.hp + 35); return true; }
        if (id === 'relic:greed') G.relics.push('greed'); return true;
      }
      // 营火/事件：只能选一次，选完即进入「待推进」
      if (encounter.chosenId) return false;
      encounter.chosenId = id;
      phaseState = PHASE.ENCOUNTER_DONE;
      if (id === 'rest:heal') G.hp = Math.min(G.maxhp, G.hp + 20);
      return true;
    },
    takeReward(id) {
      if (!B || B.rewardTaken || !encounter) return false;
      // 奖励相位恢复后：卡还在，且只能领一次（与线上一致）
      const opt = encounter.options.find(o => o.id === id);
      if (!opt) return false;
      B.rewardTaken = true;
      if (id.startsWith('relic:')) G.relics.push(id.slice('relic:'.length));
      encounter = null;
      phaseState = PHASE.MAP;
      return true;
    },
    advance() {
      const result = advanceRun(G, ++now + 1000);
      if (result === 'ended') { actions.endRun(false); return false; }
      encounter = null;
      phaseState = PHASE.MAP;
      screen = 's-map';
      log.push(['advance']);
      return true;
    },
    endRun(win) {
      log.push(['endRun', win]);
      // 结算**不清空 G**：线上结算屏上 G 仍在（result 已是布尔值），
      // 只有「放弃」才真的清掉。清空会让「已结算 → 不许再存快照」这条判据落空。
      if (G) G.result = !!win;
      DB.rewards = DB.rewards || [];
      if (win && !(G && G.reward)) { G.reward = { id: 'WR-test' }; DB.rewards.push(G.reward) }
      B = null; encounter = null; outcome = null; phaseState = PHASE.MAP;
    },
    settleRun: win => actions.endRun(win),
    clearRun() { G = null; B = null; encounter = null; outcome = null; phaseState = PHASE.MAP; },
    restoreScreen(from) {
      screen = from || 's-map';
      log.push(['restoreScreen', from]);
    },
    newRun() {
      const pool = UNIT1;
      if (!pool.length) return false;
      lifecycle.resetRun();
      G = createRun(1, HERO, pool, mulberry(0x51a7));
      registerRunStart(DB, G);
      B = null; encounter = null;
      phaseState = PHASE.MAP;
      screen = 's-map';
      return true;
    },
  };

  const api = {
    getRun: () => G, getBattle: () => B, getDB: () => DB,
    getPhase: () => phaseState, setPhase: p => { phaseState = p; },
    getOutcome: () => outcome, setOutcome: v => { outcome = v; },
    getEncounter: () => encounter, setEncounter: e => { encounter = e; },
    setRun: r => { G = r; }, setBattle: b => { B = b; },
    show: id => { screen = id; log.push(['show', id]); },
    screen: () => screen,
    toast: m => log.push(['toast', m]),
    renderMap: () => log.push(['renderMap']),
    renderFight: () => log.push(['renderFight']),
    renderTitle: () => log.push(['renderTitle']),
    applyRelicInit: () => log.push(['applyRelicInit']),
    lifecycle,
    // 同页恢复回到原屏
    restoreScreen: from => { screen = from || 's-map'; log.push(['restoreScreen', from]); },
    mutate: fn => fn(),
    TTS: { stop: () => log.push(['ttsStop']) },
    audio: { suspend: () => log.push(['audioSuspend']), resume: () => log.push(['audioResume']) },
    ...actions,
  };

  const ctrl = createProgressController({ state, api, store, now: () => now });
  // 与线上一致：受闸门动作跑完就提交一次（学习 DB + 快照同一次写）。
  // 这一步必须在 ctrl 建好之后挂上 —— 早一步拿到的是没有 checkpoint 的 api。
  api.mutate = fn => { const out = fn(); ctrl.checkpoint(); return out };
  // 顺序要紧：ctrl 在后 —— 闸门版本必须**覆盖**原始动作，
  // 否则 h.pressLetter 拿到的是没设防的那个，暂停测试会假通过。
  const h = { ...api, ...ctrl, log, mem, jobs, now: () => now, lifecycle, store,
    // 控制器读的是 api.audio，所以测试替换音频能力必须改 api 本身。
    setAudio(a) { api.audio = a; },
    advanceTime(ms) {
      now += ms;
      for (const j of jobs) if (!j.cleared && !j.fired && j.at <= now) { j.fired = true; j.fn(); }
    },
    setConfirmAnswer: v => { confirmAnswer = v; },
    adoptSavedDB(saved) {
      for (const k of Object.keys(DB)) delete DB[k];
      Object.assign(DB, saved);
    },
    get DB() { return DB; },
  };
  // confirm 由测试通过 setConfirm / setConfirmAnswer 控制
  ctrl.setConfirm(() => confirmAnswer);
  return h;
}

function startRun(h) {
  h.log.length = 0;
  h.newRun();
  return h.getRun();
}
/* 首层节点可能是 battle/event/rest（真实地图就是这样随机的）。
   战斗类测试必须显式要一个 battle 节点，否则会走进事件分支。 */
function battleNode(run) {
  const n = run.rows[0][0];
  n.type = 'battle';
  return n;
}
/* 真实刷新 = 页面重载：存档被重新读进内存 DB，运行时状态清空。
   h2 的内存 DB 必须换成存档里的那份，否则 continueRun 改的是「旧 DB」，
   而线上 DB 本来就是启动时从同一个 key 读出来的。 */
function reloadInto(h2, h1) {
  h2.mem.map.set(STORAGE_KEY, h1.mem.map.get(STORAGE_KEY));
  h2.adoptSavedDB(JSON.parse(h1.mem.map.get(STORAGE_KEY)));
  h2.clearRun();
  h2.log.length = 0;
  return h2;
}

/* ================= 1. 暂停真的挡住状态改动 ================= */

test('暂停后所有战斗输入入口都改不动状态（不是只盖 CSS）', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  const B = h.getBattle();
  const before = JSON.stringify({ input: B.input, used: B.used, combo: B.combo, hints: B.hints,
    hp: B.myHp, gold: run.gold, bag: run.bag, att: run.att });

  h.pause({ fromReload: false });
  // 每条会改状态的路径都必须原样返回 false，且一个字节都不许动
  assert.equal(h.pressLetter(0), false, '点字母');
  assert.equal(h.typeLetter('t'), false, '打字');
  assert.equal(h.undoLetter(), false, '退格');
  assert.equal(h.useItem('leech'), false, '道具');
  assert.equal(h.requestHint(), false, '提示');
  assert.equal(h.skipFight(), false, '跳过');
  assert.equal(h.fleeFight(), false, '逃跑');
  assert.equal(h.enterNode(battleNode(run)), false, '地图节点');
  assert.equal(h.chooseEncounter('shop:heal'), false, '事件/商店选项');
  assert.equal(h.takeReward('heal'), false, '领奖');
  assert.equal(h.advance(), false, '推进层数');
  assert.equal(h.endRun(true), false, '结算');
  assert.equal(JSON.stringify({ input: B.input, used: B.used, combo: B.combo, hints: B.hints,
    hp: B.myHp, gold: run.gold, bag: run.bag, att: run.att }), before, '暂停期间状态必须逐字节不变');
});

test('继续之后同一批入口恢复正常（不是永久锁死）', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  h.pause({});
  assert.equal(h.isPaused(), true);
  h.resume();
  assert.equal(h.isPaused(), false);
  assert.equal(h.pressLetter(2), true, '继续后可以继续拼词');
  assert.equal(h.getBattle().input.length, 3);
});

test('暂停会存一次快照，并给出真实的保存结果', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  const out = h.pause({});
  assert.equal(out.saved, true);
  assert.equal(h.mem.writes >= 1, true);
  const raw = JSON.parse(h.mem.map.get(STORAGE_KEY));
  assert.equal(raw.activeRun.phase, PHASE.BATTLE);
  assert.deepEqual(raw.activeRun.battle.input, ['s', 'a'], '半词存下来了');
  assert.equal(raw.runs, h.DB.runs, '暂停不加远征次数');
});

test('没有存储时暂停不阻塞玩法，并明确说「没存上」', () => {
  const h = harness({ noStorage: true });
  const run = startRun(h);
  h.enterNode(battleNode(run));
  const out = h.pause({});
  assert.equal(out.saved, false);
  assert.equal(out.reason, 'unavailable');
  assert.match(out.message, /只在这一页有效/, '必须告诉玩家进度只在这一页有效');
  assert.equal(h.isPaused(), true, '暂停本身照常生效，玩法可继续');
  h.resume();
  assert.equal(h.pressLetter(2), true, '没有存储也不影响继续玩');
});

test('存储抛异常时暂停给出「保存失败」而不是谎称成功', () => {
  const h = harness();
  startRun(h);
  h.mem.setItem = () => { throw new Error('QuotaExceededError'); };
  const out = h.pause({});
  assert.equal(out.saved, false);
  assert.equal(out.reason, 'failed');
  assert.match(out.message, /没存上|失败/);
});

/* ================= 2. 延迟任务的冻结与重建 ================= */

test('暂停冻结排队的战斗延迟任务，继续后不补跑丢失的回调', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  // 模拟「胜利后 900ms 才弹奖励面板」
  h.getBattle().over = true;
  let rewardsShown = 0;
  h.lifecycle.scheduleBattle(() => { rewardsShown++; }, 900);
  h.pause({});
  h.advanceTime(5000);                 // 暂停期间时间流逝
  assert.equal(rewardsShown, 0, '暂停期间延迟回调不得执行');
  h.resume();
  h.advanceTime(5000);
  assert.equal(rewardsShown, 1, '继续后这个待办以重建方式完成，且只完成一次');
});

test('暂停期间推进到点的任务不会被重复执行', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  let calls = 0;
  h.lifecycle.scheduleRun(() => { calls++; }, 900);
  h.pause({});
  h.advanceTime(1000);                 // 触发冻结
  h.advanceTime(1000);
  assert.equal(calls, 0);
  h.resume();
  h.advanceTime(1000);
  assert.equal(calls, 1, '同一个待办只补一次');
});

test('新开一轮 / 放弃会取消旧队列，迟到的回调不得改动新状态', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  let stale = 0;
  h.lifecycle.scheduleBattle(() => { stale++; }, 900);
  h.abandonRun();
  h.advanceTime(5000);
  assert.equal(stale, 0);
  assert.equal(h.getRun(), null);
  assert.equal(h.peekSnapshot().ok, false, '放弃后快照必须删掉');
});

/* ================= 3. 快照：每个相位该存什么 ================= */

test('地图相位快照：只有 run，没有战斗与事件', () => {
  const h = harness();
  const run = startRun(h);
  h.pause({});
  const peek = h.peekSnapshot();
  assert.equal(peek.ok, true, peek.reason);
  assert.equal(peek.value.phase, PHASE.MAP);
  assert.equal(peek.value.battle, null);
  assert.equal(peek.value.encounter, null);
  assert.equal(peek.value.run.ghostUsed, false);
});

test('战斗相位快照带全部战斗事实，影分身额度是 run 级', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  run.ghostUsed = true;
  run.gold = 88;
  h.pause({});
  const { battle } = h.peekSnapshot().value;
  assert.deepEqual(battle.input, ['s', 'a']);
  assert.deepEqual(battle.used, [true, true, false, false, false]);
  assert.equal(battle.hints, 3);
  assert.equal(battle.combo, 2);
  assert.equal(battle.myHp, 40);
  assert.equal(battle.enHp, 100);
  // 身份一致性在**同一次**解码内成立：battle.node 必须就是 run.node 那个对象。
  const snap = h.peekSnapshot();
  assert.equal(snap.value.battle.node === snap.value.run.node, true, '解码后 battle.node 与 run.node 同身份');
  assert.equal(snap.value.run.node === snap.value.run.rows[0][0], true, 'run.node 就是 rows 里的对象');
  assert.equal(snap.value.run.ghostUsed, true);
});

test('奖励相位：奖励卡数据与「尚未领取」一起存，刷新后不重发', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  const B = h.getBattle();
  B.over = true; B.won = true;
  run.gold += 121; run.kills += 1;
  h.setPhase(PHASE.REWARD);
  h.setEncounter({ kind: 'reward', gold: 121, unfinished: null, node: run.node,
    options: [{ id: 'relic:greed', cat: 'relic', ic: '💰', t: '贪婪钱币', d: '金币 +50%' }] });
  h.pause({});
  const snap = h.peekSnapshot();
  assert.equal(snap.ok, true, snap.reason);
  assert.equal(snap.value.phase, PHASE.REWARD);
  assert.equal(snap.value.encounter.gold, 121);
  assert.deepEqual(snap.value.encounter.options.map(o => o.id), ['relic:greed']);
  assert.equal(snap.value.battle.rewardTaken, false);
  assert.equal(snap.value.run.gold, run.gold);
});

test('事件相位：已展开的选项与随机结果存下来，不重新 roll', () => {
  const h = harness();
  const run = startRun(h);
  const node = run.rows[0][0];
  run.node = node;
  h.setPhase(PHASE.ENCOUNTER);
  h.setEncounter({ kind: 'shop', gold: 100, node,
    options: [{ id: 'item:stone', cat: 'item', ic: '🪨', t: '磐石之躯 ×3 · 70 金币', d: '+20 护盾' },
      { id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买', leave: true }] });
  h.pause({});
  const snap = h.peekSnapshot();
  assert.equal(snap.value.phase, PHASE.ENCOUNTER);
  assert.deepEqual(snap.value.encounter.options.map(o => o.id), ['item:stone', 'shop:leave']);
  assert.equal(snap.value.encounter.options[1].leave, true);
});

test('已选定的相位存 chosenId，刷新后不再重新执行副作用', () => {
  const h = harness();
  const run = startRun(h);
  run.node = run.rows[0][0];
  run.hp = 52;                       // 回血已经生效过
  h.setPhase(PHASE.ENCOUNTER_DONE);
  h.setEncounter({ kind: 'rest', chosenId: 'rest:heal', node: run.node, options: [] });
  h.pause({});
  const snap = h.peekSnapshot();
  assert.equal(snap.value.encounter.chosenId, 'rest:heal');
  assert.equal(snap.value.run.hp, 52, '副作用只算过一次');
});

/* ================= 4. 恢复 ================= */

test('恢复不新建远征：runs/wins/掌握/遗物初始化都不动', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  h.DB.mastered.push('litre');
  run.kills = 3; run.gold = 210; run.ghostUsed = true;
  h.pause({});
  const snapshot = h.peekSnapshot().value;
  const runsBefore = h.DB.runs, winsBefore = h.DB.wins;

  const h2 = harness();
  // 把快照写进 h2 的存档，模拟「刷新后打开同一台设备」
  reloadInto(h2, h);
  const out = h2.continueRun();
  assert.equal(out.ok, true, out.reason);
  assert.equal(h2.getDB().runs, runsBefore, '恢复不得 +1 远征次数');
  assert.equal(h2.getDB().wins, winsBefore, '恢复不得 +1 通关次数');
  assert.deepEqual(h2.getDB().mastered, ['litre'], '掌握记录不重记也不清空');
  assert.equal(h2.log.some(e => e[0] === 'applyRelicInit'), false, '恢复绝不重跑遗物初始化');
  const G = h2.getRun();
  assert.equal(G.gold, 210);
  assert.equal(G.kills, 3);
  assert.equal(G.ghostUsed, true, '已用掉的影分身额度不会因为恢复而重置');
  assert.equal(G.heroId, run.heroId, '英雄来自快照的 run.heroId');
  assert.equal(snapshot.run.gold, 210);
});

test('恢复战斗保持精确半词：不回满、不重抽词、不重置连击', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  const B = h.getBattle();
  B.combo = 6; B.maxCombo = 6; B.wordsDone = 2; B.hints = 1; B.hintUsed = 1;
  h.pause({});
  const letters = B.letters.slice();

  const h2 = harness();
  reloadInto(h2, h);
  assert.equal(h2.continueRun().ok, true);
  const b2 = h2.getBattle();
  assert.deepEqual(b2.input, ['s', 'a']);
  assert.deepEqual(b2.letters, letters, '字母盘不重新抽噪声');
  assert.deepEqual(b2.used, [true, true, false, false, false]);
  assert.equal(b2.combo, 6);
  assert.equal(b2.wordsDone, 2);
  assert.equal(b2.hints, 1);
  assert.equal(b2.myHp, 40, '不回满');
  assert.equal(h2.screen(), 's-fight');
  // 恢复期间再次点「继续远征」是 busy：不会建第二个 run、不会重复计数
  const runsBefore = h2.DB.runs, goldBefore = h2.getRun().gold;
  const again = h2.continueRun();
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'busy');
  assert.equal(h2.DB.runs, runsBefore);
  assert.equal(h2.getRun().gold, goldBefore);
  // 真正幂等的是「再刷新一次」：第三次恢复必须与第二次完全一致
  const h3 = harness();
  reloadInto(h3, h2);
  assert.equal(h3.continueRun().ok, true);
  assert.equal(h3.DB.runs, runsBefore, '反复刷新不重复计远征次数');
  assert.equal(h3.getRun().gold, goldBefore);
  assert.deepEqual(h3.getBattle().input, ['s', 'a']);
  assert.equal(h3.getBattle().combo, 6);
});

test('恢复地图保持可选节点可点（身份一致），不会变成死局', () => {
  const h = harness();
  startRun(h);
  h.enterNode(battleNode(h.getRun()));   // 真实路径：先进一场，再跳过，再推进
  h.skipFight();
  h.advance();                            // 现在 avail 是第 2 层的真实节点
  h.pause({});
  const availIds = h.getRun().avail.map(n => n.type + '@' + n.x.toFixed(3));

  const h2 = harness();
  reloadInto(h2, h);
  assert.equal(h2.continueRun().ok, true);
  const G2 = h2.getRun();
  assert.deepEqual(G2.avail.map(n => n.type + '@' + n.x.toFixed(3)), availIds);
  assert.equal(G2.avail.length > 0, true);
  assert.equal(h2.enterNode(Object.assign(G2.avail[0], { type: 'battle' })), true, '恢复后的可选节点必须真的能进');
  assert.equal(h2.screen(), 's-fight');
  assert.equal(h2.getBattle().node === G2.node, true);
});

test('恢复奖励相位：回到待领奖，不重发金币也不换成新卡', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  h.getBattle().over = true; h.getBattle().won = true;
  run.gold += 121; run.kills += 1;
  h.setPhase(PHASE.REWARD);
  h.setEncounter({ kind: 'reward', gold: 121, unfinished: null, node: run.node,
    options: [{ id: 'relic:greed', cat: 'relic', ic: '💰', t: '贪婪钱币', d: '金币 +50%' }] });
  h.pause({});

  const h2 = harness();
  reloadInto(h2, h);
  assert.equal(h2.continueRun().ok, true);
  assert.equal(h2.screen(), 's-pick', '回到待领奖');
  assert.equal(h2.getRun().gold, run.gold, '金币不重发');
  assert.equal(h2.getRun().kills, 1, '击杀不重复计');
  assert.equal(h2.pendingEncounter().options[0].id, 'relic:greed', '卡面不重抽');
  assert.equal(h2.takeReward('relic:greed'), true);
  assert.deepEqual(h2.getRun().relics, ['greed']);
  assert.equal(h2.getRun().relics.length, 1, '同一张卡只能领一次');
  assert.equal(h2.takeReward('relic:greed'), false);
});

test('恢复已选定的营火：直接重建「待推进」，不再重新执行回血', () => {
  const h = harness();
  const run = startRun(h);
  const node = run.rows[0][0];
  run.node = node; run.hp = 52;
  h.setPhase(PHASE.ENCOUNTER_DONE);
  h.setEncounter({ kind: 'rest', chosenId: 'rest:heal', node, options: [] });
  h.pause({});

  const h2 = harness();
  reloadInto(h2, h);
  assert.equal(h2.continueRun().ok, true);
  assert.equal(h2.getRun().hp, 52, '不再加一次回血');
  assert.equal(h2.log.filter(e => e[0] === 'advance').length, 1, '只推进一次');
  assert.equal(h2.getRun().floor, 2);
  assert.equal(h2.getRun().node.done, true);
});

test('恢复商店：库存与购买冷却不回退成免费重买', () => {
  const h = harness();
  const run = startRun(h);
  const node = run.rows[0][0];
  run.node = node; run.gold = 200;
  h.setPhase(PHASE.ENCOUNTER);
  h.setEncounter({ kind: 'shop', gold: 200, node,
    options: [{ id: 'item:potion', cat: 'heal', ic: '💚', t: '疗伤药剂 · 45 金币', d: '回复 35 点生命' },
      { id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买', leave: true }] });
  h.chooseEncounter('item:potion');
  assert.equal(h.getRun().gold, 155, '买过一次，钱扣了');
  h.pause({});

  const h2 = harness();
  reloadInto(h2, h);
  assert.equal(h2.continueRun().ok, true);
  assert.equal(h2.getRun().gold, 155, '恢复不退还也不重复扣');
  const options = h2.pendingEncounter().options.map(o => o.id);
  assert.deepEqual(options, ['item:potion', 'shop:leave'], '库存不重 roll');
  // 商店是「可重复购买」的界面：刷新后 chosenId 必须清空，否则玩家再也买不了第二瓶。
  assert.equal(h2.pendingEncounter().chosenId, undefined, '待选购状态的快照不带 chosenId');
  assert.equal(h2.chooseEncounter('item:potion'), true, '刷新后仍可正常购买');
  assert.equal(h2.getRun().gold, 110, '第二次购买照常扣 45，不是免费重买');
});

/* ================= 5. 拒绝与放弃 ================= */

test('损坏快照：不执行、保留 DB 与快照、明确提示可丢弃', () => {
  const h = harness();
  const DB = h.DB;
  DB.runs = 5; DB.wins = 2; DB.mastered = ['a', 'b']; DB.custom = [{ w: 'x', z: 'y' }];
  DB.rewards = [{ id: 'WR-1' }]; DB.futureField = { keep: 1 };
  const corrupt = { schemaVersion: 1, savedAt: '2026-10-01T00:00:00.000Z', phase: PHASE.BATTLE,
    run: { unit: 'not-a-number' }, battle: {}, encounter: null };
  h.mem.map.set(STORAGE_KEY, JSON.stringify({ ...DB, activeRun: corrupt }));

  const out = h.continueRun();
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid');
  assert.match(out.message, /不能恢复|无法恢复/);
  assert.equal(h.getRun(), null, '不得建出半吊子状态');
  assert.equal(h.screen(), 's-title', '停在主页，不自动走进敌人');
  const after = JSON.parse(h.mem.map.get(STORAGE_KEY));
  assert.deepEqual(after.mastered, ['a', 'b'], '学习记录不许被静默清掉');
  assert.deepEqual(after.custom, [{ w: 'x', z: 'y' }]);
  assert.deepEqual(after.rewards, [{ id: 'WR-1' }]);
  assert.equal(after.futureField.keep, 1, '未知字段保留');
  assert.deepEqual(after.activeRun, corrupt, '损坏快照先留着，等玩家确认再丢');
  assert.equal(after.runs, 5, '历史 totals 不动');
});

test('版本不支持的快照：明确提示，不执行也不静默删除', () => {
  const h = harness();
  const future = { schemaVersion: 99, savedAt: '2026-10-01T00:00:00.000Z', phase: PHASE.MAP,
    run: {}, battle: null, encounter: null };
  h.mem.map.set(STORAGE_KEY, JSON.stringify({ ...h.DB, runs: 4, activeRun: future }));
  const out = h.continueRun();
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'version');
  assert.match(out.message, /新版本|不支持/);
  const after = JSON.parse(h.mem.map.get(STORAGE_KEY));
  assert.deepEqual(after.activeRun, future, '不许静默清历史');
  assert.equal(after.runs, 4);
});

test('discardSnapshot 只丢快照，学习记录与未知字段全留', () => {
  const h = harness();
  startRun(h);
  h.pause({});
  assert.equal(h.discardSnapshot().ok, true);
  const after = JSON.parse(h.mem.map.get(STORAGE_KEY));
  assert.equal('activeRun' in after, false);
  assert.equal(after.runs, 1);
  // 丢快照**只**影响落盘：这一页内存里那一局仍可原样继续（同页恢复不读存档）。
  // 模拟刷新（内存清空）之后才真的没有可继续的远征。
  const h2 = harness();
  reloadInto(h2, h);
  assert.equal(h2.continueRun().ok, false);
  assert.equal(h2.continueRun().reason, 'none');
});

test('真正结束远征会删掉快照，刷新不会死局复活', () => {
  const h = harness();
  startRun(h);
  h.pause({});
  assert.equal(h.peekSnapshot().ok, true);
  h.resume();                    // 结算由玩法流程触发，先解除暂停
  h.endRun(false);
  assert.equal(h.peekSnapshot().ok, false, '结算后快照必须删除');
  h.resume();
});

test('清空存档也删掉快照', () => {
  const h = harness();
  startRun(h);
  h.pause({});
  h.resetProgress();
  const after = JSON.parse(h.mem.map.get(STORAGE_KEY));
  assert.equal('activeRun' in after, false, '清档必须连快照一起删，否则刷新会复活旧局');
  // 存档字段的清零由 runtime 的 toReset 负责（它保留角色与界面偏好），
  // 这里只断言快照没了、运行态也没了。
  assert.equal(h.getRun(), null);
  assert.equal(h.peekSnapshot().ok, false);
});

test('没有快照时 continueRun 明确说没有可继续的远征', () => {
  const h = harness();
  const out = h.continueRun();
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'none');
  assert.equal(h.getRun(), null);
});

/* ================= 6. 后台/前台 ================= */

test('切到后台会安全保存并暂停，回前台不自动继续也不补伤', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  const B = h.getBattle();
  B.myHp = 33;
  h.onHidden();
  assert.equal(h.isPaused(), true, '切后台即暂停');
  assert.equal(h.peekSnapshot().ok, true, '后台也要存一次');
  assert.equal(h.log.some(e => e[0] === 'ttsStop'), true, '后台掐掉语音');
  const hp = B.myHp;
  h.onVisible();
  assert.equal(h.isPaused(), true, '回前台不得自动继续');
  assert.equal(B.myHp, hp, '不补伤、不结算');
  assert.equal(h.getRun(), run, '状态没有被悄悄换掉');
  h.resume();
  assert.equal(h.isPaused(), false);
});

test('pagehide 也走同一条安全保存路径', () => {
  const h = harness();
  startRun(h);
  h.onPageHide();
  assert.equal(h.isPaused(), true);
  assert.equal(h.peekSnapshot().ok, true);
});

test('没有进行中的远征时切后台不产生空快照', () => {
  const h = harness();
  h.onHidden();
  assert.equal(h.isPaused(), false, '主页不该被暂停');
  assert.equal(h.peekSnapshot().ok, false);
});

test('AudioContext 可用时挂起，回前台手势里恢复；缺 API 静默', () => {
  const withAudio = harness();
  startRun(withAudio);
  withAudio.onHidden();
  assert.equal(withAudio.log.some(e => e[0] === 'audioSuspend'), true);
  withAudio.onVisible();
  // 恢复必须等用户手势（resumeOnGesture），不自动调用
  assert.equal(withAudio.log.some(e => e[0] === 'audioResume'), false);
  withAudio.resume();
  assert.equal(withAudio.log.some(e => e[0] === 'audioResume'), true);

  // 缺 AudioContext：暂停/继续/回前台全部静默不抛，玩法照常
  const bare = harness();
  bare.setAudio({ suspend: () => { throw new Error('no AudioContext'); }, resume: () => { throw new Error('x'); } });
  startRun(bare);
  assert.doesNotThrow(() => bare.onHidden());
  assert.equal(bare.isPaused(), true, '没有音频能力也不影响暂停生效');
  assert.equal(bare.peekSnapshot().ok, true, '进度照样存下来了');
  assert.doesNotThrow(() => bare.onVisible());
  assert.doesNotThrow(() => bare.resume());
  assert.equal(bare.isPaused(), false, '继续照常生效');
  assert.equal(bare.enterNode(battleNode(bare.getRun())), true, '没有音频能力时战斗照常可进');
  assert.equal(bare.getBattle().word.w.length > 0, true);
});

/* ================= 7. 主页入口 ================= */

test('存在未结束快照时主页提供「继续远征」，且不自动走敌人', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  h.pause({});

  const h2 = harness();
  reloadInto(h2, h);
  h2.renderTitle();
  const title = h2.titleState();
  assert.equal(title.hasSnapshot, true);
  assert.equal(title.continueLabel, '继续远征');
  assert.equal(title.unit, run.unit, '单元跟着快照走');
  assert.equal(h2.screen(), 's-title', '刷新后只停在主页');
  assert.equal(h2.getRun(), null, '不自动恢复、不自动进敌人');
  assert.equal(h2.getBattle(), null);
  assert.equal(h2.log.filter(e => e[0] === 'startFight').length, 0, '不得自动触发战斗语音/音效');
});

test('没有快照时主页只显示新开远征', () => {
  const h = harness();
  h.renderTitle();
  const title = h.titleState();
  assert.equal(title.hasSnapshot, false);
  assert.equal(title.continueLabel, null);
});

test('新开远征时若存在旧快照，必须先明确确认放弃', () => {
  // 玩家刷新过页面：内存里没有 run（G 为 null），但存档里留着未结束的快照。
  // 这正是「无声覆盖」最危险的地方 —— 点「开始远征」前必须明确确认。
  const src = harness();
  startRun(src);
  src.enterNode(battleNode(src.getRun()));
  src.getRun().gold = 300;
  src.pause({});

  let asked = 0;
  const h = harness();
  reloadInto(h, src);              // 页面刚加载：运行态空、快照在
  assert.equal(h.getRun(), null);

  h.setConfirm(() => { asked++; return false; });
  assert.equal(h.startRunFromUi(), false, '玩家未确认就不许覆盖');
  assert.equal(asked, 1);
  assert.equal(h.getRun(), null, '未确认时不得建新远征');
  const kept = h.peekSnapshot();
  assert.equal(kept.ok, true, '未确认时旧快照必须原样留着');
  assert.equal(kept.value.run.gold, 300, '旧进度一点不许丢');

  h.setConfirm(() => { asked++; return true; });
  assert.equal(h.startRunFromUi(), true);
  assert.equal(asked, 2);
  assert.notEqual(h.getRun(), null);
  const snap = h.peekSnapshot();
  assert.equal(snap.ok, true);
  assert.equal(snap.value.run.gold, 0, '新远征是干净的');
  assert.equal(snap.value.run.floor, 1);
  assert.equal(h.DB.runs, 2, '确认放弃后新开一轮才 +1（原本那轮已经计过）');
});

test('无快照时新开远征不打扰玩家（不弹确认）', () => {
  const h = harness();
  let asked = 0;
  h.setConfirm(() => { asked++; return true; });
  assert.equal(h.startRunFromUi(), true);
  assert.equal(asked, 0, '没有旧快照时不打扰玩家');
  assert.equal(h.DB.runs, 1);
});
/* ================= 8. 返回主页 ≠ 放弃远征 ================= */

test('返回主页保留这一局：快照还在、内存还在、而且仍处于暂停', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  run.gold = 321;
  h.pause({});

  assert.equal(h.returnToTitle(), true);
  // 关键三条：没删快照、没清内存、没解冻
  assert.equal(h.peekSnapshot().ok, true, '快照必须留着：刷新后还能继续');
  assert.equal(h.getRun(), run, '内存里那一局必须留着');
  assert.equal(h.isPaused(), true, '仍是暂停：回到主页不等于继续游戏');
  assert.equal(h.lifecycle.isPaused(), true, '延迟任务必须继续冻结');
  assert.equal(h.atTitle(), true);
  assert.equal(run.gold, 321);
});

test('返回主页不 resume 旧的延迟任务：推进不会在主页上自己发生', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  let advanced = 0;
  h.lifecycle.scheduleRun(() => { advanced++; }, 500);
  h.pause({});

  h.returnToTitle();
  h.advanceTime(5000);                       // 主页上待了很久
  assert.equal(advanced, 0, '返回主页后待办不许在主页上跑掉');
  // 回到游戏里才补上，且只补一次
  assert.equal(h.continueRun().ok, true);
  h.advanceTime(5000);
  assert.equal(advanced, 1, '继续后补一次，不多不少');
});

test('主页上「继续远征」原样回到离开的那一屏，而不是重建一遍', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  const B = h.getBattle();
  B.combo = 5; B.hints = 2;
  h.pause({});

  const out = h.continueRun();
  assert.equal(out.ok, true);
  assert.equal(out.source, 'memory', '同页必须走内存恢复，不重建队列');
  assert.equal(h.screen(), 's-fight', '回到离开时那一屏');
  assert.equal(h.getBattle(), B, '同一个战斗对象：没重建');
  assert.equal(h.getBattle().combo, 5, '半词与连击原样');
  assert.equal(h.isPaused(), false);
  // 没有重建，就不该重新画界面（重建会把卡片 _used 清掉）
  assert.equal(h.log.some(e => e[0] === 'reopenEncounter'), false);
});

test('返回主页后新开远征：先确认放弃，确认后这一局才真的丢掉', () => {
  const h = harness();
  startRun(h);
  h.pause({});
  h.returnToTitle();
  const runsBefore = h.DB.runs;

  let asked = 0;
  h.setConfirm(() => { asked++; return false; });
  assert.equal(h.startRunFromUi(), false, '未确认就不许开新局');
  assert.equal(asked, 1, '有暂停中的远征就必须问一次');
  assert.notEqual(h.getRun(), null, '未确认时这一局必须还在');

  h.setConfirm(() => { asked++; return true; });
  assert.equal(h.startRunFromUi(), true, '确认后必须能开新局（不被闸门永远挡住）');
  assert.equal(h.getRun().result, undefined, '新局是干净的');
  assert.equal(h.DB.runs, runsBefore + 1);
  assert.equal(h.lifecycle.isPaused(), false, '新局的延迟任务必须能正常排期');
});

test('正在玩的一局仍然挡住连点开新局（返回主页的那一局才放行）', () => {
  const h = harness();
  startRun(h);
  let asked = 0;
  h.setConfirm(() => { asked++; return true; });
  assert.equal(h.startRunFromUi(), false, '正在玩的一局：连点直接挡住');
  assert.equal(asked, 0, '这种情况不该打扰玩家');
  assert.equal(h.DB.runs, 1);
});

test('没有存储时返回主页也不丢这一局：主页仍给入口，同页可继续', () => {
  const h = harness({ noStorage: true });
  const run = startRun(h);
  h.enterNode(battleNode(run));
  run.gold = 55;
  h.pause({});

  h.returnToTitle();
  assert.equal(h.getRun(), run, '内存里这一份是唯一的，绝不能清');
  const title = h.titleState();
  assert.equal(title.hasSnapshot, true, '主页必须仍显示继续入口');
  assert.equal(title.heldInMemory, true);
  assert.equal(title.floor, run.floor);
  assert.equal(title.savedAt, null, '没有存档就如实说没有保存时间');

  const out = h.continueRun();
  assert.equal(out.ok, true, '同页照样能继续');
  assert.equal(h.getRun().gold, 55, '数据一点不丢');
  assert.equal(h.screen(), 's-fight');
});

/* ================= 9. 已结算的局不再被存 / 不再被后台复活 ================= */

test('已结算的一局：暂停、切后台、pagehide 一律不写快照', () => {
  const h = harness();
  startRun(h);
  h.pause({});
  assert.equal(h.peekSnapshot().ok, true);

  h.resume();
  h.endRun(false);
  assert.equal(h.peekSnapshot().ok, false, '结算后快照已删');
  const writesAfterEnd = h.mem.writes;

  const p = h.pause({});
  assert.equal(p.reason, 'finished', '已结算不允许再暂停保存');
  assert.equal(h.onHidden(), false, '切后台不得复活已结算的一局');
  assert.equal(h.onPageHide(), false);
  assert.equal(h.mem.writes, writesAfterEnd, '一个字节都不许再写');
  assert.equal(h.peekSnapshot().ok, false);
  assert.equal(h.isFinished(), true);
});

test('结算后再切后台：pagehide 之后仍然没有快照', () => {
  const h = harness();
  startRun(h);
  h.pause({});
  h.resume();
  h.endRun(true);
  h.onHidden();
  h.onPageHide();
  assert.equal(h.peekSnapshot().ok, false, '刷新后不会复活成一局死局');
  assert.equal(h.DB.rewards.length, 1, '纪念卡只生成一张');
});

test('结算与清快照是同一次写：不会留下「奖励已发、快照还在」的窗口', () => {
  const h = harness();
  startRun(h);
  h.pause({});
  const before = h.mem.writes;
  h.resume();
  h.endRun(true);
  // 关键：结算 + 清快照只写一次。两次写就会留下可被复活/双发的窗口。
  assert.equal(h.mem.writes - before, 1, '结算与清快照必须是同一次 storage.save');
  const after = JSON.parse(h.mem.map.get(STORAGE_KEY));
  assert.equal('activeRun' in after, false);
  assert.equal(after.rewards.length, 1, '新 totals 与「无快照」在同一份里');
});

test('结算相位可跨刷新恢复：只补一次纪念卡，不重新开奖、不重复记通关', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  h.getBattle().won = true;
  run.clearedRun = true;                      // registerRunWin 已在 finishBattleNode 记过
  const winsBefore = h.DB.wins;
  h.setPhase('ending');
  h.setOutcome(true);
  h.setEncounter(null);
  const out = h.pause({});
  assert.equal(out.saved, true, '结算相位也必须能存（否则这段延迟里刷新就丢结果）');
  const snap = h.peekSnapshot();
  assert.equal(snap.ok, true, snap.reason);
  assert.equal(snap.value.phase, 'ending');
  assert.equal(snap.value.outcome, true, '快照必须记住是赢还是输');

  const h2 = harness();
  reloadInto(h2, h);
  const resumed = h2.continueRun();
  assert.equal(resumed.ok, true, resumed.reason);
  assert.equal(h2.log.filter(e => e[0] === 'endRun').length, 1, '只结算一次');
  assert.equal(h2.DB.wins, winsBefore, '恢复不得再 +1 通关数');
  assert.equal(h2.DB.rewards.length, 1, '纪念卡只一张');
  assert.equal(h2.peekSnapshot().ok, false, '结算完快照必须已删');
});

test('结算相位（输）恢复后不重新开奖', () => {
  const h = harness();
  const run = startRun(h);
  h.enterNode(battleNode(run));
  h.setPhase('ending');
  h.setOutcome(false);
  h.setEncounter(null);
  assert.equal(h.pause({}).saved, true);

  const h2 = harness();
  reloadInto(h2, h);
  assert.equal(h2.continueRun().ok, true);
  assert.equal(h2.log.filter(e => e[0] === 'endRun' && e[1] === false).length, 1);
  assert.equal(h2.DB.rewards.length, 0, '输了没有纪念卡');
  assert.equal(h2.peekSnapshot().ok, false);
});

/* ================= 10. 保存一致性：学习记录与快照同一次提交 ================= */

test('每个完成状态的动作结束时提交一次：读到的是完整动作，不是中间态', () => {
  const h = harness();
  startRun(h);
  const run = h.getRun();
  h.enterNode(battleNode(run));
  const B = h.getBattle();
  B.hints = 3;

  // 一次完整的字母输入：半词 / 连击 / 统计必须一起落盘
  const idx = B.letters.findIndex((c, i) => !B.used[i]);
  h.pressLetter(idx);
  const snap = h.peekSnapshot();
  assert.equal(snap.ok, true, snap.reason);
  assert.equal(snap.value.battle.input.length, B.input.length, '快照里的半词与内存一致');
  assert.equal(snap.value.run.attOk, run.attOk, '统计与战斗事实同一帧');
  assert.equal(snap.value.battle.combo, B.combo);
});

test('提交失败不谎称成功，也不让内存与存档静默分叉', () => {
  const h = harness();
  startRun(h);
  h.mem.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = h.checkpoint();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'failed');
});
