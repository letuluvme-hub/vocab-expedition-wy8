// 纯规则提取的回归测试：领域模块 vs runtime.js 里的旧实现逐字对照。
// 这里的 legacy* 函数是从 runtime.js 抄下来的参照物（只把 G/B 换成参数、
// rnd/pick/shuffle 换成注入的 random），不是新的行为来源。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../../src/domain/map.js';
import { drawWord } from '../../src/domain/word-selection.js';
import { drawLetters } from '../../src/domain/letter-bank.js';
import { bankCols, bankRows, bankPosOf } from '../../src/domain/letter-bank.js';
import { createRun, advanceRun, finishBattleNode, endRunProgress } from '../../src/domain/run.js';
import { clamp } from '../../src/domain/math.js';
import { norm } from '../../src/domain/text.js';

/* ---------- 确定性随机源：两条实现必须消费同一串随机数 ---------- */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- legacy 参照实现（runtime.js:591-670 buildMap） ---------- */
const MAP_EARLY_MAX = 2;
function legacyGenerateMap(random) {
  const rnd = n => Math.floor(random() * n);
  const pick = a => a[rnd(a.length)];
  const rows = []; const ROWS = 9;
  for (let r = 0; r < ROWS; r++) {
    const isBoss = r === ROWS - 1;
    const isPreBoss = r === ROWS - 2;
    let cnt;
    if (isBoss) cnt = 1;
    else if (r === 0) cnt = 3;
    else cnt = 2 + rnd(2);
    let plan = null;
    if (isPreBoss) {
      const extra = pick(['battle', 'battle', 'event', 'elite']);
      if (cnt >= 3) plan = rnd(2) ? ['rest', 'shop', extra] : [extra, 'shop', 'rest'];
      else plan = rnd(2) ? ['rest', 'shop'] : ['shop', 'rest'];
    }
    const row = [];
    for (let c = 0; c < cnt; c++) {
      let type;
      if (isBoss) type = 'boss';
      else if (r === 0) type = rnd(2) ? 'battle' : pick(['event', 'rest']);
      else if (isPreBoss) type = plan[c];
      else if (r <= MAP_EARLY_MAX) {
        const roll = random();
        type = roll < 0.52 ? 'battle' : roll < 0.68 ? 'event' : roll < 0.92 ? 'rest' : 'elite';
      } else {
        const roll = random();
        type = roll < 0.50 ? 'battle' : roll < 0.66 ? 'event' : roll < 0.80 ? 'rest' : roll < 0.92 ? 'shop' : 'elite';
      }
      row.push({ type, x: (c + 0.5) / cnt, row: r, done: false, links: [] });
    }
    rows.push(row);
  }
  const DX_DIRECT = 0.34, DX_NEAR = 0.60, P_NEAR = 0.45;
  const hash2 = (a, b) => { let h = (a * 73856093) ^ (b * 19349663);
    h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 };
  const key = n => n.row * 131 + Math.round(n.x * 1000);
  for (let r = 0; r < ROWS - 1; r++) {
    const cur = rows[r], nxt = rows[r + 1];
    cur.forEach(n => {
      nxt.forEach(m => {
        const dx = Math.abs(n.x - m.x);
        if (dx <= DX_DIRECT) n.links.push(m);
        else if (dx <= DX_NEAR && hash2(key(n), key(m)) < P_NEAR) n.links.push(m);
      });
      if (!n.links.length) {
        let best = nxt[0];
        nxt.forEach(m => { if (Math.abs(m.x - n.x) < Math.abs(best.x - n.x)) best = m });
        n.links.push(best);
      }
    });
    nxt.forEach(m => {
      if (cur.some(n => n.links.indexOf(m) >= 0)) return;
      let best = cur[0];
      cur.forEach(n => { if (Math.abs(n.x - m.x) < Math.abs(best.x - m.x)) best = n });
      best.links.push(m);
    });
  }
  return rows;
}

