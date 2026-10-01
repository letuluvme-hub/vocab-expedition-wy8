/* 「本单元词汇已全部完成」检查点。
 *
 * 这是抽词耗尽后的**唯一**出口，必须诚实：它不是战斗通关。
 * 守卫点：
 *  1) startFight / nextWord 拿不到词时统一进这个检查点，绝不生成空字母盘、
 *     绝不让玩家掉出游戏（phase 必须落地成可快照的 learning-complete）。
 *  2) 不伪造胜利：不加 kills / gold / wins，不调 endRun(true)，怪物血真实保留。
 *  3) 最后一词真的打死 BOSS 时**优先**走既有胜利奖励（由 combat 侧先行判定）。
 *  4) 完整词 credit 仍只记一次。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../src/domain/run-snapshot.js';
import { isPoolComplete } from '../../src/domain/word-selection.js';
import { createRun } from '../../src/domain/run.js';
import { createProgressController } from '../../src/app/progress.js';
import { decodeSnapshot } from '../../src/domain/run-snapshot.js';
import { createLearningCompleteScreen } from '../../src/ui/screens/learning-complete.js';

const HERO = { id: 'heroine', mod: { hp: 10, shield: 0, gold: 5, hint: 1, noise: 0, combo: 1, regen: 2, leech: 0 } };
const W = (w, z, d = 1) => ({ u: 1, d, w, z });

/* 极小 DOM 桩：.screen 切换必须真的生效（toast()/show() 依赖它）。 */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.className = ''; this._text = ''; this.dataset = {};
    this.style = {}; this.hidden = false; this.onclick = null; this.title = ''; this._id = '';
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  get classList() {
    const self = this;
    return {
      add(c) { if (!self.className.split(' ').includes(c)) self.className = (self.className + ' ' + c).trim(); },
      remove(c) { self.className = self.className.split(' ').filter(x => x && x !== c).join(' '); },
      contains(c) { return self.className.split(' ').includes(c); },
    };
  }
}
const SCREENS = ['s-title', 's-map', 's-fight', 's-pause', 's-learning-complete', 's-pick'];
const LC_IDS = ['lcTitle', 'lcText', 'lcCount', 'lcMon', 'lcBtnHome', 'lcBtnQuit'];
// UI 模块通过全局 document 取元素：这里装一个最小全局桩（不是 game logic 的 mock）。
function withDom(dom, fn) {
  const prev = globalThis.document;
  globalThis.document = { getElementById: id => dom.el(id) };
  try { return fn(); } finally { globalThis.document = prev; }
}
function makeDom() {
  const els = new Map();
  for (const id of SCREENS) { const e = new El('div'); e._id = id; e.className = 'screen'; els.set(id, e); }
  for (const id of LC_IDS) els.set(id, new El('div'));
  els.get('lcBtnHome').tagName = 'BUTTON';
  els.get('lcBtnQuit').tagName = 'BUTTON';
  els.set('continueRow', new El('div'));
  return { els, el: id => els.get(id) || null, document: null };
}

/* progress 控制器的最小接线：只关心相位、快照、界面切换。
 * store 走真实 codec（编码 → JSON 往返 → 解码），不是把对象直接传回去 ——
 * 否则「快照能存下这个相位」这条断言根本不会被执行到。 */
