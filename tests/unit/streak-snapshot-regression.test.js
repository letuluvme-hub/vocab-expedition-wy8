/* 完整词连胜**快照回归**测试（docs/feature-word-streak.md）。
 *
 * 与 tests/unit/word-streak-wiring.test.js 的分工：那份测「正常往返」，
 * 这一份只钉住**编解码的严格性** —— 父复现过的两条静默失败：
 *
 *  1) `encodeSnapshot` 用 normalizeWordStreakState 掩掉了坏值：
 *     run.wordStreak={count:99} 落盘成 {count:8}，存档**看起来正常**，
 *     却凭空给玩家记了一个满级连胜。解码侧已经 fail closed，编码侧却在
 *     替脏值打圆场 —— 同一个字段两套口径。
 *     修法沿用 growth 的既有口径（encodeSnapshot 里的原值守卫）：
 *     **坏值就整份拒绝**（返回 null = 这一局存不下），绝不 normalize 掩坏。
 *  2) wordEventSeq 只查了 isInt(>=0)，1e21（Number.isInteger 为真）被原样写进
 *     存档，而 `++1e21 === 1e21` —— 事件身份从此**永久重复**，域层单槽去重会
 *     把后面每一次真实完成都误判成「重复投递」，连胜彻底卡死。
 *     修法：seq 必须是安全整数、非负，**并且给下一次 ++ 留出空间** ——
 *     正好卡在 MAX_SAFE_INTEGER 上时同样拒绝编码（publisher 侧另有明确降级，
 *     见 runtime 的 wordEventId：绝不重复 token）。
 *
 * 旧存档缺这两个字段 → 合法，回落 0（decode 侧）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';
import { createRun } from '../../src/domain/run.js';

const POOL = [{ w: 'keep', z: '保持', u: 1, d: 1, th: 'ki:p' }];
const baseRun = () => {
  const run = createRun(1, { id: 'scholar', mod: {} }, POOL);
  run.node = run.rows[0][0];
  return run;
};
const env = (run, extra = {}) => ({ phase: PHASE.MAP, run, battle: null, encounter: null, ...extra });

/* ---------------- 1. 编码不许掩坏：坏值整份拒绝 ---------------- */

test('回归：run.wordStreak 脏值整份拒绝编码，绝不静默夹成合法值', () => {
  for (const bad of [
    { count: 99, lastEventId: 'x' },      // 父复现：静默夹成 8
    { count: -1, lastEventId: 'x' },
    { count: 1.5, lastEventId: 'x' },
    { count: '3', lastEventId: 'x' },
    { count: 3, lastEventId: 7 },         // 身份不是字符串
    { count: 3 },                        // 缺 lastEventId
    'nope', [1, 2],
  ]) {
    const run = baseRun();
    run.wordStreak = bad;
    const out = encodeSnapshot(env(run), { now: 1 });
    assert.equal(out, null,
      '脏 wordStreak 必须整份拒绝（这一局存不下），而不是写成 ' + JSON.stringify(out && out.run.wordStreak));
  }
});

test('回归：合法 wordStreak 原样落盘，绝不被 normalize 改写', () => {
  for (const good of [
    { count: 0, lastEventId: null },
    { count: 3, lastEventId: 'R-abc:7' },
    { count: 8, lastEventId: 'R-abc:8' },
    { count: 2, lastEventId: ' 带空格的身份 ' },   // 身份按字面保留，不归一
  ]) {
    const run = baseRun();
    run.wordStreak = { ...good };
    const out = encodeSnapshot(env(run), { now: 1 });
    assert.ok(out, '合法值必须能编码: ' + JSON.stringify(good));
    assert.deepEqual(out.run.wordStreak, good, '编码必须原样，不许规范化身份');
    const back = decodeSnapshot(JSON.parse(JSON.stringify(out)));
    assert.equal(back.ok, true, '往返必须仍然合法: ' + JSON.stringify(good));
    assert.deepEqual(back.value.run.wordStreak, good);
  }
});

test('回归：旧内存态缺 wordStreak 字段 → 回落 0，仍可编码与恢复', () => {
  const run = baseRun();
  delete run.wordStreak; delete run.wordEventSeq;
  const out = encodeSnapshot(env(run), { now: 1 });
  assert.ok(out, '缺字段是合法形状（旧 run），不该整份拒绝');
  assert.deepEqual(out.run.wordStreak, { count: 0, lastEventId: null });
  assert.equal(out.run.wordEventSeq, 0);
  const back = decodeSnapshot(JSON.parse(JSON.stringify(out)));
  assert.equal(back.ok, true);
  assert.deepEqual(back.value.run.wordStreak, { count: 0, lastEventId: null });
  assert.equal(back.value.run.wordEventSeq, 0);
});

/* ---------------- 2. seq：安全整数 + 给 ++ 留空间 ---------------- */

