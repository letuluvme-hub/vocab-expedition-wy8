/* 选词出招（docs/feature-word-choice.md）：真实浏览器里的整条路径。
 *  · 进战斗就有 2–3 张候选卡，只写中文与预估伤害，不回显英文；当前出招的那张高亮。
 *  · 点卡 / 按 Tab 换词：字母盘跟着换，血量、提示额度、学习记录一个不动。
 *  · 敲下第一个字母后锁定：卡片不可点，Tab 无效。
 *  · 暂停 → 刷新 → 继续：候选与当前词原样恢复。 */
import { test, expect } from './game-harness.js';
const newOnly = info => test.skip(info.project.metadata.target === 'legacy', 'Word choice is new');

async function enterBattle(page) {
  await page.evaluate(() => {
    const t = window.__gameTest;
    const node = t.G.avail.find(n => n.type === 'battle') || t.G.avail[0];
    node.type = 'battle';
    t.enterNode(node);
  });
  await expect(page.locator('#s-fight')).toBeVisible();
}
const facts = page => page.evaluate(() => {
  const { B, G, DB } = window.__gameTest;
  return { word: B.word.w, offer: B.offer.map(w => w.w), letters: B.letters.join(''), hp: B.myHp, hints: B.hints,
    done: [...G.done], wrong: [...G.wrong], mastered: [...DB.mastered] };
});

test('candidate cards show meanings and damage, never the English answer', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start(); await enterBattle(page);
  const f = await facts(page);
  expect(f.offer.length).toBeGreaterThanOrEqual(2);
  expect(f.offer).toContain(f.word);
  const cards = page.locator('#fOffer .wcCard');
  await expect(cards).toHaveCount(f.offer.length);
  await expect(page.locator('#fOffer .wcCard.on')).toHaveCount(1);
  const text = await page.locator('#fOffer').innerText();
  for (const w of f.offer) expect(text.toLowerCase()).not.toContain(w.toLowerCase());
  expect(text).toMatch(/字母/);
  // 预估伤害随字母数单调不减（同一场战斗、同一连击状态）
  const nums = await cards.evaluateAll(cs => cs.map(c => (c.textContent.match(/⚔(\d+)/) || [0, Infinity])[1] * 1));
  for (let i = 1; i < nums.length; i++) expect(nums[i]).toBeGreaterThanOrEqual(nums[i - 1]);
});

test('clicking a card or pressing Tab switches the word without touching any other fact', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start(); await enterBattle(page);
  const before = await facts(page);
  await page.locator('#fOffer .wcCard:not(.on)').first().click();
  const afterClick = await facts(page);
  expect(afterClick.word).not.toBe(before.word);
  expect(before.offer).toContain(afterClick.word);
  for (const ch of afterClick.word.toLowerCase().replace(/[^a-z]/g, '')) expect(afterClick.letters).toContain(ch);
  expect({ hp: afterClick.hp, hints: afterClick.hints, done: afterClick.done, wrong: afterClick.wrong, mastered: afterClick.mastered })
    .toEqual({ hp: before.hp, hints: before.hints, done: before.done, wrong: before.wrong, mastered: before.mastered });
  await page.keyboard.press('Tab');
  expect((await facts(page)).word).not.toBe(afterClick.word);
});

test('the first letter locks the choice', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start(); await enterBattle(page);
  const { word } = await facts(page);
  await page.keyboard.press(word.replace(/[^a-z]/gi, '')[0].toLowerCase());
  await expect(page.locator('#fOffer')).toHaveClass(/locked/);
  await expect(page.locator('#fOffer .wcCard:not(.on)').first()).toBeDisabled();
  await page.keyboard.press('Tab');
  expect((await facts(page)).word).toBe(word);
});

test('finishing a word deals the previewed damage', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start(); await enterBattle(page);
  await page.evaluate(() => { const t = window.__gameTest; t.B.enHp = t.B.enMax = 100000; t.renderFight(); });
  const preview = await page.locator('#fOffer .wcCard.on').innerText();
  const est = Number((preview.match(/⚔(\d+)/) || [])[1]);
  const { word } = await facts(page);
  await page.keyboard.type(word.replace(/[^a-z]/gi, '').toLowerCase());
  const dealt = await page.evaluate(() => window.__gameTest.B.enMax - window.__gameTest.B.enHp);
  expect(dealt).toBe(est);
});

test('pause, reload and continue restore the same candidates and current word', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start(); await enterBattle(page);
  await page.locator('#fOffer .wcCard:not(.on)').first().click();
  const before = await facts(page);
  await page.locator('#tPause').click();
  await page.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const after = await facts(page);
  expect({ word: after.word, offer: after.offer, letters: after.letters })
    .toEqual({ word: before.word, offer: before.offer, letters: before.letters });
  await expect(page.locator('#fOffer .wcCard.on')).toHaveCount(1);
});

test('backspacing every letter does not unlock the choice', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start(); await enterBattle(page);
  const { word } = await facts(page);
  await page.keyboard.press(word.replace(/[^a-z]/gi, '')[0].toLowerCase());
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.__gameTest.B.input.length)).toBe(0);
  await page.keyboard.press('Tab');
  expect((await facts(page)).word).toBe(word);
  await expect(page.locator('#fOffer')).toHaveClass(/locked/);
});

test('when the last word also kills the boss, the unit completion is recorded and the next unit opens', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    for (const w of t.G.pool) if (w.w !== 'litre') t.G.done.add(w.w);
  });
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await page.keyboard.type('litre');
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#oNext')).toHaveText('继续 Unit 2');
  const saved = await game.saved();
  expect(typeof saved.unitProgress['1'].completedAt).toBe('string');
  await page.locator('#oNext').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect(await page.evaluate(() => window.__gameTest.G.unit)).toBe(2);
});
