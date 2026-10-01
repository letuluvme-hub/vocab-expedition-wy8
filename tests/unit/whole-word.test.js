import { test } from 'node:test';
import assert from 'node:assert/strict';
// 静态引入：winFight 桩的授权判定必须是**同步**的，否则顺序 / 计数断言会失真。
import { canFinishFight } from '../../src/domain/battle-rules.js';

/* ============================================================
 * 最终击杀必须完成当前整词（bug-whole-word）
 *
 * 覆盖两层：
 *   1) 纯规则 battle-rules：applyDamage 的「非完整词伤害留 1 血」地板、
 *      以及 winFight 的唯一授权条件 canFinishFight。
 *   2) 战斗控制器集成：单字母 / 荆棘 / 道具打不出胜负；只有 pressKey 的
 *      整词完成分支能赢；重复结算与胜利只发生一次。
 *
 * 这里全部用 Node 桩，不碰 DOM / 存档 / window。
 * ============================================================ */

/* ---------------- 纯规则 ---------------- */

test('applyDamage：非完整词伤害只能削血，敌人血量永远钉在 1', async () => {
  const { applyDamage, MIN_ENEMY_HP } = await import('../../src/domain/battle-rules.js');
  const B = { enHp: 100 };
  const r = applyDamage(B, 30);
  assert.equal(B.enHp, 70);
  assert.equal(r.lethal, false);
  // 超过剩余血量也只扣到地板，并如实报告**实际**扣掉的血
  const hard = applyDamage(B, 999);
  assert.equal(B.enHp, MIN_ENEMY_HP);
  assert.equal(hard.dealt, 69, '反馈必须展示真实扣血，不能报 999');
  assert.equal(hard.lethal, false, '非完整词伤害永远不致命');
  // 已经在地板上时不再掉血，也不致命
  const floor = applyDamage(B, 50);
  assert.equal(B.enHp, MIN_ENEMY_HP);
  assert.equal(floor.dealt, 0);
  assert.equal(floor.lethal, false);
});

test('applyDamage：allowFinish=true 才能把敌人打死（整词大招）', async () => {
  const { applyDamage } = await import('../../src/domain/battle-rules.js');
  const B = { enHp: 35 };
  const r = applyDamage(B, 40, { allowFinish: true });
  assert.equal(B.enHp, -5);
  assert.equal(r.dealt, 40);
  assert.equal(r.lethal, true);
  // 恰好扣到 0 也算致命（词大招刚好打空）
  const B2 = { enHp: 40 };
  assert.equal(applyDamage(B2, 40, { allowFinish: true }).lethal, true);
  assert.equal(B2.enHp, 0);
  // 没打空就不是致命
  const B3 = { enHp: 41 };
  assert.equal(applyDamage(B3, 40, { allowFinish: true }).lethal, false);
  assert.equal(B3.enHp, 1);
});

test('applyDamage：负数/零/NaN 伤害与空战斗都不改变状态', async () => {
  const { applyDamage } = await import('../../src/domain/battle-rules.js');
  const B = { enHp: 10 };
  assert.deepEqual(applyDamage(B, 0), { before: 10, after: 10, dealt: 0, lethal: false });
  assert.deepEqual(applyDamage(B, -5), { before: 10, after: 10, dealt: 0, lethal: false });
  assert.equal(B.enHp, 10);
  applyDamage(B, NaN);
  assert.equal(B.enHp, 10);
  applyDamage(B, undefined);
  assert.equal(B.enHp, 10);
  assert.deepEqual(applyDamage(null, 10), { before: 0, after: 0, dealt: 0, lethal: false });
});

test('applyDamage：敌人已死（enHp<=0）或本场已结算后一律 no-op —— 不复活、不反向 dealt', async () => {
  const { applyDamage, MIN_ENEMY_HP } = await import('../../src/domain/battle-rules.js');
  // 已死：负 HP。真实路径是整词大招过量击打（35 血挨 40 点 → -5）。
  const dead = { enHp: -5 };
  const r = applyDamage(dead, 999);
  assert.equal(dead.enHp, -5, '死人不能被后续伤害「复活」回 1 血地板');
  assert.equal(r.dealt, 0, '死人不再扣血，反馈不能报负数 dealt');
  assert.equal(r.lethal, false, 'no-op 不再报致命（否则会二次触发 winFight）');
  // 已结算：本场 over / finished 之后到达的迟到伤害（连点、动画回调）
  for (const flag of ['over', 'finished']) {
    const b = { enHp: 200, [flag]: true };
    const x = applyDamage(b, 999, { allowFinish: true });
    assert.equal(b.enHp, 200, flag + ' 之后的伤害必须 no-op');
    assert.equal(x.dealt, 0);
    assert.equal(x.lethal, false);
  }
  // 恰好 0 血（词大招刚好打空）也属于已死，同样不得被抬高
  const zero = { enHp: 0 };
  assert.equal(applyDamage(zero, 999).after, 0);
  assert.notEqual(zero.enHp, MIN_ENEMY_HP);
});