/* ---------- legacy 参照实现（runtime.js:847-891 drawWord / drawLetters） ---------- */
function legacyDrawWord(run, battle, budget, random) {
  const rnd = n => Math.floor(random() * n);
  const pick = a => a[rnd(a.length)];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  let pool = run.pool.filter(w => !run.done.has(w.w));
  if (pool.length < 3) pool = run.pool.slice();
  const due = run.wrong.map(w => pool.filter(x => x.w === w)[0]).filter(Boolean);
  const fresh = pool.filter(w => due.indexOf(w) < 0);
  if (due.length && fresh.length) {
    const fromDue = Math.min(due.length, 1 + Math.floor(due.length / 2));
    const fromFresh = Math.min(fresh.length, 1 + Math.floor(fresh.length / 2));
    pool = shuffle(due).slice(0, fromDue).concat(shuffle(fresh).slice(0, fromFresh));
  } else {
    pool = shuffle(pool);
  }
  const exact = pool.filter(w => w.d === budget);
  const harder = pool.filter(w => w.d > budget);
  const softer = pool.filter(w => w.d < budget);
  let src = exact;
  if (src.length < 3) src = src.concat(harder);
  if (src.length < 3) src = src.concat(softer);
  if (!src.length) src = pool;
  for (let i = 0; i < 10; i++) { const c = pick(src); if (!battle || !battle.word || c.w !== battle.word.w) return c; }
  return pick(src);
}
function legacyDrawLetters(run, battle, qword, random) {
  const rnd = n => Math.floor(random() * n);
  const pick = a => a[rnd(a.length)];
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const letters = norm(qword.w).split('');
  const cnt = {}; letters.forEach(ch => cnt[ch] = (cnt[ch] || 0) + 1);
  const uniq = [];
  Object.keys(cnt).forEach(ch => { for (let i = 0; i < cnt[ch]; i++) uniq.push(ch); });
  const noise = clamp(3 + Math.floor(run.floor / 2) + (battle && battle.elite ? 3 : 0) + (run.hnoise || 0), 2, 10);
  const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('');
  for (let i = 0; i < noise; i++) {
    let ch = pick(ALPHA), guard = 0;
    while (uniq.indexOf(ch) >= 0 && guard++ < 20) ch = pick(ALPHA);
    if (uniq.indexOf(ch) < 0) uniq.push(ch);
  }
  return { letters: shuffle(uniq), used: new Array(uniq.length).fill(false) };
}

/* ---------- 夹具 ---------- */
const WORDS = [
  { u: 1, d: 1, w: 'cat', z: '猫' }, { u: 1, d: 1, w: 'dog', z: '狗' },
  { u: 1, d: 1, w: 'apple', z: '苹果' }, { u: 1, d: 2, w: 'banana', z: '香蕉' },
  { u: 1, d: 2, w: 'keep an eye on', z: '留意' }, { u: 1, d: 2, w: 'super-speed', z: '超速' },
  { u: 1, d: 3, w: 'vocabulary', z: '词汇' }, { u: 1, d: 3, w: 'expedition', z: '远征' },
  { u: 1, d: 3, w: 'a', z: '一个' }, { u: 1, d: 3, w: 'I', z: '我' },
];
const HERO = { id: 'heroine', mod: { hp: 10, shield: 0, gold: 5, hint: 1, noise: 0, combo: 1, regen: 2, leech: 0 } };
const mkDb = () => ({ runs: 1, wins: 0, mastered: [], best: 0, custom: [], rewards: [] });

/* ================= 地图 ================= */
// 2026-10 节点分布改版（docs/feature-word-choice.md 第三节）是**有意漂移**：只改了类型阈值，
// 随机调用次数与顺序不变 —— 所以几何（行宽、x、连线）仍与旧版逐点一致，只有 type 会变。
const shape = rows => rows.map(row => row.map(n => ({ x: n.x, row: n.row, done: n.done,
  links: n.links.map(m => m.row + ':' + m.x) })));
test('generateMap matches legacy buildMap geometry node-for-node across many seeds', () => {
  for (let s = 1; s <= 40; s++) {
    assert.deepEqual(shape(generateMap(seeded(s))), shape(legacyGenerateMap(seeded(s))), 'seed ' + s);
  }
});

test('generateMap: row 0 never has a campfire and campfires are rarer than before', () => {
  let rest = 0, all = 0, oldRest = 0, oldAll = 0, battles = 0, oldBattles = 0;
  for (let s = 1; s <= 3000; s++) {
    const rows = generateMap(seeded(s));
    assert.equal(rows[0].some(n => n.type === 'rest'), false, 'seed ' + s + ' row 0 has rest');
    for (const row of rows) for (const n of row) { all++; if (n.type === 'rest') rest++; if (n.type === 'battle') battles++; }
    for (const row of legacyGenerateMap(seeded(s))) for (const n of row) {
      oldAll++; if (n.type === 'rest') oldRest++; if (n.type === 'battle') oldBattles++;
    }
  }
  assert.ok(rest / all < 0.14, 'rest share ' + (rest / all).toFixed(3));
  assert.ok(rest / all < oldRest / oldAll - 0.05, '营火必须明显少于旧版');
  assert.ok(battles / all > oldBattles / oldAll, '普通战斗占比上升');
});

