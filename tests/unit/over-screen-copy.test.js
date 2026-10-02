/* C1：结算页两个按钮的文案必须说清「进度保留」还是「进度清零」。
 *
 * 用户实机原话：「一关结束时，复习本单元和继续本单元有点搞不懂有什么区别」。
 * 读代码得出的事实：两个按钮的**真实语义完全相反**，但旧文案看不出区别 ——
 *   #oAgain  「复习本单元」     → onAgain()        —— 新开一轮，本轮进度清零
 *   #oNext   「继续本单元词汇」 → onContinueUnit() —— 同一轮继续，物资全保留
 *
 * 这些断言锁的是**新文案本身**（"清零"与"保留"必须在可见文本里出现，
 * 不能只挂在 title 上 —— 手机没有 hover，title 等于不存在），
 * 以及"两个按钮仍然是两个不同的流程"。
 *
 * ★ 既有测试里断言旧措辞的那些（campaign-ui / ui-modules / campaign.spec /
 *   progression.spec / counting.spec / round-difficulty.spec）已按
 *   「有意漂移」归一化处理 —— 归一化只放宽**措辞**，语义断言一条没删。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderOver } from '../../src/ui/screens/over.js';
import { installDocument } from './_dom-stub.js';

/* over.js 的 $ 直接用全局 document，所以先把桩装上。 */
const IDS = ['oAgain', 'oNext', 'oHome', 'oIcon', 'oTitle', 'oText',
  'oFloor', 'oKill', 'oAcc', 'oRelics', 'oReward'];

function overScreen({ unit = 1, win = true, complete = false, remaining = 12, total = 45, next = 2, unlocked = true }) {
  const els = installDocument(IDS);
  const db = { mastered: [], rewards: [], best: 0, runs: 0, wins: 0, unitProgress: {} };
  const run = {
    unit, maxhp: 70, hp: 70, shield: 0, gold: 0, relics: [], bag: {},
    kills: 3, att: 20, attOk: 18, maxFloor: 5, heroId: 'scholar', result: win,
    reward: {
      id: 'WR-x', unit, heroId: 'scholar', accuracy: 90, kills: 3, floor: 5,
      roundNumber: 2, completedUnits: [unit], roundComplete: false,
      earnedAt: '2026-10-02T00:00:00.000Z',
    },
    done: new Set(), wrong: [],
  };
  const campaign = {
    counts: () => ({ total, done: total - remaining, remaining, complete, wrong: 0 }),
    next: () => next,
    isUnlocked: () => unlocked,
  };
  renderOver({ run, db, win, campaign, onTitle: () => {}, show: () => {},
    onNextUnit: () => {}, onContinueUnit: () => {}, onAgain: () => {}, onHome: () => {} });
  return els;
}

/* ---------------- #oAgain：必须说清"进度清零" ---------------- */

test('胜利结算页：#oAgain 文案直说进度清零，且不再用有歧义的「复习」', () => {
  const again = overScreen({ win: true, complete: false, remaining: 12 }).get('oAgain');
  assert.match(again.textContent, /重新开始/, '应说清这是"重新开始"');
  assert.match(again.textContent, /进度清零/, '★ 必须直说进度会清零，不能只挂在 title 上');
  assert.doesNotMatch(again.textContent, /复习/,
    '「复习」同时暗示"接着练"和"重来"，歧义的正是它 —— 防回退');
});

test('自定义词表那一支同样说清后果', () => {
  const again = overScreen({ unit: 0, win: true, complete: false, remaining: 3, next: null }).get('oAgain');
  assert.match(again.textContent, /重新开始/);
  assert.match(again.textContent, /进度清零/);
  assert.doesNotMatch(again.textContent, /复习/);
});

test('战败时 #oAgain 仍是「再来一次」（没有"进度清零"这层含义）', () => {
  assert.equal(overScreen({ win: false }).get('oAgain').textContent, '再来一次');
});

/* ---------------- #oNext：必须说清"物资保留" ---------------- */

test('本单元没完成时：#oNext 文案直说物资保留，并带出还剩几个词', () => {
  const next = overScreen({ win: true, complete: false, remaining: 12, total: 45 }).get('oNext');
  assert.equal(next.hidden, false, '不能卡住：必须有一个继续入口');
  assert.match(next.textContent, /12/, '应带出"还剩几个词"这个具体数字');
  assert.match(next.textContent, /物资保留/, '★ 必须直说物资保留');
  assert.doesNotMatch(next.textContent, /Unit 2/, '本单元没完成，绝不许预告下一单元');
});

test('「重新开始（清零）」与「继续练（保留）」两个文案一眼可辨', () => {
  const els = overScreen({ win: true, complete: false, remaining: 12 });
  const a = els.get('oAgain').textContent;
  const n = els.get('oNext').textContent;
  assert.notEqual(a, n);
  // 一个说清零、一个说保留 —— 这正是用户分不清的那件事
  assert.match(a, /清零/);
  assert.match(n, /保留/);
});

test('本单元已完成时：#oNext 走"进入下一单元"那一支，不受本次文案改动影响', () => {
  const next = overScreen({ win: true, complete: true, remaining: 0, total: 45, next: 2 }).get('oNext');
  assert.equal(next.hidden, false);
  assert.match(next.textContent, /继续 Unit 2/);
});

test('战败时两个入口都不给（逃跑/战败不推进学习主线）', () => {
  assert.equal(overScreen({ win: false }).get('oNext').hidden, true);
});

/* ---------------- 回调仍然是两个不同的流程 ---------------- */

test('两个按钮仍分别绑到各自的回调（文案变了，流程没变）', () => {
  const els = installDocument(IDS);
  const acts = [];
  const db = { mastered: [], rewards: [], best: 0, runs: 0, wins: 0, unitProgress: {} };
  const run = {
    unit: 1, maxhp: 70, hp: 70, shield: 0, gold: 0, relics: [], bag: {},
    kills: 3, att: 20, attOk: 18, maxFloor: 5, heroId: 'scholar', result: true,
    reward: null, done: new Set(), wrong: [],
  };
  const campaign = {
    counts: () => ({ total: 45, done: 33, remaining: 12, complete: false, wrong: 0 }),
    next: () => 2,
    isUnlocked: () => true,
  };
  renderOver({ run, db, win: true, campaign, onTitle: () => {}, show: () => {},
    onNextUnit: () => acts.push('next-unit'),
    onContinueUnit: () => acts.push('continue-unit'),
    onAgain: () => acts.push('again'), onHome: () => acts.push('home') });

  els.get('oNext').onclick();
  els.get('oAgain').onclick();
  assert.deepEqual(acts, ['continue-unit', 'again'],
    '「继续」必须仍是同一轮续练、「重新开始」必须仍是新开一轮 —— 混淆它们才是真正的 bug');
});