test('applyDamage：HP 非法（NaN / undefined / 字符串脏值）时不改状态、不授权', async () => {
  const { applyDamage, MIN_ENEMY_HP } = await import('../../src/domain/battle-rules.js');
  for (const bad of [NaN, undefined, null, 'abc', {}]) {
    const b = { enHp: bad };
    const r = applyDamage(b, 999, { allowFinish: true });
    assert.equal(r.dealt, 0, '非法 HP 不得产生扣血：' + String(bad));
    assert.equal(r.lethal, false, '非法 HP 不得授权致命：' + String(bad));
    assert.ok(b.enHp === bad || !isFinite(Number(b.enHp)),
      '非法 HP 不得被默认值悄悄改写成可打空的血量：' + String(b.enHp));
    assert.notEqual(Number(b.enHp), MIN_ENEMY_HP);
  }
  // 合法但很小的非整数血量：地板只能夹到 min(before, 1)，不能被抬到 1
  const half = { enHp: 0.5 };
  const h = applyDamage(half, 10);
  assert.equal(half.enHp, 0.5, '0.5 血不会被地板抬成 1 血');
  assert.equal(h.dealt, 0);
  assert.equal(h.lethal, false);
});

test('canFinishFight：非法 HP 与 finished 状态一律 fail closed', async () => {
  const { canFinishFight } = await import('../../src/domain/battle-rules.js');
  const base = { word: { w: 'keep' }, input: ['k', 'e', 'e', 'p'], enHp: -30, over: false };
  // 非整数值血量：||0 兜底会把 NaN/undefined 变成 0 → 看起来「已打空」而放行胜利
  for (const bad of [NaN, undefined, null, 'abc', {}]) {
    assert.equal(canFinishFight({ ...base, enHp: bad }), false,
      '非法 HP 必须 fail closed，不能被当成已打空：' + String(bad));
  }
  assert.equal(canFinishFight({ ...base, enHp: undefined }), false);
  // finished：本场已结算过（finishBattleNode 写的标记）
  assert.equal(canFinishFight({ ...base, finished: true }), false, 'finished 之后不得再授权胜利');
  // 活着的敌人（哪怕只剩 0.5 血）也不能赢
  assert.equal(canFinishFight({ ...base, enHp: 0.5 }), false);
});

test('canFinishFight：整词拼完 + 敌人真被打空 + 还没结算，三者齐备才放行', async () => {
  const { canFinishFight } = await import('../../src/domain/battle-rules.js');
  const base = { word: { w: 'keep' }, input: ['k', 'e', 'e', 'p'], enHp: -30, over: false };
  assert.equal(canFinishFight(base), true);
  // 半词：授权不成立（荆棘 / 单字母 / 道具走 win 全部被这道门挡住）
  assert.equal(canFinishFight({ ...base, input: ['k'] }), false);
  // 还没打死
  assert.equal(canFinishFight({ ...base, enHp: 1 }), false);
  // 已经结算过
  assert.equal(canFinishFight({ ...base, over: true }), false);
  // 缺战斗对象 / 缺词
  assert.equal(canFinishFight(null), false);
  assert.equal(canFinishFight({ input: ['k', 'e', 'e', 'p'], enHp: -1 }), false);
  // 单字母词「i」拼完一个字母就满足整词条件
  assert.equal(canFinishFight({ word: { w: 'i' }, input: ['i'], enHp: -1 }), true);
});

/* ---------------- 战斗控制器集成 ---------------- */

