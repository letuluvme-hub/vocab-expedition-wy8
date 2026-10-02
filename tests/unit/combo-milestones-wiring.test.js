/* 「战意·连击里程碑」的**接线**回归（docs/feature-combo-milestones.md 的接线部分）。
 *
 * 规则层（domain/combo-milestones.js）有自己的单测；这里锁的是接线契约 ——
 * 也就是「规则算出来的东西有没有真的落到战斗状态上、且只落一次」：
 *
 *  1) **真的发**：6 连击 → 护盾 +8、10 连击 → 回血、12 连击 → 提示 +1，
 *     每一阶都带 toast + 音效，光看数字不够 —— 玩家必须看得见、听得见。
 *  2) **一轮一次**：护盾会跨战斗结转（finishBattleNode 把 B.shield 写回 run.shield），
 *     所以第二次达到同一门槛绝不能再加一次护盾。
 *  3) **夹取在接线层也成立**：满血时回血里程碑的增量是 0，血量不得越上限。
 *  4) **不碰存档格式**：里程碑是本轮内存态，encodeSnapshot 的产物里**不许**
 *     出现 milestones 键；旧快照（没有这个字段）必须照常解码。
 *  5) **展示层**：战斗页画出「战意 n/3 · 下一个 10 连击」；
 *     容器缺席时（测试台 / 未接线）安静返回，绝不弄崩整屏渲染。
 *
 * 全部是纯函数 / 状态迁移 + 轻量 DOM 桩，不碰真实存储。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { createRun } from '../../src/domain/run.js';
import { WORDS } from '../../src/data/words.js';
import { HEROES } from '../../src/data/heroes.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';
import { comboProgress } from '../../src/domain/combo-milestones.js';

/* ---------------- 战斗控制器测试台 ---------------- */

const ITEM_IDS = ['leech', 'rage', 'freeze', 'chain', 'reveal', 'purge', 'greed', 'stone'];

function el(extra) {
  return Object.assign({
    id: '', className: '', textContent: '', innerHTML: '', title: '', hidden: false,
    disabled: false, offsetWidth: 10, children: [], onclick: null, dataset: {},
    style: { setProperty() {} }, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), remove() {},
  }, extra || {});
}
function hud() {
  return {
    fBank: el(), fCombo: el(), fAv: el(), fMy: el(), fItems: el(), fCat: el(),
    pTitle: el(), pSub: el(), pPicks: el(), pSkip: el(),
    eIcon: el(), eTitle: el(), eText: el(), ePicks: el(),
    rTitle: el(), rSub: el(), rPicks: el(),
  };
}
function stubSfx() {
  const calls = [];
  const rec = k => (...a) => calls.push([k, ...a]);
  return { calls, good: rec('good'), bad: rec('bad'), hit: rec('hit'), hurt: rec('hurt'),
    undo: rec('undo'), hint: rec('hint'), word: rec('word'), combo: rec('combo'),
    flee: rec('flee'), item: rec('item'), relic: rec('relic'), coin: rec('coin'),
    finisher: rec('finisher'), win: rec('win'), lose: rec('lose') };
}

/* 一个「把 w 整个拼完」的战斗桩。字母盘按答案顺序 + 干扰字母排布，
   所以 pressKey(0..len-1) 就是连续正确输入 —— 用来把连击顶到门槛上。 */
