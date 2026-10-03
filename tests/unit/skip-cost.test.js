import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKIP_HP_COST } from '../../src/data/balance.js';

/* ============================================================
 * 普通跳过的代价：固定 50 点生命（B.myHp），不经护盾 / 免伤。
 *
 * 这里刻意不复用 controllers.test.js 里的纯计数桩：
 *   - finishNode 走**真实** finishBattleNode(run, battle, db)
 *   - loseFight  照抄 runtime.js 的真实实现（`if(B.over) return` 闸门 +
 *     800ms 后 endRun(false) → 真实 endRunProgress）
 * 这样「先置 B.over 再调 loseFight 会导致战斗不结束」这类接线错误
 * 会真的被抓住，而不是被一个无条件返回 true 的桩吞掉。
 * ============================================================ */

const ITEM_IDS = ['leech', 'rage', 'freeze', 'chain', 'reveal', 'purge', 'greed', 'stone'];

function el() {
  return {
    id: '', className: '', textContent: '', innerHTML: '', title: '', hidden: false,
    disabled: false, offsetWidth: 10, children: [], onclick: null, dataset: {},
    style: { setProperty() {} }, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), remove() {},
  };
}
const ids = () => ({
  fBank: el(), fCombo: el(), fAv: el(), fMy: el(), fItems: el(), fCat: el(),
  eIcon: el(), eTitle: el(), eText: el(), ePicks: el(),
  rTitle: el(), rSub: el(), rPicks: el(),
});
const noopSfx = new Proxy({}, { get: () => () => {} });
const noopTTS = { line() {}, word() {}, hint() {}, foeLine() {}, stop() {}, on: false, supported: false };

function battleFixture(over = {}) {
  const G = {
    floor: 3, hp: 50, maxhp: 50, shield: 0, gold: 30, relics: [], hcombo: 1, hm: 0,
    hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: {}, att: 0, attOk: 0,
    kills: 0, maxFloor: 3, unit: 1, heroId: 'a', node: { done: false, type: 'battle', links: [] },
    nextHint: 0, clearedRun: false, countedStart: true, result: undefined,
  };
  const B = {
    word: { w: 'keep', z: '保持', u: 1, d: 1 }, letters: ['k', 'e', 'e', 'p', 'x'],
    used: [false, false, false, false, false], bad: [false, false, false, false, false],
    input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0,
    dmgBonus: 0, firstWrong: true, lethUsed: 0, wordsDone: 0, over: false,
    boss: false, elite: false, won: false, finished: false, myHp: 50, enHp: 200, enMax: 200,
    shield: 0, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
    usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' },
  };
  // B.node 必须和 G.node 是同一个对象：finishBattleNode 结转的是 battle.node.done
  B.node = G.node;
  return { G, B: Object.assign(B, over), node: G.node };
}

async function harness({ B: overB = {}, G: overG = {} } = {}) {
  const { createCombatController } = await import('../../src/app/combat.js');
  const { finishBattleNode, endRunProgress } = await import('../../src/domain/run.js');
  const fixture = battleFixture(overB);
  Object.assign(fixture.G, overG);
  const G = fixture.G, B = fixture.B;
  const DB = { mastered: [], runs: 1, wins: 0, rewards: [], best: 0 };
  const state = { DB, G, B };
  const toasts = [], calls = [], jobs = [];
  const dom = ids();
  const ports = {
    $: id => dom[id], confirm: () => true, norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: () => 0,
    hasR: id => G.relics.indexOf(id) >= 0,
    itemById: () => undefined, hitDmg: () => 10, wordDmg: () => 40,
    wordComplete: () => B.input.length >= 4,
    creditWord: w => DB.mastered.push(w), onWordWrong: w => G.wrong.push(w),
    centerOf: () => ({ x: 1, y: 1 }), heroPoint: () => ({ x: 1, y: 1 }),
    toast: m => toasts.push(m), sfx: noopSfx, TTS: noopTTS,
    burst() {}, floatTxt() {}, flash() {}, ring() {}, animHero() {}, wordFinisher() {}, foeCry() {},
    renderFight() { calls.push('renderFight'); }, nextWord() { calls.push('nextWord'); },
    winFight: () => { if (B.over) return; B.over = true; B.won = true; calls.push('winFight'); },
    // 与 src/app/runtime.js 的 loseFight 同构：先过 over 闸门，再安排失败结算。
    loseFight: () => {
      if (B.over) return;
      B.over = true;
      calls.push('loseFight');
      jobs.push(() => { endRunProgress(G, DB, false); calls.push('endRun:false'); });
    },
    // 真实结算：普通/精英 → 'advance'，BOSS → 'boss-loss'（不算通关）
    finishNode: () => { calls.push('finishNode:' + finishBattleNode(G, B, DB)); },
    saveDB() {}, scheduleBattle() {},
  };
  const ctrl = createCombatController({ state, ports });
  return { ctrl, state, ports, G, B, DB, toasts, calls, jobs, fire: () => jobs.splice(0).forEach(f => f()) };
}