test('generateMap keeps the row skeleton, boss row and pre-boss supply row', () => {
  const rows = generateMap(seeded(7));
  assert.equal(rows.length, 9);
  assert.equal(rows[0].length, 3, 'r=0 fixed 3 nodes');
  assert.equal(rows[8].length, 1, 'boss row has exactly one node');
  assert.equal(rows[8][0].type, 'boss');
  for (const r of [1, 2, 3, 4, 5, 6, 7]) assert.ok(rows[r].length === 2 || rows[r].length === 3, 'row ' + r);
  const pre = rows[7].map(n => n.type);
  assert.ok(pre.includes('rest') && pre.includes('shop'), 'pre-boss row has rest+shop: ' + pre);
  for (const row of rows) for (const n of row) {
    assert.equal(n.done, false);
    assert.equal(n.row, rows.indexOf(row));
    assert.equal(n.x, (row.indexOf(n) + 0.5) / row.length);
  }
  assert.equal(rows[0].some(n => n.type === 'shop'), false, 'row 0 has no shop');
});

test('generateMap never leaves a node unreachable and never leaves a dead end', () => {
  for (let s = 1; s <= 30; s++) {
    const rows = generateMap(seeded(s));
    for (let r = 0; r < rows.length - 1; r++) {
      for (const n of rows[r]) assert.ok(n.links.length > 0, 'outgoing ' + s + '/' + r);
      for (const m of rows[r + 1]) {
        assert.ok(rows[r].some(n => n.links.indexOf(m) >= 0), 'incoming ' + s + '/' + r);
      }
      for (const n of rows[r]) for (const m of n.links) assert.ok(m.row === r + 1, 'links only go downward');
    }
  }
});

test('generateMap fallback links are structurally unreachable (rows are 2-3 wide)', () => {
  // 记录事实而非行为：行宽只有 2~3，任意相邻两层之间必有 dx<=0.6 的候选，
  // 所以旧 buildMap 里的兜底出边/兜底入边在这套几何下不会触发。
  // 这解释了「删掉兜底分支」这类变异不会让测试变红 —— 那段是死代码，不是漏测。
  let needOut = 0, needIn = 0;
  for (let s = 1; s <= 500; s++) {
    const rows = generateMap(seeded(s));
    for (let r = 0; r < rows.length - 1; r++) {
      const cur = rows[r], nxt = rows[r + 1];
      for (const n of cur) if (!nxt.some(m => Math.abs(n.x - m.x) <= 0.60)) needOut++;
      for (const m of nxt) if (!cur.some(n => n.links.indexOf(m) >= 0)) needIn++;
    }
  }
  assert.equal(needOut, 0);
  assert.equal(needIn, 0);
});

test('generateMap is a pure function of the injected random source', () => {
  const a = generateMap(seeded(99));
  const b = generateMap(seeded(99));
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateMap(seeded(99)), generateMap(seeded(100)));
});

/* ================= 抽词 =================
 * ★ 本功能有意改变了 drawWord 的三处行为，所以下面的「与 legacy 逐字一致」
 *   **不再是**整段成立。旧参照实现原样留在这里当基线，新断言精确写清
 *   「哪里必须一致、哪里必须分叉」，而不是把整段对比删掉 ——
 *   删掉的话，地图/字母盘/远征状态那些仍然逐字一致的部分也一并失去保护。
 *
 *   有意分叉的三处（docs/feature-word-queue.md）：
 *     A) 剩余不足 3 个时不再回灌整池（旧：`if(pool.length<3) pool=run.pool`）
 *     B) 词池穷尽时返回 null（旧：回灌整池，于是永远「打不完」）
 *     C) 避免重复从「随机试 10 次后认命」改成「先剔除上一词再抽」
 *   仍然逐字一致的部分：done 过滤、错词配额（1+floor(n/2)）、难度 exact→harder→softer、
 *   以及候选足够大时的抽词结果。 */

/* 这些组合下新旧实现必须仍逐字一致：剩余候选 >= 3、无上一词。
 * 覆盖 done 过滤、错词占多数、due 配额收缩、难度 exact 命中。 */
