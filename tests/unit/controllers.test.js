import { test } from 'node:test';
import assert from 'node:assert/strict';
// 静态引入：winFight 桩的授权判定必须是**同步**的，否则 fxOrder 的顺序断言失真。
import { canFinishFight } from '../../src/domain/battle-rules.js';

/* ============================================================
 * 控制器契约测试（战斗 / 事件·商店·奖励）
 * 全部用 Node 桩：DOM、存档、远征与战斗状态都由测试自己造，
 * 断言打在真实状态迁移与副作用顺序上，不是字符串匹配。
 * ============================================================ */

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
function stubSfx() {
  const calls = [];
  const rec = k => (...a) => calls.push([k, ...a]);
  return { calls, good: rec('good'), bad: rec('bad'), hit: rec('hit'), hurt: rec('hurt'),
    undo: rec('undo'), hint: rec('hint'), word: rec('word'), combo: rec('combo'),
    flee: rec('flee'), item: rec('item'), relic: rec('relic'), coin: rec('coin'),
    finisher: rec('finisher'), win: rec('win'), lose: rec('lose') };
}
function stubTTS() {
  const calls = [];
  return { calls, supported: true, on: true, line: (...a) => calls.push(['line', ...a]),
    word: (...a) => calls.push(['word', ...a]), hint: (...a) => calls.push(['hint', ...a]),
    foeLine: (...a) => calls.push(['foeLine', ...a]) };
}
function fx() {
  const calls = [];
  return { calls, burst: (...a) => calls.push(['burst', ...a]), floatTxt: (...a) => calls.push(['floatTxt', ...a]),
    flash: (...a) => calls.push(['flash', ...a]), ring: (...a) => calls.push(['ring', ...a]),
    animHero: (...a) => calls.push(['animHero', ...a]) };
}
function timers() {
  const jobs = [];
  return { jobs, scheduleRun: (fn, ms) => jobs.push({ fn, ms, run: true }),
    scheduleBattle: (fn, ms) => jobs.push({ fn, ms, battle: true }),
    fire() { for (const j of jobs) j.fn(); } };
}

// 道具桩：只需「存在 + 有 max」，其余字段不影响流程
const ITEM_IDS = ['leech', 'rage', 'freeze', 'chain', 'reveal', 'purge', 'greed', 'stone'];
const word = { w: 'keep', z: '保持', u: 1, d: 1 };

