// 单词预习（2026-10 起替代每日默写）的真实浏览器验收：
// 任选教材册和单元、整个单元一次过完、提示不限次数、可以跳过、刷新接着练、
// 不看提示拼对记为学会（mastered），预习不写正式默写记录。
import { test, expect } from './game-harness.js';
import { wordsFor } from '../../src/data/books.js';

const only = info => test.skip(info.project.metadata.target === 'legacy', 'Preview is new UI');
const target = page => page.evaluate(() => JSON.parse(localStorage.getItem('wy8a_rogue_v1')).dailySession.attempt.target);

for (const width of [320, 390]) {
  test(`preview a whole 八下 unit with unlimited hints, skip and reload at ${width}px`, async ({ game, page }, info) => {
    only(info);
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await game.open();
    await page.locator('#dailyEntry > summary').click();
    await expect(page.locator('#dailyOpen')).toHaveText('开始预习');
    await page.locator('#dailyOpen').click();
    await page.locator('#dailyBook').selectOption('wy8b');
    await page.locator('#dailyUnit').selectOption('3');
    await page.locator('#dailyStart').click();
    await expect(page.locator('#dailyStage')).toHaveText('单词预习');
    const total = wordsFor('wy8b', 3).length;
    await expect(page.locator('#dailyProgress')).toContainText(`第 1 / ${total} 词`);

    // 第 1 个词：先连点三次提示（不限次数），再自己拼完 —— 拼完了但不算学会。
    const first = await target(page);
    for (let i = 0; i < Math.min(3, first.length - 1); i++) await page.locator('#dailyHint').click();
    await expect(page.locator('#dailyInput')).toHaveText(first.slice(0, Math.min(3, first.length - 1)));
    await page.keyboard.type(first.slice(Math.min(3, first.length - 1)));
    await expect(page.locator('#dailyDoneNote')).toContainText('用了');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(overflow).toBeLessThanOrEqual(width);
    await page.locator('#dailyNext').click();

    // 第 2 个词：直接跳过。
    await page.locator('#dailySkip').click();
    await expect(page.locator('#dailyProgress')).toContainText(`第 3 / ${total} 词`);

    // 第 3 个词拼一半刷新，回来接着拼。
    const third = await target(page);
    await page.keyboard.type(third.slice(0, 1));
    await game.reload();
    await page.locator('#dailyEntry > summary').click();
    await expect(page.locator('#dailyOpen')).toHaveText('继续预习');
    await page.locator('#dailyOpen').click();
    await page.locator('#dailyResume').click();
    await expect(page.locator('#dailyInput')).toHaveText(third.slice(0, 1));
    await page.keyboard.type(third.slice(1));
    await page.locator('#dailyNext').click();

    for (let i = 3; i < total; i++) {
      await page.keyboard.type(await target(page));
      await page.locator('#dailyNext').click();
    }
    await expect(page.locator('#dailyStage')).toHaveText('预习完成');
    await expect(page.locator('#dailySummary')).toContainText(`拼完 ${total - 1} / ${total} 词`);
    await expect(page.locator('#dailySummary')).toContainText(`不看提示拼对 ${total - 2} 词`);
    await expect(page.locator('#dailySummary')).toContainText('跳过 1 词');
    const saved = await game.saved();
    expect(saved.dictationMastered).toEqual([]);
    const learned = saved.mastered.filter(w => w && w.bookId === 'wy8b');
    expect(learned).toHaveLength(total - 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(game.errors).toEqual([]);
  });
}

test('preview opens every unit of every book, including units the expedition still locks', async ({ game, page }, info) => {
  only(info);
  await game.open();
  await expect(page.locator('#units [data-unit="6"]')).toBeDisabled();
  await page.locator('#dailyEntry > summary').click();
  await page.locator('#dailyOpen').click();
  for (const book of ['wy8a', 'wy8b']) {
    await page.locator('#dailyBook').selectOption(book);
    await expect(page.locator('#dailyUnit option')).toHaveCount(7);
  }
  await page.locator('#dailyBook').selectOption('wy8a');
  await page.locator('#dailyUnit').selectOption('6');
  await page.locator('#dailyStart').click();
  await expect(page.locator('#dailyProgress')).toContainText(`第 1 / ${wordsFor('wy8a', 6).length} 词`);
});