const PARITY_CASES = [
  { done: [], wrong: [] },
  { done: ['cat'], wrong: [] },
  { done: ['cat', 'dog'], wrong: [] },
  { done: ['cat', 'dog', 'apple'], wrong: [] },
  { done: [], wrong: ['vocabulary'] },
  { done: [], wrong: ['vocabulary', 'expedition'] },
  { done: ['cat'], wrong: ['vocabulary', 'expedition', 'banana'] },
];
test('drawWord matches legacy drawWord on identical random streams where the rule is unchanged', () => {
  let compared = 0;
  for (const c of PARITY_CASES) for (const budget of [1, 2, 3]) for (let s = 1; s <= 12; s++) {
    const mk = () => { const r = createRun(1, HERO, WORDS); r.done = new Set(c.done); r.wrong = c.wrong.slice(); return r; };
    const a = drawWord(mk(), null, budget, seeded(s * 7 + budget));
    const b = legacyDrawWord(mk(), null, budget, seeded(s * 7 + budget));
    assert.equal(a.w, b.w, 'case ' + JSON.stringify(c) + ' budget ' + budget + ' seed ' + s);
    assert.equal(a.d, b.d);
    compared++;
  }
  assert.equal(compared, PARITY_CASES.length * 3 * 12);
  // ★ 带 battle（上一个词）时**不再**逐字一致，所以不放进这条对比：
  //   旧实现「抽到就重试、最多 10 次」会额外消费随机数，新实现「先剔除再抽」不消费。
  //   同一个 seeded 源下两条路会走到不同位置 —— 这是 C 项的必然结果，
  //   下面的 diverge 用例精确锁定它，而不是假装一致。
});

test('drawWord with a battle word still filters it out and the legacy retry loop does not', () => {
  // 基线事实：旧实现为了躲上一个词会重抽，于是随机流被额外消费，
  // 与「先剔除再抽」的新实现在同一种子上给出不同的词。
  let diffs = 0;
  for (let s = 1; s <= 20; s++) {
    const mk = () => { const r = createRun(1, HERO, WORDS); r.wrong = ['vocabulary']; return r; };
    const battle = { word: s % 2 ? WORDS[0] : WORDS[7] };
    if (drawWord(mk(), battle, 1, seeded(s)).w !== legacyDrawWord(mk(), battle, 1, seeded(s)).w) diffs++;
  }
  assert.ok(diffs > 0, '基线事实：两条路在同一种子上确实会分叉（否则这条断言是假的）');
});

test('drawWord deliberately diverges from legacy exactly where the queue rule changed', () => {
  // A) 小词池不再回灌整池。旧实现在剩余 2 个时会回灌整池，于是可能抽到已完成的词。
  const small = [
    { u: 1, d: 1, w: 'cat', z: '' }, { u: 1, d: 2, w: 'dog', z: '' }, { u: 1, d: 3, w: 'owl', z: '' },
  ];
  let legacyLeaks = 0, newLeaks = 0, nulls = 0;
  for (const done of [['cat'], ['cat', 'dog']]) for (const budget of [1, 2, 3]) for (let s = 1; s <= 8; s++) {
    const mk = () => { const r = createRun(1, HERO, small); r.done = new Set(done); return r; };
    const now = drawWord(mk(), null, budget, seeded(s * 3 + budget));
    const old = legacyDrawWord(mk(), null, budget, seeded(s * 3 + budget));
    if (now && done.includes(now.w)) newLeaks++;
    if (old && done.includes(old.w)) legacyLeaks++;
    assert.ok(now, '仍有未完成词时必须给出词');
  }
  assert.equal(newLeaks, 0, '新版绝不许返回已完成的词');
  assert.ok(legacyLeaks > 0, '基线事实：旧实现在小词池上确实会回灌已完成的词（否则这条断言是假的）');

  // B) 穷尽时新版返回 null，旧实现回灌整池给出一个词。
  const exhausted = ['cat', 'dog', 'owl'];
  for (let budget = 1; budget <= 3; budget++) for (let s = 1; s <= 8; s++) {
    const mk = () => { const r = createRun(1, HERO, small); r.done = new Set(exhausted); return r; };
    assert.equal(drawWord(mk(), null, budget, seeded(s * 11 + budget)), null, '穷尽返回 null');
    assert.ok(legacyDrawWord(mk(), null, budget, seeded(s * 11 + budget)), '基线事实：旧实现永远给得出词');
  }

  // C) 10 次认命 → 先剔除。恒定随机源下旧实现必然重复。
  // random 恒为 0.999 ⇒ rnd(n)=n-1 ⇒ pick 恒取最后一个；shuffle 因此不换位。
  // 战斗词正好是最后一个 ⇒ 旧实现 10 次都抽中它，只能「认命」重复。
  const hi = () => 0.999;
  const pair = createRun(1, HERO, [
    { u: 1, d: 1, w: 'cat', z: '' }, { u: 1, d: 1, w: 'dog', z: '' },
  ]);
  assert.equal(drawWord(pair, { word: pair.pool[1] }, 1, hi).w, 'cat', '新版剔除后抽另一个');
  assert.equal(legacyDrawWord(pair, { word: pair.pool[1] }, 1, hi).w, 'dog', '基线事实：旧实现 10 次认命后重复');
  // 极值随机源 0：旧实现重复 cat（第一个），新版仍抽另一个。
  assert.equal(drawWord(pair, { word: pair.pool[0] }, 1, () => 0).w, 'dog', '新版在 random=0 下也不重复');
  assert.equal(legacyDrawWord(pair, { word: pair.pool[0] }, 1, () => 0).w, 'dog');
});


