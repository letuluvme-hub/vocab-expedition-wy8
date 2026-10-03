/* 任务 7 的 UI 层：锁住的单元、词汇完成后的「继续下一单元」、
 * 以及 BOSS 先打完但本单元还有词时的「继续本单元词汇」。
 *
 * 红线（沿用 learning-complete 的诚实口径）：
 *  - 解锁只由「本单元全部目标词完整拼对」驱动，绝不由 BOSS 击杀驱动。
 *  - 最后单元显示「本册词汇已完成」，绝不冒充「击败最终 BOSS」。
 *  - 复习（oAgain）永远是复习，不许被拿来当「继续」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { createRun } from '../../src/domain/run.js';
import { unlockProgress } from '../../src/domain/campaign.js';
import { createTitleScreen } from '../../src/ui/screens/title.js';
import { createLearningCompleteScreen } from '../../src/ui/screens/learning-complete.js';
import { renderOver } from '../../src/ui/screens/over.js';

const HERO = { id: 'ranger', mod: { hp: 0, shield: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } };
const wordsFor = u => (u === 0 ? [] : WORDS.filter(w => w.u === u));
const NOS = [1, 2, 3, 4, 5, 6, 0];
const mkDb = (db = {}) => Object.assign({ runs: 0, wins: 0, dictationMastered: [], best: 0, custom: [], rewards: [] }, db);
const view = db => unlockProgress({ units: NOS, wordsFor, dictationMastered: db.dictationMastered, unitProgress: db.unitProgress });

/* ---------------- 最小 DOM 桩（不是 game logic 的 mock） ---------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.className = ''; this._text = ''; this.dataset = {};
    this.style = {}; this.hidden = false; this.onclick = null; this.title = ''; this._id = '';
    this.disabled = false; this.attrs = {};
  }
  // 真实 DOM 的 textContent 会包含后代文本：这里没有真正的解析器，
  // 所以子节点优先、其次直接写入的文本、最后剥掉 innerHTML 的标签。
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('');
    if (this._text) return this._text;
    return String(this._html || '').replace(/<[^>]*>/g, '');
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html || ''; }
  // 写空串会清掉子节点（box.innerHTML='' 的真实语义）；写非空串不动已 append 的子节点。
  set innerHTML(v) { this._html = String(v); if (v === '') this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  get classList() {
    const self = this;
    return {
      add(c) { if (!self.className.split(' ').includes(c)) self.className = (self.className + ' ' + c).trim(); },
      remove(c) { self.className = self.className.split(' ').filter(x => x && x !== c).join(' '); },
      contains(c) { return self.className.split(' ').includes(c); },
    };
  }
}
function withDom(els, fn) {
  const prev = globalThis.document;
  globalThis.document = {
    getElementById: id => els.get(id) || null,
    createElement: tag => new El(tag),
  };
  try { return fn(); } finally { globalThis.document = prev; }
}
function elMap(ids) { const m = new Map(); for (const id of ids) m.set(id, new El('div')); return m; }

const TITLE_IDS = ['units', 'heroes', 'heroDesc', 'sRun', 'sWin', 'sMaster', 'sFloor', 'rewardSummary', 'rewardCards'];
const LC_IDS = ['lcTitle', 'lcText', 'lcCount', 'lcMon', 'lcNext', 'lcBtnNext', 'lcBtnHome', 'lcBtnQuit'];
const OVER_IDS = ['oReward', 'oAgain', 'oNext', 'oIcon', 'oTitle', 'oText', 'oFloor', 'oKill', 'oAcc', 'oRelics'];

function renderTitleUnits(db, allWordsFn) {
  const els = elMap(TITLE_IDS);
  const picks = [];
  const screen = createTitleScreen({
    getDB: () => db, getUnit: () => 1, allWords: allWordsFn,
    getCampaign: () => view(db), onHero: () => {}, onUnit: n => picks.push(n),
  });
  const run0 = () => withDom(els, () => screen.renderTitle());
  run0();
  return { els, picks, buttons: els.get('units').children, rerender: run0 };
}
function renderLc({ db, run, battle, onNext }) {
  const els = elMap(LC_IDS);
  const screen = createLearningCompleteScreen({
    getRun: () => run, getBattle: () => battle, db, getCampaign: () => view(db),
    onHome: () => {}, onQuit: () => {}, onNext: onNext || (() => {}),
  });
  withDom(els, () => screen.render());
  return els;
}
let overEls = null;
function renderOverInto(opts) {
  overEls = elMap(OVER_IDS);
  overEls.get('oAgain').tagName = 'BUTTON';
  withDom(overEls, () => renderOver(Object.assign({ show: () => {}, onTitle: () => {} }, opts)));
  return overEls;
}
const wonRun = (unit, db) => {
  const G = createRun(unit, HERO, wordsFor(unit));
  G.reward = { id: 'WR-1', unit, heroId: 'ranger', accuracy: 88, kills: 9, floor: 9, earnedAt: 'now' };
  G.maxFloor = 9;
  return G;
};

/* ---------------- 标题页：锁定 ---------------- */
test('locked units are explained and inert; unit 1 and the custom list stay playable', () => {
  const db = mkDb();
  const { buttons, picks, els } = renderTitleUnits(db, wordsFor);
  assert.equal(buttons.length, 7);
  const locked = buttons.filter(b => b.className.split(' ').includes('locked'));
  assert.equal(locked.length, 5, 'Unit 2..6 全部锁定');
  for (const b of locked) {
    assert.equal(b.onclick, null, '锁住的单元不许挂点击回调');
    assert.equal(b.disabled, true);
    const say = b.textContent + ' | ' + b.title;
    assert.match(say, /完成 Unit \d 全部词汇后解锁/, '必须说清要完成哪个单元：' + say);
    assert.match(b.title, /Unit \d/, 'title 里也如实写明单元号：' + b.title);
    assert.match(say, /解锁/, '必须说清这是解锁状态：' + say);
  }
  for (const b of locked) if (b.onclick) b.onclick();
  assert.deepEqual(picks, [], '锁住的单元点不出任何动作');
  for (const b of buttons.filter(x => !x.className.split(' ').includes('locked'))) {
    withDom(els, () => b.onclick());   // onUnit 会重绘标题页
  }
  assert.deepEqual(picks.sort(), [0, 1], '可玩的两个仍然可用');
});

