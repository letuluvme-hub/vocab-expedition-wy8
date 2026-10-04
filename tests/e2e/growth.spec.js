// 知识成长的真实浏览器验收（docs/feature-mastery-growth.md 接线部分）。
//
// 真实度约定：
//  - 掌握词直接写进存档原文，走真实的 initializeDB 与成长摘要计算；
//  - 生命上限来自真实的「开始远征 → createRun」路径，读的是 G.maxhp；
//  - 「本局学完 20 词」走真实的整词输入路径（键盘 → typeLetter → pressKey），
//    不是直接改 DB.mastered —— 否则测的是探针而不是游戏；
//  - 320px 无溢出量真实 DOM（scrollWidth vs clientWidth），不是数 CSS 规则。
import { test, expect } from './game-harness.js';
import { WORDS } from '../../src/data/words.js';

const newOnly = (testInfo, why) => {
  if (testInfo.project.metadata.target === 'legacy') test.skip(true, why);
};
const panel = page => page.locator('#masteryGrowth');
const realWords = n => WORDS.slice(0, n).map(w => w.w);

test('the home page states real mastery growth and reports the 467-word catalog', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Mastery growth is a new regression guard');
  await game.open({ saved: { dictationMastered: realWords(40) } });

  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator('.mgrowth-h')).toHaveText('知识成长');
  // 原八上40词仍给+2；总分母随两册目录增加到467。
  await expect(panel(page).locator('.mgrowth-count')).toHaveText('教材词汇 40/467 · 下轮生命上限 +2（最多+12）');
  await expect(panel(page).locator('.mgrowth-next')).toContainText('再学 20 个教材词');
  // 说明必须写清只在新一轮生效（用户最容易误读的三条）。
  await expect(panel(page).locator('.mgrowth-note')).toContainText('只在新开一轮远征时生效');

  // 掌握表里的未知词不增加分子；总分母来自两册目录。
  const txt = await panel(page).locator('.mgrowth-count').textContent();
  expect(txt).toContain('/467');
});

test('custom-only words earn nothing: 500 of them still say +0', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Mastery growth is a new regression guard');
  const custom = Array.from({ length: 500 }, (_, i) => ({ w: 'myword' + i, z: '词' + i }));
  await game.open({ saved: { custom, dictationMastered: custom.map(x => x.w) } });

  await expect(panel(page).locator('.mgrowth-count')).toContainText('教材词汇 0/467 · 下轮生命上限 +0');
});

test('a new round really raises max hp by the growth bonus, and only at the new round', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Mastery growth is a new regression guard');
  await game.open({ saved: { dictationMastered: realWords(40) } });
  await game.start();

  // 学者基础 70+10=80，40 词 = +2 → 82。开局满血。
  const s = await game.state();
  expect(s.G.maxhp, '新一局真的把成长加进了生命上限').toBe(82);
  expect(s.G.hp, '开局满血：加的是上限不是凭空回血').toBe(82);
  expect(s.G.heroId).toBe('scholar');
});

test('reaching 20 words mid-run does not change this round max hp; the next round gains +1', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Mastery growth is a new regression guard');
  await game.open({ saved: { dictationMastered: realWords(19) } });   // 19 词 = 仍 +0
  await game.start();

  let s = await game.state();
  expect(s.G.maxhp, '19 词还没到门槛').toBe(80);

  // 真实地整词拼完一个词（走 typeLetter → pressKey），跨过 20 词门槛。
  // 这词必须是**不在**已种入的 19 词里、且属于 Unit 1（否则拼完也不计数）。
  const word = 'hamburger';
  await game.fight({ word, enemyHp: 10_000 });
  for (const ch of word) await page.keyboard.type(ch);
  await expect.poll(async () => (await game.state()).DB.mastered.length).toBe(1);

  // 自由远征只能写练习记录；成长门槛必须由一次真实正式默写规则产生。
  await page.evaluate(async word => {
    const {createDictationAttempt,applyDictationInput,creditDictation}=await import('/vocab-expedition-wy8/src/domain/dictation.js');
    const attempt=createDictationAttempt(word);
    for(const key of word) applyDictationInput(attempt,key);
    creditDictation(window.__gameTest.DB,attempt);
  }, word);
  expect((await game.state()).DB.dictationMastered).toHaveLength(20);
  s = await game.state();
  expect(s.G.maxhp, '本局中途达到门槛绝不改本局上限').toBe(80);
  expect(s.G.hp).toBe(80);

  // 放弃这一局，再开一轮：这一次才生效。
  await page.evaluate(() => window.__gameTest.endRun(false));
  await page.locator('#oAgain').click();
  await expect(page.locator('#s-map')).toBeVisible();

  s = await game.state();
  expect(s.G.maxhp, '只有新开一轮才拿到 +1').toBe(81);
  expect(s.G.hp).toBe(81);
});