test('drawWord prefers exact difficulty, skips answered words and reviews wrong ones first', () => {
  const run = createRun(1, HERO, WORDS);


  const w2 = createRun(1, HERO, WORDS);
  const done = new Set(['cat', 'dog']);
  w2.done = new Set(done);
  const picked = drawWord(w2, null, 1, seeded(5));
  assert.ok(['cat', 'dog'].indexOf(picked.w) < 0 || w2.pool.length - done.size < 3,
    'only returns an answered word when the remaining pool is too small');

  const w3 = createRun(1, HERO, WORDS);
  w3.wrong = ['vocabulary', 'expedition'];
  const duePick = drawWord(w3, null, 3, seeded(3));
  assert.ok(['vocabulary', 'expedition'].indexOf(duePick.w) >= 0, 'wrong words are review priority');

  // 复习词配额 = 1+floor(due/2)：due=3 时只能取 2 个进候选池，第 3 个不能进。
  // 靠「与 legacy 逐字一致」锁住配额：把 fromDue 改成 due.length 就会分叉。
  for (let s = 1; s <= 30; s++) {
    const mk = () => { const r = createRun(1, HERO, WORDS); r.done = new Set(['cat']); r.wrong = ['vocabulary', 'expedition', 'banana']; return r; };
    const a = drawWord(mk(), null, 3, seeded(s));
    const b = legacyDrawWord(mk(), null, 3, seeded(s));
    assert.equal(a.w, b.w, 'due quota seed ' + s);
  }

  // exact 池恰好 2 个时旧规则会补 harder（<3 才放宽），所以 d 可以上浮但不会低于 budget
  const two = createRun(1, HERO, WORDS);
  two.done = new Set(['cat']);
  const w = drawWord(two, null, 1, seeded(9));
  assert.ok(w.d >= 1, 'never easier than budget');
});

test('drawWord avoids repeating the current battle word and falls back after 10 tries', () => {
  const run = createRun(1, HERO, WORDS);
  const battle = { word: WORDS[0] };
  assert.notEqual(drawWord(run, battle, 1, seeded(11)).w, 'cat');
  const onlyOne = createRun(1, { id: 'x', mod: {} }, [WORDS[0]]);
  assert.equal(drawWord(onlyOne, battle, 1, seeded(11)).w, 'cat', 'falls back instead of looping');
});

/* ================= 字母盘 ================= */
test('drawLetters matches legacy drawLetters and keeps the elite read at the old moment', () => {
  for (let s = 1; s <= 40; s++) {
    for (const elite of [false, true]) {
      const run = createRun(1, HERO, WORDS);
      const battle = { elite };
      const a = drawLetters(run, battle, WORDS[6], seeded(s));
      const b = legacyDrawLetters(run, battle, WORDS[6], seeded(s));
      assert.deepEqual(a.letters, b.letters, 'seed ' + s + ' elite ' + elite);
      assert.deepEqual(a.used, b.used);
    }
  }
});

test('drawLetters answers contain every target letter and no distractor repeats a target', () => {
  const run = createRun(1, HERO, WORDS);
  const q = { w: 'keep an eye on' };
  const { letters, used } = drawLetters(run, { elite: false }, q, seeded(21));
  const target = norm(q.w);
  for (const ch of target) assert.ok(letters.includes(ch), 'missing ' + ch);
  assert.equal(used.length, letters.length);
  assert.ok(used.every(u => u === false));
  const extra = letters.filter(ch => target.indexOf(ch) < 0);
  assert.equal(new Set(extra).size, extra.length, 'distractors are unique');
  assert.ok(letters.length <= target.length + 10, 'noise is capped at 10');
});