function battleFixture(over) {
  const G = { floor: 3, hp: 50, maxhp: 50, shield: 0, gold: 30, relics: [], hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: { leech: 2, stone: 1, rage: 1 },
    att: 0, attOk: 0, kills: 0, unit: 1, heroId: 'a', node: { done: false, links: [] }, nextHint: 0 };
  // 答案 keep + 一个干扰字母 x：下标 4 是唯一「不在词里」的字母
  const B = { word, letters: ['k', 'e', 'e', 'p', 'x'], used: [false, false, false, false, false],
    bad: [false, false, false, false, false], input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0,
    combo: 0, maxCombo: 0, dmgBonus: 0, firstWrong: true, lethUsed: 0,
    // ★ 战斗对象上**没有** ghostUsed：影分身额度是 run 级（G.ghostUsed），
    //   放在 B 上会让每场战斗都能重新白嫖一次免费撤退。
    wordsDone: 0, over: false, boss: false, elite: false, myHp: 50, enHp: 200, enMax: 200,
    shield: 0, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
    usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' } };
  return { G, B: Object.assign(B, over || {}) };
}

function combatHarness(over) {
  const { G, B } = battleFixture(over);
  const DB = { mastered: [], runs: 0, wins: 0, rewards: [] };
  const ids = hud();
  const sfx = stubSfx(), TTS = stubTTS(), fxCalls = fx(), tm = timers();
  const toasts = [], fxOrder = [];
  const state = { DB, G, B };
  const saved = [];
  const ports = {
    $: id => ids[id], norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: n => 0, hasR: id => G.relics.indexOf(id) >= 0,
    itemById: id => ITEM_IDS.indexOf(id) >= 0 ? { id, n: id, max: 6, ic: '🩸' } : undefined,
    hitDmg: () => 10, wordDmg: () => 40, wordComplete: () => state.B.input.length >= 4,
    creditWord: w => { DB.mastered.push(w); G.done.add(w); },
    onWordWrong: w => { G.wrong.push(w); },
    centerOf: () => ({ x: 10, y: 10 }), heroPoint: () => ({ x: 5, y: 5 }),
    toast: m => toasts.push(m), sfx, TTS,
    burst: (...a) => { fxOrder.push('burst'); fxCalls.burst(...a); },
    floatTxt: (...a) => { fxOrder.push('floatTxt'); fxCalls.floatTxt(...a); },
    flash: (...a) => { fxOrder.push('flash'); fxCalls.flash(...a); },
    ring: (...a) => { fxOrder.push('ring'); fxCalls.ring(...a); },
    animHero: (...a) => { fxOrder.push('animHero'); fxCalls.animHero(...a); },
    wordFinisher: (...a) => { fxOrder.push('wordFinisher'); }, foeCry: () => {},
    renderFight: () => fxOrder.push('renderFight'), nextWord: () => fxOrder.push('nextWord'),
    // winFight 的桩走**真实**授权条件 canFinishFight（不是只挡 B.over）：
    // 半词 / 敌人没被打空 / 已结算，全部拒绝。这样单测里「赢了」这个事实
    // 本身就等价于「整词拼完 + 大招致命 + 没重复结算」三条同时成立。
    winFight: () => {
      if (!canFinishFight(state.B)) return;
      state.B.over = true; fxOrder.push('winFight');
    },
    loseFight: () => { if (state.B.over) return; state.B.over = true; fxOrder.push('loseFight'); },
    finishNode: () => { fxOrder.push('finishNode'); }, saveDB: () => saved.push(1),
    scheduleBattle: (fn, ms) => tm.scheduleBattle(fn, ms)
  };
  return { state, ids, sfx, TTS, toasts, fxOrder, tm, ports, saved, db: DB };
}

async function makeCombat(over) {
  const h = combatHarness(over);
  const { createCombatController } = await import('../../src/app/combat.js');
  h.ctrl = createCombatController({ state: h.state, ports: h.ports });
  return h;
}

/* ---------------- pick-card ---------------- */

test('pick-card：类别徽标与卡片 HTML 分层与旧版一致', async () => {
  const { CAT_LABEL, pickCardHTML } = await import('../../src/ui/components/pick-card.js');
  assert.deepEqual(CAT_LABEL, { relic: '遗物', item: '道具', heal: '恢复', boost: '增益', event: '事件', none: '无' });
  assert.equal(pickCardHTML({ cat: 'relic', ic: '💎', t: '连击徽章', d: '连击加成翻倍' }),
    '<i class="ctag" data-cat="relic">遗物</i><b>💎 连击徽章</b><span>连击加成翻倍</span>');
  assert.equal(pickCardHTML({ cat: 'item', t: '獠牙 ×3', d: '回血', tip: '续命' }),
    '<i class="ctag" data-cat="item">道具</i><b>獠牙 ×3</b><span>回血</span><span class="ctip">续命</span>');
  // 未知类别降级为 none，且无 ic 时不留空占位
  assert.equal(pickCardHTML({ cat: 'wat', t: 'X', d: 'Y' }),
    '<i class="ctag" data-cat="none">无</i><b>X</b><span>Y</span>');
});

/* ---------------- 战斗：单字母 ---------------- */

test('pressKey：正确字母入盘、连击递增、按 hitDmg 扣敌人血', async () => {
  const h = await makeCombat();
  h.ctrl.pressKey(0);
  assert.deepEqual(h.state.B.input, ['k']);
  assert.equal(h.state.B.used[0], true);
  assert.equal(h.state.B.combo, 1);
  assert.equal(h.state.G.att, 1);
  assert.equal(h.state.G.attOk, 1);
  assert.equal(h.state.B.enHp, 190);
  assert.equal(h.sfx.calls.filter(c => c[0] === 'good').length, 1);
});

test('pressKey：字母不在单词里 → 扣血、标 bad、错词进复习且保留练习历史', async () => {
  const h = await makeCombat();
  h.db.mastered.push('keep');
  h.ctrl.pressKey(4);
  assert.equal(h.state.B.bad[4], true);
  assert.equal(h.state.B.myHp, 38);
  assert.deepEqual(h.state.G.wrong, ['keep']);
  assert.deepEqual(h.db.mastered, ['keep']);
  assert.deepEqual(h.db.reviewQueue, ['keep']);
  assert.equal(h.state.B.mistaken.length, 1);
  assert.ok(h.toasts.includes('不对'));
});

test('pressKey：字母在词中但顺序不对 → 照样扣血并记错词（soft）', async () => {
  const h = await makeCombat();
  h.ctrl.pressKey(1);      // 'e'，当前位置需要 'k'
  assert.equal(h.state.B.myHp, 44);
  assert.equal(h.state.B.bad[1], false, '顺序错不能标 bad，否则死局');
  assert.deepEqual(h.state.G.wrong, ['keep']);
  assert.deepEqual(h.state.B.mistaken, ['keep']);
  assert.deepEqual(h.db.reviewQueue, ['keep']);
  assert.ok(h.toasts.includes('不对'));
  assert.equal(h.toasts.some(t=>/位置不对|在这个/.test(t)),false);
});

test('pressKey：已标 bad 的字母再点只提示，不再扣血', async () => {
  const h = await makeCombat();
  h.ctrl.pressKey(4);
  const hp = h.state.B.myHp;
  h.ctrl.pressKey(4);
  assert.equal(h.state.B.myHp, hp);
  assert.ok(h.toasts.some(t => t.indexOf('换一个字母') > 0), '只提示不重复扣血');
});

test('pressKey：需要的字母全被误标时自动解封并回退，不扣血', async () => {
  const h = await makeCombat();
  h.state.B.letters = ['k', 'q'];
  h.state.B.used = [false, false];
  h.state.B.bad = [true, false];
  const hp = h.state.B.myHp;
  h.ctrl.pressKey(0);
  assert.equal(h.state.B.bad[0], false);
  assert.equal(h.state.B.myHp, hp);
  assert.deepEqual(h.state.B.input, []);
  assert.ok(h.toasts.some(t => t.indexOf('再试一次') > 0));
});

test('pressKey：重复字母靠 typeLetter 能对上正确实例', async () => {
  const h = await makeCombat();
  h.state.B.word = { w: 'apple', z: '苹果', u: 1, d: 1 };
  h.state.B.letters = ['a', 'p', 'a'];
  h.state.B.used = [false, false, false];
  h.state.B.bad = [false, false, false];
  h.ports.wordComplete = () => h.state.B.input.length >= 5;
  h.ctrl.typeLetter('A');
  assert.deepEqual(h.state.B.input, ['a']);
  assert.equal(h.state.B.used[0], true);
  assert.equal(h.state.B.used[2], false);
  assert.equal(h.ctrl.typeLetter('q'), false, '盘上没有的字母不当作输入');
});

/* ---------------- 战斗：整词大招与结算顺序 ---------------- */

test('pressKey：整词拼完 → 记学会 + 大招反馈，且伤害先于整词结算', async () => {
  const h = await makeCombat();
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2);   // k e e
  assert.deepEqual(h.db.mastered, [], '只拼一半不算学会');
  h.fxOrder.length = 0;
  h.ctrl.pressKey(3);      // p —— 第 4 个字母，整词拼完
  assert.deepEqual(h.db.mastered, ['keep'], '整词完成只记一次');
  assert.equal(h.state.B.wordsDone, 1);
  assert.equal(h.state.B.wordStreak, 1);
  assert.equal(h.state.B.enHp, 200 - 10 * 4 - 40, '4 个单字母 + 1 次大招');
  assert.ok(h.fxOrder.includes('wordFinisher'), '大招反馈必须跑');
  assert.ok(h.fxOrder.includes('nextWord'), '未击杀则换下一个词（换词内部自己渲染）');
  assert.equal(h.fxOrder.includes('renderFight'), false, '这条路径不重复渲染');
  assert.ok(h.fxOrder.indexOf('wordFinisher') >= 0
    && h.fxOrder.indexOf('wordFinisher') < h.fxOrder.indexOf('nextWord'), '大招反馈先于换词结算');
  assert.equal(h.fxOrder.includes('winFight'), false);
});