function battleFor(w, over) {
  const letters = w.split('').concat(['x']);
  return Object.assign({
    word: { w, z: '测试', u: 1, d: 1 }, letters,
    used: letters.map(() => false), bad: letters.map(() => false),
    input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0,
    combo: 0, maxCombo: 0, dmgBonus: 0, firstWrong: true, lethUsed: 0,
    wordsDone: 0, over: false, boss: false, elite: false, myHp: 50, enHp: 5000, enMax: 5000,
    shield: 0, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
    usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' },
  }, over || {});
}
function runFixture(over) {
  return Object.assign({
    floor: 3, hp: 50, maxhp: 50, shield: 0, gold: 30, relics: [], hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: {},
    att: 0, attOk: 0, kills: 0, unit: 1, heroId: 'scholar',
    node: { done: false, links: [] }, nextHint: 0, milestones: {},
  }, over || {});
}
function harness(G, B) {
  const DB = { mastered: [], runs: 0, wins: 0, rewards: [] };
  const ids = hud(), sfx = stubSfx(), toasts = [];
  const state = { DB, G, B };
  const ctrl = createCombatController({
    state,
    ports: {
      $: id => ids[id], norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: n => 0,
      hasR: id => G.relics.indexOf(id) >= 0,
      itemById: id => ITEM_IDS.indexOf(id) >= 0 ? { id, n: id, max: 6, ic: '🩸' } : undefined,
      hitDmg: () => 1, wordDmg: () => 1,
      wordComplete: () => state.B.input.length >= state.B.word.w.length,
      creditWord: w => { DB.mastered.push(w); G.done.add(w); },
      onWordWrong: () => {},
      centerOf: () => ({ x: 0, y: 0 }), heroPoint: () => ({ x: 0, y: 0 }),
      toast: m => toasts.push(m), sfx,
      TTS: { line() {}, word() {}, foeLine() {} },
      burst() {}, floatTxt() {}, flash() {}, ring() {}, animHero() {},
      wordFinisher() {}, foeCry() {}, renderFight() {}, nextWord() {},
      winFight() {}, loseFight() {}, finishNode() {}, saveDB() {}, scheduleBattle() {},
    },
  });
  return { ctrl, state, toasts, sfx, db: DB, G, B };
}
/* 连按正确字母 n 次（把连击顶到 n）。 */
function typeCorrect(h, n) {
  for (let i = 0; i < n; i++) h.ctrl.pressKey(i);
}

/* ---------------- 1. 真的发 ---------------- */

test('6 连击：护盾 +8，带 toast 与音效', () => {
  const h = harness(runFixture(), battleFor('keeping'));
  typeCorrect(h, 5);
  assert.equal(h.B.shield, 0, '差 1 个连击绝不发');
  assert.equal(h.toasts.filter(t => /战意|稳住/.test(t)).length, 0);
  h.ctrl.pressKey(5);                                   // 第 6 个字母 → combo = 6
  assert.equal(h.B.combo, 6);
  assert.equal(h.B.shield, 8, '护盾真的加到战斗状态上了');
  assert.equal(h.toasts.filter(t => /战意/.test(t)).length, 1, '玩家看得见');
  assert.ok(h.sfx.calls.some(c => c[0] === 'combo'), '玩家听得见');
});

test('10 连击：回血 8 点，且满血时不得越上限', () => {
  const h = harness(runFixture(), battleFor('development'));
  typeCorrect(h, 9);
  assert.equal(h.B.myHp, 50, '9 连击还没到门槛');
  h.ctrl.pressKey(9);
  assert.equal(h.B.myHp, 50, '起始就满血 → 增量夹到 0，绝不越上限');
  assert.equal(h.toasts.filter(t => /回气/.test(t)).length, 1, '里程碑仍然要报出来（诚实写成到账 0）');

  const h2 = harness(runFixture(), battleFor('development', { myHp: 20 }));
  typeCorrect(h2, 10);
  assert.equal(h2.B.myHp, 28, '半血时如实回满 8 点');
});

test('12 连击：提示 +1 次', () => {
  const h = harness(runFixture(), battleFor('presentation'));
  assert.equal(h.B.word.w.length, 12, '这个词必须真的有 12 个字母，否则这条断言是假的');
  typeCorrect(h, 12);
  assert.equal(h.B.hints, 4, '提示次数真的 +1');
  assert.equal(h.toasts.filter(t => /开悟/.test(t)).length, 1);
});

test('闪电道具一次 +3 把连击推过门槛：被跳过的里程碑补发', () => {
  const h = harness(runFixture(), battleFor('knowledge'));
  typeCorrect(h, 6);
  h.B.chainNext = true;
  h.ctrl.pressKey(6);                    // combo 6 → 7，再 +3 = 10（跳过了「恰好等于 10」）
  assert.equal(h.B.combo, 10);
  assert.equal(h.G.milestones.flow, true, '跨过门槛也算达成');
});

/* ---------------- 2. 一轮一次 ---------------- */

