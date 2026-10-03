import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, finishBattleNode, endRunProgress } from '../../src/domain/run.js';
import { WORDS } from '../../src/data/words.js';
import { HEROES } from '../../src/data/heroes.js';
import { RELICS } from '../../src/data/relics.js';
import { SKIP_HP_COST } from '../../src/data/balance.js';

/* ============================================================
 * 影分身（👻）：免费撤退额度是 **run 级**，不是 battle 级。
 *
 * 语义（唯一口径）：
 *   有影分身 + 本轮未用 → 免费撤退（G.ghostUsed=true, B.over=true, finishNode）
 *   有影分身 + 本轮已用 → 回普通跳过：固定扣 SKIP_HP_COST(50) 点生命
 *                         （血不够就是战败），不再拒绝
 *   没有影分身          → 普通跳过
 *
 * 关键性质：额度挂在 run 上，所以**换一场战斗（新的 B）不会重置**，
 * 也**不会因为再次拿到影分身而重置**。createRun 是唯一把它置回 false 的地方。
 *
 * 结算同样走真实实现：
 *   - finishNode → 真实 finishBattleNode（BOSS 不算通关、不结转 0 血）
 *   - loseFight  → 照抄 runtime.js 的真实实现（`if(B.over) return` 闸门
 *     + 安排 endRun(false) → 真实 endRunProgress）
 * 不复用纯计数桩，这样「先置 over 导致战斗不结算」这类接线错误会被真的抓住。
 * ============================================================ */

const ITEM_IDS = ['leech', 'rage', 'freeze', 'chain', 'reveal', 'purge', 'greed', 'stone'];
const noopSfx = new Proxy({}, { get: () => () => {} });
const noopTTS = { line() {}, word() {}, hint() {}, foeLine() {}, stop() {}, on: false, supported: false };

function el() {
  return {
    id: '', className: '', textContent: '', innerHTML: '', title: '', hidden: false,
    disabled: false, offsetWidth: 10, clientWidth: 10, children: [], onclick: null, dataset: {},
    style: { setProperty() {} }, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), remove() {},
  };
}
const ids = () => ({
  fEn: el(), fEnT: el(), fMy: el(), fMyS: el(), fMyT: el(), fPc: el(), fMyName: el(),
  fName: el(), fZh: el(), fCat: el(), fTags: el(), fSlots: el(), fAv: el(), fCombo: el(),
  fItems: el(), tHintN: el(), tHint: el(), tSkip: el(), tFlee: el(),
  tBankMode: el(), tBankCase: el(), tBankModeV: el(), tBankCaseV: el(),
});

/* --- 战斗对象（战斗级没有任何 ghost 字段：额度在 run 上） --- */
function newBattle(G, over = {}) {
  const B = {
    word: { w: 'keep', z: '保持', u: 1, d: 1 }, letters: ['k', 'e', 'e', 'p', 'x'],
    used: [false, false, false, false, false], bad: [false, false, false, false, false],
    input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0,
    dmgBonus: 0, firstWrong: true, lethUsed: 0, wordsDone: 0, over: false,
    boss: false, elite: false, won: false, finished: false, myHp: G.hp, enHp: 200, enMax: 200,
    shield: 0, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
    usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' },
  };
  B.node = G.node;
  return Object.assign(B, over);
}

function newRun(over = {}) {
  const node = { done: false, type: 'battle', links: [] };
  const G = {
    floor: 3, hp: 60, maxhp: 100, shield: 0, gold: 30, relics: ['ghost'], hcombo: 1, hm: 0,
    hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: { leech: 2 }, att: 0,
    attOk: 0, kills: 0, maxFloor: 3, unit: 1, heroId: 'a', node, countedStart: true,
    clearedRun: false, result: undefined, advAt: 0, rows: [node], avail: [node], cur: null,
    // 与 createRun 的形状一致：额度是 run 级字段，默认未使用
    ghostUsed: false,
  };
  return Object.assign(G, over);
}

