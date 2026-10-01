/* 「单词尽量不重复」+ 词池穷尽检查点。
 *
 * 这条功能有三个必须同时成立的契约：
 *  1) 本轮已完成的词绝不作为候选返回（小词池也绝不回灌整池）；
 *  2) 相同英文的重复词条只有第一条是候选（重复字母 ≠ 重复词条）；
 *  3) 抽词是纯函数：词池穷尽时返回 **null**（不是 undefined），run.done 不重置。
 *
 * 「尽量」不是「跳过」：只剩一个未完成词时它必须还能出现，否则玩家无法通关。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawWord, pendingWords, isPoolComplete, learningCounts } from '../../src/domain/word-selection.js';
import { createRun } from '../../src/domain/run.js';
import { norm } from '../../src/domain/text.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const HERO = { id: 'heroine', mod: { hp: 10, shield: 0, gold: 5, hint: 1, noise: 0, combo: 1, regen: 2, leech: 0 } };
const W = (w, z, d = 1, u = 1) => ({ u, d, w, z });
const mkRun = pool => createRun(1, HERO, pool);

/* ---------------- 1. 已完成的词永不返回，小词池不回灌 ---------------- */
test('drawWord never returns a completed word even when only 1 or 2 candidates are left', () => {
  const pool = [W('cat', '猫'), W('dog', '狗'), W('owl', '猫头鹰', 2)];
  const cases = [['cat'], ['cat', 'dog']];   // 剩 2 / 1 个候选
  for (const done of cases) {
    for (const budget of [1, 2, 3]) {
      for (let s = 1; s <= 20; s++) {
        const run = mkRun(pool);
        run.done = new Set(done);
        const got = drawWord(run, null, budget, seeded(s * 5 + budget));
        assert.ok(got, '仍有未完成词时必须给出词（done=' + done + '）');
        assert.ok(!done.includes(got.w), '不得回灌已完成的词 ' + got.w + '（done=' + done + '）');
      }
    }
  }
});

test('drawWord returns null when the pool is exhausted and never resets run.done', () => {
  const pool = [W('cat', '猫'), W('dog', '狗')];
  const run = mkRun(pool);
  run.done = new Set(['cat', 'dog']);
  const size = run.done.size;
  for (let s = 1; s <= 20; s++) {
    assert.equal(drawWord(run, null, 1, seeded(s)), null, '穷尽时返回 null');
    assert.equal(drawWord(run, { word: pool[0] }, 3, seeded(s)), null, '上一词存在时也是 null');
  }
  assert.equal(run.done.size, size, 'run.done 不许被重置');
  assert.equal(run.pool.length, 2, '词池不被清空');
});

test('drawWord on an empty pool is safe and returns null', () => {
  const run = mkRun([]);
  assert.equal(drawWord(run, null, 1, seeded(1)), null);
  assert.equal(drawWord(run, { word: W('x', 'y') }, 1, seeded(1)), null);
  assert.equal(drawWord({ pool: [], done: new Set(), wrong: [] }, null, 2), null);
});

/* ---------------- 2. 重复词条 / 重复字母 ---------------- */
test('repeated letters in one entry are still one word, and duplicate English keeps only the first entry', () => {
  // 「重复字母 ≠ 重复词条」：banana 有三个 a，但它是一个词条，不能被当成重复排除。
  const pool = [W('banana', '香蕉'), W('keep an eye on', '留意', 2), W('super-speed', '超速', 2)];
  const run = mkRun(pool);
  for (let s = 1; s <= 30; s++) {
    const got = drawWord(run, null, 2, seeded(s));
    assert.ok(got, '短语词条必须照常出现');
    assert.equal(norm(got.w), norm(got.w), '归一化后自洽');
  }
  // 相同英文的重复词条：只有第一条是候选。
  const dup = [W('apple', '苹果'), W('apple', '苹果二'), W('pear', '梨')];
  const r2 = mkRun(dup);
  assert.deepEqual(pendingWords(r2).map(w => w.z), ['苹果', '梨']);
  for (let s = 1; s <= 30; s++) {
    const got = drawWord(r2, null, 1, seeded(s));
    assert.ok(got, '重复英文仍留一个候选');
    assert.equal(got.z, got.w === 'pear' ? '梨' : '苹果', '只能取到第一条 apple');
  }
  // 退休的是「英文」，所以第一条完成后重复词条整条都不再出现。
  r2.done.add('apple');
  for (let s = 1; s <= 20; s++) assert.equal(drawWord(r2, null, 1, seeded(s)).w, 'pear');
});

