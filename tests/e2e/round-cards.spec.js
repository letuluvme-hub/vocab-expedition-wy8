// 任务 8 的真实浏览器验收：通关纪念卡上的**真实轮次**、完成范围与旧卡展示。
//
// 真实度约定：
//  - 轮次编号来自真实的「开始远征 → registerRunStart → DB.runs」链路，读应用自己写下的存档。
//  - BOSS 胜利是真实的一字一字敲完整词（伤害路径真实），纪念卡是结算路径发出来的。
//  - 完成范围只由真实整词完成驱动；旧卡形态直接写进存档原文，走真实的解码与渲染。
//  - 布局断言（320px 无溢出）量真实 DOM，而不是数 CSS 规则。
import { test, expect } from './game-harness.js';
import { WORDS } from '../../src/data/words.js';

const newOnly = (testInfo, why) => {
  if (testInfo.project.metadata.target === 'legacy') test.skip(true, why);
};

// 逐字敲完整词（真实输入路径：键盘 → typeLetter → pressKey）。
async function typeWholeWord(page, word) {
  for (const ch of word) await page.keyboard.type(ch);
}

// 真 BOSS 战：一个词秒杀 → 领奖 → 结算屏发卡。
async function winBoss(game, page, word) {
  await game.fight({ boss: true, word, enemyHp: 1 });
  await typeWholeWord(page, word);
  await expect(page.locator('#s-pick')).toBeVisible();
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
}

// 卡上可见的三行（结算屏与收藏页共用同一份渲染）。
const card = page => page.locator('#oReward .reward-card');

test('the settlement screen shows a real round number and separates the three facts', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Round-aware cards are a new regression guard');
  await game.open();
  await game.start();
  expect((await game.state()).DB.runs, '真正开局一次').toBe(1);

  await winBoss(game, page, 'litre');

  // 结算屏：轮次、完成单元、范围完成三行都**实际可见**。
  await expect(card(page).locator('.reward-round')).toHaveText('第 1 轮');
  await expect(card(page)).toContainText('击败最终 BOSS 的纪念');
  await expect(card(page).locator('.reward-done')).toContainText('本轮完成单元');
  // 只打完 BOSS 就算整轮范围完成，是假的：范围里一个单元都还没整词完成。
  await expect(card(page).locator('.reward-complete')).toHaveText('本轮学习范围未完成');
  await expect(card(page)).not.toContainText('全册已掌握');
  await expect(page.locator('#oText')).toContainText('第 1 轮');

  // 存档里的卡确实带着真实轮次事实（不是渲染层算出来的）。
  const saved = await game.saved();
  expect(saved.rewards).toHaveLength(1);
  expect(saved.rewards[0].roundNumber).toBe(1);
  expect(typeof saved.rewards[0].roundId).toBe('string');
  expect(saved.rewards[0].roundId.length).toBeGreaterThan(0);
  expect(saved.rewards[0].roundComplete).toBe(false);
});

test('the title collection shows the same round, and a reload keeps the number', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Round-aware cards are a new regression guard');
  await game.open();
  await game.start();
  await winBoss(game, page, 'litre');
  const first = (await game.saved()).rewards[0].id;

  // 返回主页 → 收藏页里同一张卡，必须带同一个轮次编号。
  await page.locator('#oHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  const collected = page.locator('#rewardCards .reward-card').first();
  await expect(collected.locator('.reward-round')).toHaveText('第 1 轮');
  await expect(collected).toContainText('本轮完成单元');

  // 真刷新：卡仍是同一张、编号不变（不许按 DB.runs 重算，也绝不发第二张）。
  await game.reload();
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#rewardCards .reward-card')).toHaveCount(1);
  await expect(page.locator('#rewardCards .reward-card').first().locator('.reward-round')).toHaveText('第 1 轮');
  const after = await game.saved();
  expect(after.rewards).toHaveLength(1);
  expect(after.rewards[0].id).toBe(first, '★ 刷新后复用同一张卡');

  // 真正再开第二轮：编号递增到 2，且与第一轮的 id 不同。
  await page.locator('#startRun').click();
  expect((await game.state()).DB.runs).toBe(2);
  const run = await page.evaluate(() => ({ n: window.__gameTest.G.roundNumber, id: window.__gameTest.G.roundId }));
  expect(run.n).toBe(2, '★ 轮次编号递增');
  expect(run.id).not.toBe(after.rewards[0].roundId, '★ roundId 与上一轮不同');
});

