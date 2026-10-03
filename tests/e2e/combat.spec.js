import { test, expect, STORAGE_KEY } from './game-harness.js';
import { WORDS } from '../../src/data/words.js';

const combatOutcome = state => ({
  input: state.B.input, used: state.B.used, bad: state.B.bad,
  hp: state.B.myHp, enemyHp: state.B.enHp, combo: state.B.combo,
  att: state.G.att, attOk: state.G.attOk,
});

test('click and physical keyboard yield identical repeated-letter combat outcomes', async ({ game, page }) => {
  await game.open();
  await game.start();
  await game.fight({ word: 'cotton' });
  await game.clickLetter('c');
  await game.clickLetter('o');
  await game.clickLetter('t');
  await game.clickLetter('t');
  const clicked = combatOutcome(await game.state());
  await page.reload();
  // The new build keeps the unfinished run. This comparison deliberately starts
  // a fresh run, so accept its explicit discard confirmation rather than silently
  // bypassing the progress UI. The archived page has no such dialog.
  page.once('dialog', dialog => dialog.accept());
  await game.start();
  await game.fight({ word: 'cotton' });
  await page.keyboard.type('Cott');
  expect(combatOutcome(await game.state())).toEqual(clicked);
  await expect(page.locator('#fSlots .slot.f')).toHaveText(['c', 'o', 't', 't']);
  await page.keyboard.press('Backspace');
  expect((await game.state()).B.input).toEqual(['c', 'o', 't']);
  await page.keyboard.type('t');
  const undone = await game.state();
  expect(undone.B.input).toEqual(clicked.input);
  expect(undone.B.used).toEqual(clicked.used);
  expect(undone.G.attOk).toBe(clicked.attOk);
  // Legacy undo releases the letter but does not rewind damage/attempts.
  expect(undone.B.enHp).toBeLessThan(clicked.enemyHp);
  expect(undone.G.att).toBe(clicked.att + 1);
});

// 归档旧页保留「半词击杀」行为（本项目已修，见 tests/e2e/whole-word.spec.js）。
// 这里继续断言旧版事实，让基线可对照；新版跑的是新的验收标准。
test('partial word kill never becomes mastered or retired', async ({ game, page }, testInfo) => {
  test.skip(testInfo.project.metadata.target !== 'legacy', 'Legacy archived behavior only');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre', enemyHp: 1 });
  await game.clickLetter('l');
  const state = await game.state();
  expect(state.B.over).toBe(true);
  expect(state.B.won).toBe(true);
  expect(state.B.input).toEqual(['l']);
  expect(state.DB.mastered).not.toContain('litre');
  expect(state.G.done).not.toContain('litre');
  expect(state.B.wordsDone).toBe(0);
  await expect(page.locator('#s-pick')).toBeVisible();
  await expect(page.locator('#pSub')).toContainText('没拼完，不算学会');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.mastered).not.toContain('litre');
});

test('a partial word no longer ends the fight in the current build', async ({ game, page }, testInfo) => {
  test.skip(testInfo.project.metadata.target === 'legacy', 'New regression guard for bug-whole-word');
  await game.open();
  await game.start();
  await game.fight({ word: 'litre', enemyHp: 1 });
  await game.clickLetter('l');
  const state = await game.state();
  expect(state.B.over).toBe(false);
  expect(state.B.won).toBe(false);
  expect(state.DB.mastered).not.toContain('litre');
  expect(state.G.kills).toBe(0);
  await expect(page.locator('#s-fight')).toBeVisible();
});