function el(extra) {
  const e = {
    id: '', className: '', textContent: '', innerHTML: '', title: '', hidden: false,
    disabled: false, offsetWidth: 10, children: [], onclick: null, dataset: {},
    style: { setProperty() {} }, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    remove() {}
  };
  return Object.assign(e, extra || {});
}
function hud() {
  return {
    fBank: el(), fCombo: el(), fAv: el(), fMy: el(), fItems: el(), fCat: el(),
    pTitle: el(), pSub: el(), pPicks: el(), pSkip: el(),
    eIcon: el(), eTitle: el(), eText: el(), ePicks: el(),
    rTitle: el(), rSub: el(), rPicks: el()
  };
}
function timers() {
  const jobs = [];
  return { jobs, scheduleRun: (fn, ms) => jobs.push({ fn, ms, run: true }),
    scheduleBattle: (fn, ms) => jobs.push({ fn, ms, battle: true }), fire() { for (const j of jobs) j.fn(); } };
}
const ITEM_IDS = ['leech', 'rage', 'freeze', 'chain', 'reveal', 'purge', 'greed', 'stone'];

function battleFixture(over) {
  const G = { floor: 3, hp: 50, maxhp: 50, shield: 0, gold: 30, relics: [], hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: { leech: 2, stone: 1 },
    att: 0, attOk: 0, kills: 0, unit: 1, heroId: 'a', node: { done: false, links: [] }, nextHint: 0 };
  // keep 的 4 个答案字母 + 1 个干扰字母 x
  const B = { word: { w: 'keep', z: '保持', u: 1, d: 1 },
    letters: ['k', 'e', 'e', 'p', 'x'], used: [false, false, false, false, false],
    bad: [false, false, false, false, false], input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0,
    combo: 0, maxCombo: 0, dmgBonus: 0, firstWrong: true, lethUsed: 0,
    wordsDone: 0, over: false, won: false, boss: false, elite: false, myHp: 50, enHp: 200, enMax: 200,
    shield: 0, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
    usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' } };
  return { G, B: Object.assign(B, over || {}) };
}

async function makeCombat(over) {
  const { G, B } = battleFixture(over);
  const { createCombatController } = await import('../../src/app/combat.js');
  // 判据用真实的 wordComplete（learning.js），避免桩与生产漂移
  const { wordComplete } = await import('../../src/domain/learning.js');
  const DB = { mastered: [], runs: 0, wins: 0, rewards: [] };
  const ids = hud(), tm = timers();
  const toasts = [], order = [], floatTxts = [], saved = [];
  const state = { DB, G, B };
  const noop = k => (...a) => order.push([k, ...a]);
  const rewardCalls = [];
  // winFight 的桩走**真实**授权条件 canFinishFight，并复刻 runtime 的结算副作用
  // （B.over/B.won、kills++、金币、奖励面板）。这样「赢了几次」这个事实本身就等价于
  // 授权条件成立了几次，重复调用必须被 canFinishFight 挡掉而不是靠桩自己 if。
  const portsWin = () => {
    if (!canFinishFight(state.B)) return false;
    state.B.over = true; state.B.won = true;
    G.kills++;
    rewardCalls.push(1);
    order.push(['winFight']);
    return true;
  };
  const ports = {
    $: id => ids[id], norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: n => 0, hasR: id => G.relics.indexOf(id) >= 0,
    itemById: id => ITEM_IDS.indexOf(id) >= 0 ? { id, n: id, max: 6, ic: '🩸' } : undefined,
    hitDmg: () => 10, wordDmg: () => 40, wordComplete: () => wordComplete(state.B),
    creditWord: w => { DB.mastered.push(w); G.done.add(w); },
    onWordWrong: w => { G.wrong.push(w); },
    centerOf: () => ({ x: 10, y: 10 }), heroPoint: () => ({ x: 5, y: 5 }),
    toast: m => toasts.push(m),
    sfx: { good: noop('good'), bad: noop('bad'), hit: noop('hit'), hurt: noop('hurt'), undo: noop('undo'),
      hint: noop('hint'), word: noop('word'), combo: noop('combo'), flee: noop('flee'), item: noop('item'),
      relic: noop('relic'), coin: noop('coin'), finisher: noop('finisher'), win: noop('win'), lose: noop('lose') },
    TTS: { line: noop('line'), word: noop('ttsword'), hint: noop('ttshint'), foeLine: noop('foeLine') },
    burst: noop('burst'),
    floatTxt: (...a) => { floatTxts.push(a[2]); order.push(['floatTxt', ...a]); },
    flash: noop('flash'), ring: noop('ring'), animHero: noop('animHero'),
    wordFinisher: noop('wordFinisher'), foeCry: noop('foeCry'),
    renderFight: () => order.push(['renderFight']), nextWord: () => order.push(['nextWord']),
    winFight: portsWin, loseFight: noop('loseFight'),
    finishNode: noop('finishNode'), saveDB: () => saved.push(1),
    scheduleBattle: (fn, ms) => tm.scheduleBattle(fn, ms)
  };
  const ctrl = createCombatController({ state, ports });
  const wins = () => order.filter(x => x[0] === 'winFight');
  return { state, ctrl, order, toasts, floatTxts, ids, tm, db: DB, wins, portsWin, rewardCalls };
}

test('pressKey：单字母把敌人打到地板血也不能赢 —— 必须拼完整词', async () => {
  const h = await makeCombat({ enHp: 10 });
  h.ctrl.pressKey(0);                                   // 10 点伤害，敌人还剩 10
  h.state.B.enHp = 3;
  h.ctrl.pressKey(1);                                   // 这一击足以打死，但只是单字母
  assert.equal(h.state.B.enHp, 1, '非完整词伤害把敌人钉在 1 血');
  assert.deepEqual(h.wins(), [], '单字母永远不能触发 winFight');
  assert.equal(h.state.B.over, false, '战斗继续');
  assert.deepEqual(h.state.B.input, ['k', 'e'], '字母照常入盘，伤害照常结算');
  assert.equal(h.state.B.combo, 2);
  assert.equal(h.state.G.attOk, 2);
});

test('pressKey：荆棘反弹同样不能赢，敌人钉在 1 血', async () => {
  const h = await makeCombat({ enHp: 3 });
  h.state.G.relics.push('thorn');
  h.ctrl.hurtPlayer(6, 'x', 'k');
  assert.equal(h.state.B.enHp, 1, '荆棘 5 点打不死人');
  assert.deepEqual(h.wins(), [], '荆棘反弹不得走 winFight');
  assert.equal(h.state.B.over, false);
});

test('pressKey：被打到 1 血后仍必须把当前词拼完才能赢', async () => {
  const h = await makeCombat({ enHp: 5 });
  h.ctrl.pressKey(0); h.ctrl.pressKey(1);               // k e —— 敌人被压到 1 血
  assert.equal(h.state.B.enHp, 1);
  assert.deepEqual(h.wins(), []);
  assert.equal(orderHas(h.order, 'nextWord'), false, '没拼完不得换词');
  // 第三个字母仍只是普通命中
  h.order.length = 0;
  h.ctrl.pressKey(2);                                   // e
  assert.deepEqual(h.state.B.input, ['k', 'e', 'e']);
  assert.equal(h.state.B.enHp, 1);
  assert.deepEqual(h.wins(), [], '最后一个字母的普通 hit 不能抢先赢');
  assert.equal(orderHas(h.order, 'wordFinisher'), false, '大招只在整词完成分支跑');
  assert.equal(orderHas(h.order, 'nextWord'), false);
  // 第四个字母完成整词 → 大招才能收尾
  h.order.length = 0;
  h.ctrl.pressKey(3);                                   // p
  assert.equal(h.state.B.enHp, 1 - 40);
  assert.equal(h.wins().length, 1, '整词大招是唯一的胜利来源');
  assert.equal(orderHas(h.order, 'wordFinisher'), true);
  assert.equal(orderHas(h.order, 'nextWord'), false, '已死不再换词');
  assert.deepEqual(h.db.mastered, ['keep']);
  assert.equal(h.state.B.wordsDone, 1);
  assert.equal(h.state.B.wordStreak, 1);
});

test('pressKey：整词大招打不死时照常换词，战斗不结束', async () => {
  const h = await makeCombat({ enHp: 200 });
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2); h.ctrl.pressKey(3);
  assert.equal(h.state.B.enHp, 200 - 10 * 4 - 40);
  assert.deepEqual(h.wins(), []);
  assert.equal(orderHas(h.order, 'nextWord'), true);
  assert.deepEqual(h.db.mastered, ['keep']);
});

