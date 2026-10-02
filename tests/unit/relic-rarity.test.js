/* 遗物**稀有度分级**：数据完整性、分档定价、加权抽取。
 *
 * 这些测试守的是「每一件遗物都有明确档位、档位真的决定价格与出现率」：
 *  - 缺档位的遗物是最容易溜进来的回归（旧数据、手写新遗物都会这样），
 *    它的后果是 relicPrice 拿到 undefined，商店文案出现「undefined 金币」。
 *  - 未知档位必须**回落成普通档**，而不是崩或者 NaN：存档、导入数据、
 *    未来删遗物都可能带来认不出的形状。
 *  - 加权抽取必须是真加权：均匀 shuffle 会让传说和普通一样常见，
 *    稀有度分级就只剩了个价格标签。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RELICS } from '../../src/data/relics.js';
import { RELIC_RARITY, RELIC_RARITY_ORDER, LEGACY_RELIC_SHOP_PRICE } from '../../src/data/balance.js';
import {
  relicRarity, relicPrice, relicWeight, relicRarityLabel,
  pickRelicWeighted, sampleRelicsWeighted,
} from '../../src/domain/relic-rules.js';

/* 确定性随机源：任何依赖 Math.random 的断言都会变成 flaky 测试。 */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('每件遗物都标了合法稀有度，没有漏标的', () => {
  for (const r of RELICS) {
    assert.ok(RELIC_RARITY_ORDER.includes(r.rarity),
      `遗物「${r.n}」(${r.id}) 的 rarity=${JSON.stringify(r.rarity)} 不在 ${RELIC_RARITY_ORDER.join('/')} 里`);
  }
});

test('每一档都有正整数价格、正整数权重和中文标签', () => {
  for (const key of RELIC_RARITY_ORDER) {
    const t = RELIC_RARITY[key];
    assert.ok(t, '缺少稀有度档位定义: ' + key);
    assert.ok(Number.isInteger(t.price) && t.price > 0, key + ' 的价格必须是正整数，实际 ' + t.price);
    assert.ok(Number.isInteger(t.weight) && t.weight > 0, key + ' 的权重必须是正整数，实际 ' + t.weight);
    assert.equal(typeof t.label, 'string');
    assert.ok(t.label.length > 0, key + ' 缺少中文标签');
  }
});

test('价格与稀有度同向递增：普通 < 稀有 < 传说', () => {
  const prices = RELIC_RARITY_ORDER.map(k => RELIC_RARITY[k].price);
  for (let i = 1; i < prices.length; i++) {
    assert.ok(prices[i] > prices[i - 1],
      `第 ${i} 档（${RELIC_RARITY_ORDER[i]}）价格 ${prices[i]} 必须高于上一档 ${prices[i - 1]}`);
  }
});

test('权重同向递减：越稀有越少见', () => {
  const weights = RELIC_RARITY_ORDER.map(k => RELIC_RARITY[k].weight);
  for (let i = 1; i < weights.length; i++) {
    assert.ok(weights[i] < weights[i - 1],
      `第 ${i} 档（${RELIC_RARITY_ORDER[i]}）权重 ${weights[i]} 必须低于上一档 ${weights[i - 1]}`);
  }
});

test('relicPrice / relicWeight 按档位取值', () => {
  const common = RELICS.filter(r => r.rarity === 'common')[0];
  const legend = RELICS.filter(r => r.rarity === 'legendary')[0];
  assert.ok(common && legend, '数据里必须同时存在普通遗物与传说遗物');
  assert.equal(relicPrice(common), RELIC_RARITY.common.price);
  assert.equal(relicWeight(common), RELIC_RARITY.common.weight);
  assert.equal(relicPrice(legend), RELIC_RARITY.legendary.price);
  assert.equal(relicRarityLabel(legend), RELIC_RARITY.legendary.label);
});

test('缺失 / 未知 rarity 回落成普通档，绝不返回 undefined 或 NaN', () => {
  // 这是旧数据与外部输入的兜底：一场对局里少一个档位，不该让商店文案出现 NaN。
  for (const bad of [{}, { id: 'x' }, { id: 'x', rarity: undefined }, { id: 'x', rarity: null },
    { id: 'x', rarity: 'mythic' }, { id: 'x', rarity: 3 }]) {
    assert.equal(relicRarity(bad), 'common', JSON.stringify(bad) + ' 应当回落到 common');
    assert.equal(relicPrice(bad), RELIC_RARITY.common.price);
    assert.equal(relicWeight(bad), RELIC_RARITY.common.weight);
    assert.equal(relicRarityLabel(bad), RELIC_RARITY.common.label);
  }
  assert.equal(relicRarity(null), 'common');
});

test('每一档都有遗物：稀有度分级不能有空档', () => {
  for (const key of RELIC_RARITY_ORDER) {
    assert.ok(RELICS.some(r => r.rarity === key), '没有任何 ' + key + ' 遗物，档位形同虚设');
  }
});

test('加权抽取：单抽只从池子里拿，且 4000 次里传说明显少于普通', () => {
  const rnd = lcg(20251002);
  const counts = {};
  let legendHits = 0, commonHits = 0;
  for (let i = 0; i < 4000; i++) {
    const r = pickRelicWeighted(RELICS, rnd);
    assert.ok(r, 'pickRelicWeighted 绝不能返回空');
    assert.ok(RELICS.includes(r), '只能从传入的池子里挑');
    counts[r.rarity] = (counts[r.rarity] || 0) + 1;
    if (r.rarity === 'legendary') legendHits++;
    if (r.rarity === 'common') commonHits++;
  }
  assert.ok(commonHits > legendHits, '普通必须远多于传说，实际 common=' + commonHits + ' legendary=' + legendHits);
  // 单件传说的权重 8 / 全池权重和 —— 期望约 4000*8/(7*62+5*30+8)
  const total = RELICS.reduce((n, r) => n + relicWeight(r), 0);
  const expected = 4000 * RELIC_RARITY.legendary.weight / total;
  assert.ok(Math.abs(legendHits - expected) < expected * 0.5 + 8,
    '传说出现率应贴近权重预期 ' + expected.toFixed(1) + '，实际 ' + legendHits);
});

test('抽不满的池子不会越界：只剩一个候选时必定抽它', () => {
  const rnd = lcg(7);
  const only = RELICS.filter(r => r.rarity === 'legendary')[0];
  for (let i = 0; i < 50; i++) assert.equal(pickRelicWeighted([only], rnd), only);
  assert.equal(pickRelicWeighted([], rnd), null, '空池返回 null，不抛异常');
  assert.equal(pickRelicWeighted(null, rnd), null);
});

test('不重复加权抽样：拿 3 件必得 3 件互不相同的遗物', () => {
  const rnd = lcg(99);
  const out = sampleRelicsWeighted(RELICS, 3, rnd);
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map(r => r.id)).size, 3, '同一个遗物不能在一批奖励里出现两次');
  assert.ok(out.every(r => RELICS.includes(r)));
  assert.deepEqual(sampleRelicsWeighted(RELICS, 99, rnd).length, RELICS.length, '要多少给多少，不足则全给');
  assert.deepEqual(sampleRelicsWeighted([], 3, rnd), []);
});

test('旧版商店的固定价被保留成一个具名常量（存档恢复路径要用）', () => {
  assert.equal(LEGACY_RELIC_SHOP_PRICE, 80);
});