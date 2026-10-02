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
 *  4) **跟着存档走**：已达成的阶必须落进快照。否则「暂停 → 刷新 → 继续」会把
 *     整张表清空，玩家可以反复领取同一阶 —— 护盾/生命被上限夹住只是顶满，
 *     而**提示次数没有上限**，那就是无限白嫖。形状与 growth 同款可选字段。
 *  5) **展示层**：战斗页画出「战意 n/3 · 下一个 10 连击」；
 *     容器缺席时（测试台 / 未接线）安静返回，绝不弄崩整屏渲染。
 *
 * 全部是纯函数 / 状态迁移 + 轻量 DOM 桩，不碰真实存储。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { createRun, advanceRun } from '../../src/domain/run.js';
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

/* ---------------- 4. 存档：已达成的阶必须跟着快照走 ----------------
 *
 * ★ 这里锁的是一个**真实漏洞**：里程碑原本不在 encodeRun 的白名单里，于是
 *   「暂停 → 刷新 → 继续」把整张表清空。护盾/生命被上限夹住只是顶满（无害），
 *   而 B.hints 没有上限 —— 玩家可以无限次重刷同一阶提示。
 *   docs/feature-combo-milestones.md 曾把它记成「已知、未修」，此处按 growth
 *   的同款**可选**字段补上：合法才写、缺失就是缺失、脏值整份 fail closed。
 */

/* 真实开局：createRun → 选一个首层节点。battle.node 必须在 rows 里解得开，
   所以这里走真实 map 结构，而不是 runFixture 那种没有 rows/pool 的假 run ——
   拿假 run 去 encode，测出来的「能快照」是假的。 */
function realRun(over) {
  const hero = HEROES.filter(h => h.id === 'scholar')[0];
  const run = createRun(1, hero, WORDS.filter(w => w.u === 1), () => 0.5);
  run.node = run.rows[0][0];
  run.avail = [];
  advanceRun(run, 1000);
  return Object.assign(run, over || {});
}
/* 能进快照的战斗：harness 的 battleFor 缺 encodeBattle 要的 won/finished/rewardTaken；
   词条本体必须从 run.pool 里取 —— validBattle 会逐字段比对 w/u/d/z/th。 */
function snapBattle(run, w, over) {
  const entry = run.pool.filter(x => x.w === w)[0];
  assert.ok(entry, '这个词必须在 unit 1 词池里，否则 battle 与 pool 对不上：' + w);
  return battleFor(w, Object.assign({
    word: entry, node: run.node, myHp: 20,
    won: false, finished: false, rewardTaken: false,
  }, over || {}));
}
const enc = (run, over) => JSON.parse(JSON.stringify(
  encodeSnapshot(Object.assign({ phase: PHASE.MAP, run, battle: null, encounter: null }, over || {}),
    { now: 1700000000000 })));

test('createRun 开局带上空的 milestones 记录', () => {
  const hero = HEROES.filter(h => h.id === 'scholar')[0];
  const run = createRun(1, hero, WORDS.filter(w => w.u === 1), () => 0.5);
  assert.deepEqual(run.milestones, {}, '开局一定是空表，绝不凭空带一个已达成的');
});

test('合法时才写键：空表与缺失都不出现，已达成的逐个落盘且键序固定', () => {
  const run = realRun();
  assert.deepEqual(run.milestones, {}, '开局一定是空表');
  // 空的两种表示（空表 / 键缺失）语义相同 —— 都不写这个键。写成 undefined 或 {}
  //   都会让内存态与 JSON 往返态长出两个形状，deepEqual 恒假（与 growth 同一口径）。
  assert.equal('milestones' in enc(run).run, false, '空表 → 整个键不出现');
  const gone = realRun();
  delete gone.milestones;                                  // 老内存态
  assert.equal('milestones' in enc(gone).run, false, '缺失 → 整个键不出现');

  run.milestones = { insight: true, steady: true };         // 故意乱序写入
  const raw = enc(run);
  assert.deepEqual(Object.keys(raw.run.milestones), ['steady', 'insight'],
    '按阶梯顺序重建 → 键序固定，JSON 往返前后字节稳定');
  const back = decodeSnapshot(raw);
  assert.equal(back.ok, true, back.reason);
  assert.deepEqual(back.value.run.milestones, { steady: true, insight: true });
  assert.equal(comboProgress(12, back.value.run.milestones).unlocked, 2);
});

