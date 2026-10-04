/* 长远征的后期内容（2026-10）：
 *   1) 第几张地图 → 怪物血量 / 伤害 / 蓄力节奏递增（第 1 张图逐字等于旧行为）
 *   2) 商店按第几张地图涨价，新增高价商品（提示宝典 1000 / 提示圣典 2000 等）
 *   3) 八上 Unit 6 学完顺延八下 Unit 1；全部学完进入全册随机循环
 *   4) 跨册 / 循环之后的 run 能原样存档、恢复 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncounterController } from '../../src/app/encounters.js';
import { HEROES } from '../../src/data/heroes.js';
import { WORDS } from '../../src/data/words.js';
import { wordsFor } from '../../src/data/books.js';
import { FOE_ATTACK, PREMIUM_SHOP, PERMANENT_HINT_MAX, SHOP_BASE_PRICES } from '../../src/data/balance.js';
import { ITEMS } from '../../src/data/items.js';
import { RELICS } from '../../src/data/relics.js';
import { relicPrice } from '../../src/domain/relic-rules.js';
import { scaledPrice, shopPriceScale } from '../../src/domain/shop-pricing.js';
import { deriveRoundDifficulty, scaleEnemyHealth, scaleFoeAttackProfile, segmentMultipliers,
  MIN_IDLE_MS, MIN_TELEGRAPH_MS, MIN_RECOVER_MS } from '../../src/domain/round-difficulty.js';
import { createRun, endRunProgress, syncRoundCard } from '../../src/domain/run.js';
import { crossBookTarget, applyBookTransition, roundScopeUnits } from '../../src/domain/campaign.js';
import { pendingWords } from '../../src/domain/word-selection.js';
import { learningKey } from '../../src/domain/learning-identity.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';

/* ---------------- 1) 地图递增难度 ---------------- */

test('第 1 张图（或没有图数）逐字等于旧行为', () => {
  const d = deriveRoundDifficulty({ roundNumber: 3 });
  for (const seg of [undefined, null, 0, 1, -4, 2.5, '9']) {
    assert.deepEqual(scaleFoeAttackProfile(FOE_ATTACK.normal, d, seg), scaleFoeAttackProfile(FOE_ATTACK.normal, d));
    assert.equal(scaleEnemyHealth(500, d, seg), scaleEnemyHealth(500, d));
  }
});

test('越往后的地图，怪物血更厚、伤害更高、蓄力更快，到封顶为止', () => {
  const d = deriveRoundDifficulty({ roundNumber: 1 });
  let prevHp = 0, prevDmg = 0, prevIdle = Infinity;
  for (let seg = 1; seg <= 21; seg++) {
    const hp = scaleEnemyHealth(1000, d, seg);
    const p = scaleFoeAttackProfile(FOE_ATTACK.normal, d, seg);
    assert.ok(hp > prevHp, 'hp 单调递增 @' + seg);
    assert.ok(p.damage >= prevDmg, 'damage 不降 @' + seg);
    assert.ok(p.idleMs <= prevIdle, 'idle 不变长 @' + seg);
    prevHp = hp; prevDmg = p.damage; prevIdle = p.idleMs;
  }
  assert.equal(scaleEnemyHealth(1000, d, 9), 2200);
  assert.equal(scaleFoeAttackProfile(FOE_ATTACK.normal, d, 9).damage, Math.round(4 * 1.8));
  assert.deepEqual(segmentMultipliers(50), segmentMultipliers(21), '第 21 张图起封顶');
});

test('思考窗口的硬下限在地图倍率之下照样生效', () => {
  const p = scaleFoeAttackProfile(FOE_ATTACK.boss, deriveRoundDifficulty({ roundNumber: 99 }), 99);
  assert.equal(p.idleMs, MIN_IDLE_MS);
  assert.equal(p.telegraphMs, MIN_TELEGRAPH_MS);
  assert.equal(p.recoverMs, MIN_RECOVER_MS);
});

