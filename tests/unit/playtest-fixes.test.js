/* 实机反馈这一轮的四处修复。每处都先钉住「玩家真正看到 / 真正拿到的东西」。
 *
 *   1) 预知残卷（传说）：一轮远征只触发**一次**。原实现每次答错都全词揭示，
 *      而 B.hints 有 3-5 点底子 —— 等于每局白嫖 3-5 次完整答案，学习价值归零。
 *   2) 商店买完东西，顶部的金币必须**跟着变**。原实现只在进入商店时写一次
 *      rSub，点完卡片不刷新，玩家付了钱却看不见扣款。
 *   3) 磨砺石（生命上限 +10）每轮限购。原实现 70 金币无限买，后期数值崩坏。
 *   4) 赌局文案说的是**这一局赢到的数额**，不是赢完之后的账户总额。
 *
 * 两个新落盘字段（prophecyUsed / whetBuys）都必须是**可选**的：旧存档里根本没有
 * 这两个键，缺了就按「还没用 / 还没买过」回落，绝不因此把正在进行的一局判成损坏。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { createEncounterController } from '../../src/app/encounters.js';
import { createRun } from '../../src/domain/run.js';
import { WORDS } from '../../src/data/words.js';
import { ITEMS } from '../../src/data/items.js';
import { PHASE, encodeSnapshot, decodeSnapshot } from '../../src/domain/run-snapshot.js';
import { relicPrice } from '../../src/domain/relic-rules.js';

const ITEMS_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const UNIT1 = WORDS.filter(w => w.u === 1);
const HERO = { id: 'ranger', mod: { hp: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), s >>> 7) + 0x9e3779b9) >>> 0; return s / 4294967296; };
}
const freshRun = () => createRun(1, HERO, UNIT1, mulberry(0x51a7));
const envelopeOf = run => ({
  phase: PHASE.MAP, savedAt: '2026-10-01T12:00:00.000Z',
  run, battle: null, encounter: null,
});
const encoded = env => JSON.parse(JSON.stringify(encodeSnapshot(env)));
const roundTrip = env => decodeSnapshot(encoded(env));

/* ================= 1) 预知残卷：一轮只触发一次 ================= */

function combatHarness({ relics = [], hints = 3 } = {}) {
  const G = {
    floor: 3, hp: 60, maxhp: 60, shield: 0, gold: 30, relics: relics.slice(), hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: {}, att: 0, attOk: 0,
    kills: 0, unit: 1, heroId: 'a', node: { done: false, links: [] }, nextHint: 0,
  };
  const B = {
    word: { w: 'keep', z: '保持', u: 1, d: 1 }, letters: ['k', 'e', 'e', 'p', 'x'],
    used: [false, false, false, false, false], bad: [false, false, false, false, false],
    input: [], sel: 0, hints, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0, dmgBonus: 0,
    firstWrong: false, lethUsed: 0, wordsDone: 0, over: false, boss: false, elite: false,
    myHp: 60, enHp: 200, enMax: 200, shield: 0, rageLeft: 0, freezeWord: false, chainNext: false,
    goldMult: 1, usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' },
  };
  const DB = { mastered: [], runs: 0, wins: 0, rewards: [] };
  const ids = { fBank: el(), fCombo: el(), fAv: el(), fMy: el(), fItems: el(), fCat: el() };
  const toasts = [];
  const state = { DB, G, B };
  const combat = createCombatController({
    state,
    ports: {
      $: id => ids[id], norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: () => 0,
      hasR: id => G.relics.indexOf(id) >= 0,
      itemById: id => ITEMS_BY_ID[id],
      hitDmg: () => 10, wordDmg: () => 40,
      wordComplete: () => state.B.input.length >= 4,
      creditWord: () => {}, onWordWrong: () => {},
      centerOf: () => ({ x: 1, y: 1 }), heroPoint: () => ({ x: 2, y: 2 }),
      toast: m => toasts.push(String(m)),
      sfx: new Proxy({}, { get: () => () => {} }),
      TTS: { line() {}, word() {}, hint() {}, foeLine() {}, stop() {}, supported: false, on: false },
      burst() {}, floatTxt() {}, flash() {}, ring() {}, animHero() {}, wordFinisher() {}, foeCry() {},
      renderFight() {}, nextWord() {}, winFight() {}, loseFight() {}, finishNode() {},
      saveDB() {}, scheduleBattle() {}, notifyLetterAttempted: () => true,
    },
  });
  return { G, B, DB, combat, toasts };
}
function el(extra) {
  return Object.assign({
    id: '', className: '', textContent: '', innerHTML: '', title: '', hidden: false, disabled: false,
    offsetWidth: 10, children: [], onclick: null, dataset: {},
    style: { setProperty() {} }, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    remove() {},
  }, extra || {});
}
const WRONG = 4;   // 字母盘第 5 个是 'x'，不在 keep 里 —— 一次干净的真实答错

