import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncounterController } from '../../src/app/encounters.js';
import { ITEMS } from '../../src/data/items.js';

class Element {
  constructor() { this.children = []; this.dataset = {}; this.style = {}; this.textContent = ''; }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html || ''; }
  appendChild(child) { this.children.push(child); }
}

function harness({ gold = 1000, hp = 20, maxhp = 70, bag = {}, relics = [] } = {}) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const G = { gold, hp, maxhp, bag: { ...bag }, relics: [...relics], shopHints: 0,
    att: 1, attOk: 1, node: { type: 'shop', done: false } };
  const B = { myHp: hp, enMax: 200, elite: false, boss: false, rewardTaken: false,
    node: G.node, maxCombo: 1, foe: { ic: '👾', n: '测试怪' } };
  const calls = { init: 0, finish: 0, toasts: [] };
  let desc;
  const ctrl = createEncounterController({ state: { G, B }, ports: {
    $, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    pick: a => a[0], shuffle: a => a.slice(), rnd: () => 1,
    has: (a, id) => a.includes(id), hasR: id => G.relics.includes(id),
    goldGain: n => (G.gold += n), applyRelicInit: () => calls.init++,
    sfx: { relic() {}, coin() {} }, toast: text => calls.toasts.push(text),
    advance() {}, endRun() {}, finishNode: () => calls.finish++, show() {},
    scheduleRun() {}, scheduleBattle() {}, makeButton: () => new Element(),
    publishEncounter: value => { desc = value; }, setPhase() {},
    relicRnd: () => .99, relicDraw: pool => pool[0],
  } });
  const button = (id, screen = 'rPicks') => $(screen).children.find(b => b.dataset.opt === id);
  const click = (id, screen) => {
    const b = button(id, screen);
    assert.ok(b, '应显示可操作卡片：' + id);
    b._at = 0; // 越过防手滑冷却，以测试业务幂等而不是计时器。
    b.onclick();
  };
  return { G, B, ctrl, $, calls, button, click, desc: () => desc };
}

const serialized = desc => JSON.parse(JSON.stringify(desc));
const oneCard = (h, kind, id, fields = {}) => ({ kind, gold: h.G.gold, node: h.G.node,
  options: [{ id, cat: 'item', ic: '🎒', t: '已展开的卡片', d: '', ...fields }] });

for (const restored of [false, true]) {
  test(`商店遗物重复点击仅购买一次${restored ? '，刷新恢复后同样拒绝' : ''}`, () => {
    const h = harness();
    h.ctrl.showShop();
    const id = h.desc().options.find(o => o.id.startsWith('shop:relic:')).id;
    h.click(id);
    const after = { gold: h.G.gold, relics: [...h.G.relics], init: h.calls.init };
    if (restored) assert.equal(h.ctrl.reopenEncounter(serialized(h.desc())), true);
    h.click(id);
    assert.equal(h.G.gold, after.gold, '已经拥有不能再次扣钱');
    assert.deepEqual(h.G.relics, after.relics, '不得添加重复遗物');
    assert.equal(h.calls.init, after.init, '重复购买不得重新初始化所有遗物');
  });

  test(`满生命不买疗伤药${restored ? '（恢复商店）' : ''}`, () => {
    const h = harness({ hp: 70 });
    h.ctrl.showShop();
    if (restored) h.ctrl.reopenEncounter(serialized(h.desc()));
    h.click('shop:potion');
    assert.equal(h.G.gold, 1000);
    assert.equal(h.G.hp, 70);
    assert.match(h.calls.toasts.at(-1), /满|无需/);
  });

  test(`提示卷轴只能累加到6次${restored ? '，恢复后不能绕过' : ''}`, () => {
    const h = harness();
    h.ctrl.showShop();
    h.click('shop:scroll');
    h.click('shop:scroll');
    assert.equal(h.G.shopHints, 6);
    assert.equal(h.G.gold, 920);
    if (restored) h.ctrl.reopenEncounter(serialized(h.desc()));
    h.click('shop:scroll');
    assert.equal(h.G.shopHints, 6);
    assert.equal(h.G.gold, 920);
    assert.match(h.calls.toasts.at(-1), /6|上限/);
  });
}

test('同图第二块磨砺石不扣钱、不回满、不增加上限',()=>{
 const h=harness();h.ctrl.showShop();h.click('shop:whet');h.G.hp=10;
 const before=[h.G.gold,h.G.maxhp,h.G.hp];h.click('shop:whet');
 assert.deepEqual([h.G.gold,h.G.maxhp,h.G.hp],before);
});

test('旧存档提示超过6次保留原数值；不能购买越过上限的半份卷轴', () => {
  for (const hints of [5, 6, 600]) {
    const h = harness();
    h.G.shopHints = hints;
    h.ctrl.reopenEncounter(oneCard(h, 'shop', 'shop:scroll'));
    h.click('shop:scroll');
    assert.equal(h.G.shopHints, hints, '拒绝购买不能改写已有额度');
    assert.equal(h.G.gold, 1000);
  }
});