test('complete phrase with repeated letters credits exactly one mastered word on killing blow', async ({ game, page }) => {
  // 任务 7 之后 Unit 2 默认锁着：这里显式按「Unit 1 词汇已全部掌握」解锁它，
  // 这本身就是保守迁移口径的一次真实浏览器验证。
  await game.open({ saved: { mastered: WORDS.filter(w => w.u === 1).map(w => w.w), dictationMastered: WORDS.filter(w => w.u === 1).map(w => w.w) } });
  await game.start(2);
  await game.fight({ word: 'keep an eye on' });
  await expect(page.locator('#fSlots .slot')).toHaveCount(11);
  await expect(page.locator('#fSlots .slotsep')).toHaveCount(3);
  await expect(page.locator('#fCat')).toContainText('11 字符 · 词组');
  await page.keyboard.type('keepaneyeo');
  expect((await game.state()).DB.mastered).not.toContain('keep an eye on');
  // A final-letter kill invokes both winFight and the word-completion branch.
  await page.evaluate(() => { const t = window.__gameTest; t.B.enHp = 1; t.renderFight(); });
  await game.clickLetter('n');
  const state = await game.state();
  expect(state.B.input.join('')).toBe('keepaneyeon');
  expect(state.B.wordsDone).toBe(1);
  expect(state.DB.mastered.filter(w => w === 'keep an eye on')).toHaveLength(1);
  expect(state.G.done.filter(w => w === 'keep an eye on')).toHaveLength(1);
  expect(state.G.kills).toBe(1);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.mastered.filter(w => w === 'keep an eye on')).toHaveLength(1);
  await expect(page.locator('#s-pick')).toBeVisible();
  await expect(page.locator('#pSub')).not.toContainText('没拼完');
});

test('QWERTY uppercase switches preserve in-progress input and consumed letter instances', async ({ game, page }) => {
  // 这条用例测的是「点一下切到键盘、再点一下切回网格」，所以必须显式从网格出发：
  // 任务14 起无 kbMode 字段的新档默认已是 QWERTY。legacy 归档页默认仍是网格，
  // 但显式写 false 对两个目标都是合法的旧档，两边行为一致。
  await game.open({ saved: { kbMode: false } });
  await game.start();
  await game.fight({ word: 'cotton' });
  await expect(page.locator('#fBank')).not.toHaveClass(/kb/);
  await page.keyboard.type('cot');
  const before = await game.state();
  await page.locator('#tBankMode').click();
  await expect(page.locator('#fBank')).toHaveClass(/kb/);
  await expect(page.locator('#fBank .kbrow')).toHaveCount(3);
  const qwerty = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const rows = await page.locator('#fBank .kbrow').evaluateAll(elements => elements.map(el => [...el.querySelectorAll('.key')].map(k => k.textContent.toLowerCase())));
  for (const letters of rows) {
    const layout = qwerty.find(row => row.includes(letters[0]));
    expect(letters.every(ch => layout.includes(ch))).toBe(true);
    expect(letters.map(ch => layout.indexOf(ch))).toEqual(letters.map(ch => layout.indexOf(ch)).sort((a, b) => a - b));
  }
  await page.locator('#tBankCase').click();
  await expect(page.locator('#tBankCaseV')).toHaveText('开');
  expect(await page.locator('#fBank .key').first().evaluate(el => getComputedStyle(el).textTransform)).toBe('uppercase');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  const switched = await game.state();
  expect(combatOutcome(switched)).toEqual(combatOutcome(before));
  await page.locator('#tBankMode').click();
  await expect(page.locator('#fBank')).not.toHaveClass(/kb/);
  expect(combatOutcome(await game.state())).toEqual(combatOutcome(before));
  await page.keyboard.type('ton');
  expect((await game.state()).DB.mastered).toContain('cotton');
  await page.reload();
  const saved = (await game.state()).DB;
  expect(saved.kbMode).toBe(false);
  expect(saved.kbUpper).toBe(true);
});

test('listen is unavailable and consumes no hints without browser speech support', async ({ game, page }) => {
  await game.open({ noSpeech: true });
  await game.start();
  await game.fight();
  await expect(page.locator('#tSay')).toHaveClass(/off/);
  await expect(page.locator('#tSayV')).toHaveText('不可用');
  expect(await page.evaluate(() => window.__gameTest.TTS.supported)).toBe(false);
  const before = await game.state();
  const hints = await page.evaluate(() => window.__gameTest.B.hints);
  await page.locator('#tSay').click();
  expect(combatOutcome(await game.state())).toEqual(combatOutcome(before));
  expect(await page.evaluate(() => window.__gameTest.B.hints)).toBe(hints);
  await expect(page.locator('#tSay')).not.toHaveClass(/on2/);
  await expect(page.locator('#fMsg')).toContainText('不支持语音朗读');
});