test('同一个里程碑一轮只发一次：连击涨上去不再加第二次护盾', () => {
  const G = runFixture();
  const h1 = harness(G, battleFor('presentation'));       // 12 字母，连击还能继续往上走
  typeCorrect(h1, 6);
  assert.equal(G.milestones.steady, true, '已达成被记在本轮上');
  assert.equal(h1.B.shield, 8);
  h1.ctrl.pressKey(6); h1.ctrl.pressKey(7); h1.ctrl.pressKey(8);   // 连击继续涨到 9
  assert.equal(h1.B.combo, 9);
  assert.equal(h1.B.shield, 8, '同一轮里绝不再发第二次');

  // 换一场战斗（新的 battle 对象，同一个 run）：护盾会跨战斗结转，
  // 所以这里再发一次就等于「打得越多护盾越厚」的滚雪球。
  const h2 = harness(G, battleFor('keeping'));
  typeCorrect(h2, 6);
  assert.equal(h2.B.shield, 0, '第二场不再发放');
  assert.equal(G.milestones.steady, true);
});

test('三阶互相独立：发掉第一阶不影响后两阶', () => {
  const G = runFixture();
  const h1 = harness(G, battleFor('development'));
  typeCorrect(h1, 6);
  assert.deepEqual(Object.keys(G.milestones), ['steady']);
  const h2 = harness(G, battleFor('presentation'));
  typeCorrect(h2, 12);
  assert.deepEqual(Object.keys(G.milestones).sort(), ['flow', 'insight', 'steady']);
  assert.equal(h2.B.shield, 0, '已达成的第一阶不再发护盾');
  assert.equal(h2.B.myHp, 50, '满血下回血里程碑到账 0');
  assert.equal(h2.B.hints, 4, '但第三阶照发');
});

/* ---------------- 3. 脏状态 fail closed ---------------- */

test('缺 milestones 字段的旧 run（老内存态 / 快照恢复）不崩，照常发一次并自己补上', () => {
  const G = runFixture(); delete G.milestones;
  const h = harness(G, battleFor('keeping'));
  typeCorrect(h, 6);
  assert.equal(h.B.shield, 8);
  assert.equal(G.milestones.steady, true, '接线层自己补回合法形状');
});

test('milestones 是脏值（字符串 / 数组）时不崩、不叠发：先归一再发', () => {
  for (const junk of ['steady', [1], 42]) {
    const G = runFixture({ milestones: junk });
    const h = harness(G, battleFor('keeping'));
    typeCorrect(h, 6);
    assert.equal(h.B.shield, 8, '脏值下不得发两次：' + JSON.stringify(junk));
    assert.equal(G.milestones.steady, true);
  }
});

test('战斗已结算（over）后到达的迟到回调不会再发里程碑', () => {
  const G = runFixture();
  const h = harness(G, battleFor('keeping'));
  typeCorrect(h, 5);
  h.B.over = true;
  h.ctrl.pressKey(5);
  assert.equal(h.B.shield, 0, 'pressKey 开头就 return 了，绝不在结算之后再加护盾');
});

/* ---------------- 4. 存档格式零改动 ---------------- */

test('createRun 开局带上空的 milestones 记录', () => {
  const hero = HEROES.filter(h => h.id === 'scholar')[0];
  const run = createRun(1, hero, WORDS.filter(w => w.u === 1), () => 0.5);
  assert.deepEqual(run.milestones, {}, '开局一定是空表，绝不凭空带一个已达成的');
});

test('快照里不出现 milestones 键：这是本轮内存态，不改存档格式', () => {
  const hero = HEROES.filter(h => h.id === 'scholar')[0];
  const run = createRun(1, hero, WORDS.filter(w => w.u === 1), () => 0.5);
  run.milestones = { steady: true, flow: true };
  const env = { run, battle: null, encounter: null, phase: PHASE.MAP };
  const raw = JSON.parse(JSON.stringify(encodeSnapshot(env, { now: 1700000000000 })));
  assert.equal('milestones' in raw.run, false, '编码产物里绝不能有这个键（旧存档与新存档同形）');
  const back = decodeSnapshot(raw);
  assert.equal(back.ok, true, '带里程碑的 run 仍然可快照、可恢复');
  assert.equal(back.value.run.milestones, undefined, '恢复出来没有这个字段 = 本轮还没发过');
  assert.equal(comboProgress(6, back.value.run.milestones).unlocked, 0);
  assert.equal(comboProgress(6, back.value.run.milestones).next.combo, 6);
});