// ★ 旧断言（enHp:10 时敲第一个字母就 winFight）编码的是「半词能赢」的 bug，
//   已按新的验收标准改写：单字母打不死敌人，整词大招才是唯一胜利来源。
test('pressKey：最后一个字母的普通命中也不会抢先赢，赢一定发生在大招上', async () => {
  const h = await makeCombat({ enHp: 1 });      // 敌人只剩 1 血，一个字母就够打死
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2);
  assert.deepEqual(h.fxOrder.filter(x => x === 'winFight'), [], '半词不得赢');
  assert.equal(h.state.B.enHp, 1, '敌人被钉在 1 血地板上');
  assert.deepEqual(h.db.mastered, [], '没拼完不算学会');
  h.fxOrder.length = 0;
  h.ctrl.pressKey(3);                            // 整词拼完 → 大招 40 收尾
  assert.equal(h.state.B.enHp, -39);
  assert.deepEqual(h.fxOrder.filter(x => x === 'winFight'), ['winFight'], '大招赢一次');
  assert.deepEqual(h.db.mastered, ['keep'], '拼完了才记学会');
  assert.equal(h.state.B.over, true, 'winFight 由 runtime 负责置 over');
});

test('pressKey：整词大招自己打死敌人 → 先放完大招再结算胜利', async () => {
  const h = await makeCombat({ enHp: 45 });      // 3 个单字母剩 15；第 4 个字母后剩 5，只有大招能致命
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2);
  h.fxOrder.length = 0;
  h.ctrl.pressKey(3);                            // 最后一个字母：大招扣 40 → 敌人 -35
  assert.equal(h.state.B.enHp, -35);
  assert.deepEqual(h.db.mastered, ['keep'], '打死了也照样记学会（这词确实拼完了）');
  assert.equal(h.fxOrder.includes('wordFinisher'), true, '大招反馈先播完');
  assert.equal(h.fxOrder.includes('winFight'), true, '然后才结算胜利');
  assert.ok(h.fxOrder.indexOf('wordFinisher') < h.fxOrder.indexOf('winFight'));
  assert.equal(h.fxOrder.includes('nextWord'), false, '已死不再换词');
});