test('已经持有的无价格旧遗物卡恢复后也不能重复扣款', () => {
  const h = harness({ relics: ['shield'] });
  h.ctrl.reopenEncounter(oneCard(h, 'shop', 'shop:relic:shield'));
  h.click('shop:relic:shield');
  assert.equal(h.G.gold, 1000);
  assert.deepEqual(h.G.relics, ['shield']);
  assert.equal(h.calls.init, 0);
});

test('遗物卡恢复接受卡面原价，当前稀有度价格改变不会让旧卡丢失', () => {
  const h = harness();
  const id = 'shop:relic:shield:83';
  assert.equal(h.ctrl.reopenEncounter(oneCard(h, 'shop', id, { t: '护盾符文 · 83 金币' })), true);
  h.click(id);
  assert.equal(h.G.gold, 917);
  assert.deepEqual(h.G.relics, ['shield']);
});

test('商店道具新卡的id记录价格，购买三件后库存可以超过单场使用次数', () => {
  const item = ITEMS[0];
  const h = harness({ bag: { [item.id]: item.max } });
  h.ctrl.showShop();
  const id = 'shop:item:' + item.id + ':' + item.price;
  h.click(id);
  assert.equal(h.G.bag[item.id], item.max + 3);
  assert.equal(h.G.gold, 1000 - item.price);
});

test('跨版本恢复新版道具卡仍按卡面旧价格购买三件', () => {
  const h = harness();
  const item = ITEMS[0], currentPrice = item.price;
  h.ctrl.showShop();
  const id = 'shop:item:' + item.id + ':' + currentPrice;
  const desc = serialized(h.desc());
  try {
    item.price = currentPrice + 25; // 模拟发版更新，已展开卡的价格不得跟着改。
    assert.equal(h.ctrl.reopenEncounter(desc), true);
    h.click(id);
    assert.equal(h.G.gold, 1000 - currentPrice);
    assert.equal(h.G.bag[item.id], 3);
  } finally { item.price = currentPrice; }
});

test('无价格的旧道具卡使用历史价格表，不能套用新配置价格', () => {
  const historical = { leech: 60, rage: 65, freeze: 50, chain: 55, reveal: 45, purge: 40, greed: 35, stone: 70 };
  for (const item of ITEMS) {
    const h = harness();
    const originalPrice = item.price, price = historical[item.id];
    try {
      item.price = price + 19;
      const id = 'shop:item:' + item.id;
      assert.equal(h.ctrl.reopenEncounter(oneCard(h, 'shop', id, { t: item.n + ' ×3 · ' + price + ' 金币' })), true);
      h.click(id);
      assert.equal(h.G.gold, 1000 - price, item.id + ' 的旧卡原价');
      assert.equal(h.G.bag[item.id], 3);
    } finally { item.price = originalPrice; }
  }
});

test('恢复商店购买后立即同步显示剩余金币', () => {
  const h = harness();
  h.ctrl.showShop();
  h.ctrl.reopenEncounter(serialized(h.desc()));
  h.click('shop:scroll');
  assert.match(h.$('rSub').textContent, /960/);
});

test('非法价格不能恢复为可购买卡片', () => {
  for (const id of ['shop:item:leech:-3', 'shop:item:leech:0', 'shop:item:leech:NaN',
    'shop:item:leech:1.5', 'shop:item:leech:9007199254740992', 'shop:relic:shield:-1']) {
    const h = harness();
    assert.equal(h.ctrl.reopenEncounter(oneCard(h, 'shop', id)), false, id);
    assert.equal(h.G.gold, 1000);
    assert.deepEqual(h.G.bag, {});
    assert.deepEqual(h.G.relics, []);
  }
});

for (const elite of [false, true]) {
  test(`${elite ? '精英' : '普通'}回血战利品不随敌人血量增长，并记入恢复id`, () => {
    for (const enMax of [30, 200, 40000]) {
      const h = harness();
      h.B.elite = elite; h.B.enMax = enMax;
      const amount = elite ? 18 : 12;
      const rolled = h.ctrl.rollBattleRewards(20, null);
      const heal = rolled.opts.find(o => o.cat === 'heal');
      assert.equal(heal.id, 'reward:heal:' + amount);
      assert.equal(heal.d, '回复 ' + amount + ' 点生命');
      h.ctrl.showRolledRewards(rolled);
      h.click(heal.id, 'pPicks');
      assert.equal(h.B.myHp, 20 + amount);
      assert.equal(h.G.hp, 20, '回血写入战斗生命，等待finishNode结转');
      assert.equal(h.calls.finish, 1);
    }
  });
}

test('只缺3点血时卡面如实写3点，恢复后也只领一次', () => {
  const h = harness({ hp: 67 });
  h.ctrl.rollBattleRewards(20, null);
  const desc = serialized(h.desc());
  const heal = desc.options.find(o => o.cat === 'heal');
  assert.equal(heal.id, 'reward:heal:3');
  assert.equal(heal.d, '回复 3 点生命');
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  h.click(heal.id, 'pPicks');
  h.click(heal.id, 'pPicks');
  assert.equal(h.B.myHp, 70);
  assert.equal(h.calls.finish, 1);
});