/* ---------------- 2) 商店 ---------------- */

class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.dataset = {}; this._text = ''; this.style = {}; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  classList = { add() {}, remove() {} };
}
function shop({ gold = 100000, segments = 1, hm = 0, relics = [] } = {}) {
  const ids = new Map(['rTitle', 'rSub', 'rPicks', 'eIcon', 'eTitle', 'eText', 'ePicks', 'pTitle', 'pSub', 'pPicks', 'pSkip'].map(id => [id, new El('div')]));
  const log = [];
  const G = { unit: 1, hp: 30, maxhp: 70, gold, relics: relics.slice(), bag: {}, floor: 1, hm,
    campaign: { startedUnit: 1, segments }, node: { type: 'shop', done: false, links: [] } };
  const ctrl = createEncounterController({ state: { G, B: null }, ports: {
    $: id => ids.get(id) || null, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    pick: a => a[0], shuffle: a => a.slice(), rnd: () => 0, has: (a, v) => a.indexOf(v) >= 0,
    hasR: id => G.relics.includes(id), goldGain: n => n, applyRelicInit: () => {},
    sfx: { relic() {}, coin() {} }, toast: m => log.push(['toast', m]), advance() {}, endRun() {},
    finishNode() {}, show() {}, scheduleRun() {}, scheduleBattle() {},
    publishEncounter: d => log.push(['publish', d]), setPhase() {}, canAct: () => true,
    makeButton: tag => new El(tag || 'button'), relicDraw: pool => pool[0],
  } });
  ctrl.showShop();
  const desc = () => log.filter(l => l[0] === 'publish').pop()[1];
  // 同一按钮有 260ms 防连点冷却，测试里每次点击前清掉。
  const click = id => { const b = ids.get('rPicks').children.find(c => c.dataset.opt === id); b._at = 0; b.onclick(); };
  const opt = prefix => desc().options.find(o => o.id.startsWith(prefix));
  return { G, ctrl, log, desc, click, opt, toasts: () => log.filter(l => l[0] === 'toast').map(l => l[1]) };
}

test('价格倍率：第 1 张图原价，每多一张图 +25%，第 21 张图封顶', () => {
  assert.equal(shopPriceScale(1), 1);
  assert.equal(shopPriceScale(5), 2);
  assert.equal(shopPriceScale(21), 6);
  assert.equal(shopPriceScale(99), 6);
  assert.equal(scaledPrice(45, 1), 45);
  assert.equal(scaledPrice(45, 5), 90);
});

test('第 1 张图的普通商品仍是原价', () => {
  const h = shop();
  assert.match(h.opt('shop:potion').t, / 45 金币$/);
  assert.match(h.opt('shop:scroll').t, / 40 金币$/);
  assert.match(h.opt('shop:whet').t, / 70 金币$/);
  const r = RELICS[0];
  assert.match(h.opt('shop:relic:').t, new RegExp(' ' + relicPrice(r) + ' 金币$'));
});

test('第 5 张图：普通商品、遗物、道具都翻倍，卡面价就是实收价', () => {
  const h = shop({ segments: 5 });
  assert.match(h.opt('shop:potion').t, / 90 金币$/);
  assert.equal(h.opt('shop:potion').id, 'shop:potion:90', '涨过价的固定商品把价格写进 id');
  const before = h.G.gold;
  h.click('shop:potion:90');
  assert.equal(h.G.gold, before - 90);
  const relic = h.opt('shop:relic:');
  const price = Number(relic.id.split(':').pop());
  assert.equal(price, scaledPrice(relicPrice(RELICS[0]), 5));
  const g = h.G.gold; h.click(relic.id); assert.equal(h.G.gold, g - price);
  const item = h.opt('shop:item:');
  const it = ITEMS.find(i => item.id.startsWith('shop:item:' + i.id + ':'));
  assert.equal(Number(item.id.split(':').pop()), scaledPrice(it.price, 5));
});