async function harness({ run: overRun = {}, battle: overB = {} } = {}) {
  const { createCombatController } = await import('../../src/app/combat.js');
  const G = newRun(overRun);
  const B = newBattle(G, overB);
  const DB = { mastered: [], runs: 1, wins: 0, rewards: [], best: 0 };
  const state = { DB, G, B };
  const toasts = [], calls = [], jobs = [];
  const dom = ids();
  const ports = {
    $: id => dom[id], confirm: () => true, norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: () => 0,
    hasR: id => G.relics.indexOf(id) >= 0,
    itemById: id => ITEM_IDS.indexOf(id) >= 0 ? { id, n: id, max: 6, ic: 'x' } : undefined,
    hitDmg: () => 10, wordDmg: () => 40, wordComplete: () => B.input.length >= 4,
    creditWord: w => DB.mastered.push(w), onWordWrong: w => G.wrong.push(w),
    centerOf: () => ({ x: 1, y: 1 }), heroPoint: () => ({ x: 1, y: 1 }),
    toast: m => toasts.push(m), sfx: noopSfx, TTS: noopTTS,
    burst() {}, floatTxt() {}, flash() {}, ring() {}, animHero() {}, wordFinisher() {}, foeCry() {},
    renderFight() { calls.push('renderFight'); }, nextWord() { calls.push('nextWord'); },
    winFight: () => { const b = state.B; if (b.over) return; b.over = true; b.won = true; calls.push('winFight'); },
    // 与 src/app/runtime.js 的 loseFight 同构：先过 over 闸门，再安排失败结算。
    // ★ 必须读 state.B 而不是闭包里的初始 B：runtime 的 loseFight 操作的是当前战斗对象，
    //   闭包捕获会让「换一场战斗后的结算」打到上一场身上（真实代码里是 module 级 B）。
    loseFight: () => {
      const b = state.B;
      if (b.over) return;
      b.over = true;
      calls.push('loseFight');
      jobs.push(() => { endRunProgress(G, DB, false); calls.push('endRun:false'); });
    },
    // 真实结算：普通/精英 → 'advance'，BOSS → 'boss-loss'（不算通关）
    finishNode: () => { calls.push('finishNode:' + finishBattleNode(G, state.B, DB)); },
    saveDB() {}, scheduleBattle() {},
  };
  const ctrl = createCombatController({ state, ports });
  return {
    ctrl, state, ports, G, B, DB, toasts, calls, jobs, dom,
    fire: () => jobs.splice(0).forEach(f => f()),
    /** 同一轮远征里推进到下一场战斗：真实的 startFight 会换一个全新的 B 对象 */
    nextBattle: (over = {}, nodeType = 'battle') => {
      // 下一层 → 换一个节点对象（真实 advance 会换 node/avail）
      const node = { done: false, type: nodeType, links: [] };
      G.node = node;
      G.avail = [node];
      const b = newBattle(G, over);
      state.B = b;
      return b;
    },
  };
}

/* ============================================================
 * 1. 单一事实来源：额度在 run 上，战斗对象里不存在 ghost 字段
 * ============================================================ */

test('createRun 把影分身额度初始化为未使用，且额度只挂在 run 上', () => {
  const run = createRun(1, HEROES[0], WORDS);
  assert.equal(run.ghostUsed, false, '每一轮远征都从「未使用」开始');
  assert.ok(!('ghostCharges' in run), '不引入第二个来源');
  const next = createRun(1, HEROES[0], WORDS);
  next.ghostUsed = true;
  assert.equal(createRun(1, HEROES[0], WORDS).ghostUsed, false, '上一轮的已用状态不得泄漏到下一轮');
});

test('战斗对象上不再有 ghostUsed：额度不是每场一次', async () => {
  const h = await harness();
  h.ctrl.skipFight();
  assert.equal(h.G.ghostUsed, true);
  assert.ok(!('ghostUsed' in h.B), '新战斗对象不得携带任何 ghost 状态');
});

/* ============================================================
 * 2. 同 run 内第二场战斗：必须付 50，不能再免费
 * ============================================================ */

test('同一轮里换一场新战斗，影分身不再免费，必须付固定 50', async () => {
  const h = await harness();
  // 第一场：免费撤退
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.B.myHp, 60, '第一次免费，不扣血');
  assert.equal(h.G.ghostUsed, true);
  assert.deepEqual(h.calls, ['finishNode:advance']);

  // 第二场：**全新的 B 对象**（startFight 每次都重建），额度不得重置
  const b2 = h.nextBattle({ myHp: 80 });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(b2.myHp, 80 - SKIP_HP_COST, '第二场必须走普通跳过的固定代价');
  assert.equal(h.G.ghostUsed, true);
  assert.deepEqual(h.calls, ['finishNode:advance', 'finishNode:advance']);
});

test('第二轮免费撤退在低血时是真的战败，而不是被拒绝或保底活着', async () => {
  const h = await harness();
  h.ctrl.skipFight();                       // 第一场用掉额度
  const b2 = h.nextBattle({ myHp: SKIP_HP_COST });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(b2.myHp, 0, '不能被 Math.max(1,...) 救成 1');
  assert.ok(h.calls.includes('loseFight'), '必须真的结算失败，而不是拒绝操作');
  assert.ok(!h.calls.slice(1).some(c => c.startsWith('finishNode')), '失败路径不得结算/推进');
  h.fire();
  assert.equal(h.DB.wins, 0);
  assert.deepEqual(h.DB.rewards, []);
});