test('pressKey：单字母英语 i 这种极短词拼完一个字母就是整词，允许赢', async () => {
  const h = await makeCombat({ enHp: 20, word: { w: 'i', z: '我', u: 1, d: 1 } });
  h.state.B.letters = ['i', 'q'];
  h.state.B.used = [false, false];
  h.state.B.bad = [false, false];
  h.ctrl.pressKey(0);
  assert.deepEqual(h.state.B.input, ['i']);
  assert.deepEqual(h.db.mastered, ['i'], '单字母词拼完即学会');
  assert.equal(h.state.B.wordsDone, 1);
  assert.equal(h.state.B.enHp, 20 - 10 - 40);
  assert.equal(h.wins().length, 1);
});

test('pressKey：胜利后重复结算与重复按最后一个键都无效（一次金币 / kills / 掌握 / 奖励）', async () => {
  const h = await makeCombat({ enHp: 1 });
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2); h.ctrl.pressKey(3);
  assert.equal(h.wins().length, 1, '整词大招赢一次');
  assert.equal(h.state.B.won, true, 'winFight 真的置了 won，而不是空操作');
  assert.equal(h.state.G.kills, 1);
  assert.equal(h.rewardCalls.length, 1);
  const snap = () => JSON.stringify({
    over: h.state.B.over, won: h.state.B.won, enHp: h.state.B.enHp,
    wordsDone: h.state.B.wordsDone, wordStreak: h.state.B.wordStreak,
    mastered: h.db.mastered, done: [...h.state.G.done], kills: h.state.G.kills
  });
  const before = snap();
  // 连点最后那个键（已 used 的槽位）
  h.ctrl.pressKey(3);
  h.ctrl.pressKey(3);
  // 再从「直接调用 winFight」入口打一次 —— 授权判据在 canFinishFight 里，
  // 已结算的 B 必须被拒掉，kills / 奖励 / 掌握全部不得二次发生。
  assert.equal(h.portsWin(), false, '已结算的战场再调 winFight 必须被授权闸门拒绝');
  assert.equal(h.wins().length, 1, 'winFight 只发生一次');
  assert.equal(h.rewardCalls.length, 1, '奖励面板只安排一次');
  assert.equal(h.state.G.kills, 1, 'kills 不二次计数');
  assert.equal(snap(), before, '重复输入 / 重复结算后状态必须逐字段不变');
});