test('drawLetters noise count follows floor, elite bonus and hero noise', () => {
  const q = { w: 'abc' };
  const base = createRun(1, { id: 'x', mod: {} }, WORDS);
  base.floor = 1;
  const count = run => drawLetters(run, { elite: false }, q, seeded(4)).letters.length - 3;
  assert.equal(count(base), 3, 'floor 1 -> 3 distractors');
  base.floor = 4;
  assert.equal(count(base), 5, 'floor 4 -> 3 + 2');
  const elite = drawLetters(base, { elite: true }, q, seeded(4)).letters.length - 3;
  assert.equal(elite, 8, 'elite adds 3');
  const explorer = createRun(1, { id: 'x', mod: { noise: -1 } }, WORDS);
  explorer.floor = 1;
  assert.equal(count(explorer), 2, 'explorer hnoise -1');
  const deep = createRun(1, { id: 'x', mod: {} }, WORDS);
  deep.floor = 40;
  assert.equal(count(deep), 10, 'capped at 10 distractors, not unbounded with floor');
  const deepElite = createRun(1, { id: 'x', mod: {} }, WORDS);
  deepElite.floor = 40;
  assert.equal(drawLetters(deepElite, { elite: true }, q, seeded(4)).letters.length - 3, 10, 'elite does not lift the cap');
  assert.equal(count(createRun(1, { id: 'x', mod: {} }, WORDS)), 3, 'floor 1 default');
});

/* ================= 布局 ================= */
test('bankCols keeps the legacy breakpoints', () => {
  assert.deepEqual([1, 6, 7, 9, 10, 12, 13, 16, 17, 30].map(bankCols), [3, 3, 4, 4, 4, 4, 5, 5, 6, 6]);
});

test('bankRows in grid mode keeps the original row-major order', () => {
  assert.deepEqual(bankRows('abcdefgh'.split(''), false), [[0, 1, 2, 3], [4, 5, 6, 7]], '8 letters -> 4 cols');
  assert.deepEqual(bankRows('abcdefghi'.split(''), false), [[0, 1, 2, 3], [4, 5, 6, 7], [8]], '9 letters -> 4 cols, last row short');
  assert.deepEqual(bankRows('abcde'.split(''), false), [[0, 1, 2], [3, 4]], '5 letters -> 3 cols');
  assert.deepEqual(bankRows('ab'.split(''), false), [[0, 1]]);
});

test('bankRows in kb mode buckets by QWERTY row and drops empty rows', () => {
  // q,p 在键盘第 1 行；a,l 在第 2 行；z 在第 3 行
  const letters = 'qazpl'.split('');
  assert.deepEqual(bankRows(letters, true), [[0, 3], [1, 4], [2]]);
  assert.deepEqual(bankRows('az'.split(''), true), [[0], [1]], 'empty middle keyboard row is not rendered');
  // 同一键盘行内按键盘列排序：p(col9) 出现在 e(col2) 之前时也要排成 e,p
  assert.deepEqual(bankRows('pe'.split(''), true), [[1, 0]]);
  assert.deepEqual(bankRows('lkj'.split(''), true), [[2, 1, 0]], 'asdf row: l(8) k(7) j(6)');
  assert.deepEqual(bankRows(['q'], true), [[0]]);
  assert.deepEqual(bankRows(['!'], true), [[0]], 'unknown chars still render one row');
});

test('bankPosOf reports the visual position or null', () => {
  const letters = 'qazpl'.split('');
  assert.deepEqual(bankPosOf(letters, true, 0), { row: 0, col: 0, rows: 3 });
  assert.deepEqual(bankPosOf(letters, true, 1), { row: 1, col: 0, rows: 3 });
  assert.deepEqual(bankPosOf(letters, true, 4), { row: 1, col: 1, rows: 3 });
  assert.deepEqual(bankPosOf('qp'.split(''), true, 1), { row: 0, col: 1, rows: 1 }, 'middle empty row is skipped');
  assert.equal(bankPosOf(letters, true, 9), null);
  assert.deepEqual(bankPosOf('abcde'.split(''), false, 4), { row: 1, col: 1, rows: 2 });
  assert.deepEqual(bankPosOf('abcde'.split(''), false, 0), { row: 0, col: 0, rows: 2 });
});