test('every unit button carries data-unit so locators never depend on the label text', () => {
  const db = mkDb();
  const { buttons } = renderTitleUnits(db, wordsFor);
  assert.deepEqual(buttons.map(b => b.getAttribute('data-unit')), ['1', '2', '3', '4', '5', '6', '0']);
  // 单元名与编号照常可见：不再为了「躲文本定位」把编号从说明里拿掉。
  assert.match(String(buttons[1].innerHTML), /<b>Unit 2 数字生活<\/b>/);
  assert.match(String(buttons[1].innerHTML), /完成 Unit 1 全部词汇后解锁/);
});

test('stale historical completion cannot contradict current formal evidence or unlock the next unit', () => {
  const all = WORDS.filter(w => w.u === 1).map(w => w.w);
  const db = mkDb({ dictationMastered: all.slice(0, -1), unitProgress: { 1: { complete: true, completedAt: 'now' } } });
  const { buttons } = renderTitleUnits(db, wordsFor);
  const u1 = buttons.find(b => b.getAttribute('data-unit') === '1');
  assert.match(u1.textContent, /44\/45/);
  assert.doesNotMatch(u1.textContent, /已完成过|已全部完成/);
  const u2 = buttons.find(b => b.getAttribute('data-unit') === '2');
  assert.equal(u2.disabled, true);
});