test('an in-progress round survives a refresh with the same number and identity', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Round-aware cards are a new regression guard');
  await game.open();
  await game.start();
  const before = await page.evaluate(() => ({ n: window.__gameTest.G.roundNumber, id: window.__gameTest.G.roundId }));

  await game.fight({ word: 'litre', enemyHp: 100 });
  await game.reload();
  await page.locator('#continueRun').click();
  // 刷新时正在战斗里 → 恢复必须回到战斗屏（真实相位，不是地图）。
  await expect(page.locator('#s-fight')).toBeVisible();
  const after = await page.evaluate(() => ({ n: window.__gameTest.G.roundNumber, id: window.__gameTest.G.roundId }));
  expect(after, '★ 恢复的是同一轮：编号与身份都固定').toEqual(before);
  expect((await game.state()).DB.runs, '恢复不加次数').toBe(1);
});

test('a legacy card with no round fields is shown as 旧版记录, not given a guessed number', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Round-aware cards are a new regression guard');
  // 直接放一张旧版形状的卡进存档：没有 roundNumber / roundId / completedUnits，
  // 还有一个未知字段（必须原样保留，不许因为不认识就丢字段或整份拒绝）。
  await game.open({
    saved: {
      rewards: [{
        id: 'WR-legacy-1', unit: 2, heroId: 'scholar', accuracy: 70, kills: 4, floor: 5,
        earnedAt: '2020-05-06T07:08:09.000Z', mysteryField: 'keep-me',
      }],
    },
  });
  const collected = page.locator('#rewardCards .reward-card').first();
  await expect(collected.locator('.reward-round')).toHaveText('旧版记录 · 未记录轮次');
  await expect(collected).not.toContainText(/第 \d+ 轮/);
  // 旧卡不能反过来声称「本轮范围完成」，也不能谎报「这一轮没完成」——
  // 它根本没记录过这件事，说法必须是「未记录」。
  await expect(collected.locator('.reward-complete')).toHaveText('本轮完成范围：未记录完成范围');
  await expect(collected.locator('.reward-done')).toContainText('未记录完成范围');
  await expect(collected).not.toContainText('本轮学习范围未完成');
  // 既有字段与未知字段都还在
  const saved = await game.saved();
  expect(saved.rewards).toHaveLength(1);
  expect(saved.rewards[0].mysteryField).toBe('keep-me');
  expect(saved.rewards[0].accuracy).toBe(70);

  // 旧卡与新卡并存：新卡有编号，旧卡仍旧版记录，绝不被就地改写。
  await page.locator('#units .unit[data-unit="1"]').click();
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  await winBoss(game, page, 'litre');
  await page.locator('#oHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  const cards = page.locator('#rewardCards .reward-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('.reward-round')).toHaveText('第 1 轮');
  await expect(cards.nth(1).locator('.reward-round')).toHaveText('旧版记录 · 未记录轮次');
  const both = await game.saved();
  expect(both.rewards.map(r => r.id).sort()).toEqual(['WR-legacy-1', both.rewards[0].id === 'WR-legacy-1' ? both.rewards[1].id : both.rewards[0].id]);
  expect(both.rewards[1].roundNumber).toBe(1);
  expect(both.rewards[0].roundNumber).toBeUndefined();
});

/* ---------------- L1 / L2 的真浏览器回归 ---------------- */

