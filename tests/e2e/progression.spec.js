import { test, expect } from './game-harness.js';
import { WORDS } from '../../src/data/words.js';

// 任务 7 之后，跨单元与「继续下一单元」不再是「新开一次远征」：
// oNext 把玩家送进**同一轮**的下一段（物资继承、DB.runs 不加）。
const unlockAll = n => WORDS.filter(w => w.u <= n).map(w => w.w);

test('shop permits separate repeat purchases rejects rapid duplicates and still leaves', async ({ game, page }) => {
  await game.open();
  await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const shop = t.G.rows.at(-2).find(n => n.type === 'shop');
    t.G.floor = shop.row + 1;
    t.G.gold = 200;
    t.G.hp = 10;
    t.enterNode(shop);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await expect(page.locator('#rSub')).toContainText('200');
  const scroll = page.locator('#rPicks .pick').filter({ hasText: '提示卷轴' });
  // Dispatch two real DOM clicks in one turn to exercise the legacy per-button cooldown.
  await scroll.evaluate(el => { el.click(); el.click(); });
  expect((await game.state()).G.gold).toBe(160);
  expect((await game.state()).G.shopHints).toBe(3);
  await page.waitForTimeout(300); // documented business cooldown is 260ms
  await scroll.click();
  expect((await game.state()).G.gold).toBe(120);
  expect((await game.state()).G.shopHints).toBe(6);
  await page.locator('#rPicks .pick').filter({ hasText: '疗伤药剂' }).click();
  expect((await game.state()).G.gold).toBe(75);
  expect((await game.state()).G.hp).toBe(45);
  const stone = page.locator('#rPicks .pick').filter({ hasText: '磨砺石' });
  await stone.click();
  expect((await game.state()).G.gold).toBe(5);
  expect((await game.state()).G.maxhp).toBe(70);
  expect((await game.state()).G.hp).toBe(70);
  await page.waitForTimeout(300);
  await stone.click();
  expect((await game.state()).G.gold).toBe(5);
  expect((await game.state()).G.maxhp).toBe(70);
  await page.locator('#rPicks .pick').filter({ hasText: '离开商店' }).click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.floor).toBe(9);
  await expect(page.locator('#map .node.pick.boss')).toHaveCount(1);
});

// BOSS 胜利：legacy 靠半词击杀，new 必须拼完整词（1 血地板 + 授权闸门）。
// 两条路径最终都必须真的打开奖励面板；新版的额外断言是「半词不能赢」。
async function defeatBoss(game, page, testInfo) {
  const isLegacy = testInfo.project.metadata.target === 'legacy';
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await game.clickLetter('l');
  if (!isLegacy) expect((await game.state()).B.over).toBe(false);
  await page.keyboard.type('itre');                    // legacy 下战斗已结束，这几次输入被 B.over 挡下
  await expect(page.locator('#s-pick')).toBeVisible();
}

test('BOSS victory collects one reward card and next unit starts without stale battle', async ({ game, page }, testInfo) => {
  await game.open();
  await game.start();
  await defeatBoss(game, page, testInfo);
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oTitle')).toHaveText('远征成功！');
  await expect(page.locator('#oReward .reward-card')).toHaveCount(1);
  await expect(page.locator('#oReward')).toContainText('不代表已掌握全部词汇');
  const isLegacy = testInfo.project.metadata.target === 'legacy';
  // C1 有意漂移：「复习本单元」→「重新开始本单元（进度清零）」。
  // ⚠️ 这条 spec 同时跑 legacy 与 new 两个 project，而 legacy 跑的是**归档旧页** ——
  //   旧页当然还写着「复习本单元」。所以必须按 project 分支，不能只写新文案
  //   （我第一版漏了 legacy 那一支，legacy 侧当场变红）。
  await expect(page.locator('#oAgain')).toHaveText(isLegacy ? '复习本单元' : /重新开始/);
  // Legacy starts a fresh next-unit run; the campaign build continues this unit
  // until its vocabulary is complete. Preserve both actual target contracts.
  await expect(page.locator('#oNext')).toBeVisible();
  // C1 有意漂移：legacy 逐字保留旧措辞，new 只咬「继续」这个动作词。
  await expect(page.locator('#oNext')).toHaveText(isLegacy ? '继续 Unit 2' : /继续/);
  const win = await game.state();
  expect(win.DB.wins).toBe(1);
  expect(win.DB.rewards).toHaveLength(1);
  // legacy 半词赢 → 不记学会；new 拼完整词 → 恰好记一次
  if (testInfo.project.metadata.target === 'legacy') expect(win.DB.mastered).not.toContain('litre');
  else expect(win.DB.mastered.filter(w => w === 'litre')).toHaveLength(1);
  await page.evaluate(() => window.__gameTest.endRun(true));
  expect((await game.state()).DB.rewards).toHaveLength(1);
  const runId = await page.evaluate(() => window.__gameTest.G.id);
  await page.locator('#oNext').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const next = await game.state();
  expect(next.G.unit).toBe(isLegacy ? 2 : 1);
  expect(next.G.floor).toBe(1);
  expect(next.B).toBeNull();
  expect(next.DB.runs).toBe(isLegacy ? 2 : 1);
  if (!isLegacy) expect(await page.evaluate(() => window.__gameTest.G.id)).toBe(runId);
  await page.reload();
  await page.locator('#rewardSummary').click();
  await expect(page.locator('#rewardCards .reward-card')).toHaveCount(1);
  expect((await game.state()).DB.rewards[0]).toEqual(win.DB.rewards[0]);
});

test('last unit victory hides next-unit action in computed layout', async ({ game, page }, testInfo) => {
  // Unit 6 默认锁着：先按旧存档迁移口径把 Unit 1..6 的词都记为已掌握，
  // Unit 6 因此解锁；打完它就是本册最后一个单元。
  await game.open({ saved: { mastered: unlockAll(6) } });
  await game.start(6);
  await defeatBoss(game, page, testInfo);
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oNext')).toBeHidden();
  expect(await page.locator('#oNext').evaluate(el => getComputedStyle(el).display)).toBe('none');
  await expect(page.locator('#oText')).toContainText(testInfo.project.metadata.target === 'legacy'
    ? '已到本册最后一个单元' : '本册词汇已完成');
  await expect(page.locator('#oReward')).toContainText('Unit 6');
  await page.locator('#oAgain').click();
  expect((await game.state()).G.unit).toBe(6);
  expect((await game.state()).B).toBeNull();
});

test('skipping BOSS is a failed run with no reward or next-unit action', async ({ game, page }) => {
  await game.open();
  await game.start();
  await game.fight({ boss: true });
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oTitle')).toHaveText('远征结束');
  await expect(page.locator('#oReward')).toBeHidden();
  await expect(page.locator('#oNext')).toBeHidden();
  const state = await game.state();
  expect(state.DB.wins).toBe(0);
  expect(state.DB.rewards).toEqual([]);
  expect(state.B.won).toBe(false);
});