test('新版回血卡恢复保留展开时金额，不再读取敌人血量', () => {
  const h = harness();
  h.B.enMax = 40000;
  assert.equal(h.ctrl.reopenEncounter(oneCard(h, 'reward', 'reward:heal:12', { cat: 'heal', d: '回复 12 点生命' })), true);
  h.click('reward:heal:12', 'pPicks');
  assert.equal(h.B.myHp, 32);
  assert.equal(h.calls.finish, 1);
});

test('旧版尚未领取的reward:heal保留旧公式承诺', () => {
  const h = harness({ maxhp: 200 });
  h.B.enMax = 400;
  assert.equal(h.ctrl.reopenEncounter(oneCard(h, 'reward', 'reward:heal', { cat: 'heal', d: '回复 60 点生命' })), true);
  h.click('reward:heal', 'pPicks');
  assert.equal(h.B.myHp, 80);
  assert.equal(h.calls.finish, 1);
});

test('背包库存达到每场使用额度，仍能获得战利品库存', () => {
  const h = harness({ bag: Object.fromEntries(ITEMS.map(it => [it.id, it.max])) });
  const rolled = h.ctrl.rollBattleRewards(20, null);
  const items = rolled.opts.filter(o => o.cat === 'item');
  assert.equal(items.length, 2);
  h.ctrl.showRolledRewards(rolled);
  h.click(items[0].id, 'pPicks');
  const item = ITEMS.find(it => items[0].id === 'reward:item:' + it.id);
  assert.equal(h.G.bag[item.id], item.max + 1);
});

test('先知卡仍遵循原掉落概率和点金术保底，只调整解释文案', () => {
  const plain = harness({ relics: ['scholar'] });
  assert.equal(plain.ctrl.rollBattleRewards(20, null).opts.some(o => o.id === 'reward:seer'), false);
  const combo = harness({ relics: ['scholar', 'purse'] });
  const rolled = combo.ctrl.rollBattleRewards(20, null);
  const seer = rolled.opts.find(o => o.id === 'reward:seer');
  assert.ok(seer);
  combo.ctrl.showRolledRewards(rolled);
  combo.click(seer.id, 'pPicks');
  assert.equal(combo.G.nextHint, true);
  assert.equal(combo.calls.finish, 1);
});

for (const restored of [false, true]) {
  test(`商店购买后数量、限购与实际治疗即时同步（恢复=${restored}）`, () => {
    const h = harness({hp:65}); h.ctrl.showShop();
    if (restored) h.ctrl.reopenEncounter(serialized(h.desc()));
    assert.match(h.button('shop:potion').innerHTML, /回复 5 点生命/);
    h.click('shop:whet');
    assert.match(h.button('shop:whet').innerHTML, /本图还剩 0 次，远征还剩 1 次/);
    h.click('shop:whet');
    assert.match(h.button('shop:whet').innerHTML, /还剩 0 次/);
    const gold=h.G.gold; h.click('shop:whet'); assert.equal(h.G.gold,gold);
    h.click('shop:scroll');
    assert.match(h.button('shop:scroll').innerHTML, /已积累 3\/6 次/);
    h.click('shop:scroll');
    assert.match(h.button('shop:scroll').innerHTML, /已积累 6\/6 次/);
    for (const o of h.desc().options) assert.ok(h.button(o.id).innerHTML.includes(o.d));
    h.ctrl.reopenEncounter(serialized(h.desc()));
    assert.match(h.button('shop:whet').innerHTML, /还剩 0 次/);
    assert.match(h.button('shop:scroll').innerHTML, /已积累 6\/6 次/);
  });
}

for (const item of ITEMS) {
  test(`商店 ${item.id} 的三件包装、连续购买与恢复库存一致`, () => {
    const h=harness({bag:{[item.id]:item.max}});
    const id='shop:item:'+item.id+':'+item.price;
    h.ctrl.reopenEncounter(oneCard(h,'shop',id,{t:item.n+' ×3 · '+item.price+' 金币'}));
    assert.match(h.button(id).innerHTML, /每次购买 3 件/);
    assert.ok(h.button(id).innerHTML.includes('当前库存 '+item.max+' 件'));
    h.click(id); h.click(id);
    assert.equal(h.G.bag[item.id],item.max+6);
    assert.equal(h.G.gold,1000-2*item.price);
    assert.ok(h.button(id).innerHTML.includes('当前库存 '+(item.max+6)+' 件'));
    h.ctrl.reopenEncounter(serialized(h.desc()));
    assert.ok(h.button(id).innerHTML.includes('当前库存 '+(item.max+6)+' 件'));
    h.G.gold=0; h.click(id);
    assert.equal(h.G.bag[item.id],item.max+6); assert.equal(h.G.gold,0);
  });
}