test('pressKey：正确字母让提示窗口同步收缩，不会白赚下一个字母', async () => {
  const h = await makeCombat();
  h.ctrl.requestHint();
  assert.equal(h.state.B.hintUsed, 1);
  h.ctrl.pressKey(0);                            // 敲进第 1 个正确字母
  assert.equal(h.state.B.input.length, 1);
  assert.equal(h.state.B.hintUsed, 0, '进度 +1 必须把已揭示数减回来');
  h.ctrl.pressKey(1);
  assert.equal(h.state.B.hintUsed, 0, '没有新提示时不能变负');
});

test('pressKey：非最后字母的伤害把敌人压到地板也不得走 winFight', async () => {
  const h = await makeCombat({ enHp: 10 });
  h.ctrl.pressKey(0);                            // 10 点伤害足以打死，但只是半词
  assert.equal(h.state.B.enHp, 1, '非完整词伤害有 1 血地板');
  assert.deepEqual(h.fxOrder.filter(x => x === 'winFight'), [], '半词伤害不得赢');
  assert.equal(h.state.B.over, false, '战斗继续');
});

/* ---------------- 战斗：受伤结算 ---------------- */

test('hurtPlayer：护盾先吃伤害、荆棘反弹、血尽触发 loseFight', async () => {
  const h = await makeCombat({ shield: 10, myHp: 12 });
  h.state.G.relics.push('thorn');
  h.ctrl.hurtPlayer(16, 'x', 'k');
  assert.equal(h.state.B.shield, 0);
  assert.equal(h.state.B.myHp, 6);
  assert.equal(h.state.B.enHp, 195, '荆棘反弹 5 点');
  h.ctrl.hurtPlayer(6, 'x', 'k');
  assert.equal(h.state.B.myHp, 0);
  assert.ok(h.fxOrder.includes('loseFight'));
});

test('hurtPlayer：幸运草免伤、BOSS 首击减半', async () => {
  const a = await makeCombat({ lethUsed: 1 });
  a.ctrl.hurtPlayer(12, 'x', 'k');
  assert.equal(a.state.B.myHp, 50);
  assert.ok(a.toasts.some(t => t.indexOf('🍀') === 0));
  const b = await makeCombat({ boss: true });
  b.ctrl.hurtPlayer(12, 'x', 'k');
  assert.equal(b.state.B.myHp, 44);
  assert.ok(b.toasts.some(t => t.indexOf('🛡️') === 0));
});

test('hurtPlayer：低血量喊一次台词，回血后允许再喊', async () => {
  const h = await makeCombat({ myHp: 14 });
  h.ctrl.hurtPlayer(6, 'x', 'k');
  assert.equal(h.TTS.calls.filter(c => c[0] === 'line' && c[1] === 'low').length, 1);
  h.state.B.myHp = 40;
  h.ctrl.hurtPlayer(1, 'x', 'k');
  assert.equal(h.TTS.calls.filter(c => c[0] === 'line' && c[1] === 'low').length, 1);
});

/* ---------------- 战斗：道具 ---------------- */

test('useItem：吸血獠牙回血扣库存，石之躯加护盾且受上限夹逼', async () => {
  const h = await makeCombat({ myHp: 49 });
  h.ctrl.useItem('leech');
  assert.equal(h.state.B.myHp, 50);
  assert.equal(h.state.G.bag.leech, 1);
  h.ctrl.useItem('stone');
  assert.equal(h.state.B.shield, 20);
  assert.ok(h.sfx.calls.some(c => c[0] === 'item'));
});

test('useItem：本场用满、库存为空、道具不存在时只提示不改状态', async () => {
  const h = await makeCombat({ usedThisFight: { leech: 6 } });
  const before = h.state.G.bag.leech;
  h.ctrl.useItem('leech');
  assert.equal(h.state.G.bag.leech, before);
  assert.ok(h.toasts.some(t => t.indexOf('本场已用满') >= 0));
  h.state.G.bag.leech = 0;
  h.ctrl.useItem('leech');
  assert.ok(h.toasts.some(t => t.indexOf('没有') >= 0));
  h.ctrl.useItem('unknown');
  assert.equal(h.toasts.length, 2);
});