test('pressKey：整词完成后再补一刀（迟到的荆棘 / dealDamage）不会二次赢', async () => {
  const h = await makeCombat({ enHp: 1 });
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2); h.ctrl.pressKey(3);
  assert.equal(h.wins().length, 1);
  const kills = h.state.G.kills;
  // 战斗已结算，但迟到的伤害回调仍然到达：不得改动血量，也不得二次授权
  h.ctrl.dealDamage(999);
  assert.equal(h.state.B.enHp, -39, '死人不再掉血，也不会被抬回 1 血地板');
  assert.equal(h.state.G.kills, kills);
  assert.equal(h.wins().length, 1);
  assert.equal(h.rewardCalls.length, 1);
});

test('dealDamage / hurtPlayer 的直接调用同样受地板约束', async () => {
  const h = await makeCombat({ enHp: 4 });
  h.ctrl.dealDamage(999);
  assert.equal(h.state.B.enHp, 1);
  assert.deepEqual(h.wins(), [], '直接调 dealDamage 也不能赢');
  const shown = h.floatTxts.filter(t => typeof t === 'string' && t.indexOf('-') === 0);
  assert.ok(shown.includes('-3'), '普通反馈展示实际扣血 3，而不是 999：' + JSON.stringify(shown));
  const h2 = await makeCombat({ enHp: 4 });
  h2.state.G.relics.push('thorn');
  h2.ctrl.hurtPlayer(4, 'x', 'k');
  assert.equal(h2.state.B.enHp, 1);
  assert.ok(h2.floatTxts.some(t => t === '荆棘 -3'), '荆棘反馈同样展示实际扣血：'
    + JSON.stringify(h2.floatTxts));
  assert.deepEqual(h2.wins(), []);
});

test('荆棘把敌人压到 1 血后，整词完成是唯一的出路', async () => {
  const h = await makeCombat({ enHp: 4 });
  h.state.G.relics.push('thorn');
  h.ctrl.hurtPlayer(4, 'x', 'k');                       // 荆棘 5 → 敌人 1 血
  assert.equal(h.state.B.enHp, 1);
  assert.deepEqual(h.wins(), []);
  h.state.B.freezeWord = false;
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2);
  assert.equal(h.state.B.enHp, 1);
  assert.deepEqual(h.wins(), []);
  h.ctrl.pressKey(3);
  assert.equal(h.wins().length, 1);
});

function orderHas(order, name) { return order.some(x => x[0] === name); }