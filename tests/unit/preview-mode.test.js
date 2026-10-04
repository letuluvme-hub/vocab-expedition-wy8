/* 预习模式（2026-10 起替代每日默写）：
 *   - 新会话一律是预习：过完整个单元（不限 16 词）、不限时、按课本顺序
 *   - 提示不限次数，直接填上下一个字母；用过提示的词不算学会
 *   - 不看提示拼完记进 mastered（统一的「学会」口径），随时可以跳过
 *   - 最后一个词过完直接「预习完成」，没有正式默写阶段
 *   - 存档恢复能接着预习 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyDictationController } from '../../src/app/daily-dictation.js';
import { restoreDailySession, PREVIEW_WORD_LIMIT } from '../../src/domain/daily-session.js';

const words = Array.from({ length: 45 }, (_, i) => ({ w: 'word' + String.fromCharCode(97 + (i % 26)) + i, z: '词' + i, u: 1 }));
const cat = { w: 'cat', z: '猫', u: 1 }, dog = { w: 'dog', z: '狗', u: 1 }, owl = { w: 'owl', z: '猫头鹰', u: 1 };

function setup(list = [cat, dog, owl]) {
  let clock = 1000;
  const db = { mastered: [], dictationMastered: [], reviewQueue: [], future: { keep: 1 } };
  const events = [];
  const c = createDailyDictationController({ getDB: () => db, getWords: () => list, now: () => clock, random: () => 0.4,
    persist: () => true, onPreview: e => events.push(e), getDueWords: () => [dog] });
  return { c, db, events, advance: n => { clock += n; } };
}
const spell = (c, text) => { for (const ch of text) c.input(ch); };

test('新会话默认是预习：整个单元一次过完，按课本顺序，不插复习词', () => {
  const { c } = setup(words);
  assert.equal(c.start({ unit: 1 }), true);
  const s = c.state();
  assert.equal(s.mode, 'preview');
  assert.equal(s.words.length, 45, '不再限 16 词');
  assert.deepEqual(s.words.map(w => w.w), words.map(w => w.w));
  assert.deepEqual(s.reviewKeys, []);
  assert.equal(s.phase, 'warmup');
  assert.ok(PREVIEW_WORD_LIMIT >= 55, '最大的教材单元 55 词');
});

test('提示不限次数，每次替你填一个字母；用过提示的词拼完不算学会', () => {
  const { c, db, events } = setup();
  c.start({ unit: 1 });
  assert.equal(c.hint(), 'c');
  assert.equal(c.hint(), 'a');
  assert.equal(c.hint(), 't');
  assert.equal(c.state().attempt.completed, true);
  assert.equal(c.state().attempt.hints, 3);
  assert.equal(c.hint(), false, '拼完以后不再提示');
  assert.deepEqual(db.mastered, []);
  assert.deepEqual(c.state().cleanDone, []);
  assert.equal(events.at(-1).clean, false);
  c.next();
  spell(c, 'dog');
  assert.deepEqual(db.mastered, ['dog'], '不看提示拼对记为学会');
  assert.deepEqual(c.state().cleanDone, ['dog']);
  assert.equal(events.at(-1).clean, true);
});

test('跳过当前词：不记学会，直接下一个；最后一个词过完就是预习完成', () => {
  const { c, db } = setup();
  c.start({ unit: 1 });
  spell(c, 'ca');
  assert.equal(c.skip(), true);
  assert.equal(c.state().index, 1);
  spell(c, 'dog'); c.next();
  spell(c, 'owl'); c.next();
  const s = c.state();
  assert.equal(s.phase, 'completed');
  assert.equal(s.reason, 'pool-exhausted');
  const sum = c.summary();
  assert.deepEqual([sum.preview, sum.planned, sum.warmup, sum.clean, sum.skipped], [true, 3, 2, 2, 1]);
  assert.deepEqual(db.mastered.sort(), ['dog', 'owl']);
  assert.deepEqual(db.dictationMastered, [], '预习不写正式默写记录');
});

test('预习不限时：练很久也不会被 15 分钟检查点叫停', () => {
  const { c, advance } = setup();
  c.start({ unit: 1 });
  advance(60 * 60 * 1000);
  assert.equal(c.checkTime(), false);
  assert.equal(c.input('c'), true);
  assert.equal(c.state().paused, false);
});

test('预习进度存档恢复后能接着练，跳过和学会的记录都在', () => {
  const { c, db } = setup();
  c.start({ unit: 1 });
  c.skip(); spell(c, 'do');
  const raw = JSON.parse(JSON.stringify(db.dailySession));
  const back = restoreDailySession(raw);
  assert.ok(back);
  assert.equal(back.mode, 'preview');
  assert.equal(back.attempt.input, 'do');
  assert.deepEqual(back.skipped, ['cat']);
  for (const bad of [{ skipped: ['nope'] }, { cleanDone: 'dog' }, { mode: 'exam' }]) {
    assert.equal(restoreDailySession({ ...raw, ...bad }), null, JSON.stringify(bad));
  }
});

test('旧版默写模式仍可显式开启（只为旧存档和回归测试保留）', () => {
  const { c } = setup();
  c.start({ unit: 1, mode: 'dictation' });
  assert.equal(c.state().mode, undefined);
  for (const w of c.state().words) { spell(c, w.w); c.next(); }
  assert.equal(c.state().phase, 'formal-ready');
});