test('useItem：怒火护符点燃伤害翻倍并清空连击', async () => {
  const h = await makeCombat();
  h.state.B.combo = 5;
  h.ctrl.useItem('rage');
  assert.equal(h.state.B.rageLeft, 3);
  assert.equal(h.state.B.combo, 0);
});

/* ---------------- 战斗：提示 / 跳过 / 逃跑 / 退格 ---------------- */

test('requestHint：扣次数、揭示窗口按当前进度、顺手解开误标字母', async () => {
  const h = await makeCombat();
  h.state.B.bad[0] = true;
  h.ctrl.requestHint();
  assert.equal(h.state.B.hints, 2);
  assert.equal(h.state.B.hintUsed, 1);
  assert.equal(h.state.B.hintTotal, 1);
  assert.equal(h.state.B.bad[0], false);
  h.ctrl.requestHint();
  assert.equal(h.state.B.hintUsed, 2);
  h.ctrl.requestHint();
  assert.equal(h.state.B.hints, 0);
  assert.equal(h.state.B.hintUsed, 3, '初始只有 3 次提示，最多揭示 3 个字母');
  assert.equal(h.ctrl.requestHint(), false, '次数用完直接拒绝');
  assert.equal(h.state.B.hints, 0);
  assert.equal(h.state.B.hintUsed, 3);
});

test('requestHint：剩余字母已全部揭示时直接拒绝，不扣次数', async () => {
  const h = await makeCombat();
  h.state.B.hints = 9;
  h.state.B.hintUsed = 4;          // keep 的 4 个字母已全揭示
  assert.equal(h.ctrl.requestHint(), false);
  assert.equal(h.state.B.hints, 9, '不再白扣次数');
  assert.equal(h.state.B.hintUsed, 4);
  assert.ok(h.toasts.some(t => t.indexOf('全部揭示') >= 0));
});

test('undoLetter：退回最后输入的字母并重置对应实例', async () => {
  const h = await makeCombat();
  h.ctrl.pressKey(0);
  h.ctrl.undoLetter();
  assert.deepEqual(h.state.B.input, []);
  assert.equal(h.state.B.used[0], false);
  assert.equal(h.state.G.attOk, 0);
  assert.equal(h.state.B.combo, 0);
  assert.equal(h.ctrl.undoLetter(), false, '空输入时无操作');
});

test('skipFight：影分身首次免费，之后普通跳过固定损失 50 点生命', async () => {
  const a = await makeCombat();
  a.state.G.relics.push('ghost');
  a.ctrl.skipFight();
  assert.ok(a.fxOrder.includes('finishNode'));
  // 固定 50 取代旧的「本场 40%」：50 血场上旧逻辑只扣 20，新逻辑扣到 0 → 战败。
  const b = await makeCombat({ myHp: 80 });
  b.ctrl.skipFight();
  assert.equal(b.state.B.myHp, 30);
  assert.ok(b.fxOrder.includes('finishNode'));
});

test('skipFight：影分身额度是 run 级 —— 第二场战斗必须付 50 点生命', async () => {
  const h = await makeCombat();
  h.state.G.relics.push('ghost');
  h.ctrl.skipFight();
  assert.ok(h.fxOrder.includes('finishNode'));
  assert.equal(h.state.B.myHp, 50, '第一次：免费撤退，不扣血');
  assert.equal(h.state.G.ghostUsed, true, '额度记在 run 上，不是本场');
  // 真实的 startFight 每场都重建 B：额度不能因为换了一场战斗而重置
  const fresh = battleFixture();
  h.state.B = fresh.B;
  assert.ok(!('ghostUsed' in fresh.B), '新战斗对象不携带任何 ghost 状态');
  h.ctrl.skipFight();
  assert.equal(h.state.B.myHp, 0, '第二场必须走普通跳过的固定 50（50 血场 → 战败）');
  assert.ok(h.fxOrder.includes('loseFight'), '用完额度后不再拒绝，而是真的结算代价');
});

test('skipFight：新开一轮远征会重新获得一次免费撤退', async () => {
  const { createRun } = await import('../../src/domain/run.js');
  const h = await makeCombat();
  h.state.G.relics.push('ghost');
  h.ctrl.skipFight();
  assert.equal(h.state.G.ghostUsed, true);
  // createRun 是唯一把额度置回 false 的地方
  const next = createRun(1, null, []);
  assert.equal(next.ghostUsed, false);
  h.state.G = next;
  const fresh = battleFixture();
  fresh.G.relics = ['ghost'];
  h.state.B = fresh.B;
  h.ctrl.skipFight();
  assert.equal(h.state.B.myHp, 50, '新一局的第一场仍然免费');
  assert.equal(h.state.G.ghostUsed, true);
});