test('historical mastery unlocks the next unit but never becomes this round completion', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'The round evidence gate is a new regression guard');
  // 一份「259 个词历史全掌握」的存档：从 Unit 1 起手点「继续下一单元」在**解锁口径上**
  // 一直合法（口径不许收紧），可这一轮一个词都没答过 —— 卡上绝不许出现「本轮完成 Unit 1」。
  await game.open({ saved: { dictationMastered: WORDS.map(w => w.w) } });
  await game.start(1);

  // 真打一场 BOSS：整词答对 litre → 卡发出（本轮完成范围此刻必然为空）。
  await winBoss(game, page, 'litre');
  let saved = await game.saved();
  expect(saved.rewards).toHaveLength(1);
  expect(saved.rewards[0].completedUnits, '★ 只打完 BOSS 不算本轮完成').toEqual([]);
  expect(saved.rewards[0].roundComplete).toBe(false);

  // 「继续下一单元」：解锁合法（历史 mastered），本轮完成仍然不记。
  const nextBtn = page.locator('#oNext');
  await expect(nextBtn).toHaveText('继续 Unit 2');
  await nextBtn.click();
  await expect(page.locator('#s-map')).toBeVisible();
  const after = await page.evaluate(() => ({
    unit: window.__gameTest.G.unit,
    completed: [...window.__gameTest.G.completedUnits],
    runs: window.__gameTest.DB.runs,
  }));
  expect(after.unit, '★ 相位守卫与跨单元过渡本身不受影响').toBe(2);
  expect(after.completed, '★ 本轮没学过 Unit 1：完成范围必须仍是空').toEqual([]);
  expect(after.runs, '同一轮跨单元不加次数').toBe(1);

  // 已有卡被同步过一次，但仍然是空的（syncRoundCard 不 mint、不虚报）。
  saved = await game.saved();
  expect(saved.rewards).toHaveLength(1, '★ 同步绝不多发一张卡');
  expect(saved.rewards[0].completedUnits).toEqual([]);

  // 再打一场 BOSS（Unit 2），卡仍然是同一张、范围仍然是空的。
  await winBoss(game, page, 'digital');
  saved = await game.saved();
  expect(saved.rewards).toHaveLength(1, '★ 一轮最多一张卡');
  expect(saved.rewards[0].completedUnits).toEqual([]);
  expect(saved.rewards[0].roundComplete).toBe(false);
});

