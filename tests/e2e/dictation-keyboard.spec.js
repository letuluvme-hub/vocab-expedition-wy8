import { test, expect } from './game-harness.js';
import { WORDS } from '../../src/data/words.js';

const newOnly = info => test.skip(info.project.metadata.target === 'legacy', 'Formal dictation is a new feature');
async function mountFormal(page, word) {
  await page.evaluate(async word => {
    const base = location.pathname;
    const rules = await import(base + 'src/domain/dictation.js');
    const { createDictationKeyboard } = await import(base + 'src/ui/components/dictation-keyboard.js');
    await import(base + 'src/styles/dictation.css');
    const host = document.createElement('section'); host.className = 'daily-dictation';
    host.style.cssText = 'width:100%;max-width:640px;margin:auto;padding:8px;box-sizing:border-box';
    const prompt = document.createElement('p'); prompt.textContent = '按中文意思默写';
    const input = document.createElement('p'); input.id = 'formalInput'; input.setAttribute('aria-live', 'polite');
    const feedback = document.createElement('p'); feedback.id = 'formalFeedback';
    const keys = document.createElement('div'); keys.id = 'formalKeys';
    host.append(prompt, input, feedback, keys);
    for(const child of document.body.children) child.style.display='none';
    document.body.appendChild(host);
    const attempt = rules.createDictationAttempt(word);
    const keyboard = createDictationKeyboard({ onInput: key => {
      rules.applyDictationInput(attempt, key);
      input.textContent = attempt.input; feedback.textContent = attempt.feedback;
      if (attempt.completed) rules.creditDictation(window.__gameTest.DB, attempt);
    }});
    keyboard.render(keys, word);
    document.addEventListener('keydown', event => keyboard.handleKey(event));
    window.formalTestAttempt = attempt;
  }, word);
}

for (const width of [320, 390]) {
  test(`formal reusable QWERTY keyboard fits ${width}px and click/typing both complete repeated letters`, async ({ game, page }, info) => {
    newOnly(info); await game.open(); await page.setViewportSize({ width, height: 720 });
    await mountFormal(page, 'letter');
    await expect(page.locator('#formalKeys button')).toHaveCount(27);
    await page.locator('#formalKeys [data-key="l"]').click();
    await page.keyboard.type('e');
    await page.locator('#formalKeys [data-key="t"]').click();
    await page.locator('#formalKeys [data-key="t"]').click();
    await page.keyboard.type('er');
    await expect(page.locator('#formalInput')).toHaveText('letter');
    const facts = await page.evaluate(() => ({
      mastered: window.__gameTest.DB.dictationMastered,
      pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
      keys: [...document.querySelectorAll('#formalKeys button')].map(b => {
        const r = b.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, disabled: b.disabled };
      }),
      input: document.getElementById('formalInput').getBoundingClientRect().bottom,
      keyboard: document.getElementById('formalKeys').getBoundingClientRect().top,
    }));
    expect(facts.mastered).toEqual(['letter']);
    expect(facts.pageWidth).toBeLessThanOrEqual(facts.viewport + 1);
    for (const key of facts.keys) { expect(key.left).toBeGreaterThanOrEqual(0); expect(key.right).toBeLessThanOrEqual(width); expect(key.height).toBeGreaterThanOrEqual(44); expect(key.disabled).toBe(false); }
    expect(facts.keyboard).toBeGreaterThanOrEqual(facts.input);
  });
}

test('formal wrong-order feedback only says 不对 and corrected word is still review-only', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await mountFormal(page, 'cat');
  await page.keyboard.type('a'); await expect(page.locator('#formalFeedback')).toHaveText('不对');
  await page.keyboard.type('cat'); await expect(page.locator('#formalInput')).toHaveText('cat');
  expect(await page.evaluate(() => window.__gameTest.DB.dictationMastered)).toEqual([]);
  expect(await page.evaluate(() => window.__gameTest.DB.reviewQueue)).toEqual(['cat']);
});

test('lower-book ellipsis phrases keep spaces and permit repeated punctuation on the complete keyboard',async({game,page},info)=>{
  newOnly(info);await game.open();await page.setViewportSize({width:320,height:720});
  const word={w:'prefer ... to',z:'更喜欢……',u:1,d:2,th:'个性',bookId:'wy8b'};
  await mountFormal(page,word);await expect(page.locator('#formalKeys button')).toHaveCount(29);
  await page.keyboard.type('prefer');await page.locator('#formalKeys [data-key=" "]').click();
  for(let i=0;i<3;i++)await page.locator('#formalKeys [data-key="."]').click();
  await page.keyboard.type(' to');await expect(page.locator('#formalInput')).toHaveText('prefer ... to');
  expect(await page.evaluate(()=>window.__gameTest.DB.dictationMastered)).toEqual([word]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

// 2026-10 预习模式起统一「学会」口径：远征里整词拼对过的词也算学会，解锁和成长都认。
test('a legacy all-practiced save counts as learned: units unlock and new runs get growth', async ({ game, page }, info) => {
  newOnly(info); const original = WORDS.map(w => w.w);
  await game.open({ saved: { mastered: original, unitProgress: { 1: { complete: true } }, future: { keep: 1 } } });
  await expect(page.locator('#units [data-unit="6"]')).toBeEnabled();
  await expect(page.locator('#sMaster')).toHaveText(String(WORDS.length));
  await expect(page.locator('#masteryGrowth .mgrowth-count')).toContainText(`${WORDS.length}/467`);
  await game.start(); const g = await page.evaluate(() => ({ bonus: window.__gameTest.G.growth.bonusHp, maxhp: window.__gameTest.G.maxhp })); expect(g.bonus).toBe(12); expect(g.maxhp).toBe(80 + 12);
  const saved = await game.saved(); expect(saved.mastered).toEqual(original);
  expect(saved.dictationMastered).toEqual([]); expect(saved.future).toEqual({ keep: 1 });
});

test('free wrong-order practice retains historical records, queues review and never grants formal mastery', async ({ game, page }, info) => {
  newOnly(info); await game.open({ saved: { mastered: ['litre'] } });
  await game.start(); await game.fight({ word: 'litre' });
  await page.keyboard.type('i');
  let state = await game.state(); expect(state.G.wrong).toEqual(['litre']);
  expect(state.DB.reviewQueue).toEqual(['litre']); expect(state.DB.mastered).toEqual(['litre']);
  await page.keyboard.type('litre');
  state = await game.state(); expect(state.DB.mastered).toEqual(['litre']);
  expect(state.G.wrong).toEqual(['litre']); expect(state.DB.reviewQueue).toEqual(['litre']);
  expect(state.DB.dictationMastered).toEqual([]);
});