test('旧快照（归档年代、没有本轮里程碑概念）照常解码：向后兼容零回归', () => {
  const hero = HEROES.filter(h => h.id === 'scholar')[0];
  const run = createRun(1, hero, WORDS.filter(w => w.u === 1), () => 0.5);
  delete run.milestones;
  const env = { run, battle: null, encounter: null, phase: PHASE.MAP };
  const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(env, { now: 1700000000000 }))));
  assert.equal(back.ok, true);
  assert.equal(back.value.run.milestones, undefined);
  assert.equal(back.value.run.maxhp, run.maxhp, '其它字段一个都不受影响');
});

/* ---------------- 5. 战斗页展示 ---------------- */

class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.attrs = {}; this.dataset = {}; this.className = '';
    this.id = ''; this.hidden = false; this.disabled = false; this.title = '';
    this.onclick = null; this.offsetWidth = 0; this.clientWidth = 0;
    this.parentElement = null; this._text = ''; this._html = '';
    const props = {};
    this.style = {
      setProperty(k, v) { props[k] = String(v); }, getPropertyValue(k) { return props[k] || ''; },
      set width(v) { props.width = v; }, get width() { return props.width || ''; },
      get gridTemplateColumns() { return props.gridTemplateColumns || ''; },
      set gridTemplateColumns(v) { props.gridTemplateColumns = v; },
      set maxWidth(v) { props.maxWidth = v; }, get maxWidth() { return props.maxWidth || ''; },
      get _props() { return props; },
    };
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  insertAdjacentHTML(p, html) { this._html += html; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  insertBefore(n) { return this.appendChild(n); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
  querySelector() { return null; }
  /* 只支持 `.class` 选择器：战意条要断言的就是那几个档位指示点。
     真的走一遍树，而不是永远返回 []，否则「三个指示点」这条断言是假通过。 */
  querySelectorAll(sel) {
    const cls = String(sel).replace(/^\./, '');
    const out = [];
    const walk = n => {
      for (const c of n.children || []) {
        if (String(c.className || '').split(/\s+/).indexOf(cls) >= 0) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}
function stubDoc(ids) {
  const reg = new Map();
  for (const id of ids) reg.set(id, new StubEl('div'));
  return {
    getElementById: id => (reg.has(id) ? reg.get(id) : null),
    createElement: tag => new StubEl(tag), querySelectorAll: () => [], _reg: reg,
  };
}
function textOf(node) {
  if (!node) return '';
  return node.children.length ? node.children.map(textOf).join('') : node._text;
}
const withDoc = (doc, fn) => {
  const prev = globalThis.document;
  globalThis.document = doc;
  try { return fn(doc); } finally { globalThis.document = prev; }
};

const FIGHT_IDS = ['fEn', 'fEnT', 'fMy', 'fMyS', 'fMyT', 'fPc', 'fMyName', 'fAv', 'fName', 'fZh',
  'fCat', 'fTags', 'fSlots', 'fBank', 'tHintN', 'tHint', 'tSkip', 'tFlee', 'fCombo', 'fItems',
  'tBankMode', 'tBankCase', 'tBankModeV', 'tBankCaseV'];

const uiRun = over => Object.assign({
  unit: 1, hp: 42, maxhp: 60, shield: 0, gold: 120, floor: 5, maxFloor: 5, heroId: 'scholar',
  relics: [], hcombo: 1, hm: 0, hnoise: 0, hleech: 0, hregen: 0, bag: {}, att: 0, attOk: 0,
  milestones: {},
}, over || {});
const uiBattle = over => Object.assign({
  word: { w: 'keeping', z: '保持', u: 1, d: 1 }, letters: 'keeping'.split(''),
  used: [false, false, false, false, false, false, false], bad: new Array(7).fill(false),
  input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0,
  dmgBonus: 0, myHp: 42, enHp: 100, enMax: 200, shield: 0, rageLeft: 0, rage: 0,
  usedThisFight: {}, wordStreak: 0, mistaken: [], keyEls: null,
  foe: { n: '词灵', ic: '👾', tint: '#a67dff' }, boss: false, elite: false,
}, over || {});

async function renderFightDom(run, B, ids) {
  const { createFightScreen } = await import('../../src/ui/screens/fight.js');
  const doc = stubDoc(ids);
  withDoc(doc, () => {
    createFightScreen({
      getRun: () => run, getBattle: () => B, getDB: () => ({ kbMode: false, kbUpper: false }),
      onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {},
    }).renderFight();
  });
  return doc;
}

test('战斗页画出「战意 n/3 · 下一个 X 连击」，达成后指向下一阶', async () => {
  const run = uiRun({ milestones: { steady: true } });
  const doc = await renderFightDom(run, uiBattle({ combo: 4 }), FIGHT_IDS.concat(['fComboMs']));
  const box = doc.getElementById('fComboMs');
  assert.ok(box, '容器必须真的被画出来（否则这条断言是假的）');
  const txt = textOf(box);
  assert.match(txt, /1\/3/, '已达成 1 阶');
  assert.match(txt, /10/, '下一个门槛是 10');
  // 三个档位指示点：一个已达成、两个未达成
  const pips = box.querySelectorAll('.comboMsPip');
  assert.equal(pips.length, 3);
});

test('战意三阶全达成时写「3/3 · 全部达成」，不再报一个不存在的下一阶', async () => {
  const run = uiRun({ milestones: { steady: true, flow: true, insight: true } });
  const doc = await renderFightDom(run, uiBattle({ combo: 0 }), FIGHT_IDS.concat(['fComboMs']));
  const txt = textOf(doc.getElementById('fComboMs'));
  assert.match(txt, /3\/3/);
  assert.match(txt, /全部达成/);
  assert.doesNotMatch(txt, /下一个/);
});

test('战斗页渲染绝**只读**：画战意条不改 G/B 的任何字段', async () => {
  const run = uiRun({ milestones: { steady: true } });
  const B = uiBattle({ combo: 7 });
  // B.keyEls 是战斗页**既有**的 DOM 引用缓存（renderFight 每帧都会重写它），
  // 它不是状态，所以快照里排除；其余字段逐个比。
  const snap = () => JSON.stringify({
    milestones: run.milestones, shield: run.shield, gold: run.gold, maxhp: run.maxhp,
    combo: B.combo, dmgBonus: B.dmgBonus, hints: B.hints, myHp: B.myHp, shield: B.shield,
    input: B.input.slice(), used: B.used.slice(), wordStreak: B.wordStreak, wordsDone: B.wordsDone,
  });
  const before = snap();
  await renderFightDom(run, B, FIGHT_IDS.concat(['fComboMs']));
  assert.equal(snap(), before, '展示层是纯只读：绝不在渲染里补发里程碑或改生命/护盾/提示');
});

test('容器缺席时安静返回：不抛错、不把整屏渲染带崩', async () => {
  // 未接线的测试台（以及任何还没加容器的部署）都会走这条路径。
  const run = uiRun();
  const doc = await renderFightDom(run, uiBattle({ combo: 12 }), FIGHT_IDS);   // 不含 fComboMs
  assert.equal(doc.getElementById('fComboMs'), null);
  assert.equal(doc.getElementById('fBank').children.length, 7, '字母盘照常画出来');
});

test('脏里程碑状态（老 run 缺字段 / 脏形状）在展示层降级，不上屏 NaN', async () => {
  for (const junk of [undefined, null, 'steady', 42]) {
    const run = uiRun();
    if (junk === undefined) delete run.milestones; else run.milestones = junk;
    const doc = await renderFightDom(run, uiBattle({ combo: 6 }), FIGHT_IDS.concat(['fComboMs']));
    const txt = textOf(doc.getElementById('fComboMs'));
    assert.doesNotMatch(txt, /NaN|undefined/, '脏状态绝不上屏：' + String(junk));
    assert.match(txt, /0\/3/);
  }
});