function harness({ saved = null, live = true } = {}) {
  const dom = makeDom();
  const DB = { runs: 1, wins: 0, mastered: [], best: 0, custom: [], rewards: [] };
  // live=false 模拟**真正的刷新**：内存里没有这一局，只能从存档恢复。
  // （live=true 是同一个页面里暂停中的那一局，continueRun 会走 held 那条路。）
  let G = live ? createRun(1, HERO, [W('cat', '猫')]) : null;
  let B = makeBattle(G || createRun(1, HERO, [W('cat', '猫')]));
  let phase = PHASE.MAP;
  let raw = saved ? JSON.parse(JSON.stringify(saved)) : null;
  const shown = [];
  const state = { get G() { return G; }, get B() { return B; }, get DB() { return DB; } };
  const store = {
    commit: (db, env) => {
      if (!env) { raw = null; return { ok: true }; }
      const check = decodeSnapshot(JSON.parse(JSON.stringify(env)));
      if (!check.ok) return { ok: false, reason: 'invalid' };   // 存一份解不开的快照是 no-op
      raw = JSON.parse(JSON.stringify(env));
      return { ok: true };
    },
    peek: () => decodeSnapshot(raw),
    clear: () => { raw = null; return { ok: true }; },
    rawDB: () => raw ? { activeRun: raw } : {},
  };
  const lifecycle = { pause() {}, resume() {}, resetRun() {}, resetBattle() {},
    scheduleRun: () => 0, scheduleBattle: () => 0 };
  const ctrl = createProgressController({
    state,
    api: {
      getRun: () => G, getBattle: () => B, getDB: () => DB,
      getPhase: () => phase, setPhase: p => { phase = p; },
      getOutcome: () => false, getEncounter: () => null, setEncounter: () => {},
      // 恢复 = 换成快照里那一局（真刷新就是这样），不是一个空壳。
      setRun: r => { G = r; },
      setBattle: b => { B = b; },
      show: id => { shown.push(id); for (const s of SCREENS) dom.el(s).classList.remove('on'); dom.el(id).classList.add('on'); },
      screen: () => SCREENS.find(s => dom.el(s).classList.contains('on')) || null,
      toast: () => {}, renderMap: () => {}, renderFight: () => {}, renderTitle: () => {},
      restoreScreen: () => {}, mutate: fn => fn(), lifecycle,
      showLearningComplete: () => { shown.push('s-learning-complete'); },
      settleRun: () => {}, TTS: { stop() {} }, audio: {},
      confirm: () => true, newRun: () => true, clearRun: () => { phase = PHASE.MAP; },
    },
    store,
  });
  return { ctrl, get G() { return G; }, B, DB, dom, live, phase: () => phase, setPhase: p => { phase = p; }, shown, lifecycle,
    rawSaved: () => (raw ? JSON.parse(JSON.stringify(raw)) : null) };
}

// 一个真实形状的未打完战斗（enHp>0、over=false）
function makeBattle(G) {
  return {
    word: G.pool[0], letters: 'cat'.split(''), used: [false, false, false], bad: [false, false, false],
    myHp: 50, enHp: 37, enMax: 100, shield: 4, input: [], sel: 0,
    hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0, dmgBonus: 0,
    firstWrong: true, lethUsed: 0, wordsDone: 3, over: false, won: false,
    mistaken: [], wordStreak: 3, rageLeft: 0, freezeWord: false, chainNext: false,
    goldMult: 1, usedThisFight: {}, boss: true, elite: false,
    foe: { n: 'boss', ic: '👑', tint: '#fff' }, node: G.rows[0][0], finished: false, rewardTaken: false,
  };
}

/* ---------------- 1. 相位常量存在且可被编解码 ---------------- */
test('PHASE.LEARNING_COMPLETE is a distinct, round-trippable phase', async () => {
  const codec = await import('../../src/domain/run-snapshot.js');
  assert.equal(PHASE.LEARNING_COMPLETE, 'learning-complete');
  assert.notEqual(PHASE.LEARNING_COMPLETE, PHASE.BATTLE);
  assert.notEqual(PHASE.LEARNING_COMPLETE, PHASE.ENDING);
  // 存档原样带着这个相位（暂停/刷新往返要靠它）
  const G = createRun(1, HERO, [W('cat', '猫')]);
  G.done.add('cat');
  // 直接用 codec 验证该相位是合法形状：**必须**带真实未打完的战斗
  // （enHp>0、over=false），因为「怪物还剩多少血」是检查点屏必须如实说出的事实。
  const node = G.rows[0][0];
  const battle = {
    word: G.pool[0], letters: 'cat'.split(''), used: [false, false, false], bad: [false, false, false],
    myHp: 50, enHp: 37, enMax: 100, shield: 4, input: [], sel: 0,
    hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0, dmgBonus: 0,
    firstWrong: true, lethUsed: 0, wordsDone: 3, over: false, won: false,
    mistaken: [], wordStreak: 3, rageLeft: 0, freezeWord: false, chainNext: false,
    goldMult: 1, usedThisFight: {}, boss: true, elite: false,
    foe: { n: 'boss', ic: '👑', tint: '#fff' }, node, finished: false, rewardTaken: false,
  };
  const env = codec.encodeSnapshot({ phase: PHASE.LEARNING_COMPLETE, run: G, battle, encounter: null }, { now: 1 });
  assert.equal(env.phase, 'learning-complete');
  assert.ok(env.battle, '必须带上真实战斗状态');
  assert.equal(env.battle.enHp, 37, '怪物血量原样保存');
  const dec = codec.decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(dec.ok, true, 'learning-complete 快照必须能解回来');
  assert.equal(dec.value.phase, 'learning-complete');
  assert.equal(dec.value.battle.enHp, 37, '血量往返不变');
  assert.equal(dec.value.battle.myHp, 50, '玩家血量往返不变');
  assert.equal(dec.value.battle.shield, 4, '护盾往返不变');
  assert.equal(isPoolComplete(dec.value.run), true, '恢复后仍能推出词汇已完成');
  // 缺少 battle 的形状必须被拒（否则恢复会丢掉「还剩多少血」这个事实）
  const noBattle = { ...JSON.parse(JSON.stringify(env)), battle: null };
  assert.equal(codec.decodeSnapshot(noBattle).ok, false, '不带 battle 的 learning-complete 是非法存档');
  // 反过来，非词汇完成相位不许带 encounter
  const badShape = { ...JSON.parse(JSON.stringify(env)), phase: PHASE.BATTLE, encounter: { kind: 'rest', options: [] } };
  assert.equal(codec.decodeSnapshot(badShape).ok, false, '相位与内容必须自洽');
});

