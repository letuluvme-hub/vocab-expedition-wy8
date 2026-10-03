/* 选词出招（docs/feature-word-choice.md）。
 *
 * 契约：
 *  1) 候选只来自本轮**未完成**词，且彼此身份不同；主词（抽词结果）永远在内。
 *  2) 候选不消耗随机数：既有抽词 / 字母盘 / 怪物的随机序列一位都不漂移。
 *  3) 伤害预估与真实结算走同一套 hitDmg / wordDmg —— 长词预估必然更高。
 *  4) 只有「这个词还没动过」才能换：一个字母、一次错、一次读音、一次主动提示都会锁定。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { offerWords, estimateWordDamage, canSwitchWord } from '../../src/domain/word-choice.js';
import { hitDmg, wordDmg } from '../../src/domain/damage.js';
import { createRun } from '../../src/domain/run.js';
import { createWordQ } from '../../src/domain/word-quality.js';
import { norm } from '../../src/domain/text.js';

const HERO = { id: 'scholar', mod: { hp: 0, hint: 0 } };
const W = (w, z, d = 1, u = 1) => ({ u, d, w, z });
const POOL = [
  W('pot', '锅'), W('drop', '滴'), W('salty', '咸的'), W('corner', '角'),
  W('factory', '工厂', 2), W('pollution', '污染', 3), W('presentation', '展示会', 3),
];
const mkRun = (pool = POOL) => { const r = createRun(1, HERO, pool); r.floor = 1; return r; };
const battle = over => Object.assign({ combo: 0, dmgBonus: 0, rageLeft: 0, freezeWord: false,
  wordStreak: 0, foe: { n: '词灵', ic: '👾', tint: '#8b5cf6' }, enHp: 400, enMax: 400 }, over);

test('offerWords keeps the drawn word and adds up to two distinct pending alternatives', () => {
  const run = mkRun();
  const main = POOL[3];
  const offer = offerWords(run, main, null);
  assert.equal(offer.length, 3);
  assert.ok(offer.includes(main), '抽到的主词必须在候选里');
  const keys = offer.map(w => w.w.toLowerCase());
  assert.equal(new Set(keys).size, 3, '候选身份互不相同');
});

test('offerWords never offers completed words and shrinks gracefully', () => {
  const run = mkRun();
  run.done = new Set(['pot', 'drop', 'salty', 'corner', 'factory']);
  const main = POOL[5];
  const offer = offerWords(run, main, null);
  assert.deepEqual(offer.map(w => w.w).sort(), ['pollution', 'presentation']);
  run.done.add('presentation');
  assert.deepEqual(offerWords(run, main, null).map(w => w.w), ['pollution'], '只剩一个词时只给它');
});

test('offerWords avoids the previous word when other choices exist', () => {
  const run = mkRun();
  const prev = POOL[0];
  for (const main of POOL.slice(1)) {
    const offer = offerWords(run, main, prev);
    assert.ok(!offer.some(w => w.w === prev.w), '刚拼完的词不该马上又出现在候选里');
  }
});

test('offerWords spans short and long words and is ordered short → long', () => {
  const run = mkRun();
  const offer = offerWords(run, POOL[3], null);
  const lens = offer.map(w => norm(w.w).length);
  assert.deepEqual(lens, lens.slice().sort((a, b) => a - b), '候选按字母数升序：稳 → 搏');
  assert.ok(lens[0] < lens[lens.length - 1], '至少给出一短一长两种取舍');
});

test('offerWords consumes no randomness', () => {
  const run = mkRun();
  const orig = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return orig(); };
  try { offerWords(run, POOL[2], POOL[1]); } finally { Math.random = orig; }
  assert.equal(calls, 0, '候选生成不能扰动既有随机序列');
});

test('estimateWordDamage matches the real letter + finisher formula', () => {
  const run = mkRun();
  const b = battle();
  const est = estimateWordDamage(run, b, W('drop', '滴'));
  // 手算：每个字母先 combo++ 再按 hitDmg 结算，最后一击按 wordDmg。
  const sim = battle();
  let letters = 0;
  for (let i = 0; i < 4; i++) { sim.combo++; letters += hitDmg(run, sim); }
  assert.equal(est.letters, letters);
  assert.equal(est.finisher, wordDmg(run, sim));
  assert.equal(est.total, letters + wordDmg(run, sim));
  assert.equal(b.combo, 0, '预估不能改动真实战斗');
});

test('longer words are estimated to hit harder', () => {
  const run = mkRun();
  const short = estimateWordDamage(run, battle(), W('pot', '锅')).total;
  const long = estimateWordDamage(run, battle(), W('presentation', '展示会', 3)).total;
  assert.ok(long > short * 2, `长词伤害应显著更高（${short} vs ${long}）`);
});

test('canSwitchWord locks once the word has been touched', () => {
  const fresh = () => battle({ over: false, input: [], hintTotal: 0, autoHint: 0, wordQ: createWordQ(),
    offer: [POOL[0], POOL[1]] });
  assert.equal(canSwitchWord(fresh()), true);
  assert.equal(canSwitchWord(Object.assign(fresh(), { input: ['d'] })), false, '已填字母');
  const wrong = fresh(); wrong.wordQ.wrong = 1;
  assert.equal(canSwitchWord(wrong), false, '已答错');
  const listened = fresh(); listened.wordQ.listen = 1;
  assert.equal(canSwitchWord(listened), false, '已听读音');
  assert.equal(canSwitchWord(Object.assign(fresh(), { hintTotal: 1 })), false, '已主动提示');
  assert.equal(canSwitchWord(Object.assign(fresh(), { hintTotal: 1, autoHint: 1 })), true,
    '开场自动揭示（先知卡/学者之书）不算玩家动过这个词');
  assert.equal(canSwitchWord(Object.assign(fresh(), { over: true })), false, '战斗已结束');
  assert.equal(canSwitchWord(Object.assign(fresh(), { offer: [POOL[0]] })), false, '只有一个候选');
  assert.equal(canSwitchWord(null), false);
});