test('回归：wordEventSeq 必须是安全整数、非负 —— 1e21 这类整份拒绝', () => {
  for (const bad of [
    1e21,               // 父复现：isInt 为真，但 ++ 之后不变 → 身份永久重复
    Number.MAX_SAFE_INTEGER + 2,
    Number.MAX_VALUE,
    Infinity, NaN,
    -1, -1e21,
    1.5,
    '3', true, {},
  ]) {
    const run = baseRun();
    run.wordEventSeq = bad;
    const out = encodeSnapshot(env(run), { now: 1 });
    assert.equal(out, null, '不安全/非法序号必须整份拒绝，而不是写成 ' + String(bad));
  }
});

test('回归：seq 卡在 MAX_SAFE_INTEGER 拒绝 —— 必须给下一次 ++ 留空间', () => {
  const run = baseRun();
  run.wordEventSeq = Number.MAX_SAFE_INTEGER;
  const out = encodeSnapshot(env(run), { now: 1 });
  assert.equal(out, null,
    'MAX_SAFE_INTEGER 的下一次 ++ 会溢出成同一个值（重复 token），编码必须拒绝');

  // 留一个位置就合法：++ 之后仍是安全整数，且仍能被编码 —— 这是最后一个可编码值。
  run.wordEventSeq = Number.MAX_SAFE_INTEGER - 1;
  const ok = encodeSnapshot(env(run), { now: 1 });
  assert.ok(ok, 'MAX_SAFE_INTEGER-1 合法：++ 之后仍是安全整数');
  assert.equal(ok.run.wordEventSeq, Number.MAX_SAFE_INTEGER - 1);

  // ★ 再 ++ 一次就越过可编码上界：编码必须拒绝，**而不是**悄悄写出一个
  //   「下一次 ++ 必然重复身份」的值。这正是 publisher 必须显式降级的地方
  //   （runtime 的 wordEventId 到顶就不再 ++，改用一次性身份）。
  const run2 = baseRun();
  run2.wordEventSeq = ok.run.wordEventSeq + 1;
  assert.equal(run2.wordEventSeq, Number.MAX_SAFE_INTEGER);
  assert.equal(encodeSnapshot(env(run2), { now: 1 }), null,
    '越过可编码上界的序号必须整份拒绝，绝不静默落盘');
});

test('回归：解码侧同样拒绝不安全序号（旧存档被人动过）', () => {
  const run = baseRun();
  run.wordEventSeq = 5;
  const base = JSON.parse(JSON.stringify(encodeSnapshot(env(run), { now: 1 })));

  for (const bad of [1e21, Number.MAX_VALUE, Infinity, -1, 1.5, '3', null]) {
    const dirty = JSON.parse(JSON.stringify(base));
    if (bad === null) delete dirty.run.wordEventSeq;   // 缺字段合法
    else dirty.run.wordEventSeq = bad;
    const back = decodeSnapshot(dirty);
    if (bad === null) {
      assert.equal(back.ok, true, '缺序号是合法旧存档');
      assert.equal(back.value.run.wordEventSeq, 0);
    } else {
      assert.equal(back.ok, false, '不安全/非法序号必须 fail closed: ' + String(bad));
    }
  }
});

test('回归：合法 seq 往返不变，且严格递增', () => {
  for (const seq of [0, 1, 7, 1e6, Number.MAX_SAFE_INTEGER - 1]) {
    const run = baseRun();
    run.wordStreak = { count: 3, lastEventId: 'R-abc:' + seq };
    run.wordEventSeq = seq;
    const back = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(env(run), { now: 1 }))));
    assert.equal(back.ok, true, '合法序号必须往返: ' + seq);
    assert.equal(back.value.run.wordEventSeq, seq);
    assert.equal(Number.isSafeInteger(back.value.run.wordEventSeq + 1), true,
      '往返后的序号必须还留得下下一次 ++');
  }
});

/* ---------------- 3. lastEventId：原样保留，不做控制符过滤 ---------------- */

test('回归：lastEventId 是合法字符串就原样保留（本模块不渲染它，没有 XSS 面）', () => {
  for (const id of ['R:1', ' 带空格 ', 'a\nb', '<script>x</script>', '中文身份', '']) {
    const run = baseRun();
    // 空串不是「没有身份」的合法编码形态（域层回落成 null），这里只测非空字面量。
    if (id === '') continue;
    run.wordStreak = { count: 1, lastEventId: id };
    const out = encodeSnapshot(env(run), { now: 1 });
    assert.ok(out, '合法字符串身份必须能编码: ' + JSON.stringify(id));
    assert.equal(out.run.wordStreak.lastEventId, id, '身份必须逐字保留，不许过滤/归一');
    assert.equal(decodeSnapshot(JSON.parse(JSON.stringify(out))).ok, true);
  }
});