test('pressKey：整词拼完后连击清零，伤害不跨词叠加', async () => {
  const h = await makeCombat();
  h.ctrl.pressKey(0); h.ctrl.pressKey(1); h.ctrl.pressKey(2); h.ctrl.pressKey(3);
  assert.equal(h.state.B.combo, 0, '换词前必须结算连击');
  assert.equal(h.state.B.maxCombo, 4, '最高连击仍然记录');
});

test('fleeFight：金币不足不动，够则扣 10 金币结束节点', async () => {
  const h = await makeCombat();
  h.state.G.gold = 5;
  h.ctrl.fleeFight();
  assert.equal(h.fxOrder.length, 0);
  h.state.G.gold = 20;
  h.ctrl.fleeFight();
  assert.equal(h.state.G.gold, 10);
  assert.ok(h.fxOrder.includes('finishNode'));
});

/* ---------------- 战斗：快照隔离 ---------------- */

test('战斗入口每次重新读取 state，不会拿旧 B 继续结算', async () => {
  const h = await makeCombat();
  const first = h.state.B;
  h.state.B = battleFixture({ myHp: 10 }).B;
  h.ctrl.pressKey(0);
  assert.equal(first.input.length, 0, '上一场战斗不应被新状态污染');
  assert.deepEqual(h.state.B.input, ['k']);
});

/* ============================================================
 * 事件 / 营火 / 商店 / 战斗奖励
 * ============================================================ */

function encounterHarness() {
  const ids = hud();
  // 控制器需要造 button：Node 里没有全局 document，桩里注入一个最简 createElement
  const made = [];
  globalThis.document = { createElement: tag => { const e = el({ tagName: tag }); made.push(e); return e; } };
  const G = { floor: 2, hp: 40, maxhp: 40, shield: 0, gold: 100, relics: ['forge'], bag: {},
    unit: 1, heroId: 'a', done: new Set(), wrong: [], kills: 3, maxFloor: 2,
    att: 10, attOk: 9, nextHint: 0, node: { done: false, type: 'event', links: [{ x: 1 }] } };
  const B = { boss: false, elite: false, myHp: 20, enMax: 100, enHp: 40, foe: { n: '词灵', ic: '👾' },
    maxCombo: 3, finished: false, rewardTaken: false, node: G.node };
  const DB = { mastered: [], runs: 1, wins: 0, rewards: [], best: 1 };
  const state = { DB, G, B };
  const sfx = stubSfx(), tm = timers();
  const toasts = [], shown = [];
  const ports = {
    $: id => ids[id], clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    pick: a => a[0], shuffle: a => a.slice().reverse(), rnd: () => 0, has: (a, v) => a.indexOf(v) >= 0,
    hasR: id => G.relics.indexOf(id) >= 0, goldGain: n => { G.gold += Math.round(n * 1.5); return G.gold; },
    applyRelicInit: () => { G.relicInit = (G.relicInit || 0) + 1; },
    sfx, toast: m => toasts.push(m), advance: () => shown.push('advance'),
    endRun: w => shown.push('endRun:' + w), finishNode: () => shown.push('finishNode'),
    show: id => shown.push('show:' + id), scheduleRun: (fn, ms) => tm.scheduleRun(fn, ms),
    scheduleBattle: (fn, ms) => tm.scheduleBattle(fn, ms),
    makeButton: () => document.createElement('button')
  };
  return { state, ids, G, B, DB, sfx, toasts, shown, tm, ports, made };
}
async function makeEncounters() {
  const h = encounterHarness();
  const { createEncounterController } = await import('../../src/app/encounters.js');
  h.ctrl = createEncounterController({ state: h.state, ports: h.ports });
  return h;
}

test('showEvent：渲染选项、一次生效、延迟后标记节点并推进', async () => {
  const h = await makeEncounters();
  h.ctrl.showEvent();
  assert.equal(h.ids.ePicks.children.length, 2);
  assert.ok(h.shown.includes('show:s-event'));
  const [first, second] = h.ids.ePicks.children;
  first.onclick();
  second.onclick();
  assert.equal(h.toasts.length, 1, '双击只生效一次');
  assert.equal(h.state.G.relics.length, 2, '打开背包：还有未持有的遗物 → 直接给一件');
  assert.equal(h.state.G.gold, 100, '给了遗物就不再给金币');
  assert.ok(h.toasts[0].indexOf('你找到了') === 0);
  h.tm.fire();
  assert.ok(h.shown.includes('advance'));
  assert.equal(h.state.G.node.done, true);
});

