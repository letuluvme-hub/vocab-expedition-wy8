/* 「知识成长」纯规则单元回归（docs/feature-mastery-growth.md）。
 *
 * 契约（逐条核对，全部是纯函数：domain/mastery-growth.js 不碰 DOM / 存储 / 全局）：
 *  1) 身份只做 trim + lowerCase，**保留空格、连字符、撇号的拼写含义**
 *     （ice cream 与 icecream 不是同一个词，剥掉分隔符会伪造掌握量）。
 *  2) 只有**真实教材词**计入成长：自定义词表里独有的词再多也不给 +HP。
 *  3) 大小写/重复/前后空格的同一身份只算一次（259 词库真实计数）。
 *  4) 20 个真实教材词 = +1 生命上限，封顶 +12 → 240 词封顶，259 词仍是 12。
 *  5) 非法入参（null / 非数组 / NaN / 空词）不产生 NaN、不抛异常、
 *     也不会被算成「成长」。
 *  6) 只读：不修改传入的 mastered / canonicalWords（旧存档与词库逐字节不变）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import {
  GROWTH_VERSION, GROWTH_INTERVAL, GROWTH_MAX_BONUS, GROWTH_TOTALS_FLOOR,
  growthKey, canonicalMasteryKeys, growthSummary,
} from '../../src/domain/mastery-growth.js';

const ALL = [...new Set(WORDS.map(w => growthKey(w.w)))];
const keys = n => ALL.slice(0, n);
const custom = n => Array.from({ length: n }, (_, i) => 'customword' + i);

/* ---------------- 垂直 1：计数 / 重复 / 身份（真实 259 教材词） ---------------- */

test('真实 259 教材词：重复与大小写不重复计数，顺序保持词库原序', () => {
  assert.equal(WORDS.length, 259, '教材词库真实规模就是 259');
  assert.equal(ALL.length, 259, '259 个身份互不重复');

  const messy = [
    '  ' + ALL[3] + ' ', ALL[3], ALL[3].toUpperCase(), ALL[5], ' ' + ALL[5] + '  ',
  ];
  const out = canonicalMasteryKeys(messy, WORDS);
  assert.deepEqual(out, [ALL[3], ALL[5]], '同一身份只留一条，保持词库原序');
});

test('自定义词表独有的词不成长：500 个自定义词仍是 +0', () => {
  const out = canonicalMasteryKeys(custom(500), WORDS);
  assert.deepEqual(out, [], '自定义词一个都不算教材掌握');
  const s = growthSummary(custom(500), WORDS);
  assert.equal(s.masteredCount, 0);
  assert.equal(s.bonusHp, 0);
  assert.equal(s.totalCount, 259);
});

test('教材词与自定义词混在一起时，只按教材身份计数', () => {
  const s = growthSummary([...keys(20), ...custom(500)], WORDS);
  assert.equal(s.masteredCount, 20);
  assert.equal(s.bonusHp, 1, '500 个自定义词不许把生命上限推上去');
});

test('身份保留空格 / 连字符的拼写含义', () => {
  assert.equal(growthKey('  Ice   Cream '), 'ice   cream');
  assert.notEqual(growthKey('ice   cream'), growthKey('ice cream'), '成长身份必须与词队列、单元解锁共用 trim+lower，不再归一化内部空白');
  assert.deepEqual(canonicalMasteryKeys([' ice   cream '], [{ w: 'ice cream' }]), []);
  assert.notEqual(growthKey('ice cream'), growthKey('icecream'));
  assert.equal(growthKey('well-known'), 'well-known');
  assert.notEqual(growthKey('well-known'), growthKey('wellknown'));
  assert.equal(growthKey(null), '');
  assert.equal(growthKey(undefined), '');

  /* 真实词库里带空格的词：按原文录入算掌握，剥掉空格后不算。 */
  const spaced = WORDS.filter(w => /\s/.test(w.w));
  for (const w of spaced) {
    assert.ok(canonicalMasteryKeys([w.w], WORDS).length === 1, '原文可算：' + w.w);
    assert.ok(canonicalMasteryKeys([w.w.replace(/\s/g, '')], WORDS).length === 0, '剥空格不算：' + w.w);
  }
});

/* ---------------- 垂直 2：边界 19 / 20 / 239 / 240 / 259 与封顶 ---------------- */

test('边界：19 → +0，20 → +1，239 → +11，240 → +12（封顶），259 → 仍是 +12', () => {
  const at = n => growthSummary(keys(n), WORDS);
  assert.equal(at(19).bonusHp, 0, '19 个教材词不给生命上限');
  assert.equal(at(20).bonusHp, 1, '20 个真实教材词 = +1');
  assert.equal(at(239).bonusHp, 11);
  assert.equal(at(240).bonusHp, 12, '240 词封顶 +12');
  assert.equal(at(259).bonusHp, 12, '259 词全部掌握仍是 +12');
});