test('提示宝典 1000 金币 +1、提示圣典 2000 金币 +3，写进本次远征的基础提示', () => {
  const h = shop({ gold: 3500 });
  assert.match(h.opt('shop:tome').t, /1000 金币/);
  assert.match(h.opt('shop:codex').t, /2000 金币/);
  h.click('shop:tome');
  assert.equal(h.G.gold, 2500); assert.equal(h.G.hm, 1);
  h.click('shop:codex');
  assert.equal(h.G.gold, 500); assert.equal(h.G.hm, 4);
  h.click('shop:tome');
  assert.equal(h.G.gold, 500, '钱不够不扣'); assert.equal(h.G.hm, 4);
  assert.ok(h.toasts().some(t => t.includes('金币不够')));
});

test('永久提示有上限：基础提示最多 ' + PERMANENT_HINT_MAX + ' 次', () => {
  const h = shop({ hm: PERMANENT_HINT_MAX - 3 - 2 });
  h.click('shop:codex');
  assert.equal(h.G.hm, PERMANENT_HINT_MAX - 5, '再加 3 会超上限，不卖');
  h.click('shop:tome');
  h.click('shop:tome');
  assert.equal(3 + h.G.hm, PERMANENT_HINT_MAX);
  const gold = h.G.gold; h.click('shop:tome');
  assert.equal(h.G.gold, gold, '到上限后不扣钱');
});

test('生命圣杯与遗物宝箱', () => {
  const h = shop({ gold: 3000 });
  h.click('shop:grail');
  assert.equal(h.G.maxhp, 70 + PREMIUM_SHOP.grail.maxhp);
  assert.equal(h.G.hp, h.G.maxhp);
  assert.equal(h.G.gold, 1500);
  h.click('shop:chest');
  assert.equal(h.G.gold, 300);
  assert.equal(h.G.relics.length, 1);
  const full = shop({ relics: RELICS.map(r => r.id) });
  const gold = full.G.gold; full.click('shop:chest');
  assert.equal(full.G.gold, gold, '遗物集齐后宝箱不收钱');
});

test('恢复的商店：高价商品与涨过价的普通商品按卡面收费', () => {
  const h = shop({ segments: 9 });
  const published = h.desc();
  const h2 = shop({ segments: 9, gold: 5000 });
  assert.equal(h2.ctrl.reopenEncounter(published), true);
  const potionPrice = scaledPrice(SHOP_BASE_PRICES.potion, 9);
  assert.match(published.options.find(o => o.id === 'shop:potion:' + potionPrice).t, new RegExp(' ' + potionPrice + ' 金币$'));
  h2.click('shop:potion:' + potionPrice);
  assert.equal(h2.G.gold, 5000 - potionPrice);
  h2.click('shop:tome');
  assert.equal(h2.G.hm, 1);
});