/* ---------------- 正常撤退：够血就固定付 50 ---------------- */

test('普通跳过固定扣 50 点生命并推进普通节点（不是 40%、不是比例）', async () => {
  const h = await harness({ B: { myHp: 60 } });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.B.myHp, 10, '60 - 固定 50');
  assert.equal(h.B.over, true);
  assert.deepEqual(h.calls, ['finishNode:advance']);
  assert.equal(h.G.hp, 10, '战斗生命结转回远征，且不为 0 保底');
  assert.equal(h.G.node.done, true);
  assert.equal(h.DB.wins, 0);
  assert.equal(h.DB.rewards.length, 0);
  assert.ok(h.toasts.some(t => t.includes('50')), '文案点明损失 50 点生命');
});

test('跳过代价与当前生命上限无关：100 血也只扣 50', async () => {
  const h = await harness({ B: { myHp: 100 }, G: { hp: 100, maxhp: 100 } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 50);
  assert.equal(h.G.hp, 50);
});

test('低血跳过：生命归 0、战败、不结算节点（不 clamp 保底、不推进）', async () => {
  const h = await harness({ B: { myHp: 50 } });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.B.myHp, 0, '不能被 Math.max(1,...) 救成 1');
  assert.equal(h.B.over, true, 'loseFight 必须真的把战斗标记为结束');
  assert.ok(!h.calls.some(c => c.startsWith('finishNode')), '失败路径不得结算/推进节点');
  assert.equal(h.G.node.done, false);
  assert.equal(h.G.hp, 50, '未结算就不能结转生命，远征状态保持原值');
  assert.equal(h.DB.wins, 0);
  assert.equal(h.DB.rewards.length, 0);
  assert.equal(h.calls.includes('loseFight'), true, '死亡必须走 loseFight');
});