test('showEvent：远征已被换掉时，旧回调不得推进新状态', async () => {
  const h = await makeEncounters();
  h.ctrl.showEvent();
  h.ids.ePicks.children[0].onclick();
  const fresh = encounterHarness();
  h.state.G = fresh.G;                       // 清档/重开：旧 UI 回调仍在飞
  h.tm.fire();
  assert.deepEqual(h.shown.filter(x => x === 'advance'), []);
  assert.equal(fresh.G.floor, 2, '新远征的层数不得被旧回调推进');
});

test('showEvent / showRest：远征换掉后旧卡片的点击也不得改动新远征', async () => {
  const h = await makeEncounters();
  h.ctrl.showEvent();
  const card = h.ids.ePicks.children[0];
  const fresh = encounterHarness();             // 新远征：hp 40、relics ['forge']
  h.state.G = fresh.G;
  h.state.G.relics = [];
  card.onclick();                              // 旧卡片被点到
  assert.deepEqual(h.state.G.relics, [], '旧事件卡不得给新远征塞遗物');
  assert.equal(h.state.G.hp, 40);
  assert.equal(h.toasts.length, 0, '旧事件卡连文案都不该播');

  const h2 = await makeEncounters();
  h2.ctrl.showRest();
  const restCard = h2.ids.rPicks.children[0];
  const fresh2 = encounterHarness();
  h2.state.G = fresh2.G;
  restCard.onclick();
  assert.equal(h2.state.G.hp, 40, '旧营火卡不得给新远征回血');
  assert.equal(h2.toasts.length, 0);
});

test('showRest：锻造台让休息回 20、只能选一次', async () => {
  const h = await makeEncounters();
  h.ctrl.showRest();
  const cards = h.ids.rPicks.children;
  assert.ok(cards[0].innerHTML.indexOf('回复 20 点生命') > 0, '有锻造台：12 → 20');
  cards[0].onclick();
  assert.equal(h.state.G.hp, 40);
  cards[1].onclick();
  assert.equal(h.state.G.gold, 100, '第二次点击被拦下');
  h.tm.fire();
  assert.ok(h.shown.includes('advance'));
});

test('showShop：可重复购买、单按钮有 260ms 冷却、金币不足只提示', async () => {
  const h = await makeEncounters();
  h.ctrl.showShop();
  const potion = h.ids.rPicks.children[0];
  potion.onclick();
  assert.equal(h.state.G.hp, 40);
  assert.equal(h.state.G.gold, 55);
  potion.onclick();                                   // 冷却内：不再扣钱
  assert.equal(h.state.G.gold, 55);
  assert.equal(h.shown.filter(x => x === 'advance').length, 0, '买东西不推进层数');
  assert.ok(h.shown.includes('show:s-rest'));
});

test('showShop：冷却到期后可以再买一次（连买多件是商店的正常玩法）', async () => {
  const h = await makeEncounters();
  h.ctrl.showShop();
  const potion = h.ids.rPicks.children[0];
  potion.onclick();                                    // 第 1 次
  await new Promise(r => setTimeout(r, 300));          // 等过 260ms 冷却
  potion.onclick();                                    // 第 2 次：应真的成交
  assert.equal(h.state.G.gold, 10, '45 × 2，两次都扣了钱');
  assert.equal(h.toasts.filter(t => t.indexOf('伤口愈合') >= 0).length, 2);
});

test('showShop：金币不够时只提示、不扣钱、不推进', async () => {
  const h = await makeEncounters();
  h.ctrl.showShop();
  h.state.G.gold = 10;
  h.ids.rPicks.children[0].onclick();
  assert.equal(h.state.G.gold, 10);
  assert.ok(h.toasts.some(t => t.indexOf('金币不够') >= 0));
  assert.equal(h.shown.filter(x => x === 'advance').length, 0);
});

test('showShop：远征换掉后旧商店卡不得扣新远征的钱、不得推进', async () => {
  const h = await makeEncounters();
  h.ctrl.showShop();
  const potion = h.ids.rPicks.children[0];
  const leave = h.ids.rPicks.children[h.ids.rPicks.children.length - 1];
  const fresh = encounterHarness();             // 新远征：gold 100、node 未完成
  h.state.G = fresh.G;
  potion.onclick();
  assert.equal(fresh.G.gold, 100, '旧商店卡不得扣新远征的金币');
  assert.equal(h.toasts.length, 0);
  leave.onclick();
  assert.equal(h.shown.filter(x => x === 'advance').length, 0, '旧「离开」不得推进新远征');
  assert.equal(fresh.G.node.done, false);
});