test('completing unit 1 makes unit 2 playable and shows real progress', () => {
  const db = mkDb({ dictationMastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const { buttons } = renderTitleUnits(db, wordsFor);
  const u2 = buttons.filter(b => b.textContent.includes('Unit 2'))[0];
  assert.ok(!u2.className.split(' ').includes('locked'), 'Unit 2 已解锁');
  assert.equal(u2.disabled, false);
  assert.equal(typeof u2.onclick, 'function');
  const u1 = buttons.filter(b => b.textContent.includes('Unit 1'))[0];
  assert.match(u1.textContent, /45\s*\/\s*45/, '已完成量如实显示');
  assert.doesNotMatch(u1.textContent, /本册|全部解锁|通关/, '单元完成不许暗示全册掌握');
});

test('a legacy save with only partial mastery keeps the next unit locked', () => {
  const db = mkDb({ dictationMastered: ['water', 'river'], wins: 30, best: 9 });
  const { buttons } = renderTitleUnits(db, wordsFor);
  const u2 = buttons.filter(b => b.textContent.includes('Unit 2'))[0];
  assert.ok(u2.className.split(' ').includes('locked'));
});

/* ---------------- 词汇完成检查点：继续下一单元 ---------------- */
test('learning-complete offers the next unit when this unit is fully complete', () => {
  const db = mkDb({ dictationMastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const G = createRun(1, HERO, wordsFor(1));
  G.done = new Set(WORDS.filter(w => w.u === 1).map(w => w.w));
  let next = 0;
  const els = renderLc({ db, run: G, battle: { enHp: 40, enMax: 100, boss: true }, onNext: () => { next++; } });
  const btn = els.get('lcBtnNext');
  assert.equal(btn.hidden, false, '本单元全部完成 → 可以继续下一单元');
  assert.match(btn.textContent, /Unit 2/);
  const say = els.get('lcNext').textContent;
  assert.match(say, /45\s*\/\s*45/, '必须显示已完成量：' + say);
  assert.match(say, /已解锁/);
  assert.match(els.get('lcText').textContent, /不等于击败首领/, '既有诚实口径不许丢');
  btn.onclick();
  assert.equal(next, 1);
});

test('learning-complete hides the next-unit action while words remain', () => {
  const db = mkDb();
  const G = createRun(1, HERO, wordsFor(1));
  G.done = new Set(WORDS.filter(w => w.u === 1).slice(0, 1).map(w => w.w));
  let next = 0;
  const els = renderLc({ db, run: G, battle: null, onNext: () => { next++; } });
  const btn = els.get('lcBtnNext');
  assert.equal(btn.hidden, true, '还有词没学完就不许解锁下一单元');
  assert.equal(btn.onclick, null, '隐藏的按钮不许留回调');
  const say = els.get('lcNext').textContent;
  assert.match(say, /1\s*\/\s*45/, '已完成量：' + say);
  assert.match(say, /44/, '剩余量：' + say);
  assert.equal(next, 0);
});

test('the last unit reports the book vocabulary as finished without claiming a boss kill', () => {
  const db = mkDb({ dictationMastered: WORDS.filter(w => w.u >= 1).map(w => w.w) });
  const G = createRun(6, HERO, wordsFor(6));
  G.done = new Set(WORDS.filter(w => w.u === 6).map(w => w.w));
  const els = renderLc({ db, run: G, battle: { enHp: 30, enMax: 90, boss: true } });
  assert.equal(els.get('lcBtnNext').hidden, true, '最后一个单元没有「下一单元」');
  const say = els.get('lcNext').textContent;
  assert.match(say, /本册词汇已完成/);
  assert.doesNotMatch(say, /击败|战胜|通关|胜利|BOSS/, '词汇完成绝不能冒充击败最终 BOSS：' + say);
});

/* ---------------- BOSS 结算屏 ---------------- */
test('boss-first with words remaining keeps a continue-this-unit entry', () => {
  const db = mkDb({ dictationMastered: ['water'] });
  const G = wonRun(1, db);
  G.done = new Set(['water']);
  const acts = [];
  const els = renderOverInto({ run: G, db, win: true, campaign: view(db),
    onNextUnit: () => acts.push('next-unit'), onContinueUnit: () => acts.push('continue-unit'),
    onAgain: () => acts.push('again'), onHome: () => acts.push('home') });
  const next = els.get('oNext');
  assert.equal(next.hidden, false, '不能卡住：必须有一个继续入口');
  assert.match(next.textContent, /继续本单元词汇/);
  assert.doesNotMatch(next.textContent, /Unit 2/, '本单元没完成，绝不许预告下一单元');
  next.onclick();
  assert.deepEqual(acts, ['continue-unit']);
  els.get('oAgain').onclick();
  assert.deepEqual(acts, ['continue-unit', 'again'], '复习仍是复习，不许拿它当继续');
});

test('boss screen switches to the next unit only when this unit vocabulary is complete', () => {
  const db = mkDb({ dictationMastered: WORDS.filter(w => w.u === 1).map(w => w.w) });
  const G = wonRun(1, db);
  G.done = new Set(WORDS.filter(w => w.u === 1).map(w => w.w));
  const acts = [];
  const els = renderOverInto({ run: G, db, win: true, campaign: view(db),
    onNextUnit: () => acts.push('next-unit'), onContinueUnit: () => acts.push('continue-unit'),
    onAgain: () => acts.push('again'), onHome: () => acts.push('home') });
  const next = els.get('oNext');
  assert.match(next.textContent, /继续 Unit 2/);
  next.onclick();
  assert.deepEqual(acts, ['next-unit']);
});

test('the final unit victory keeps no next-unit entry but explains the book is done', () => {
  const db = mkDb({ dictationMastered: WORDS.filter(w => w.u >= 1).map(w => w.w) });
  const G = wonRun(6, db);
  G.done = new Set(WORDS.filter(w => w.u === 6).map(w => w.w));
  const els = renderOverInto({ run: G, db, win: true, campaign: view(db),
    onNextUnit: () => {}, onContinueUnit: () => {}, onAgain: () => {}, onHome: () => {} });
  assert.equal(els.get('oNext').hidden, true);
  assert.match(els.get('oText').textContent, /本册词汇已完成/, '最后一单元只讲词汇，不冒充通关');
});

test('a lost run offers neither continuation', () => {
  const db = mkDb({ dictationMastered: ['water'] });
  const G = createRun(1, HERO, wordsFor(1));
  const acts = [];
  const els = renderOverInto({ run: G, db, win: false, campaign: view(db),
    onNextUnit: () => acts.push('next-unit'), onContinueUnit: () => acts.push('continue-unit'),
    onAgain: () => acts.push('again'), onHome: () => acts.push('home') });
  assert.equal(els.get('oNext').hidden, true, '战败不许有继续入口');
  els.get('oAgain').onclick();
  assert.deepEqual(acts, ['again']);
});

/* ---------------- 自定义单元：永不进入教材，但不许卡死 ---------------- */
/* 自定义词表按**真实词库**算进度（学完就是 2/2），但 progress.next(0) 返回的是
   教材里的 Unit 2 —— UI 必须自己挡住，否则玩家会从自己的词表跳进课本。 */
const CUSTOM = [{ u: 0, d: 1, w: 'cat', z: '猫' }, { u: 0, d: 1, w: 'dog', z: '狗' }];
const customView = db => unlockProgress({
  units: NOS, wordsFor: u => (u === 0 ? CUSTOM : wordsFor(u)),
  dictationMastered: db.dictationMastered, unitProgress: db.unitProgress,
});

test('the custom unit shows its real progress on the title and never offers a textbook unit', () => {
  const db = mkDb({ dictationMastered: ['cat'] });
  const els = elMap(TITLE_IDS);
  const screen = createTitleScreen({
    getDB: () => db, getUnit: () => 1, allWords: u => (u === 0 ? CUSTOM : wordsFor(u)),
    getCampaign: () => customView(db), onHero: () => {}, onUnit: () => {},
  });
  withDom(els, () => screen.renderTitle());
  const buttons = els.get('units').children;
  const custom = buttons[6];
  assert.equal(custom.getAttribute('data-unit'), '0');
  assert.match(custom.textContent, /已掌握 1\/2/, '★ 自定义单元不许伪报 0 词/未开始：' + custom.textContent);
  assert.equal(custom.disabled, false);
  // 教材单元仍然锁着：自定义学完也不解锁课本。
  assert.ok(buttons[1].className.split(' ').includes('locked'));
});

test('learning-complete on the custom unit reports progress but offers no next unit', () => {
  const db = mkDb({ dictationMastered: ['cat', 'dog'] });
  const G = createRun(0, HERO, CUSTOM);
  G.done = new Set(['cat', 'dog']);
  const els = renderLc({ db, run: G, battle: null,
    onNext: () => { throw new Error('自定义单元绝不许触发 nextUnit'); } });
  assert.equal(els.get('lcBtnNext').hidden, true, '★ 自定义单元没有「下一单元」');
  assert.equal(els.get('lcBtnNext').onclick, null);
  assert.match(els.get('lcNext').textContent, /2\s*\/\s*2/);
});

test('boss-first on the custom unit keeps a same-run continuation instead of dead-ending', () => {
  const db = mkDb({ dictationMastered: ['cat'] });
  const G = createRun(0, HERO, CUSTOM);
  G.done = new Set(['cat']);
  G.reward = { id: 'WR-c', unit: 0, heroId: 'ranger', accuracy: 70, kills: 4, floor: 9, earnedAt: 'now' };
  G.maxFloor = 9;
  const acts = [];
  const els = renderOverInto({ run: G, db, win: true, campaign: customView(db),
    onNextUnit: () => acts.push('next-unit'), onContinueUnit: () => acts.push('continue-unit'),
    onAgain: () => acts.push('again'), onHome: () => acts.push('home') });
  const next = els.get('oNext');
  assert.equal(next.hidden, false, '★ 自定义单元也绝不能把玩家卡死');
  assert.match(next.textContent, /继续本单元词汇/);
  assert.doesNotMatch(next.textContent, /Unit \d/, '绝不许预告教材单元：' + next.textContent);
  next.onclick();
  assert.deepEqual(acts, ['continue-unit']);
});