test('预知残卷：第一次答错就揭示，而且记账在本轮远征上', () => {
  const h = combatHarness({ relics: ['prophecy'], hints: 3 });
  h.combat.pressKey(WRONG);
  assert.equal(h.B.hints, 2, '揭示一次吃掉 1 点提示额度');
  assert.equal(h.G.prophecyUsed, true, '★「本轮已用」必须记在 run 上，换战斗不重置');
});

test('预知残卷：第二次答错不再揭示，也不再扣额度', () => {
  const h = combatHarness({ relics: ['prophecy'], hints: 3 });
  h.combat.pressKey(WRONG);
  const hints = h.B.hints;
  h.B.input = [];                                   // 换一个词继续
  h.B.word = { w: 'book', z: '书', u: 1, d: 1 };
  h.B.letters = ['b', 'o', 'o', 'k', 'x'];
  h.B.used = [false, false, false, false, false];
  h.B.bad = [false, false, false, false, false];
  h.combat.pressKey(WRONG);
  assert.equal(h.B.hints, hints, '★ 一轮只有一次，第二次不许再吃额度');
});

test('预知残卷：额度用尽时本来就不触发（既有的保底行为不许回退）', () => {
  const h = combatHarness({ relics: ['prophecy'], hints: 0 });
  h.combat.pressKey(WRONG);
  assert.equal(h.G.prophecyUsed, undefined, '没触发就不该消耗那一次');
  assert.equal(h.B.hints, 0, '不许扣成负数');
});

test('预知残卷：没有这件遗物时完全不记账', () => {
  const h = combatHarness({ relics: [], hints: 3 });
  h.combat.pressKey(WRONG);
  assert.equal(h.G.prophecyUsed, undefined);
  assert.equal(h.B.hints, 3);
});

/* ---- 预知残卷的落盘 ---- */

test('预知残卷用掉之后，刷新页面不会白赚第二次', () => {
  const run = Object.assign(freshRun(), { prophecyUsed: true });
  const back = roundTrip(envelopeOf(run));
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.value.run.prophecyUsed, true, '★ 必须跟着快照走');
});

test('没用过预知残卷时快照里不出现这个键，旧存档缺键回落成 false', () => {
  const env = encoded(envelopeOf(freshRun()));
  assert.ok(!('prophecyUsed' in env.run), 'false 与「缺失」同义，不写这个键');
  const back = roundTrip(envelopeOf(freshRun()));
  assert.equal(back.value.run.prophecyUsed, false, '旧存档缺这个键 → 回落成「还没用」');
  assert.deepEqual(
    Object.keys(encoded(back.value).run).sort(),
    Object.keys(env.run).sort(),
    '解码后再编码，键集合必须与旧存档逐字相同');
});

test('脏的 prophecyUsed 让整份存档 fail closed，绝不静默当成「还没用」', () => {
  for (const bad of ['yes', 1, {}, []]) {
    const env = encoded(envelopeOf(freshRun()));
    env.run.prophecyUsed = bad;
    assert.equal(decodeSnapshot(env).ok, false, JSON.stringify(bad) + ' 必须是损坏');
  }
});

/* ================= 2) + 3) + 4) 商店与赌局 ================= */

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.dataset = {}; this.className = ''; this._text = '';
    this.style = {}; this.hidden = false; this.onclick = null; this.title = '';
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  classList = { add() {}, remove() {} };
}
const IDS = ['eIcon', 'eTitle', 'eText', 'ePicks', 'rTitle', 'rSub', 'rPicks', 'pTitle', 'pSub', 'pPicks', 'pSkip'];

