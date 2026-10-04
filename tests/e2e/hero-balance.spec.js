import { test, expect } from './game-harness.js';
const newOnly = info => test.skip(info.project.metadata.target === 'legacy', 'New balance rules');

for (const [hero, hp, hints] of [
  ['scholar', 80, 5], ['warrior', 85, 2], ['scout', 65, 3],
  ['lucky', 65, 3], ['healer', 65, 3], ['ranger', 50, 3],
]) {
  test(`${hero} starts with the displayed life and hint tradeoff`, async ({ game, page }, info) => {
    newOnly(info); await game.open({ saved: { hero } }); await game.start();
    await game.fight({ word: 'litre' });
    expect(await page.evaluate(() => [window.__gameTest.G.maxhp, window.__gameTest.B.hints])).toEqual([hp, hints]);
    if (hero === 'healer') {expect((await game.state()).B.shield).toBe(0);expect((await game.state()).B.myHp).toBe(43);}
    if (hero === 'warrior') {
      await page.keyboard.type('litre'); expect((await game.state()).B.shield).toBe(2);
    }
    if (hero === 'scholar') {
      await page.locator('#tHint').click();
      expect(await page.evaluate(() => window.__gameTest.B.hintUsed)).toBe(2);
    }
    expect(game.errors).toEqual([]);
  });
}

test('ranger reward ledger and visible budget survive backspace, pause, and refresh', async ({ game, page }, info) => {
  newOnly(info); await game.open({ saved: { hero: 'ranger' } }); await game.start();
  await game.fight({ word: 'litre' });
  await page.evaluate(() => { window.__gameTest.B.myHp = 20; });
  await page.keyboard.press('l');
  const first = await page.evaluate(() => [window.__gameTest.B.myHp, window.__gameTest.B.enHp]);
  await page.keyboard.press('Backspace');
  await page.locator('#tPause').click(); await page.reload(); await page.locator('#continueRun').click();
  await page.keyboard.press('l');
  expect(await page.evaluate(() => [window.__gameTest.B.myHp, window.__gameTest.B.enHp])).toEqual(first);
  await page.locator('#fDetailsOpen').click();
  await expect(page.locator('#fEquipment')).toContainText('本场已回血 1/18');
});

test('scout candidate estimate includes the real first finisher bonus', async ({ game, page }, info) => {
  newOnly(info); await game.open({ saved: { hero: 'scout' } }); await game.start();
  await page.evaluate(() => { const t = window.__gameTest; const n = t.G.avail[0]; n.type = 'battle'; t.enterNode(n); t.B.enHp = t.B.enMax = 100000; t.renderFight(); });
  const card = await page.locator('#fOffer .wcCard.on').innerText();
  const damage = Number(card.match(/⚔(\d+)/)[1]);
  const word = await page.evaluate(() => window.__gameTest.norm(window.__gameTest.B.word.w));
  await page.keyboard.type(word);
  expect(await page.evaluate(() => window.__gameTest.B.enMax - window.__gameTest.B.enHp)).toBe(damage);
});

for (const undo of [false, true]) {
  test(`late rage card predicts actual remaining damage (undo=${undo})`, async ({ game, page }, info) => {
    newOnly(info); await game.open(); await game.start(); await game.fight({ word: 'litre', enemyHp: 100000 });
    await page.evaluate(() => {
      const t = window.__gameTest; t.G.bag.rage = 1;
      t.B.offer = [t.B.word, t.G.pool.find(w => w.w !== t.B.word.w)]; t.renderFight();
    });
    await page.keyboard.type('li');
    if (undo) { await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); }
    await page.locator('#fItems .item', { hasText: '怒火护符' }).click();
    const card = await page.locator('#fOffer .wcCard.on').innerText();
    const predicted = Number(card.match(/⚔(\d+)/)[1]);
    const before = (await game.state()).B.enHp;
    await page.keyboard.type(undo ? 'litre' : 'tre');
    expect(before - (await game.state()).B.enHp).toBe(predicted);
  });
}

test('shield relic claimed after victory survives battle-to-map transfer without hidden battery healing', async ({ game, page }, info) => {
  newOnly(info); await game.open(); await game.start(); await game.fight({ word: 'litre', enemyHp: 1, elite: true });
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.relics = t.RELICS.filter(r => r.id !== 'shield').map(r => r.id);
    t.G.shieldGiven = false; t.B.myHp = 10; t.B.shield = 0;
  });
  await page.keyboard.type('litre');
  await expect(page.locator('#pPicks [data-opt="reward:relic:shield"]')).toBeVisible();
  await page.locator('#pPicks [data-opt="reward:relic:shield"]').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const got = await page.evaluate(() => ({ hp: window.__gameTest.G.hp, shield: window.__gameTest.G.shield }));
  expect(got).toEqual({ hp: 28, shield: 15 }); // win +4; advancing +8 battery/+6 synergy
});

for (const width of [320, 390]) {
  test(`role descriptions and live equipment remain readable at ${width}px`, async ({ game, page }, info) => {
    newOnly(info); await page.setViewportSize({ width, height: 844 });
    await game.open({ saved: { hero: 'ranger' } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await game.start(); await game.fight({ word: 'litre' });
    await page.locator('#fDetailsOpen').click();
    await expect(page.locator('#fEquipment')).toContainText('每场最多 18');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#fDetailsClose').click();
    await game.clickLetter('l');
    expect((await game.state()).B.input).toEqual(['l']);
  });
}