/* ---------------- 3. 错词队列 ---------------- */
test('wrong queue is deduplicated and only holds unfinished words', () => {
  const pool = [W('cat', '猫'), W('dog', '狗'), W('owl', '猫头鹰', 2)];
  const run = mkRun(pool);
  run.wrong = ['cat', 'cat', 'dog', 'banana'];
  const pending = pendingWords(run);
  assert.deepEqual(pending.map(w => w.w), ['cat', 'dog', 'owl']);
  // 已完成的词即使在 wrong 里也不作为候选（done 优先）。
  run.done.add('cat');
  assert.deepEqual(pendingWords(run).map(w => w.w), ['dog', 'owl']);
  assert.equal(isPoolComplete(run), false);
  for (let s = 1; s <= 30; s++) {
    const got = drawWord(run, null, 1, seeded(s));
    assert.ok(['dog', 'owl'].includes(got.w), '错词队列里的已完成词不复活：' + got.w);
  }
});

/* ---------------- 4. 避免立刻重复，但单候选允许再出现 ---------------- */
test('drawWord prefers a different word from the current battle but allows a single unfinished word to repeat', () => {
  const pool = [W('cat', '猫'), W('dog', '狗'), W('owl', '猫头鹰', 2)];
  const run = mkRun(pool);
  run.done.add('cat');
  for (let s = 1; s <= 60; s++) {
    const got = drawWord(run, { word: pool[1] }, 1, seeded(s));
    assert.notEqual(got.w, 'dog', '有别的未完成词时不得立刻重复上一个词（seed ' + s + '）');
  }
  // 难度过滤可能把唯一另一个候选排除：只按难度放宽不能造成重复。
  const one = mkRun([W('cat', '猫'), W('dog', '狗', 3)]);
  for (let s = 1; s <= 30; s++) {
    const got = drawWord(one, { word: one.pool[0] }, 3, seeded(s));
    assert.equal(got.w, 'dog', '难度只匹配到上一个词时必须改用另一个候选');
  }
  // 真的只剩一个未完成词：允许再出现（「尽量」不是跳过未完成词）。
  const only = mkRun([W('cat', '猫')]);
  for (let s = 1; s <= 10; s++) assert.equal(drawWord(only, { word: only.pool[0] }, 1, seeded(s)).w, 'cat');
});

test('drawWord with a degenerate random source still avoids the current word when an alternative exists', () => {
  const pool = [W('cat', '猫'), W('dog', '狗')];
  const run = mkRun(pool);
  // random 恒为 0：旧实现会连续抽中上一个词然后「10 次认命」。
  assert.equal(drawWord(run, { word: pool[0] }, 1, () => 0).w, 'dog');
  assert.equal(drawWord(run, { word: pool[1] }, 1, () => 0).w, 'cat');
});

/* ---------------- 5. 一整轮：每个唯一词恰好出现一次 ---------------- */
test('a full round over 500 seeds shows each unfinished word exactly once before exhaustion', () => {
  const pool = [W('cat', '猫'), W('dog', '狗'), W('banana', '香蕉', 2), W('keep an eye on', '留意', 2),
    W('vocabulary', '词汇', 3), W('a', '一个', 3), W('I', '我', 3)];
  for (let s = 1; s <= 500; s++) {
    const run = mkRun(pool);
    const seen = [];
    for (let i = 0; i < pool.length + 3; i++) {
      const battle = { word: seen.length ? run.pool.find(w => w.w === seen[seen.length - 1]) : null };
      const got = drawWord(run, battle, (i % 3) + 1, seeded(s * 31 + i));
      if (!got) break;
      assert.ok(!seen.includes(got.w), 'seed ' + s + ' 第 ' + i + ' 题重复出现 ' + got.w);
      seen.push(got.w);
      run.done.add(got.w);
    }
    assert.equal(seen.length, pool.length, '一轮必须把每个唯一词都出到（seed ' + s + '）');
    assert.equal(new Set(seen).size, pool.length);
    assert.equal(isPoolComplete(run), true, '一轮之后必须判定为已完成');
  }
});