test('低血跳过的失败结算由 loseFight 安排：跑完定时器后本轮结束且无纪念卡', async () => {
  const h = await harness({ B: { myHp: 20 } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 0);
  assert.equal(h.calls.includes('endRun:false'), false, '结算前还没跑定时器');
  h.fire();
  assert.deepEqual(h.calls.filter(c => c === 'endRun:false').length, 1);
  assert.equal(h.G.result, false);
  assert.equal(h.DB.wins, 0);
  assert.deepEqual(h.DB.rewards, [], '失败不给纪念卡');
  assert.equal(h.G.kills, 0, '撤退/死亡都不算击杀');
});

test('跳过死亡后连点不会重复扣血或重复结算', async () => {
  const h = await harness({ B: { myHp: 30 } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 0);
  assert.equal(h.ctrl.skipFight(), false, '已 over 的战斗拒绝第二次跳过');
  assert.equal(h.B.myHp, 0, '不会出现负血或二次扣减');
  assert.deepEqual(h.calls, ['loseFight'], '第二次调用不留任何副作用');
  h.fire();
  assert.equal(h.calls.filter(c => c === 'endRun:false').length, 1, '只结算一次');
});

/* ---------------- 护盾 / 免伤 / 遗物都不代付 ---------------- */

test('护盾不代付跳过代价：护盾原样保留，生命照扣 50', async () => {
  const h = await harness({ B: { myHp: 60, shield: 30 } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 10);
  assert.equal(h.B.shield, 30, '跳过不是受击，不走护盾吸收');
  assert.equal(h.G.hp, 10);
  assert.equal(h.G.shield, 30);
});

test('幸运草（首次答错免伤）不减免跳过代价', async () => {
  const h = await harness({ B: { myHp: 60, lethUsed: 1 }, G: { relics: ['lucky'] } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 10);
  assert.equal(h.B.lethUsed, 1, '免伤次数不该被跳过消耗或触发');
});

test('任何遗物都不改变固定代价（有遗物也只扣 50）', async () => {
  for (const relic of ['forge', 'battery', 'focus', 'greed', 'scholar', 'thorn']) {
    const h = await harness({ B: { myHp: 70 }, G: { relics: [relic] } });
    h.ctrl.skipFight();
    assert.equal(h.B.myHp, 20, relic + ' 不得改变跳过代价');
  }
});

/* ---------------- 精英 / BOSS ---------------- */

test('精英战跳过：付 50 后照常推进（精英不算 BOSS）', async () => {
  const h = await harness({ B: { myHp: 60, elite: true }, G: { node: { done: false, type: 'elite', links: [] } } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 10);
  assert.deepEqual(h.calls, ['finishNode:advance']);
});

test('BOSS 跳过即使血够：付 50、boss-loss、不计通关、不发纪念卡', async () => {
  const h = await harness({ B: { myHp: 100, boss: true }, G: { hp: 100, maxhp: 100, node: { done: false, type: 'boss', links: [] } } });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.B.myHp, 50);
  assert.deepEqual(h.calls, ['finishNode:boss-loss']);
  assert.equal(h.DB.wins, 0, '借跳过不能通关');
  assert.deepEqual(h.DB.rewards, []);
  assert.equal(h.G.hp, 50);
});

test('BOSS 跳过血不够：死亡且不算通关', async () => {
  const h = await harness({ B: { myHp: 40, boss: true }, G: { node: { done: false, type: 'boss', links: [] } } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 0);
  assert.ok(!h.calls.some(c => c.startsWith('finishNode')));
  h.fire();
  assert.equal(h.DB.wins, 0);
  assert.deepEqual(h.DB.rewards, []);
});

test('BOSS 跳过成功后不能因迟到的胜利回调再补一次通关', async () => {
  const h = await harness({ B: { myHp: 100, boss: true }, G: { hp: 100, maxhp: 100, node: { done: false, type: 'boss', links: [] } } });
  h.ctrl.skipFight();
  // 同一个战斗对象上迟到的「打赢」回调：结算已被 finishBattleNode 标记 finished
  h.ports.finishNode();
  assert.equal(h.DB.wins, 0);
});

/* ---------------- 影分身免费路径：额度是 run 级（任务 3） ---------------- */

test('影分身免费撤退不扣血、照常推进，并把额度记在 run 上', async () => {
  const h = await harness({ B: { myHp: 60 }, G: { relics: ['ghost'] } });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.B.myHp, 60, '影分身仍然免费');
  assert.equal(h.G.ghostUsed, true, '额度挂在 run 上');
  assert.ok(!('ghostUsed' in h.B), '战斗对象不再持有 ghost 状态');
  assert.deepEqual(h.calls, ['finishNode:advance']);
});

// 本轮已用完 → **不再拒绝**，而是回普通跳过（固定 50）。
// 这是任务 3 的核心语义变化：旧行为是「拒绝 + 不扣血」，等于免费撤退还有第二次。
test('本轮影分身已用完 → 回普通跳过（固定 50），不再是拒绝', async () => {
  const h = await harness({ B: { myHp: 90 }, G: { relics: ['ghost'], ghostUsed: true } });
  assert.equal(h.ctrl.skipFight(), true, '必须执行，而不是返回 false 拒绝');
  assert.equal(h.B.myHp, 90 - SKIP_HP_COST, '与没有影分身时完全一致的代价');
  assert.deepEqual(h.calls, ['finishNode:advance']);
});

test('本轮已用完 + 血不够付代价 → 仍然是战败，不会因为「有影分身」而免死', async () => {
  const h = await harness({ B: { myHp: 40 }, G: { relics: ['ghost'], ghostUsed: true } });
  assert.equal(h.ctrl.skipFight(), true);
  assert.equal(h.B.myHp, 0);
  assert.equal(h.B.over, true);
  assert.ok(!h.calls.some(c => c.startsWith('finishNode')));
  h.fire();
  assert.equal(h.DB.wins, 0);
});

/* ---------------- 单一数值来源 ---------------- */

test('SKIP_HP_COST 只有一个来源，且跳过按它结算', async () => {
  assert.equal(SKIP_HP_COST, 50);
  const h = await harness({ B: { myHp: 120 } });
  h.ctrl.skipFight();
  assert.equal(h.B.myHp, 120 - SKIP_HP_COST);
});
