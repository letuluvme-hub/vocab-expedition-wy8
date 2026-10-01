/* 纪念卡的**呈现契约**（docs/feature-rounds.md）。
 *
 * 卡上必须把三件互相独立的事分开说，不能混成一句「全册已掌握」：
 *   1) 轮次：第 N 轮 —— 旧卡没有编号就老实写「旧版记录 · 未记录轮次」，绝不猜一个。
 *   2) 完成单元：本轮整词完成的单元（到过某个单元不算）。
 *   3) 本轮学习范围是否完成（名义口径「本轮学习范围已完成」，不是「全册已掌握」）。
 *
 * 所有文本走 textContent：卡上的 id / 单元名来自存档，是外部输入。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRewardCard, rewardScope, rewardRoundLine } from '../../src/ui/components/reward-card.js';

/* 最小 DOM 桩：只要求 createElement / textContent / appendChild / classList。
   故意做成真对象：断言要落在 textContent 上，而不是源码字符串匹配。 */
class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.className = '';
    this._text = '';
    this.hidden = false;
    this.title = '';
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    if (this.children.length) return this.children.map(c => c.textContent).join('\n');
    return this._text;
  }
  appendChild(c) { this.children.push(c); return c; }
  set innerHTML(v) { if (v === '') { this.children = []; this._text = ''; } else { throw new Error('reward cards must not use innerHTML'); } }
  get innerHTML() { return ''; }
}
function withDom(fn) {
  const prev = { createElement: globalThis.document && globalThis.document.createElement };
  globalThis.document = {
    createElement: tag => new StubEl(tag),
  };
  try { return fn(); } finally { globalThis.document = prev.createElement ? { createElement: prev.createElement } : undefined; }
}

const baseCard = (over = {}) => Object.assign({
  id: 'WR-1', unit: 1, heroId: 'ranger', accuracy: 90, kills: 5, floor: 7,
  earnedAt: '2026-01-02T03:04:05.000Z',
}, over);

const render = card => withDom(() => {
  const box = new StubEl('div');
  renderRewardCard(box, card);
  return box.textContent;
});

test('a card with a round number shows 第 N 轮', () => {
  const text = render(baseCard({ roundNumber: 7, roundId: 'rid-7' }));
  assert.match(text, /第 7 轮/);
  assert.equal(rewardRoundLine(baseCard({ roundNumber: 7 })), '第 7 轮');
});

test('a legacy card with no round number says so instead of guessing', () => {
  const legacy = baseCard({ id: 'WR-old', roundNumber: undefined, roundId: undefined, completedUnits: undefined, roundComplete: undefined });
  const line = rewardRoundLine(legacy);
  assert.equal(line, '旧版记录 · 未记录轮次');
  const text = render(legacy);
  assert.match(text, /旧版记录 · 未记录轮次/);
  assert.doesNotMatch(text, /第 \d+ 轮/, '★ 旧卡绝不编一个编号出来');
});

test('a legacy card says the scope is unrecorded, never that it was incomplete', () => {
  // ★ unknown 不是 false：旧卡没有这些字段，说「未完成」是替玩家下一个他没经历过的结论。
  const legacy = baseCard({ id: 'WR-old', completedUnits: undefined, roundComplete: undefined });
  const text = render(legacy);
  assert.match(text, /未记录完成范围/);
  assert.doesNotMatch(text, /本轮学习范围未完成/, '★ 旧卡不能谎报「未完成」');
  assert.doesNotMatch(text, /本轮学习范围已完成/);
  assert.doesNotMatch(text, /尚无整词完成的单元/, '★ 「没记过」不等于「记了没有」');
});

test('a new card with an empty list and roundComplete false does say incomplete', () => {
  // 新卡是有记录的：[] / false 就是「这一轮确实没完成任何单元」，可以直说。
  const text = render(baseCard({ roundNumber: 1, completedUnits: [], roundComplete: false }));
  assert.match(text, /本轮完成单元：尚无整词完成的单元/);
  assert.match(text, /本轮学习范围未完成/);
  assert.doesNotMatch(text, /未记录完成范围/);
});

test('the completed units are listed from this round only', () => {
  const text = render(baseCard({ roundNumber: 2, completedUnits: [1, 2], roundComplete: false }));
  assert.match(text, /本轮完成单元/);
  assert.match(text, /Unit 1/);
  assert.match(text, /Unit 2/);
  assert.doesNotMatch(text, /Unit 3/, '只列真正完成过的单元');
});

test('boss clear, completed units and round-scope completion are three separate statements', () => {
  const text = render(baseCard({ roundNumber: 1, completedUnits: [1], roundComplete: false }));
  // BOSS 通关是这张卡存在的原因
  assert.match(text, /击败最终 BOSS/);
  // 完成单元是事实
  assert.match(text, /本轮完成单元/);
  // 范围完成是另一个判断，且未完成时不能说「全册」
  assert.doesNotMatch(text, /本轮学习范围已完成/);
  assert.doesNotMatch(text, /全册已掌握/);
});

test('a fully completed round says 本轮学习范围已完成, never 全册已掌握', () => {
  const text = render(baseCard({ roundNumber: 1, completedUnits: [1, 2, 3, 4, 5, 6], roundComplete: true }));
  assert.match(text, /本轮学习范围已完成/);
  assert.doesNotMatch(text, /全册已掌握/);
});

test('a custom round labels itself accurately', () => {
  const card = baseCard({ unit: 0, roundNumber: 4, completedUnits: [0], roundComplete: true });
  const text = render(card);
  assert.equal(rewardScope(0), '我的词表', '自定义词表单元自称自己的名字，不冒充教材单元');
  assert.match(text, /本轮完成单元/);
  assert.doesNotMatch(text, /Unit \d/, '★ 自定义轮次不预告教材单元');
  assert.match(text, /本轮学习范围已完成/);
});

test('card text is escaped at the render boundary, not in the data', () => {
  const evil = baseCard({ id: '<img src=x onerror=alert(1)>', roundNumber: 3, completedUnits: [] });
  const box = withDom(() => {
    const b = new StubEl('div');
    renderRewardCard(b, evil);
    return b;
  });
  // 内部只允许 textContent 节点：不会变成一个真的 <img> 元素
  const tags = [];
  (function walk(n) { tags.push(n.tagName); n.children.forEach(walk); })(box);
  assert.equal(tags.filter(t => t === 'IMG').length, 0, '存档里的 id 不许注入元素');
  assert.match(box.textContent, /<img src=x onerror=alert\(1\)>/, '原文照常显示为纯文本');
});