test('旧快照没有 milestones 键：照常恢复，回落成空表（向后兼容零回归）', () => {
  const run = realRun();
  run.milestones = { steady: true, insight: true };
  const raw = enc(run);
  delete raw.run.milestones;                                // 旧客户端写出的存档：压根没这个键
  const back = decodeSnapshot(raw);
  assert.equal(back.ok, true, back.reason);
  // 回落成空表而不是 undefined：接线层与战意条都直接读这个字段，
  // 空表是「本轮一阶都没发过」唯一诚实的表示，undefined 只会把判空的责任推给每个读者。
  assert.deepEqual(back.value.run.milestones, {});
  assert.equal(comboProgress(6, back.value.run.milestones).unlocked, 0);
  assert.equal(back.value.run.maxhp, run.maxhp, '其它字段一个都不受影响');

  // 更老的一档：键在但值是 undefined / null（某些序列化路径会这么写）
  for (const absent of [undefined, null]) {
    const r2 = enc(realRun());
    r2.run.milestones = absent;
    const b2 = decodeSnapshot(r2);
    assert.equal(b2.ok, true, 'undefined/null 也算「没有」：' + String(absent));
    assert.deepEqual(b2.value.run.milestones, {});
  }
});

test('脏 milestones 整份 fail closed（不是普通对象 / 值不是 true / 未登记的 id）', () => {
  for (const junk of ['steady', [true], 42, true, { steady: 'yes' }, { steady: 1 }, { steady: false },
    { ghost: true }, { steady: true, ghost: true }, { '': true }]) {
    const raw = enc(realRun());
    raw.run.milestones = junk;
    // 绝不静默当成「本轮没发过」：那正是这个漏洞本身 —— 一张被清空的表 = 每一阶都能再领一次。
    assert.equal(decodeSnapshot(raw).ok, false,
      '脏 milestones 必须整份被拒：' + JSON.stringify(junk));
  }
});

test('内存态 milestones 是脏值时存不下整份快照（不伪装成旧快照）', () => {
  for (const junk of ['steady', [true], 42, { steady: 'yes' }, { steady: false }, { ghost: true }]) {
    const run = realRun();
    run.milestones = junk;
    assert.equal(encodeSnapshot({ phase: PHASE.MAP, run, battle: null, encounter: null }), null,
      '脏内存态必须存不下，而不是存一份缺了里程碑的快照：' + JSON.stringify(junk));
  }
  // 缺失 / null / 空表都是合法形状（这一轮确实一阶都没发过），不拦。
  for (const ok of [undefined, null, {}]) {
    const run = realRun();
    if (ok === undefined) delete run.milestones; else run.milestones = ok;
    const env = encodeSnapshot({ phase: PHASE.MAP, run, battle: null, encounter: null });
    assert.ok(env, '合法形状必须照常存盘：' + String(ok));
    assert.equal('milestones' in env.run, false);
  }
});

test('完整路径：保存 → 刷新 → 恢复 → 同一阶不再发放（提示次数不被白嫖）', () => {
  const G = realRun();
  const B = snapBattle(G, 'presentation');
  const h1 = harness(G, B);
  assert.equal(B.word.w.length, 12, '这个词真的有 12 个字母，否则 12 连击这条路径走不到');

  // ── 玩到三阶全部达成 ──
  typeCorrect(h1, 12);
  assert.deepEqual(G.milestones, { steady: true, flow: true, insight: true }, '三阶都记在本轮上');
  assert.equal(B.shield, 8, '护盾 +8 真的到账');
  assert.equal(B.hints, 4, '提示 +1 真的到账（3 → 4）');

  // ── 暂停 → 存盘 → 刷新 ──
  const raw = JSON.parse(JSON.stringify(encodeSnapshot(
    { phase: PHASE.BATTLE, run: G, battle: B, encounter: null }, { now: 1700000000000 })));
  const back = decodeSnapshot(raw);
  assert.equal(back.ok, true, back.reason);

  // ── 继续：同一轮、同一份「已发放」记录 ──
  //   ★ 行为断言放在最前面：这条测试真正要证的是「刷一次不能再领一次」，
  //   而不是「某个键在不在」。只断言键存在的话，一次手滑（键在、值没还原）
  //   就能让整条测试绿掉，而漏洞照样存在。
  const G2 = back.value.run, B2 = back.value.battle;
  assert.deepEqual(G2.milestones, { steady: true, flow: true, insight: true },
    '恢复出来的「已发放」表必须还在，否则每一阶都能再领一次');
  assert.equal(B2.hints, 4, '恢复回来的战斗本来就带着那 1 次提示');
  const h2 = harness(G2, snapBattle(G2, 'presentation', { hints: B2.hints, shield: B2.shield }));
  typeCorrect(h2, 12);                                    // 又一次把连击顶到 12
  assert.equal(h2.B.hints, 4, '★ 提示次数绝不能再 +1（它没有上限，重复发放就是无限白嫖）');
  assert.equal(h2.B.shield, 8, '护盾同理：已达成的阶不重复发放');
  assert.deepEqual(G2.milestones, { steady: true, flow: true, insight: true });
  assert.equal(comboProgress(0, G2.milestones).done, true, '战意条显示三阶全达成');

  // 落盘形状：合法且非空时才写这个键，三阶逐个原样带回来。
  assert.deepEqual(Object.keys(raw.run.milestones).sort(), ['flow', 'insight', 'steady'],
    '★ 漏洞本体：已达成的阶必须真的落盘');
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