test('pause then reload restores the same growth instead of recomputing it', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Mastery growth is a new regression guard');
  await game.open({ saved: { dictationMastered: realWords(40) } });
  await game.start();
  expect((await game.state()).G.maxhp).toBe(82);

  await game.fight({ word: 'litre', enemyHp: 10_000 });
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();

  // 暂停期间把存档里的掌握表改成「全部 259 词」：若恢复路径偷重算，
  // 刷新后就会跳到 +12 —— 这正是必须防住的白赚一次上限。
  await game.writeSaved({ ...(await game.saved()), dictationMastered: realWords(259) });
  await game.reload();

  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();

  const s = await game.state();
  expect(s.G.maxhp, '恢复必须原样尊重盘上的 82，不按当前 DB 重算').toBe(82);
  // 恢复出来的血量仍是真实战况（本局战斗刚开始，没掉血）。
  expect(s.B.myHp).toBe(82);
});

test('crossing into the next unit adds nothing on top of the growth bonus', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Mastery growth is a new regression guard');
  // Unit 1 全部词汇已掌握 → 可以合法过渡到 Unit 2；开局 40 词 = +2。
  await game.open({ saved: { dictationMastered: realWords(40) } });
  await game.start();

  const before = await game.state();
  expect(before.G.maxhp, '开局已经带上 +2').toBe(82);
  expect(before.G.unit).toBe(1);

  // 走真实的「词池抽干 → 词汇完成检查点」路径：把 Unit 1 备到只剩最后一个词，
  // 再真键盘敲完它。这是唯一合法的跨单元来源相位（LEARNING_COMPLETE）。
  // 学习记录（DB.mastered）不动 —— 它已经决定了这局的 +2 开局加成。
  const prepared = await page.evaluate(() => {
    const t = window.__gameTest;
    const words = t.WORDS.filter(w => w.u === 1);
    // 此用例只验证过渡不叠加；其余单元词已通过正式默写。
    t.DB.dictationMastered = words.map(w=>w.w);
    // 本局退休集合：只留最后一个词，其余整词「已退休」——抽词因此只剩它。
    t.G.pool = words.slice();
    t.G.done = new Set(words.slice(0, words.length - 1).map(w => w.w));
    t.G.wrong = [];
    return { pending: t.G.pool.filter(w => !t.G.done.has(w.w)).map(w => w.w) };
  });
  const lastWord = prepared.pending[0];

  await game.fight({ word: lastWord, enemyHp: 10_000 });
  for (const ch of lastWord) await page.keyboard.type(ch);
  await expect(page.locator('#s-learning-complete')).toBeVisible();

  // 点真实的「继续 Unit 2」按钮。
  await page.locator('#lcBtnNext').click();
  await expect(page.locator('#s-map')).toBeVisible();

  const s = await game.state();
  expect(s.G.unit, '真的过渡到 Unit 2').toBe(2);
  expect(s.G.maxhp, '跨单元不再额外增加，仍是 82').toBe(82);
  expect(s.G.hp, '也不额外回血').toBe(82);
  expect(s.DB.runs, '跨单元不算新开一轮').toBe(1);
});

test('the growth panel fits a 320px screen without horizontal overflow', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Mastery growth is a new regression guard');
  // 故意写一条超长的坏词条：展示层必须换行，不能撑破布局。
  await game.open({ saved: { dictationMastered: [...realWords(40), 'x'.repeat(120)] } });
  await page.setViewportSize({ width: 320, height: 720 });

  await expect(panel(page)).toBeVisible();
  const overflow = await panel(page).evaluate(el => ({
    scroll: el.scrollWidth, client: el.clientWidth,
    pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
  }));
  expect(overflow.scroll, '知识成长区在 320px 下不得横向溢出').toBeLessThanOrEqual(overflow.client + 1);
  expect(overflow.pageWidth, '整页在320px下不得横向溢出').toBeLessThanOrEqual(overflow.viewport + 1);
});