test('再次拿到影分身也不重置本轮额度', async () => {
  const h = await harness();
  h.ctrl.skipFight();                       // 用掉
  h.G.relics = ['ghost', 'ghost'];          // 重复持有（捡到第二件）
  const b2 = h.nextBattle({ myHp: 90 });
  h.ctrl.skipFight();
  assert.equal(b2.myHp, 90 - SKIP_HP_COST, '重复持有不恢复免费额度');
});

test('没有影分身的战斗不受影响', async () => {
  const h = await harness({ run: { relics: [] } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 60 - SKIP_HP_COST);
  assert.equal(h.G.ghostUsed, false, '没有影分身就不该产生 run 级消耗标记');
});

/* ============================================================
 * 3. 两局 run：额度各自独立
 * ============================================================ */

test('两局 run 的影分身额度互不影响', async () => {
  const a = await harness();
  a.ctrl.skipFight();
  assert.equal(a.G.ghostUsed, true);

  const b = await harness();               // 全新 run
  assert.equal(b.G.ghostUsed, false);
  assert.equal(b.ctrl.skipFight(), true);
  assert.equal(b.B.myHp, 60, '新一局重新获得一次免费撤退');
  assert.equal(b.G.ghostUsed, true);
});

/* ============================================================
 * 4. 未来快照恢复：布尔可 JSON 序列化，缺字段回落为「未使用」
 * ============================================================ */

test('已使用状态能通过 JSON 快照往返保留（未来存档/恢复的基础）', () => {
  const run = createRun(1, HEROES[0], WORDS);
  run.ghostUsed = true;
  const back = JSON.parse(JSON.stringify(run));
  assert.equal(back.ghostUsed, true, '恢复后仍然是「本轮已用完」');
  assert.equal(typeof back.ghostUsed, 'boolean');
});

test('老快照缺 ghostUsed 字段时按未使用处理（保守：不白送也不拒绝）', async () => {
  const h = await harness();
  delete h.G.ghostUsed;                    // 模拟旧存档/旧快照
  const b = h.nextBattle({ myHp: 90 });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(b.myHp, 90, '缺字段视为未使用：这一场仍然免费');
});

/* ============================================================
 * 5. BOSS：影分身跳过仍然失败，不算通关
 * ============================================================ */

test('BOSS 战用影分身免费撤退仍然算失败，不给通关', async () => {
  const h = await harness({
    run: { node: { done: false, type: 'boss', links: [] } },
    battle: { boss: true, myHp: 100 },
  });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.B.myHp, 100, '免费');
  assert.equal(h.G.ghostUsed, true, '额度照样消耗');
  assert.deepEqual(h.calls, ['finishNode:boss-loss']);
  assert.equal(h.DB.wins, 0);
  assert.deepEqual(h.DB.rewards, []);
});

test('BOSS 战用完额度后再跳过仍是 boss-loss，不 win、不发纪念卡', async () => {
  const h = await harness();
  h.ctrl.skipFight();                       // 免费额度用在第一场普通战斗
  // 推进到真正的 BOSS 节点（下一层最后一个节点）
  const boss = h.nextBattle({ boss: true, myHp: 100 }, 'boss');
  assert.equal(h.G.node.type, 'boss', '这一场必须是 BOSS 节点');
  h.ctrl.skipFight();                       // 这一场必须付 50
  assert.equal(boss.myHp, 100 - SKIP_HP_COST);
  assert.deepEqual(h.calls, ['finishNode:advance', 'finishNode:boss-loss']);
  assert.equal(h.DB.wins, 0);
  assert.deepEqual(h.DB.rewards, []);
});

/* ============================================================
 * 6. 连点：额度只被消耗一次
 * ============================================================ */

test('连点跳过只消耗一次额度、只结算一次', async () => {
  const h = await harness();
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.ctrl.skipFight(), false, '战斗已结束，第二次调用是空操作');
  assert.deepEqual(h.calls, ['finishNode:advance']);
  assert.equal(h.G.ghostUsed, true);
  assert.equal(h.B.myHp, 60, '连点不得把免费撤退变成扣血');
});

test('连点在已用完额度的战斗里也只结算一次', async () => {
  const h = await harness();
  h.ctrl.skipFight();
  const b2 = h.nextBattle({ myHp: 90 });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.ctrl.skipFight(), false);
  assert.equal(b2.myHp, 90 - SKIP_HP_COST, '第二次连点不得再扣一次 50');
  assert.equal(h.calls.filter(c => c.startsWith('finishNode')).length, 2);
});