function encHarness({ relics = [], gold = 100000, want = null, rnd = () => 0 } = {}) {
  const ids = new Map(IDS.map(id => [id, new El('div')]));
  ids.set('pSkip', new El('button'));
  const log = [];
  const G = {
    unit: 1, hp: 40, maxhp: 70, gold, relics: relics.slice(), bag: {}, floor: 1,
    att: 4, attOk: 3, node: { type: 'shop', done: false, links: [] },
  };
  const B = {
    foe: { n: 'slime', ic: '👾', tint: '#fff' }, boss: false, elite: false, enMax: 200,
    myHp: 40, combo: 3, maxCombo: 3, rewardTaken: false, usedThisFight: {},
  };
  const ctrl = createEncounterController({
    state: { G, B },
    ports: {
      $: id => ids.get(id) || null,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      pick: a => a[0], shuffle: a => a.slice(), rnd: () => 0,
      has: (a, v) => a.indexOf(v) >= 0,
      hasR: id => G.relics.indexOf(id) >= 0,
      goldGain: n => { G.gold += n; return G.gold; },
      applyRelicInit: () => log.push(['relicInit']),
      sfx: { relic() {}, coin() {} },
      toast: m => log.push(['toast', String(m)]),
      advance: () => log.push(['advance']), endRun: () => log.push(['endRun']),
      finishNode: () => log.push(['finishNode']), show: id => log.push(['show', id]),
      scheduleRun: () => {}, scheduleBattle: () => {},
      publishEncounter: d => log.push(['publish', d]), setPhase: () => {},
      canAct: () => true, makeButton: tag => new El(tag || 'button'),
      relicRnd: rnd,
      relicDraw: want ? pool => (pool.filter(x => x.id === want)[0] || pool[0]) : null,
    },
  });
  return { ctrl, G, B, ids, log };
}
const published = h => h.log.filter(l => l[0] === 'publish').pop()[1];
const optOf = (h, prefix) => published(h).options.filter(o => o.id.indexOf(prefix) === 0)[0];
const clickCard = (h, id) => {
  h.ids.get('rPicks').children.find(c => c.dataset.opt === id).onclick();
};
const lastToast = h => (h.log.filter(l => l[0] === 'toast').pop() || [])[1];
/* 冷却：卡点击有 260ms 防连点。测试里把 _at 清掉即可连续点。 */
const clearCooldown = h => h.ids.get('rPicks').children.forEach(c => { c._at = 0; });

test('商店：买完遗物，顶部金币必须显示扣款之后的钱', () => {
  const h = encHarness({ want: 'combo' });
  h.ctrl.showShop();
  assert.equal(h.ids.get('rSub').textContent, '你的金币：100000 枚 —— 用金币强化自己');
  const id = optOf(h, 'shop:relic:').id;
  clickCard(h, id);
  const after = 100000 - relicPrice({ rarity: 'rare' });
  assert.equal(h.G.gold, after, '钱要真的扣掉');
  assert.ok(h.ids.get('rSub').textContent.includes(String(after)),
    '★ 玩家付了钱，商店上必须看得见这笔消耗，实际「' + h.ids.get('rSub').textContent + '」');
});

test('商店：买完道具，顶部金币同样要跟着变', () => {
  const h = encHarness();
  h.ctrl.showShop();
  const id = optOf(h, 'shop:item:').id;
  clickCard(h, id);
  assert.ok(h.ids.get('rSub').textContent.includes(String(h.G.gold)),
    '道具购买也要刷新金币显示');
});

test('商店：买不起时金币显示不动（没扣钱就不该显示新数字）', () => {
  const h = encHarness({ gold: 5, want: 'combo' });
  h.ctrl.showShop();
  clickCard(h, optOf(h, 'shop:relic:').id);
  assert.equal(h.G.gold, 5, '不许扣成负数');
  assert.ok(h.ids.get('rSub').textContent.includes('5'), '显示的钱必须还是 5');
});

/* ---- 3) 磨砺石限购 ---- */

test('磨砺石每轮限购：买满之后既不加血也不扣钱，并如实告知', () => {
  const h = encHarness();
  h.ctrl.showShop();
  clickCard(h, 'shop:whet'); clearCooldown(h);
  assert.equal(h.G.maxhp, 80, '本图只能买一次');
  const gold = h.G.gold;
  clickCard(h, 'shop:whet');
  assert.equal(h.G.maxhp, 80, '★ 超出本图限购时生命上限必须停住');
  assert.equal(h.G.gold, gold, '★ 买不成就不许扣钱');
  assert.match(lastToast(h), /本图|已经买过/, '必须如实告诉玩家为什么买不成');
  clearCooldown(h);h.G.whetMapBuys=0;clickCard(h,'shop:whet');clearCooldown(h);
  assert.equal(h.G.maxhp,90,'下一图可买第二块');
  h.G.whetMapBuys=0;const finalGold=h.G.gold;clickCard(h,'shop:whet');
  assert.equal(h.G.maxhp,90,'整次远征仍限制两块');assert.equal(h.G.gold,finalGold);
});

test('磨砺石的限购次数跟着快照走：刷新之后不会重新归零', () => {
  const h = encHarness();
  h.ctrl.showShop();
  clickCard(h, 'shop:whet');
  const run = Object.assign(freshRun(), { gold: h.G.gold, maxhp: h.G.maxhp, whetBuys: h.G.whetBuys });
  const back = roundTrip(envelopeOf(run));
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.value.run.whetBuys, 1, '★ 已买次数必须落盘');
});

