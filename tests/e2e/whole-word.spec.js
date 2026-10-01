import { test, expect } from './game-harness.js';

/* ============================================================
 * 最终击杀必须完成当前整词（真实浏览器）
 *
 * 这是 bug-whole-word 的端到端验收：单字母 / 荆棘等非完整词伤害都杀不死敌人，
 * 战斗会一直持续到玩家把当前这个词完整拼出来，由整词大招收尾。
 *
 * 全部跑 new 项目（legacy 归档页保留旧的半词击杀行为，是对照基线不是本 bug）。
 * ============================================================ */

const newOnly = (testInfo, why) =>
  test.skip(testInfo.project.metadata.target === 'legacy', why);

// 把敌人压到 1 血：模拟「再一下就打死」的临界局面。
async function crippleEnemy(page) {
  await page.evaluate(() => { const t = window.__gameTest; t.B.enHp = 1; t.renderFight(); });
}

test('a single letter on a one-HP enemy cannot end the fight', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre' });
  await crippleEnemy(page);
  await game.clickLetter('l');                       // 这一击在旧版直接杀死敌人

  const state = await game.state();
  expect(state.B.over).toBe(false);
  expect(state.B.won).toBe(false);
  expect(state.B.enHp).toBe(1);                      // 1 血地板：打不死，但能削血
  expect(state.B.input).toEqual(['l']);
  expect(state.G.kills).toBe(0);
  expect(state.DB.mastered).not.toContain('litre');
  expect(state.G.done).not.toContain('litre');
  expect(state.B.wordsDone).toBe(0);
  await expect(page.locator('#s-fight')).toBeVisible();
  await expect(page.locator('#s-pick')).toBeHidden();  // 奖励面板不得出现
});

test('the player must finish the current word after being pinned at one HP', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre' });
  await crippleEnemy(page);
  await page.keyboard.type('lit');                    // 前三个字母，敌人被压到地板
  const partial = await game.state();
  expect(partial.B.over).toBe(false);
  expect(partial.B.enHp).toBe(1);
  expect(partial.DB.mastered).not.toContain('litre');
  await expect(page.locator('#s-pick')).toBeHidden();

  await page.keyboard.type('re');                     // 整词拼完 → 大招收尾
  const won = await game.state();
  expect(won.B.over).toBe(true);
  expect(won.B.won).toBe(true);
  expect(won.B.input.join('')).toBe('litre');
  expect(won.B.wordsDone).toBe(1);
  expect(won.DB.mastered.filter(w => w === 'litre')).toHaveLength(1);
  expect(won.G.done.filter(w => w === 'litre')).toHaveLength(1);
  expect(won.G.kills).toBe(1);
  await expect(page.locator('#s-pick')).toBeVisible();
  await expect(page.locator('#pSub')).not.toContainText('没拼完');
});

test('a correct letter never advances the word or sets B.over mid-word', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre' });
  await crippleEnemy(page);
  await page.keyboard.type('lit');
  const state = await game.state();
  expect(state.B.input.join('')).toBe('lit');
  expect(state.B.over).toBe(false);
  expect(state.B.wordsDone).toBe(0);
  expect(state.DB.mastered).toEqual([]);
  // 词还没拼完：已填槽位只有 lit，整词槽位仍是 5 个，不能被「赢」提前结算
  await expect(page.locator('#fSlots .slot.f')).toHaveText(['l', 'i', 't']);
  await expect(page.locator('#fSlots .slot')).toHaveCount(5);
});

test('the last letter cannot win before the word finisher runs', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre' });
  await crippleEnemy(page);
  await page.keyboard.type('litr');                   // 只差最后一个字母
  const before = await game.state();
  expect(before.B.over).toBe(false);
  expect(before.B.enHp).toBe(1);

  await game.clickLetter('e');
  const after = await game.state();
  expect(after.B.over).toBe(true);
  expect(after.B.wordsDone).toBe(1);                  // 计数只来自整词大招那一次
  expect(after.DB.mastered.filter(w => w === 'litre')).toHaveLength(1);
  expect(after.G.kills).toBe(1);
});