/* ============================================================
 * 7. 免费撤退不计击杀 / 掌握 / 通关
 * ============================================================ */

test('免费撤退不记掌握、不记通关', async () => {
  const h = await harness();
  h.ctrl.skipFight();
  assert.deepEqual(h.DB.mastered, []);
  assert.equal(h.DB.wins, 0);
  assert.deepEqual(h.DB.rewards, []);
  assert.equal(h.G.kills, 0);
});

/* ============================================================
 * 8. UI 文案与图鉴
 * ============================================================ */

const FIGHT_IDS = ['fEn', 'fEnT', 'fMy', 'fMyS', 'fMyT', 'fPc', 'fMyName', 'fAv', 'fName', 'fZh',
  'fCat', 'fTags', 'fSlots', 'fBank', 'tHintN', 'tHint', 'tSkip', 'tFlee', 'fCombo', 'fItems',
  'tBankMode', 'tBankCase', 'tBankModeV', 'tBankCaseV'];

/* 轻量 DOM 桩（fight.renderFight 只读快照 + 发回调，不需要真 DOM） */
class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.attrs = {}; this.dataset = {}; this.className = '';
    this.hidden = false; this.disabled = false; this.title = ''; this.onclick = null;
    this.offsetWidth = 0; this.clientWidth = 100; this.parentElement = null;
    this._text = ''; this._html = '';
    this.style = { setProperty() {}, getPropertyValue: () => '' };
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function fightDom() {
  const reg = new Map(FIGHT_IDS.map(id => [id, new StubEl('div')]));
  return { getElementById: id => (reg.has(id) ? reg.get(id) : null), createElement: t => new StubEl(t) };
}
let fightModule = null;
async function paintSkip(run, battle) {
  fightModule = fightModule || await import('../../src/ui/screens/fight.js');
  const doc = fightDom();
  const prev = globalThis.document;
  globalThis.document = doc;
  try {
    const { createFightScreen } = fightModule;
    createFightScreen({
      getRun: () => run, getBattle: () => battle, getDB: () => ({ kbMode: false, kbUpper: false }),
      onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {},
    }).renderFight();
    const el = doc.getElementById('tSkip');
    return { html: el.innerHTML, title: el.title, text: el.innerHTML.replace(/<[^>]*>/g, '') };
  } finally { globalThis.document = prev; }
}
test('UI 探针可用（fight 屏幕能在 Node 里渲染出跳过按钮）', async () => {
  const run = newRun();
  const out = await paintSkip(run, newBattle(run));
  assert.match(out.html, /影分身|跳过/);
});

test('有影分身且未使用：按钮显示影分身并点明本轮仅剩 1 次', async () => {
  const run = newRun();
  const out = await paintSkip(run, newBattle(run));
  assert.match(out.html, /影分身/, '标签必须写影分身');
  assert.match(out.text, /本轮/, '要说明额度是本轮的');
  assert.match(out.text, /1/, '要说明剩几次');
  assert.ok(!/损失/.test(out.text), '可用时不得显示已用完/代价文案');
});

test('本轮已用完：按钮回到普通跳过并点明固定代价，同时说明影分身已用完', async () => {
  const run = newRun({ ghostUsed: true });
  const out = await paintSkip(run, newBattle(run));
  assert.match(out.text, /跳过/);
  assert.match(out.text, new RegExp(String(SKIP_HP_COST)), '要写出实际代价');
  assert.match(out.title + out.text, /已用完|本轮已/, 'tooltip 或文案必须说明影分身已用完');
});

test('没有影分身：普通跳过文案，不提影分身', async () => {
  const run = newRun({ relics: [] });
  const out = await paintSkip(run, newBattle(run));
  assert.match(out.text, /跳过/);
  assert.match(out.text, new RegExp(String(SKIP_HP_COST)));
  assert.ok(!/影分身/.test(out.text + out.title), '没这件遗物就不该提它');
});

test('UI 读 run 而非旧战斗对象：换战斗后按钮仍是普通跳过', async () => {
  const run = newRun({ ghostUsed: true });
  // 战斗对象连 ghost 字段都没有（真实 startFight 的形状）——不得因此显示成免费
  const stale = newBattle(run);
  const out = await paintSkip(run, stale);
  assert.match(out.text, /跳过/);
  assert.ok(!/影分身/.test(out.text));
});

test('图鉴文案：影分身说明改成「每轮远征一次」', () => {
  const ghost = RELICS.filter(r => r.id === 'ghost')[0];
  assert.ok(ghost, '图鉴里必须有影分身');
  assert.match(ghost.d, /每轮/, '旧文案是「每场战斗」，必须改成「每轮」');
  assert.ok(!/每场/.test(ghost.d), '不得残留「每场」口径');
});