test('封顶后 toNext / nextThreshold 为 0 / null，并且 capped 明确', () => {
  const s = growthSummary(keys(259), WORDS);
  assert.equal(s.capped, true);
  assert.equal(s.nextThreshold, null);
  assert.equal(s.toNext, 0);
  assert.equal(s.maxBonusHp, 12);
  assert.equal(s.interval, 20);
  assert.equal(s.version, GROWTH_VERSION);
  assert.equal(s.totalCount, 259);
  assert.equal(s.progress, 1);
});

test('未封顶时 nextThreshold / toNext 说清「再学几词」', () => {
  const s = growthSummary(keys(12), WORDS);
  assert.equal(s.bonusHp, 0);
  assert.equal(s.nextThreshold, 20, '下一个台阶在第 20 词');
  assert.equal(s.toNext, 8);
  assert.equal(s.capped, false);
  assert.equal(growthSummary(keys(0), WORDS).toNext, 20);
  assert.equal(growthSummary(keys(19), WORDS).toNext, 1);
  assert.equal(growthSummary(keys(239), WORDS).toNext, 1, '最后一格 +12 前还差 1 词');
});

test('封顶常量自洽：20 × 12 = 240 ≤ 259，且 >= 240 的输入全部相同', () => {
  assert.equal(GROWTH_INTERVAL, 20);
  assert.equal(GROWTH_MAX_BONUS, 12);
  assert.equal(GROWTH_TOTALS_FLOOR, 240);
  assert.ok(GROWTH_TOTALS_FLOOR <= 259, '封顶点必须在真实词库规模之内，否则封顶永远够不到');
  for (let n = 240; n <= 259; n += 1) {
    const s = growthSummary(keys(n), WORDS);
    assert.equal(s.bonusHp, 12, n + ' 词仍是 +12');
    assert.equal(s.capped, true);
  }
});

/* ---------------- 垂直 3（规则侧）：非法入参与只读 ---------------- */

test('非法入参不产生 NaN、不抛异常、不算成长', () => {
  const cases = [
    [null, null], [undefined, undefined], [[], []],
    ['nope', 'nope'], [{}, {}], [[null, undefined, {}, 0, false], [null, 42, {}, '']],
    [['NaN', ' ', NaN], null], [keys(5), null], [keys(5), []], [keys(5), 'nope'],
  ];
  for (const [mastered, canon] of cases) {
    const s = growthSummary(mastered, canon);
    assert.equal(s.masteredCount, 0, JSON.stringify([mastered, canon]));
    assert.equal(s.totalCount, 0);
    assert.equal(s.bonusHp, 0);
    assert.equal(s.capped, false);
    assert.equal(Number.isFinite(s.progress), true);
    assert.equal(typeof s.tier, 'string');
  }
  /* 词库可用但 mastered 全是垃圾身份：教材规模照实（259），成长照 0。 */
  const junk = growthSummary(['NaN', ' ', NaN, 42, {}, ''], WORDS);
  assert.equal(junk.totalCount, 259, '词库规模与 mastered 无关');
  assert.equal(junk.masteredCount, 0);
  assert.equal(junk.bonusHp, 0);
  assert.equal(junk.progress, 0);
  /* 空词库没有封顶可言：给 0/+0，文案不会自称封顶。 */
  const empty = growthSummary(keys(300), []);
  assert.equal(empty.bonusHp, 0, '没有教材词库就无从成长，绝不白送生命上限');
  assert.equal(empty.capped, false);
});

test('只读：入参 mastered 与词库在调用前后逐字节不变', () => {
  const mastered = ['  ' + ALL[0] + ' ', ALL[1], 'customword0'];
  const before = JSON.stringify(mastered);
  const canonBefore = JSON.stringify(WORDS);
  growthSummary(mastered, WORDS);
  canonicalMasteryKeys(mastered, WORDS);
  assert.equal(JSON.stringify(mastered), before, '旧存档的 mastered 不许被这个模块改写');
  assert.equal(JSON.stringify(WORDS), canonBefore, '词库是只读输入');
  assert.equal(mastered.length, 3, '不新增、不删除、不重排');
});

test('mastered 可以是词对象或字符串（旧存档两种形状都在流通）', () => {
  const asObjects = WORDS.slice(0, 20).map(w => ({ w: w.w, z: w.z }));
  const asStrings = keys(20);
  const a = growthSummary(asObjects, WORDS);
  const b = growthSummary(asStrings, WORDS);
  assert.equal(a.bonusHp, 1);
  assert.equal(b.bonusHp, 1);
  assert.deepEqual(canonicalMasteryKeys(asObjects, WORDS), asStrings);
});

test('tier 随 bonusHp 变化且封顶后保持不变', () => {
  const t0 = growthSummary(keys(0), WORDS).tier;
  const t1 = growthSummary(keys(20), WORDS).tier;
  const t12 = growthSummary(keys(240), WORDS).tier;
  assert.equal(t0, growthSummary(keys(19), WORDS).tier, '同一台阶内文案一致');
  assert.equal(t12, growthSummary(keys(259), WORDS).tier);
  assert.notEqual(t0, t1, '跨台阶文案必须变');
});