/* ================= 远征状态 ================= */
test('createRun reproduces the legacy newRun object, including starter bag and done Set', () => {
  const run = createRun(1, HERO, WORDS);
  assert.equal(run.unit, 1);
  assert.equal(run.maxhp, 80);
  assert.equal(run.hp, 80);
  assert.equal(run.gold, 5);
  assert.equal(run.hm, 1);
  assert.equal(run.hregen, 2);
  assert.equal(run.floor, 1);
  assert.equal(run.maxFloor, 1);
  assert.equal(run.kills, 0);
  assert.equal(run.att, 0);
  assert.equal(run.attOk, 0);
  assert.equal(run.relics.length, 0);
  assert.equal(run.shield, 0);
  assert.equal(run.skipFree, false);
  assert.equal(run.heroId, 'heroine');
  assert.equal(run.node, null);
  assert.equal(run.cur, null);
  assert.equal(run.pending, null);
  assert.deepEqual(run.bag, { leech: 2 });
  assert.ok(run.done instanceof Set);
  assert.deepEqual(run.wrong, []);
  assert.deepEqual(run.history, []);
  assert.deepEqual(run.pool, WORDS);
  assert.notEqual(run.pool, WORDS, 'pool is a copy');
  assert.equal(run.avail.length, 3, 'first row is selectable');
  assert.equal(run.rows.length, 9);
  const bare = createRun(3, { id: 'h2' }, []);
  assert.equal(bare.maxhp, 70, 'no mod means base 70 hp');
  assert.equal(bare.hcombo, 1, 'combo defaults to 1');
});

test('advanceRun increments floor, moves to the next links and reports map', () => {
  const run = createRun(1, HERO, WORDS);
  const first = run.avail[0];
  run.node = first;
  const r = advanceRun(run, 1000);
  assert.equal(r, 'map');
  assert.equal(run.floor, 2);
  assert.equal(run.maxFloor, 2);
  assert.equal(run.cur, first);
  assert.deepEqual(run.avail, first.links);
  assert.notEqual(run.avail, first.links, 'avail is a copy of links');
  run.hp = 3;
  assert.equal(advanceRun(run, 1500), 'map');
  assert.equal(run.hp, 3, 'hp only clamped from below, not healed');
  run.hp = -5;
  advanceRun(run, 2000);
  assert.equal(run.hp, 1, 'hp never drops to 0 or below');
});

test('advanceRun double-click inside 400ms is locked and the window then expires', () => {
  const run = createRun(1, HERO, WORDS);
  run.node = run.avail[0];
  assert.equal(advanceRun(run, 10000), 'map');
  const floor = run.floor;
  assert.equal(advanceRun(run, 10000 + 399), 'locked');
  assert.equal(run.floor, floor, 'a locked call changes nothing');
  assert.equal(advanceRun(run, 10000 + 400), 'map', 'the lock window expires on its own');
  assert.equal(run.floor, floor + 1);
});

test('advanceRun reports ended when the node has no outgoing links', () => {
  const run = createRun(1, HERO, WORDS);
  const boss = run.rows[8][0];
  boss.links = [];
  run.node = boss;
  run.floor = 8;
  assert.equal(advanceRun(run, 5000), 'ended');
  assert.equal(run.floor, 9);
  assert.deepEqual(run.avail, []);
});

test('advanceRun heals 8 hp with the battery relic, capped at maxhp', () => {
  const run = createRun(1, HERO, WORDS);
  run.relics = ['battery'];
  run.node = run.avail[0];
  run.hp = 10;
  advanceRun(run, 1000);
  assert.equal(run.hp, 18);
  run.hp = run.maxhp - 2;
  advanceRun(run, 5000);
  assert.equal(run.hp, run.maxhp, 'never exceeds maxhp');
});

test('finishBattleNode ignores a second call and settles the battle result once', () => {
  const run = createRun(1, HERO, WORDS);
  const db = mkDb();
  const node = run.avail[0];
  const battle = { node, myHp: 40, shield: 6, boss: false, elite: false, won: true };
  assert.equal(finishBattleNode(run, battle, db), 'advance');
  assert.equal(node.done, true);
  assert.equal(run.hp, 40);
  assert.equal(run.shield, 6);
  assert.equal(battle.finished, true);
  const hp = run.hp;
  assert.equal(finishBattleNode(run, battle, db), 'ignored');
  assert.equal(run.hp, hp, 'the idempotent guard leaves state alone');
  assert.equal(db.wins, 0);
});

test('finishBattleNode clamps carry-over hp into [1, maxhp]', () => {
  const run = createRun(1, HERO, WORDS);
  const low = finishBattleNode(run, { node: null, myHp: -20, shield: -3 }, mkDb());
  assert.equal(low, 'advance');
  assert.equal(run.hp, 1);
  const high = finishBattleNode(createRun(1, HERO, WORDS), { node: null, myHp: 9999, shield: 0 }, mkDb());
  assert.equal(high, 'advance');
});