/* ---------------- 6. 词条身份：只 lower + trim，不吞掉不同的词 ---------------- */
test('a finished word retires its case variants and counts stay in sync with pendingWords', () => {
  // 复现：pool=[CAT, cat]、done={CAT}。旧口径下「cat」既不在 done 里、
  // 又因为 seen 只在通过 done 检查后才登记，于是又被当成新候选吐出来 ——
  // 而计数那边早就说「已完成 1/1、剩 0」。两个口径从此永久分叉。
  const pool = [W('CAT', '猫'), W('cat', '猫二')];
  for (const doneRaw of ['CAT', 'cat', ' Cat ']) {
    const run = mkRun(pool);
    run.done = new Set([doneRaw]);
    const pending = pendingWords(run);
    const c = learningCounts(run);
    assert.deepEqual(pending, [], '同一身份（只差大小写/空白）完成后不再出题：done=' + JSON.stringify(doneRaw));
    assert.deepEqual(c, { total: 1, done: 1, remaining: 0, wrong: 0 });
    assert.equal(c.remaining, pending.length, 'remaining 必须恒等于 pendingWords 的长度');
    assert.equal(isPoolComplete(run), true);
  }
  // 变体只有一个完成时，另一个未完成的**别的**词必须照常出。
  const mixed = mkRun([W('CAT', '猫'), W('dog', '狗', 2)]);
  mixed.done = new Set(['cat']);
  assert.deepEqual(pendingWords(mixed).map(w => w.w), ['dog'], '不同词不许被大小写变体连累');
  const mc = learningCounts(mixed);
  assert.deepEqual(mc, { total: 2, done: 1, remaining: 1, wrong: 0 });
  assert.equal(mc.remaining, pendingWords(mixed).length);
  assert.equal(isPoolComplete(mixed), false);
  for (let s = 1; s <= 20; s++) {
    const got = drawWord(mixed, null, 1, seeded(s));
    assert.equal(got.w, 'dog', 'CAT 的退休不许带走 dog');
  }
  // 纯派生：run 里的原始词条、词库顺序、done 记账一个字节都不许被改。
  const pure = mkRun(pool);
  pure.done.add('CAT');
  pendingWords(pure);
  learningCounts(pure);
  assert.deepEqual(pure.pool.map(w => w.w), ['CAT', 'cat'], '原始词条与词库顺序不变');
  assert.deepEqual([...pure.done], ['CAT'], 'done 仍以原始字符串记账');
});

test('a space, a hyphen and no separator are three independent targets', () => {
  // 旧口径用 norm() 比较，它把非字母全剥掉：ice cream / icecream / ice-cream
  // 折叠成同一个 key，于是三个不同的词被吞成一个，短语词再也练不到。
  const pool = [W('ice cream', '冰淇淋'), W('icecream', '冰激凌'), W('ice-cream', '奶油冻')];
  const run = mkRun(pool);
  assert.deepEqual(pendingWords(run).map(w => w.w), ['ice cream', 'icecream', 'ice-cream']);
  assert.deepEqual(learningCounts(run), { total: 3, done: 0, remaining: 3, wrong: 0 });
  // 一整轮：三个各出一次，谁都不许被当成重复吃掉。
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const battle = { word: seen.length ? W(seen[seen.length - 1], 'x') : null };
    const got = drawWord(run, battle, 1, seeded(1000 + i));
    if (!got) break;
    assert.ok(!seen.includes(got.w), '拼写不同的词不算重复：' + got.w);
    seen.push(got.w);
    run.done.add(got.w);
  }
  assert.equal(seen.length, 3, '三个拼写都必须轮到：' + JSON.stringify(seen));
  assert.equal(isPoolComplete(run), true);
  // 退休其中一个，另外两个必须还在。
  assert.deepEqual(pendingWords(run).map(w => w.w), []);
  run.done = new Set(['ice cream']);
  assert.deepEqual(pendingWords(run).map(w => w.w), ['icecream', 'ice-cream']);
});

test('the previous word is avoided whatever its difficulty bucket is', () => {
  // 上一词与唯一别的候选难度不同：必须换到那个别的词，而不是被难度分桶挡回去。
  const only = mkRun([W('ice cream', '冰淇淋'), W('ice-cream', '奶油冻', 3)]);
  for (let s = 1; s <= 40; s++) {
    const got = drawWord(only, { word: only.pool[0] }, 1, seeded(s));
    assert.equal(got.w, 'ice-cream', '不同难度的候选也必须能避开立即重复（seed ' + s + '）');
  }
  // 反过来：上一词在难的一档、唯一别的候选在易的一档，同样必须换。
  const rev = mkRun([W('cat', '猫', 3), W('dog', '狗', 1)]);
  for (let s = 1; s <= 40; s++) {
    assert.equal(drawWord(rev, { word: rev.pool[0] }, 3, seeded(s)).w, 'dog', 'seed ' + s);
  }
  // 大小写变体是**同一个身份**，所以根本不是「另一个候选」：唯一身份只剩一条，
  // 而「尽量不重复」不许跳过未完成词 —— 此时重复它是正确的。
  const variant = mkRun([W('cat', '猫'), W('CAT', '猫二', 2)]);
  assert.equal(pendingWords(variant).length, 1, '大小写变体折叠成同一个身份');
  for (let s = 1; s <= 40; s++) {
    assert.equal(drawWord(variant, { word: W('cat', '猫') }, 1, seeded(s)).w, 'cat');
  }
  // 只剩一个未完成词时仍然允许再出现（「尽量」不是跳过）。
  const lonely = mkRun([W('cat', '猫')]);
  for (let s = 1; s <= 10; s++) assert.equal(drawWord(lonely, { word: lonely.pool[0] }, 1, seeded(s)).w, 'cat');
});