test('an earned card is synced before 结束本轮学习, so abandon keeps the real scope', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Card sync before abandon is a new regression guard');
  // 真实起点 Unit 6：范围就是 [6] 本身（不猜编号、不借前 5 个单元充数）。
  // Unit 1..5 的真实学习记录放在存档的 mastered 里 —— 那正是 Unit 6 已解锁的依据。
  const u1to5 = WORDS.filter(w => w.u > 0 && w.u < 6).map(w => w.w);
  await game.open({ saved: { dictationMastered: u1to5 } });
  await game.start(6);

  // DEV 只用来把词池准备到「真实只剩 1 个词」：最后一个词是真的一个字一个字敲完的。
  // 本轮 completedUnits 保持开局值 [] —— 起点 Unit 6 的范围就是 [6]，
  // 借前 5 个单元充数是虚报（他们根本不在本轮范围里）。
  const { bossWord, lastWord } = await page.evaluate(() => {
    const t = window.__gameTest;
    const words = t.WORDS.filter(w => w.u === 6);
    t.G.pool = words.slice();
    t.G.done = new Set(words.slice(0, words.length - 1).map(w => w.w));
    t.G.wrong = [];
    return { bossWord: words[0].w, lastWord: words[words.length - 1].w };
  });
  expect(lastWord, 'Unit 6 的最后一个词真实存在').toBeTruthy();
  expect(bossWord, '★ BOSS 用的词必须与最后一个词不同').not.toBe(lastWord);

  // 先打 BOSS 拿到卡：此刻本轮 Unit 6 还没学完，卡必须是 [] / false。
  await winBoss(game, page, bossWord);
  const earned = await game.saved();
  expect(earned.rewards).toHaveLength(1);
  const cardId = earned.rewards[0].id;
  const earnedAt = earned.rewards[0].earnedAt;
  expect(earned.rewards[0].completedUnits).toEqual([]);
  expect(earned.rewards[0].roundComplete).toBe(false, '★ 拿到卡时 Unit 6 还没学完');

  // 同一单元续一段，把最后一个词真的敲完。
  await page.locator('#oNext').click();
  await expect(page.locator('#s-map')).toBeVisible();
  await game.fight({ word: lastWord, enemyHp: 10_000 });
  await typeWholeWord(page, lastWord);
  await expect(page.locator('#s-learning-complete')).toBeVisible();

  // 检查点上这一轮的范围已经变了：已有卡必须**立刻**同步并落盘。
  const synced = await game.saved();
  expect(synced.rewards).toHaveLength(1, '★ 同步不 mint 第二张');
  expect(synced.rewards[0].id, '★ 复用同一张卡').toBe(cardId);
  expect(synced.rewards[0].completedUnits, '★ 本轮整词完成的单元落到同一张卡上').toEqual([6]);
  expect(synced.rewards[0].roundComplete, '★ 范围 [6] 真的完成').toBe(true);
  expect(synced.rewards[0].earnedAt, '★ 获得时间固定：同步不是重新获得').toBe(earnedAt);

  // 「结束本轮学习」是明确放弃（不是战败结算），但卡不许丢。
  page.once('dialog', d => d.accept());
  await page.locator('#lcBtnQuit').click();
  await expect(page.locator('#s-title')).toBeVisible();
  const afterQuit = await game.saved();
  expect(afterQuit.rewards).toHaveLength(1, '★ 放弃也不丢卡、不多卡');
  expect(afterQuit.rewards[0].id).toBe(cardId);
  expect(afterQuit.rewards[0].completedUnits).toEqual([6]);
  expect(afterQuit.rewards[0].earnedAt).toBe(earnedAt);
  expect(afterQuit.activeRun, '★ 这一局确实被结束了').toBeUndefined();

  // 主页收藏页显示同一张卡、同一句话；真刷新后仍然一样。
  const collected = page.locator('#rewardCards .reward-card').first();
  await expect(collected.locator('.reward-complete')).toHaveText('本轮学习范围已完成');
  await expect(collected.locator('.reward-done')).toContainText('Unit 6');
  await game.reload();
  await expect(page.locator('#rewardCards .reward-card')).toHaveCount(1);
  await expect(page.locator('#rewardCards .reward-card').first().locator('.reward-complete')).toHaveText('本轮学习范围已完成');
  const reloaded = await game.saved();
  expect(reloaded.rewards).toHaveLength(1);
  expect(reloaded.rewards[0].id).toBe(cardId);
  expect(reloaded.rewards[0].completedUnits).toEqual([6]);
  expect(reloaded.rewards[0].roundComplete).toBe(true);
});

test('cards stay readable at 320px without horizontal overflow', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Round lines are a new layout risk');
  await page.setViewportSize({ width: 320, height: 720 });
  await game.open();
  await game.start();
  await winBoss(game, page, 'litre');

  // 结算屏上的卡：真实盒子宽度不许超出视口。
  const over = await card(page).evaluate(el => {
    const doc = document.documentElement;
    return {
      cardRight: el.getBoundingClientRect().right,
      viewport: window.innerWidth,
      docScroll: doc.scrollWidth,
      lines: [...el.querySelectorAll('.reward-round, .reward-done, .reward-complete')].map(n => n.getBoundingClientRect().right),
    };
  });
  expect(over.cardRight, '★ 结算卡不得横向溢出 320px').toBeLessThanOrEqual(over.viewport + 1);
  expect(over.docScroll, '★ 页面不得出现横向滚动').toBeLessThanOrEqual(over.viewport + 1);
  for (const right of over.lines) expect(right).toBeLessThanOrEqual(over.viewport + 1);

  // 收藏页里的同一张卡也一样。
  await page.locator('#oHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  const col = await page.locator('#rewardCards .reward-card').first().evaluate(el => ({
    right: el.getBoundingClientRect().right,
    viewport: window.innerWidth,
    docScroll: document.documentElement.scrollWidth,
  }));
  expect(col.right).toBeLessThanOrEqual(col.viewport + 1);
  expect(col.docScroll).toBeLessThanOrEqual(col.viewport + 1);
});