test('加价之前的旧存档商店（id 不带价格）在后面的地图恢复时仍按卡面原价收费', () => {
  const h = shop({ segments: 5, gold: 1000 });
  const legacy = { kind: 'shop', options: [
    { id: 'shop:potion', cat: 'heal', ic: '💚', t: '疗伤药剂 · 45 金币', d: '回复 35 点生命' },
    { id: 'shop:scroll', cat: 'boost', ic: '🔮', t: '提示卷轴 · 40 金币', d: '' },
    { id: 'shop:whet', cat: 'boost', ic: '💪', t: '磨砺石 · 70 金币', d: '' },
    { id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买' }] };
  assert.equal(h.ctrl.reopenEncounter(legacy), true);
  h.click('shop:potion'); assert.equal(h.G.gold, 955);
  h.click('shop:scroll'); assert.equal(h.G.gold, 915);
  h.click('shop:whet'); assert.equal(h.G.gold, 845);
  assert.equal(shop().opt('shop:potion').id, 'shop:potion', '第 1 张图的 id 与旧版逐字相同');
});

/* ---------------- 3) 跨册顺延与循环 ---------------- */

const hero = HEROES[0];
const upperRun = unit => createRun(unit, hero, WORDS.filter(w => w.u === unit), () => .5);
const finish = run => { for (const w of run.pool) run.done.add(learningKey(w)); };

test('八上 Unit 6 的下一站是八下 Unit 1；前面的单元不跨册', () => {
  assert.equal(crossBookTarget(upperRun(5)), null);
  assert.deepEqual(crossBookTarget(upperRun(6)), { bookId: 'wy8b', unit: 1, loop: false });
  const custom = createRun(0, hero, [{ u: 0, d: 2, w: 'abc', z: '自定义', th: 'custom' }], () => .5);
  assert.equal(crossBookTarget(custom), null);
});

test('跨到八下：换册换词池，金币遗物带过去，旧册纪念卡不被八下改写', () => {
  const run = upperRun(6);
  run.gold = 4321; run.relics = ['hint']; run.roundId = 'r-1'; run.roundNumber = 8;
  finish(run);
  const db = { runs: 8, wins: 0, best: 0, rewards: [] };
  endRunProgress(run, db, true, 1);
  run.result = undefined;
  const card = db.rewards[0];
  assert.equal(card.bookId, undefined, '八上卡没有 bookId');
  const target = crossBookTarget(run);
  const applied = applyBookTransition(run, target, { from: 6, words: wordsFor('wy8b', 1), random: () => .5 });
  assert.deepEqual(applied, { bookId: 'wy8b', unit: 1, segment: 2, loop: false });
  assert.equal(run.bookId, 'wy8b');
  assert.deepEqual(run.scopeUnits, [1, 2, 3, 4, 5, 6]);
  assert.equal(run.campaign.bookId, 'wy8b');
  assert.equal(run.gold, 4321); assert.deepEqual(run.relics, ['hint']);
  assert.equal(run.roundNumber, 8);
  assert.equal(run.floor, 1);
  assert.equal(pendingWords(run).length, wordsFor('wy8b', 1).length);
  assert.equal(run.rewardId, undefined, '八下另发一张卡');
  assert.deepEqual(run.completedUnits, []);
  assert.deepEqual(roundScopeUnits(run), [1, 2, 3, 4, 5, 6]);
  const before = JSON.stringify(card);
  run.completedUnits = [1];
  syncRoundCard(Object.assign({}, run, { rewardId: card.id }), db);
  assert.equal(JSON.stringify(card), before, '八下的单元不能写到八上卡上');
});

test('过期的过渡（from 不是当前单元）没有任何副作用', () => {
  const run = upperRun(6);
  const snap = JSON.stringify({ ...run, done: [...run.done] });
  assert.equal(applyBookTransition(run, crossBookTarget(run), { from: 5, words: wordsFor('wy8b', 1) }), null);
  assert.equal(applyBookTransition(run, { bookId: 'wy8b', unit: 1 }, { from: 6, words: WORDS.filter(w => w.u === 1) }), null, '词池必须属于目标册');
  assert.equal(JSON.stringify({ ...run, done: [...run.done] }), snap);
});

test('late-run-1 的商店存档（id 不带价、卡面已涨价）按卡面价收费', () => {
  const h = shop({ segments: 5, gold: 1000 });
  assert.equal(h.ctrl.reopenEncounter({ kind: 'shop', options: [
    { id: 'shop:potion', cat: 'heal', ic: '💚', t: '疗伤药剂 · 90 金币', d: '' },
    { id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买' }] }), true);
  // 恢复后价格写进 id，之后再存档就不再依赖卡面文字。
  assert.deepEqual(h.desc().options.map(o => o.id), ['shop:potion:90', 'shop:leave']);
  h.click('shop:potion:90'); assert.equal(h.G.gold, 910);
});

test('八下开局：学完八下补八上，补完八上时八下已学完，直接进循环而不是绕回八下', () => {
  const upper6 = upperRun(6);
  const done = { wy8a: undefined, wy8b: undefined };
  assert.equal(crossBookTarget(upper6, { unfinished: id => done[id] }).loop, true);
  const partly = { wy8a: undefined, wy8b: 3 };
  assert.deepEqual(crossBookTarget(upper6, { unfinished: id => partly[id] }), { bookId: 'wy8b', unit: 3, loop: false });
});

test('从八下开局学完八下，先补八上没完成的单元，不直接进循环', () => {
  const run = createRun(6, hero, wordsFor('wy8b', 6), () => .5, null, { bookId: 'wy8b' });
  const pending = { wy8a: 4, wy8b: undefined };
  assert.deepEqual(crossBookTarget(run, { unfinished: id => pending[id] }), { bookId: 'wy8a', unit: 4, loop: false });
  assert.equal(crossBookTarget(run, { unfinished: () => undefined }).loop, true, '全部完成才循环');
});

test('八下 Unit 6 学完进入全册随机循环；同一张图抽到的单元固定', () => {
  const run = createRun(6, hero, wordsFor('wy8b', 6), () => .5, null, { bookId: 'wy8b' });
  run.roundId = 'round-x';
  const allDone = { unfinished: () => undefined };
  const t1 = crossBookTarget(run, allDone), t2 = crossBookTarget(run, allDone);
  assert.equal(t1.loop, true);
  assert.deepEqual(t1, t2, '按钮上写的和点下去进入的是同一个单元');
  assert.ok(!(t1.bookId === 'wy8b' && t1.unit === 6), '不抽到刚学完的单元');
  finish(run);
  // 循环抽到的单元在本次远征里早就做过（第一遍学的时候），要重新练。
  for (const w of wordsFor(t1.bookId, t1.unit)) run.done.add(learningKey(w));
  applyBookTransition(run, t1, { from: 6, words: wordsFor(t1.bookId, t1.unit), random: () => .5 });
  assert.equal(run.campaign.loop, true);
  assert.equal(pendingWords(run).length, new Set(wordsFor(t1.bookId, t1.unit).map(w => learningKey(w))).size,
    '循环里这个单元重新练一遍');
  const seen = new Set();
  for (let seg = 3; seg < 40; seg++) {
    run.campaign.segments = seg;
    const t = crossBookTarget(run, allDone);
    assert.equal(t.loop, true, '进入循环之后一直随机');
    seen.add(t.bookId + ':' + t.unit);
  }
  assert.ok(seen.size >= 6, '循环会抽到很多不同的单元，实际 ' + seen.size);
  assert.ok([...seen].some(k => k.startsWith('wy8a:')) && [...seen].some(k => k.startsWith('wy8b:')), '两册都会抽到');
});

/* ---------------- 4) 存档 ---------------- */

const roundTrip = run => {
  const enc = encodeSnapshot({ phase: PHASE.MAP, run, battle: null, encounter: null }, { now: 1 });
  assert.ok(enc, '能写出快照');
  const dec = decodeSnapshot(JSON.parse(JSON.stringify(enc)));
  assert.equal(dec.ok, true, '能读回快照');
  return dec.value.run;
};

test('跨到八下、循环回八上之后都能存档恢复，循环标记与图数不丢', () => {
  const run = upperRun(6);
  run.roundId = 'round-y'; run.roundNumber = 2;
  finish(run);
  applyBookTransition(run, crossBookTarget(run), { from: 6, words: wordsFor('wy8b', 1), random: () => .5 });
  let back = roundTrip(run);
  assert.equal(back.bookId, 'wy8b'); assert.equal(back.campaign.segments, 2);
  const loopTo = { bookId: 'wy8a', unit: 3, loop: true };
  applyBookTransition(run, loopTo, { from: 1, words: wordsFor('wy8a', 3), random: () => .5 });
  assert.equal(Object.hasOwn(run, 'bookId'), false, '回到八上恢复旧形状');
  back = roundTrip(run);
  assert.equal(back.unit, 3);
  assert.equal(back.campaign.loop, true);
  assert.equal(back.campaign.segments, 3);
  assert.equal(back.bookId, undefined);
});