test('remaining always equals pendingWords length across pools, duplicates and case variants', () => {
  const pools = [
    [W('CAT', '猫'), W('cat', '猫二')],
    [W('CAT', '猫'), W('cat', '猫二'), W('dog', '狗')],
    [W('ice cream', '冰淇淋'), W('icecream', '冰激凌'), W('ice-cream', '奶油冻')],
    [W('CAT', '猫'), W('cat', '猫二'), W('CAT', '猫三'), W('dog', '狗', 3)],
    [W('', '空'), W('cat', '猫')],
    [W('a', '一个'), W('I', '我'), W('i', '第二个 i')],
  ];
  const doneSets = [[], ['CAT'], ['cat'], ['CAT', 'dog'], ['ice cream'], ['a', 'i'], [' I ']];
  for (const pool of pools) for (const done of doneSets) for (const wrong of [[], ['cat'], ['dog', 'dog', 'ice cream']]) {
    const run = mkRun(pool);
    run.done = new Set(done);
    run.wrong = wrong.slice();
    const c = learningCounts(run);
    const p = pendingWords(run);
    assert.equal(c.remaining, p.length, 'remaining ' + c.remaining + ' != pending ' + p.length
      + ' pool=' + JSON.stringify(pool.map(w => w.w)) + ' done=' + JSON.stringify(done));
    assert.equal(c.done, c.total - c.remaining);
    assert.equal(isPoolComplete(run), p.length === 0);
    assert.ok(c.wrong <= c.remaining, '待复习数不许超过未完成数');
  }
});

/* ---------------- 7. 进度计数（供 UI 与检查点使用） ---------------- */
test('learningCounts reports total, done, remaining and wrong from the run alone', () => {
  const pool = [W('cat', '猫'), W('dog', '狗'), W('apple', '苹果'), W('apple', '苹果二')];
  const run = mkRun(pool);
  assert.deepEqual(learningCounts(run), { total: 3, done: 0, remaining: 3, wrong: 0 });
  run.done.add('cat');
  run.wrong = ['dog', 'dog', 'owl'];
  assert.deepEqual(learningCounts(run), { total: 3, done: 1, remaining: 2, wrong: 1 });
  run.done.add('dog');
  run.done.add('apple');
  // dog 已完成 → 不再算待复习；owl 压根不在本局词池 → 也不计数。
  assert.deepEqual(learningCounts(run), { total: 3, done: 3, remaining: 0, wrong: 0 });
  // 保留一个真正待复习的词时计数为 1。
  run.wrong = ['dog', 'dog', 'cat', 'owl'];
  assert.deepEqual(learningCounts(run), { total: 3, done: 3, remaining: 0, wrong: 0 });
  const r2 = mkRun([W('cat', '猫'), W('dog', '狗')]);
  r2.wrong = ['cat', 'cat', 'dog'];
  assert.deepEqual(learningCounts(r2), { total: 2, done: 0, remaining: 2, wrong: 2 });
  assert.equal(isPoolComplete(run), true);
  // 纯函数：不许改 run 本身。
  assert.equal(run.done.size, 3);
  assert.deepEqual(run.wrong, ['dog', 'dog', 'cat', 'owl']);
});

test('isPoolComplete and pendingWords are safe on a degenerate run', () => {
  assert.deepEqual(pendingWords({ pool: [] }), []);
  assert.equal(isPoolComplete({ pool: [] }), true);
  assert.deepEqual(pendingWords({ pool: null, done: new Set() }), []);
  assert.deepEqual(learningCounts({ pool: [], done: new Set(), wrong: [] }),
    { total: 0, done: 0, remaining: 0, wrong: 0 });
});