test('showShop：只卖玩家还没拿满的道具（每种最多 3 件）', async () => {
  const h = await makeEncounters();
  // 把背包塞满：leech 上限 6、greed 上限 9，其余为 0
  h.state.G.bag = { leech: 6, greed: 9, rage: 3, freeze: 3, chain: 4 };
  h.ctrl.showShop();
  const cards = h.ids.rPicks.children.filter(c => c.dataset.cat === 'item');
  assert.equal(cards.length, 3, '只上架还没拿满的 3 种');
  // 背包已满的是 吸血獠牙/怒火护符/寒冰护符/连锁闪电/贪婪钱币，
  // 因此上架的只可能是 透视之眼/扫除术/磐石之躯
  const names = cards.map(c => c.innerHTML).join('|');
  for (const gone of ['吸血獠牙', '怒火护符', '寒冰护符', '连锁闪电', '贪婪钱币'])
    assert.equal(names.indexOf(gone) < 0, true, '已拿满上限的道具不上架：' + gone);
  assert.equal(/透视之眼|扫除术|磐石之躯/.test(names), true);
  // 买一件：+3，仍不超过上限
  const before = JSON.stringify(h.state.G.bag);
  cards[0].onclick();
  assert.notEqual(JSON.stringify(h.state.G.bag), before);
});

test('showShop：提示卷轴累加 shopHints，离开按钮走 advance 且不触发购买', async () => {
  const h = await makeEncounters();
  h.ctrl.showShop();
  const scroll = h.ids.rPicks.children[1];            // 提示卷轴 · 40 金币
  scroll.onclick();
  assert.equal(h.state.G.gold, 60);
  assert.equal(h.state.G.shopHints, 3);
  const leave = h.ids.rPicks.children[h.ids.rPicks.children.length - 1];
  leave.onclick();
  assert.equal(h.state.G.gold, 60, '离开不扣钱');
  assert.ok(h.shown.includes('advance'));
  assert.ok(h.shown.includes('show:s-rest'));
  assert.equal(h.state.G.node.done, true, '离开才把节点标记为已完成');
});

test('showBattleRewards：奖励只能领一次（rewardTaken 闸门）', async () => {
  const h = await makeEncounters();
  h.ctrl.showBattleRewards(37, null);
  const cards = h.ids.pPicks.children;
  assert.ok(cards.length >= 2);
  const goldBefore = h.state.G.gold, relicsBefore = h.state.G.relics.length;
  cards[0].onclick();
  const afterFirst = JSON.stringify([h.state.G.gold, h.state.G.relics, h.state.B.myHp]);
  cards[1].onclick();                                 // 再点第二张：必须被拒绝
  h.ids.pSkip.onclick();                              // 跳过键同样不能再发一次
  assert.equal(JSON.stringify([h.state.G.gold, h.state.G.relics, h.state.B.myHp]), afterFirst,
    '重复领奖必须无效');
  assert.ok(h.state.G.gold >= goldBefore);
  assert.equal(h.state.G.relics.length, relicsBefore + (cards[0].dataset.cat === 'relic' ? 1 : 0));
});

test('showBattleRewards：回血卡作用在 B.myHp 并走 finishNode，标题含正确率', async () => {
  const h = await makeEncounters();
  h.state.G.relics = [];                              // 去掉锻造台等干扰，卡片更可预测
  h.ctrl.showBattleRewards(37, 'keep');
  assert.ok(h.ids.pSub.textContent.indexOf('90%') > 0);
  assert.ok(h.ids.pSub.textContent.indexOf('keep') > 0, '没拼完的词要如实写进副标题');
  const heal = h.ids.pPicks.children[0];
  assert.equal(heal.dataset.cat, 'heal');
  heal.onclick();
  assert.ok(h.state.B.myHp > 20);
  assert.ok(h.shown.includes('finishNode'));
});

test('showBattleRewards：BOSS 胜利不给回血卡且必须杀掉旧战斗后不再响应', async () => {
  const h = await makeEncounters();
  h.state.B.boss = true;
  h.ctrl.showBattleRewards(200, null);
  assert.ok(h.ids.pPicks.children.every(c => c.dataset.cat !== 'heal'));
  assert.equal(h.ids.pTitle.textContent, '🎉 击败词汇之王！');
  const stale = h.ids.pPicks.children[0];
  const relicsBefore = h.state.G.relics.length;
  h.state.B = { ...h.state.B };                       // 下一场战斗顶上来
  stale.onclick();
  assert.equal(h.state.G.relics.length, relicsBefore, '旧结算按钮不得改动新战斗');
  assert.deepEqual(h.shown.filter(x => x === 'finishNode'), []);
});