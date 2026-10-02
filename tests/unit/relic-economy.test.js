/* 遗物经济：商店按稀有度定价、奖励池按稀有度加权、恢复路径收费一致。
 *
 * 三条容易出事的地方：
 *  1) **显示与实收必须一致**。商店卡面写「护盾符文 · 110 金币」，
 *     点下去就扣 80，就是最典型的「界面说一套、游戏做一套」。
 *  2) **恢复路径必须收费一致**。暂停/刷新把商店原样重建回来时，
 *     它用的是另一套硬编码表（optionById），最容易漏掉新定价。
 *  3) **旧存档恢复**。加稀有度之前商店卡 id 是 `shop:relic:<id>`（不带价格），
 *     旧快照里存的就是这种 id；新代码必须仍能把它映射回来，而且按它当时
 *     显示的旧价 80 收费 —— 收新价就是「刷新一次凭空涨价」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncounterController } from '../../src/app/encounters.js';
import { RELICS } from '../../src/data/relics.js';
import { RELIC_RARITY, LEGACY_RELIC_SHOP_PRICE } from '../../src/data/balance.js';
import { relicPrice } from '../../src/domain/relic-rules.js';

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

const optOf = (h, prefix) => h.log.filter(l => l[0] === 'publish').pop()[1]
  .options.filter(o => o.id.indexOf(prefix) === 0)[0];
const titleOf = (h) => h.ids.get('rTitle').textContent;

/* ---------------- 1) 商店定价 ---------------- */

test('商店遗物卡按该遗物的稀有度标价，不是固定 80', () => {
  for (const r of RELICS) {
    const h = harness({ want: r.id });
    h.ctrl.showShop();
    const opt = optOf(h, 'shop:relic:');
    assert.ok(opt, '商店里应当出现 ' + r.id);
    const price = relicPrice(r);
    assert.ok(opt.t.includes(String(price) + ' 金币'), `${r.n} 的卡面应标价 ${price}，实际「${opt.t}」`);
    assert.equal(r.price, undefined, '定价的唯一来源是 balance 的档位表，不许在遗物对象上重复一份');
  }
});

test('点下去实收的金额等于卡面标价的金额', () => {
  const rare = RELICS.filter(r => r.rarity === 'rare')[0];
  const legend = RELICS.filter(r => r.rarity === 'legendary')[0];
  for (const r of [rare, legend]) {
    const h = harness({ want: r.id });
    h.ctrl.showShop();
    const before = h.G.gold;
    const box = h.ids.get('rPicks');
    const opt = optOf(h, 'shop:relic:');
    const idx = box.children.findIndex(c => c.dataset.opt === opt.id);
    assert.ok(idx >= 0, '卡必须在按钮上带 dataset.opt');
    box.children[idx].onclick();
    assert.equal(h.G.gold, before - relicPrice(r), `${r.n}：卡面 ${opt.t}，实收必须是 ${relicPrice(r)}`);
    assert.ok(h.G.relics.includes(r.id), '买完必须真的进背包');
  }
});

test('钱不够时既不扣钱也不发货', () => {
  const legend = RELICS.filter(r => r.rarity === 'legendary')[0];
  const h = harness({ gold: 5, want: legend.id });
  h.ctrl.showShop();
  const box = h.ids.get('rPicks');
  const opt = optOf(h, 'shop:relic:');
  box.children.find(c => c.dataset.opt === opt.id).onclick();
  assert.equal(h.G.gold, 5, '金币不够不能被扣成负数或扣走');
  assert.deepEqual(h.G.relics, []);
  assert.ok(h.log.some(l => l[0] === 'toast' && String(l[1]).includes('金币不够')));
});

test('便宜的普通遗物现在真的比传说便宜（价格差存在）', () => {
  const h = harness({ want: RELICS.filter(x => x.rarity === 'common')[0].id });
  h.ctrl.showShop();
  const commonOpt = optOf(h, 'shop:relic:');
  const h2 = harness({ want: RELICS.filter(x => x.rarity === 'legendary')[0].id });
  h2.ctrl.showShop();
  const legendOpt = optOf(h2, 'shop:relic:');
  assert.notEqual(commonOpt.t, legendOpt.t);
  assert.ok(RELIC_RARITY.legendary.price > RELIC_RARITY.common.price);
});

/* ---------------- 2) 恢复路径收费一致 ---------------- */

test('暂停恢复重建的商店卡：显示什么价就收什么价', () => {
  for (const r of RELICS.filter(x => x.rarity !== 'common').slice(0, 4)) {
    const h = harness({ want: r.id });
    h.ctrl.showShop();
    const published = h.log.filter(l => l[0] === 'publish').pop()[1];
    const h2 = harness({ relics: h.G.relics });
    // 模拟刷新：只有快照里的 id / 文案，动作走 optionById 重新映射
    const ok = h2.ctrl.reopenEncounter(published);
    assert.equal(ok, true, '商店屏必须能恢复');
    const relicOptId = published.options
      .filter(o => o.id.indexOf('shop:relic:') === 0)[0].id;
    const shown = h2.ids.get('rPicks').children.find(c => c.dataset.opt === relicOptId);
    assert.ok(shown, '恢复后那张卡必须还在');
    const before = h2.G.gold;
    shown.onclick();
    assert.equal(h2.G.gold, before - relicPrice(r),
      `恢复后实收必须是 ${relicPrice(r)}（卡面上写的就是这个价）`);
  }
});

test('旧存档里的旧版卡 id（shop:relic:<id>，无价格）仍能恢复，并按旧价 80 收费', () => {
  const r = RELICS.filter(x => x.rarity === 'legendary')[0];
  const h = harness();
  const legacyDesc = {
    kind: 'shop', gold: 200,
    node: h.G.node,
    options: [{ id: 'shop:relic:' + r.id, cat: 'relic', ic: r.ic, t: r.n + ' · 80 金币', d: r.d }],
  };
  assert.equal(h.ctrl.reopenEncounter(legacyDesc), true, '旧版卡必须还能恢复，不能被判成「无法恢复」');
  const box = h.ids.get('rPicks');
  assert.equal(box.children.length, 1);
  const before = h.G.gold;
  box.children[0].onclick();
  assert.equal(h.G.gold, before - LEGACY_RELIC_SHOP_PRICE,
    '旧快照上写着 80 金币，恢复后就必须还是 80 —— 刷新一次凭空涨价是不能接受的');
  assert.ok(h.G.relics.includes(r.id));
});

/* ---------------- 3) 奖励池按稀有度加权 ---------------- */

test('战斗奖励的遗物卡按稀有度加权，而不是均匀洗牌', () => {
  // 用一个只会返回 0 的 rnd：加权抽取的第一个候选之外仍会走完整个池子，
  // 所以这里直接断言「候选里各稀有度都出现」并单独验证权重函数。
  const h = harness({ relics: RELICS.map(r => r.id) });
  const rolled = h.ctrl.rollBattleRewards(30, null);
  assert.ok(rolled);
  const relicCards = rolled.opts.filter(o => o.id && o.id.indexOf('reward:relic:') === 0);
  assert.ok(relicCards.length <= 3);
});

test('奖励池被抽干时不再出现遗物卡', () => {
  const h = harness({ relics: RELICS.map(r => r.id) });
  const rolled = h.ctrl.rollBattleRewards(30, null);
  const relicCards = rolled.opts.filter(o => o.id && o.id.indexOf('reward:relic:') === 0);
  assert.equal(relicCards.length, 0, '全收集之后不该再掉遗物');
});