test('repeated final keypresses and extra damage settle victory exactly once', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre' });
  await page.keyboard.type('lit');
  await crippleEnemy(page);
  await page.keyboard.type('r');                       // 只差最后一个字母 e
  // 连点最后一个字母：多路伤害、多重 winFight 入口
  await page.locator('#fBank .key:not(.out):not(.gone)').filter({ hasText: /^e$/i }).first()
    .evaluate(el => { el.click(); el.click(); el.click(); });
  await expect(page.locator('#s-pick')).toBeVisible();

  const state = await game.state();
  expect(state.B.wordsDone).toBe(1);
  expect(state.G.kills).toBe(1);
  expect(state.DB.mastered.filter(w => w === 'litre')).toHaveLength(1);
  expect(state.G.done.filter(w => w === 'litre')).toHaveLength(1);
  // 奖励面板只能兑现一次：领奖后推进一层，且金币/掌握表不被二次改动
  expect(await page.locator('#pPicks .pick').count()).toBeGreaterThan(0);
  const goldBefore = state.G.gold;
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-map')).toBeVisible();
  const settled = await game.state();
  expect(settled.G.floor).toBe(2);
  expect(settled.DB.mastered.filter(w => w === 'litre')).toHaveLength(1);
  // 连点「跳过奖励」：rewardTaken 闸门必须挡住，不会二次推进层数
  await page.evaluate(() => { const t = window.__gameTest; t.winFight(); });
  expect((await game.state()).G.floor).toBe(2);
  expect(goldBefore).toBeGreaterThan(0);
});

test('a direct winFight call is rejected while the word is unfinished', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre' });
  await crippleEnemy(page);
  await page.keyboard.type('l');
  // 生产代码的授权闸门必须挡住任何直接调用（探针 / 将来新增的伤害来源）
  const direct = await page.evaluate(() => {
    const t = window.__gameTest;
    t.winFight();                                    // 半词：必须被拒绝
    return { over: t.B.over, won: !!t.B.won, kills: t.G.kills };
  });
  expect(direct.over).toBe(false);
  expect(direct.won).toBe(false);
  expect(direct.kills).toBe(0);
  await expect(page.locator('#s-fight')).toBeVisible();

  // 拼完整词后同一个入口放行，且只放行一次
  await page.keyboard.type('itre');
  await expect(page.locator('#s-pick')).toBeVisible();
  const again = await page.evaluate(() => {
    const t = window.__gameTest;
    t.winFight();                                    // 已结算：必须被拒绝
    return { kills: t.G.kills, wordsDone: t.B.wordsDone, mastered: t.DB.mastered.length };
  });
  expect(again.kills).toBe(1);
  expect(again.wordsDone).toBe(1);
  expect(again.mastered).toBe(1);
});

test('a BOSS cannot be killed by a partial word', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ boss: true, word: 'litre' });
  await crippleEnemy(page);
  await game.clickLetter('l');
  const partial = await game.state();
  expect(partial.B.over).toBe(false);
  expect(partial.DB.wins).toBe(0);
  expect(partial.B.boss).toBe(true);
  await expect(page.locator('#s-fight')).toBeVisible();

  // 拼完整个词 → 击败词汇之王 → 奖励 → 通关结算
  await page.keyboard.type('itre');
  await expect(page.locator('#pTitle')).toContainText('击败词汇之王');
  const won = await game.state();
  expect(won.DB.wins).toBe(0);                       // 通关在领奖后才记账
  expect(won.DB.mastered.filter(w => w === 'litre')).toHaveLength(1);
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  expect((await game.state()).DB.wins).toBe(1);
});

test('single-letter vocabulary words still complete and can win', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Half-word kill prevention is a new regression guard');
  // 题库自定义词表里放一个单字母英语词：「i」
  await game.open({ saved: { custom: [{ w: 'i', z: '我' }] } });
  await game.start(0);
  await game.fight({ word: 'i', enemyHp: 1 });
  await expect(page.locator('#fSlots .slot')).toHaveCount(1);
  await game.clickLetter('i');
  const won = await game.state();
  expect(won.B.over).toBe(true);
  expect(won.B.won).toBe(true);
  expect(won.B.input).toEqual(['i']);
  expect(won.B.wordsDone).toBe(1);
  expect(won.DB.mastered.filter(w => w === 'i')).toHaveLength(1);
  expect(won.G.kills).toBe(1);
});