import { test, expect } from './game-harness.js';

test.beforeEach(({}, info) => test.skip(info.project.metadata.target === 'legacy', 'P0 is additive'));
const zeroQ = { wrong: 0, hint: 0, listen: 0, revealed: 0 };
const zeroStats = { words: 0, perfect: 0, good: 0, rescue: 0,
  hintsUsed: 0, wrongLetters: 0, listenUsed: 0 };
const quality = page => page.evaluate(() => ({ q: window.__gameTest.B.wordQ, s: window.__gameTest.G.qStats }));

test('P0: listen action counts once even for double playback, denied actions do not', async ({ game, page }) => {
  await game.open({ speechStub: true }); await game.start(); await game.fight();
  expect((await quality(page)).q).toEqual(zeroQ);
  expect(await page.evaluate(() => window.__gameTest.sayCurrentWord(2))).toBe(true);
  expect((await quality(page)).q).toEqual({ ...zeroQ, listen: 1 });
  expect((await game.state()).B.hints).toBe(2);
  await page.evaluate(() => { window.__gameTest.B.hints = 0; });
  expect(await page.evaluate(() => window.__gameTest.sayCurrentWord(1))).toBe(false);
  expect((await quality(page)).q.listen).toBe(1);
});

test('P0: nextHint and scholar automatic first-letter reveals are recorded', async ({ game, page }) => {
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest; t.G.nextHint = true;
    t.startFight(t.G.avail[0]);
  });
  expect((await quality(page)).q).toEqual({ ...zeroQ, hint: 1, revealed: 1 });
  await page.evaluate(() => {
    const t = window.__gameTest; t.G.relics.push('scholar'); t.B.enHp = 10000;
    for (const ch of t.norm(t.B.word.w)) t.typeLetter(ch);
  });
  expect((await quality(page)).q).toEqual({ ...zeroQ, hint: 1, revealed: 1 });
  expect((await quality(page)).s.words).toBe(1);
  expect((await quality(page)).s.perfect).toBe(0);
});

test('P0: ordinary next word and next battle reset word markers but retain run totals', async ({ game, page }) => {
  await game.open(); await game.start(); await game.fight();
  await page.locator('#tHint').click();
  await page.keyboard.type('litre');
  expect((await quality(page)).q).toEqual(zeroQ);
  expect((await quality(page)).s).toEqual({ ...zeroStats, words: 1, good: 1, hintsUsed: 1 });
  await page.evaluate(() => {
    const t = window.__gameTest; t.startFight(t.G.node);
  });
  expect((await quality(page)).q).toEqual(zeroQ);
  expect((await quality(page)).s.words).toBe(1);
});

test('P0: pause and real refresh preserve help and totals without recounting', async ({ game, page }) => {
  await game.open({ speechStub: true }); await game.start(); await game.fight();
  await page.locator('#tHint').click(); await page.locator('#tSay').click();
  await page.keyboard.type('l');
  const before = await quality(page);
  expect(before.q).toEqual({ ...zeroQ, hint: 1, listen: 1, revealed: 1 });
  await page.locator('#tPause').click();
  const saved = await game.saved();
  expect(saved.activeRun.battle.wordQ).toEqual(before.q);
  expect(saved.activeRun.run.qStats).toEqual(before.s);
  await game.reload(); await page.locator('#continueRun').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  expect(await quality(page)).toEqual(before);
  await page.locator('#pzResume').click(); await page.keyboard.type('itre');
  const after = await quality(page);
  expect(after.q).toEqual(zeroQ);
  expect(after.s).toEqual({ ...zeroStats, words: 1, good: 1, hintsUsed: 1, listenUsed: 1 });
  await page.locator('#tPause').click(); await game.reload();
  await page.locator('#continueRun').click();
  expect((await quality(page)).s).toEqual(after.s);
});

test('P0: legacy snapshot completes as good, never as a fabricated perfect', async ({ game, page }) => {
  await game.open(); await game.start(); await game.fight();
  await page.keyboard.type('l'); await page.locator('#tPause').click();
  const db = await game.saved(); delete db.activeRun.battle.wordQ; delete db.activeRun.run.qStats;
  await game.writeSaved(db); await game.reload(); await page.locator('#continueRun').click();
  expect((await quality(page)).q).toEqual({ ...zeroQ, wrong: 1 });
  await page.locator('#pzResume').click(); await page.keyboard.type('itre');
  expect((await quality(page)).s).toEqual({ ...zeroStats, words: 1, good: 1, wrongLetters: 1 });
});

test('P0: settlement displays real totals and writes one capped history with no active snapshot', async ({ game, page }) => {
  const old = Array.from({ length: 20 }, (_, i) => ({ endedAt: new Date(i * 1000).toISOString(),
    hero: 'scholar', unit: 1, qStats: zeroStats, win: false }));
  await game.open({ saved: { playLog: old } }); await game.start(); await game.fight({ enemyHp: 1 });
  await page.keyboard.type('litre');
  await page.evaluate(() => { window.__gameTest.endRun(false); });
  await expect(page.locator('#oQuality')).toHaveText('完美 1/1 · 每词提示 0.0 · 每词错字母 0.0');
  const db = await game.saved();
  expect(db.playLog).toHaveLength(20); expect(db.playLog[0].endedAt).toBe(old[1].endedAt);
  expect(db.playLog.at(-1)).toEqual({ endedAt: expect.any(String), hero: (await game.state()).G.heroId,
    unit: 1, qStats: { ...zeroStats, words: 1, perfect: 1 }, win: false });
  expect(db.activeRun).toBeUndefined();
  await page.evaluate(() => { window.__gameTest.endRun(false); window.__gameTest.renderTitle(); });
  expect((await game.saved()).playLog).toEqual(db.playLog);
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator('#oQuality')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('P0: no completed words yields 0.0 averages and the requested row also appears on wins', async ({ game, page }) => {
  await game.open(); await game.start();
  await page.evaluate(() => { window.__gameTest.endRun(true); });
  await expect(page.locator('#oQuality')).toHaveText('完美 0/0 · 每词提示 0.0 · 每词错字母 0.0');
  expect((await game.saved()).playLog.at(-1).win).toBe(true);
});

test('P0: nonzero averages use completed words and round to one decimal', async ({ game, page }) => {
  await game.open(); await game.start(); await game.fight();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.typeLetter('i'); t.progress.requestHint();
    for (let i = 0; i < 3; i++) for (const ch of t.norm(t.B.word.w)) t.typeLetter(ch);
    t.endRun(false);
  });
  await expect(page.locator('#oQuality')).toHaveText('完美 2/3 · 每词提示 0.3 · 每词错字母 0.3');
});