test('旧存档没有磨砺石计数时按「还没买过」回落，而不是判成损坏', () => {
  const env = encoded(envelopeOf(freshRun()));
  assert.ok(!('whetBuys' in env.run), '计数为 0 时不写这个键（与「缺失」同义）');
  const out = decodeSnapshot(env);
  assert.equal(out.ok, true, out.reason);
  assert.equal(out.value.run.whetBuys, 0);
});

test('脏的磨砺石计数让整份存档 fail closed', () => {
  for (const bad of ['yes', 1.5, -1, {}]) {
    const env = encoded(envelopeOf(freshRun()));
    env.run.whetBuys = bad;
    assert.equal(decodeSnapshot(env).ok, false, JSON.stringify(bad) + ' 必须是损坏');
  }
});

/* ---- 4) 赌局文案 ---- */

/* 硬币正反面用的是模块里的 Math.random，测试直接把它钉住。 */
function withCoin(value, fn) {
  const real = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = real; }
}

/* 赌局是 EVENTS 里的一项；pick 端口默认取第一项，所以这里改成按标题挑，
   这样 EVENTS 的顺序变了也不会把这个测试带崩。
   动作不走 publish 出来的 desc（那是脱敏的，没有 fn），而是像真实玩家
   一样点 ePicks 里那张卡。 */
function gambleHarness(gold) {
  const ids = new Map(IDS.map(id => [id, new El('div')]));
  ids.set('pSkip', new El('button'));
  const toasts = [];
  const G = { unit: 1, hp: 40, maxhp: 70, gold, relics: [], bag: {}, floor: 1,
    att: 4, attOk: 3, node: { type: 'shop', done: false, links: [] } };
  const B = { foe: { n: 'slime', ic: '👾', tint: '#fff' }, boss: false, elite: false,
    enMax: 200, myHp: 40, combo: 0, maxCombo: 0, rewardTaken: false, usedThisFight: {} };
  const ctrl = createEncounterController({
    state: { G, B },
    ports: {
      $: id => ids.get(id) || null,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      pick: a => a.filter(x => x.t === '命运的赌局')[0] || a[0],
      shuffle: a => a.slice(), rnd: () => 0,
      has: (a, v) => a.indexOf(v) >= 0,
      hasR: id => G.relics.indexOf(id) >= 0,
      goldGain: n => { G.gold += n; return G.gold; },
      applyRelicInit: () => {}, sfx: { relic() {}, coin() {} },
      toast: m => toasts.push(String(m)),
      advance: () => {}, endRun: () => {}, finishNode: () => {}, show: () => {},
      scheduleRun: () => {}, scheduleBattle: () => {},
      publishEncounter: () => {}, setPhase: () => {},
      canAct: () => true, makeButton: tag => new El(tag || 'button'),
      relicRnd: () => 0, relicDraw: null,
    },
  });
  ctrl.showEvent();
  const card = id => ids.get('ePicks').children.filter(c => c.dataset.opt === id)[0];
  return { G, ids, toasts, bet: card('gamble:bet'), lastToast: () => toasts[toasts.length - 1] };
}

test('赌赢：文案报的是这一局赢到的数额，不是赢完之后的账户总额', () => {
  const h = gambleHarness(100);
  assert.ok(h.bet, '赌局必须发布押注选项');
  withCoin(0.1, () => h.bet.onclick());        // < 0.5 = 正面
  assert.equal(h.G.gold, 140, '钱本身该翻成 140 —— 修的是文案，不是结算');
  assert.match(h.lastToast(), /40/, '★ 必须报出这一局赢到的 40，实际「' + h.lastToast() + '」');
  assert.ok(h.lastToast().indexOf('140') < 0,
    '★ 不许把账户总额（140）说成「获得的」，实际「' + h.lastToast() + '」');
});

test('赌输：只输掉押上的 40，文案也只说这一局输掉的部分', () => {
  const h = gambleHarness(100);
  withCoin(0.9, () => h.bet.onclick());        // >= 0.5 = 反面
  assert.equal(h.G.gold, 60, '★ 卡面说「押上 40 金币」，就只赌这 40，不抄家');
  assert.match(h.lastToast(), /40/, '必须报出输掉的 40，实际「' + h.lastToast() + '」');
  assert.ok(h.lastToast().indexOf('60') < 0,
    '★ 不许把账户余额写进结果文案，实际「' + h.lastToast() + '」');
});

test('赌局：凑不出 40 金币时不能押，也不许把钱扣成负数', () => {
  const h = gambleHarness(10);
  withCoin(0.1, () => h.bet.onclick());
  assert.equal(h.G.gold, 10, '押不起就不该有输赢');
  assert.match(h.lastToast(), /凑不出来|不够/, '要如实说明为什么押不了');
});