test('boss win heals 30, counts the win and records floor 9 as best', () => {
  const run = createRun(1, HERO, WORDS);
  const db = mkDb();
  const battle = { node: run.rows[8][0], myHp: 50, shield: 0, boss: true, elite: false, won: true };
  assert.equal(finishBattleNode(run, battle, db), 'boss-win');
  assert.equal(run.hp, 80, '50 + 30 capped at maxhp 80');
  assert.equal(db.wins, 1);
  assert.equal(db.best, 9);
  assert.equal(run.rows[8][0].done, true);
});

test('boss win on a nearly dead hero still gets exactly +30, not more', () => {
  const run = createRun(1, HERO, WORDS);
  const battle = { node: null, myHp: 20, shield: 0, boss: true, elite: false, won: true };
  assert.equal(finishBattleNode(run, battle, mkDb()), 'boss-win');
  assert.equal(run.hp, 50);
});

test('boss loss or escape never counts as a clear', () => {
  const run = createRun(1, HERO, WORDS);
  const db = mkDb();
  assert.equal(finishBattleNode(run, { node: null, myHp: 50, shield: 0, boss: true, elite: false, won: false }, db), 'boss-loss');
  assert.equal(db.wins, 0);
  assert.equal(db.best, 0, 'escaping the boss is not a win');
  assert.equal(run.hp, 50, 'no +30 consolation');
});

test('finishBattleNode ignores a null run', () => {
  assert.equal(finishBattleNode(null, { node: null, myHp: 1 }, mkDb()), 'ignored');
});

/* ================= 结算 ================= */
test('endRunProgress records one reward per win, updates best and result', () => {
  const run = createRun(1, HERO, WORDS);
  run.att = 8; run.attOk = 6; run.kills = 4; run.maxFloor = 5; run.floor = 5;
  const db = mkDb();
  const reward = endRunProgress(run, db, true, 1700000000000, '2023-11-14T22:13:20.000Z');
  assert.equal(reward.id, 'WR-' + (1700000000000).toString(36) + '-1-0');
  assert.equal(reward.unit, 1);
  assert.equal(reward.heroId, 'heroine');
  assert.equal(reward.accuracy, 75);
  assert.equal(reward.kills, 4);
  assert.equal(reward.floor, 5);
  assert.equal(reward.earnedAt, '2023-11-14T22:13:20.000Z');
  assert.deepEqual(db.rewards, [reward]);
  assert.equal(db.best, 5);
  assert.equal(run.result, true);

  const again = endRunProgress(run, db, true, 1700000009999);
  assert.equal(again, reward, 'the same card is reused');
  assert.equal(db.rewards.length, 1, 'a win never mints a second card');
  assert.equal(db.best, 5);
});

test('endRunProgress on a loss updates best and result but mints no card', () => {
  const run = createRun(1, HERO, WORDS);
  run.att = 3; run.attOk = 1; run.maxFloor = 3; run.floor = 3;
  const db = mkDb();
  assert.equal(endRunProgress(run, db, false, 1700000000000), null);
  assert.equal(run.reward, undefined);
  assert.deepEqual(db.rewards, []);
  assert.equal(db.best, 3, 'a run still raises the best floor reached');
  assert.equal(run.result, false);
});

test('endRunProgress accuracy is clamped and safe with zero attempts', () => {
  const zero = createRun(1, HERO, WORDS);
  const db = mkDb();
  assert.equal(endRunProgress(zero, db, false, 1), null);
  assert.equal(db.best, 1, 'zero-attempt run still reports the best floor');
  const wild = createRun(1, HERO, WORDS);
  wild.att = 1; wild.attOk = 99;
  assert.equal(endRunProgress(wild, db, true, 1).accuracy, 100);
  const old = createRun(1, HERO, WORDS);
  old.maxFloor = 12;
  const db2 = mkDb(); db2.best = 30;
  endRunProgress(old, db2, false, 1);
  assert.equal(db2.best, 30, 'best never regresses');
});

test('endRunProgress default earnedAt is derived from now', () => {
  const run = createRun(1, HERO, WORDS);
  const reward = endRunProgress(run, mkDb(), true, 1700000000000);
  assert.equal(reward.earnedAt, new Date(1700000000000).toISOString());
});

test('endRunProgress ignores a null run like the legacy guard', () => {
  assert.equal(endRunProgress(null, mkDb(), true, 1), null);
});