/* ---------------- 2. progress 能重建这个检查点 ---------------- */
test('progress checkpoints and rebuilds learning-complete without re-issuing rewards or words', () => {
  const h = harness();
  h.G.done.add('cat');
  h.G.kills = 2; h.G.gold = 77; h.G.ghostUsed = true; h.G.countedStart = true;
  h.setPhase(PHASE.LEARNING_COMPLETE);
  const before = { kills: h.G.kills, gold: h.G.gold, wins: h.DB.wins, mastered: h.DB.mastered.length };

  const paused = h.ctrl.pause({ fromReload: false });
  assert.equal(paused.saved, true, '检查点必须真的存得下（走真实 codec 自检）');

  // 模拟刷新：存档里就是这一份 learning-complete 快照
  const env = h.rawSaved();
  assert.equal(env.phase, PHASE.LEARNING_COMPLETE, '检查点必须能被快照带走');
  assert.equal(env.battle.enHp, 37, '怪物血量跟着存档走');
  assert.deepEqual(env.run.done, ['cat'], 'done 原样落盘成数组');
  assert.equal(env.run.result, undefined, '未结束的本局不写 result');
  assert.equal(env.encounter, null, '不带事件屏');
  const decoded = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(decoded.ok, true, '快照必须能解回来');
  assert.equal(decoded.value.phase, PHASE.LEARNING_COMPLETE);

  const h2 = harness({ saved: JSON.parse(JSON.stringify(env)), live: false });
  const out = h2.ctrl.continueRun();
  assert.equal(out.ok, true, '必须能继续');
  assert.equal(h2.phase(), PHASE.LEARNING_COMPLETE, '恢复后回到 learning-complete 而不是地图/战斗');
  assert.ok(h2.shown.includes('s-learning-complete'), '必须显示完成检查点屏');
  assert.equal(h2.G.kills, before.kills, 'kills 不许变');
  assert.equal(h2.G.gold, before.gold, 'gold 不许变');
  assert.equal(h2.DB.wins, before.wins, 'wins 不许变（这不是通关）');
  assert.equal(h2.DB.mastered.length, before.mastered, '掌握记录不重复记');
  assert.equal(h2.G.ghostUsed, true, '影分身额度不重置');
  assert.equal(h2.G.countedStart, true, '计次标记不重置');
  assert.equal(h2.B.enHp, 37, '怪物血量往返不变');
  assert.equal(isPoolComplete(h2.G), true, '恢复后不得抽出重复词');
  assert.equal(h2.G.result, undefined, '未结束的本局不许被当成已结算');
});

test('an unfinished run is never reported as learning-complete', () => {
  const h = harness();
  h.ctrl.checkpoint();
  const env = h.rawSaved();
  assert.equal(env.phase, PHASE.MAP);
  assert.notEqual(env.phase, PHASE.LEARNING_COMPLETE);
  assert.equal(isPoolComplete(h.G), false);
});

test('a learning-complete snapshot whose run is not actually finished is refused on restore', () => {
  // 存档是外部输入：把 phase 改成 learning-complete 但 done 是空的，必须被拒，
  // 否则玩家会凭空看到一个「词汇已全部完成」的空检查点。
  const h = harness();
  h.setPhase(PHASE.LEARNING_COMPLETE);
  h.ctrl.checkpoint();
  const env = h.rawSaved();
  assert.equal(env.phase, PHASE.LEARNING_COMPLETE, '存档原文确实带着这个相位');
  assert.equal(isPoolComplete(decodeSnapshot(JSON.parse(JSON.stringify(env))).value.run), false, '词还没答完');
  // progress 恢复时若 run 其实没答完，必须回到真实相位而不是谎称完成
  const h2 = harness({ saved: env, live: false });
  h2.ctrl.continueRun();
  assert.notEqual(h2.phase(), PHASE.LEARNING_COMPLETE, '没答完不许显示完成检查点');
  assert.ok(h2.shown.includes('s-map') || h2.shown.includes('s-fight'),
    '必须回到地图或战斗：' + JSON.stringify(h2.shown));
});

