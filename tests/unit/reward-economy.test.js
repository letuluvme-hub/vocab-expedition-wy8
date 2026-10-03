/* 奖励经济（docs/feature-word-choice.md 第二节）。
 *
 * 旧规则：每场普通战都给 3 张遗物卡 + 回血卡。13 件遗物几场就拿完，
 * 「拿到遗物」不再是事件；满血时还摆着一张「回复 71 点生命」；
 * 「跳过」按钮实际领取第一张卡（回血）。
 * 新规则：
 *  · 普通战：受伤才给回血；道具二选一；遗物只有小概率出现，且最多 1 张。
 *  · 精英战：遗物 2 选 1（稀有度加权）+ 道具 + 受伤回血。
 *  · 首领：遗物 3 选 1 + 道具。
 *  · 「跳过」= 什么都不拿，直接前进。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncounterController } from '../../src/app/encounters.js';
import { RELICS } from '../../src/data/relics.js';
import { REWARD_ECONOMY } from '../../src/data/balance.js';

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

function harness({ relics = [], gold = 100000, want = null, rnd = () => 0 } = {}) {
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
      pick: a => a[0],
      shuffle: a => a.slice(),
      rnd: () => 0,
      has: (a, v) => a.indexOf(v) >= 0,
      hasR: id => G.relics.indexOf(id) >= 0,
      goldGain: n => { G.gold += n; return n; },
      applyRelicInit: () => log.push(['relicInit']),
      sfx: { relic() {}, coin() {} },
      toast: m => log.push(['toast', m]),
      advance: () => log.push(['advance']),
      endRun: () => log.push(['endRun']),
      finishNode: () => log.push(['finishNode']),
      show: id => log.push(['show', id]),
      scheduleRun: () => {}, scheduleBattle: () => {},
      publishEncounter: d => log.push(['publish', d]),
      setPhase: () => {},
      canAct: () => true,
      makeButton: tag => new El(tag || 'button'),
      // 加权之后「这局一定出某一件」没法断言，所以留一个指名道姓的抽取口。
      relicRnd: rnd,
      relicDraw: want ? pool => (pool.filter(x => x.id === want)[0] || pool[0]) : null,
    },
  });
  return { ctrl, G, B, ids, log, find: (p) => log.find(p) };
}


const cats = rolled => rolled.opts.map(o => o.cat);
const count = (rolled, cat) => cats(rolled).filter(c => c === cat).length;

test('普通战：满血不给回血卡，受伤才给', () => {
  const full = harness();
  full.B.myHp = full.G.maxhp;
  assert.equal(count(full.ctrl.rollBattleRewards(20, null), 'heal'), 0, '满血时回血卡毫无意义');
  const hurt = harness();
  hurt.B.myHp = 30;
  assert.equal(count(hurt.ctrl.rollBattleRewards(20, null), 'heal'), 1);
});

test('普通战：遗物最多 1 张，并且只在小概率命中时出现', () => {
  const lucky = harness({ rnd: () => 0 });
  assert.equal(count(lucky.ctrl.rollBattleRewards(20, null), 'relic'), 1);
  const plain = harness({ rnd: () => 0.99 });
  assert.equal(count(plain.ctrl.rollBattleRewards(20, null), 'relic'), 0);
  assert.ok(REWARD_ECONOMY.normalRelicChance > 0 && REWARD_ECONOMY.normalRelicChance <= 0.25);
});

test('普通战：道具给二选一（不同种）', () => {
  const h = harness({ rnd: () => 0.99 });
  const items = h.ctrl.rollBattleRewards(20, null).opts.filter(o => o.cat === 'item');
  assert.equal(items.length, REWARD_ECONOMY.normalItemChoices);
  assert.equal(new Set(items.map(o => o.id)).size, items.length);
});

test('精英战：遗物 2 选 1；首领：遗物 3 选 1', () => {
  const elite = harness({ rnd: () => 0.99 });
  elite.B.elite = true;
  assert.equal(count(elite.ctrl.rollBattleRewards(60, null), 'relic'), REWARD_ECONOMY.eliteRelics);
  const boss = harness({ rnd: () => 0.99 });
  boss.B.boss = true;
  const rolled = boss.ctrl.rollBattleRewards(200, null);
  assert.equal(count(rolled, 'relic'), REWARD_ECONOMY.bossRelics);
  assert.equal(count(rolled, 'heal'), 0, '首领战后不给回血卡（与旧规则一致）');
});

test('遗物收集满之后不再出现遗物卡', () => {
  const h = harness({ relics: RELICS.map(r => r.id), rnd: () => 0 });
  h.B.elite = true;
  assert.equal(count(h.ctrl.rollBattleRewards(60, null), 'relic'), 0);
});

test('「跳过」什么都不拿，只推进', () => {
  const h = harness({ rnd: () => 0 });
  h.B.myHp = 30;
  const rolled = h.ctrl.rollBattleRewards(20, null);
  assert.ok(rolled.opts.length >= 2);
  h.ctrl.showRolledRewards(rolled);
  const before = JSON.stringify([h.B.myHp, h.G.relics, h.G.bag, h.G.nextHint]);
  h.ids.get('pSkip').onclick();
  assert.equal(JSON.stringify([h.B.myHp, h.G.relics, h.G.bag, h.G.nextHint]), before, '跳过不得领取任何一张卡');
  assert.equal(h.log.filter(l => l[0] === 'finishNode').length, 1, '跳过照常推进一次');
  assert.equal(h.B.rewardTaken, true, '跳过之后奖励同样作废');
  h.ids.get('pSkip').onclick();
  assert.equal(h.log.filter(l => l[0] === 'finishNode').length, 1, '再点跳过不得重复推进');
});