/* ---------------- 3. UI：只给两个诚实的出口 ---------------- */
test('learning-complete screen says the unit is finished, not that the boss was beaten', () => {
  const dom = makeDom();
  const G = createRun(1, HERO, [W('cat', '猫'), W('dog', '狗'), W('banana', '香蕉', 2)]);
  G.done.add('cat'); G.done.add('dog'); G.done.add('banana');
  const B = { enHp: 37, enMax: 100, boss: true, myHp: 55, shield: 4 };
  let home = 0, quit = 0;
  const screen = createLearningCompleteScreen({
    getRun: () => G, getBattle: () => B, onHome: () => { home++; }, onQuit: () => { quit++; },
  });
  withDom(dom, () => screen.render());
  const text = dom.el('lcText').textContent + dom.el('lcTitle').textContent;
  assert.match(dom.el('lcTitle').textContent, /全部完成|已完成/);
  assert.match(text, /本单元|词汇/);
  // 文案红线：绝不许**肯定式**地承诺通关 / 解锁 / 击败。
  // 「词汇完成不等于击败首领」是否定句，所以断言前先剥掉否定子句，
  // 剩下的部分里不许再出现任何通关/击败/解锁字样。
  const claim = text.replace(/词汇完成不等于击败首领/g, '');
  assert.ok(!/通关|击败|战胜|胜利|解锁/.test(claim), '绝不许承诺通关或解锁：' + text);
  assert.match(text, /不等于击败首领/, '必须明说词汇完成不等于击败首领');
  // 开发说明不进产品文案：这一屏只讲玩家现在能做什么。
  assert.doesNotMatch(text, /之后的功能|下一单元/, '不许出现面向开发者的功能说明：' + text);
  // 两个出口都要说清后果
  assert.match(dom.el('lcText').textContent, /保存进度返回主页/);
  assert.match(dom.el('lcText').textContent, /结束本轮学习/);
  // 「结束本轮学习」实际是 abandon（不结算、不算战败），tooltip 必须如实说
  assert.match(dom.el('lcBtnQuit').title, /结束/);
  assert.match(dom.el('lcBtnQuit').title, /保留|已掌握/, 'tooltip 必须说明掌握记录会保留：' + dom.el('lcBtnQuit').title);
  assert.doesNotMatch(dom.el('lcBtnQuit').title, /结算/, 'abandon 不结算，tooltip 不许说结算');
  // 计数如实反映真实状态
  assert.match(dom.el('lcCount').textContent, /3\s*\/\s*3/);
  // 怪物还活着这件事必须说出来，血量与真实值一致
  assert.match(dom.el('lcMon').textContent, /37/);
  assert.match(dom.el('lcMon').textContent, /100/);
  assert.match(dom.el('lcMon').textContent, /还没有被打倒/);
  assert.doesNotMatch(dom.el('lcMon').textContent, /NaN|undefined/);
  // 按钮文案
  assert.equal(dom.el('lcBtnHome').textContent, '保存并返回主页');
  assert.equal(dom.el('lcBtnQuit').textContent, '结束本轮学习');
  dom.el('lcBtnHome').onclick();
  dom.el('lcBtnQuit').onclick();
  assert.equal(home, 1);
  assert.equal(quit, 1);
});

test('learning-complete screen does not claim a dead monster is still alive', () => {
  // 领奖后推进也会到达这个检查点，那时 enHp<=0。反过来说「还没被打倒」同样是谎话。
  const dom = makeDom();
  const G = createRun(1, HERO, [W('cat', '猫')]);
  G.done.add('cat');
  const B = { enHp: 0, enMax: 100, boss: false, over: true, won: true };
  const screen = createLearningCompleteScreen({ getRun: () => G, getBattle: () => B, onHome: () => {}, onQuit: () => {} });
  withDom(dom, () => screen.render());
  assert.doesNotMatch(dom.el('lcMon').textContent, /还没有被打倒/, '打死的怪不许说还活着');
  assert.match(dom.el('lcMon').textContent, /已经打完/);
  assert.doesNotMatch(dom.el('lcMon').textContent, /NaN|undefined/);
});

test('learning-complete screen survives a missing battle and a zero enemy pool', () => {
  const dom = makeDom();
  const G = createRun(1, HERO, [W('cat', '猫')]);
  G.done.add('cat');
  const screen = createLearningCompleteScreen({
    getRun: () => G, getBattle: () => null, onHome: () => {}, onQuit: () => {},
  });
  withDom(dom, () => screen.render());
  assert.match(dom.el('lcTitle').textContent, /全部完成|已完成/);
  // 没有战斗时也不许编造怪物血量
  assert.doesNotMatch(dom.el('lcMon').textContent, /NaN|undefined/);
});
