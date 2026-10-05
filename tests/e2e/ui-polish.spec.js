import { test, expect } from './game-harness.js';
// docs/ui-polish-2026-10-05.md：主页字号与排列、奖励卡图标、商店灰显、地图底部按钮、暂停页文案。
test('home: units in two columns, stats in one row, growth text no larger than its heading', async ({ game, page }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New home polish');
  await page.setViewportSize({ width: 390, height: 844 });
  await game.open();
  const m = await page.evaluate(() => {
    const tops = sel => new Set([...document.querySelectorAll(sel)].map(e => Math.round(e.getBoundingClientRect().top)));
    const lefts = sel => new Set([...document.querySelectorAll(sel)].map(e => Math.round(e.getBoundingClientRect().left)));
    const fs = sel => [...document.querySelectorAll(sel)].map(e => parseFloat(getComputedStyle(e).fontSize));
    return { unitCols: lefts('#units .unit').size, statRows: tops('#s-title .stats > div').size,
      growth: Math.max(...fs('#masteryGrowth p')), heroMin: Math.min(...fs('#heroes .hs, #heroes .heroUnlock')),
      hOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(m.unitCols).toBe(2);
  expect(m.statRows).toBe(1);
  expect(m.growth).toBeLessThanOrEqual(13);
  expect(m.heroMin).toBeGreaterThanOrEqual(11);
  expect(m.hOverflow).toBe(false);
});

test('shop: pixel icons sit on the title line and a full-HP potion is greyed out', async ({ game, page }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New shop polish');
  await page.setViewportSize({ width: 390, height: 844 });
  await game.open(); await game.start();
  await page.evaluate(() => { const t = window.__gameTest; t.G.gold = 500; t.G.hp = t.G.maxhp; t.showShop(); });
  const m = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#rPicks .pick')];
    const icons = cards.map(c => c.querySelector('b > .ic')).filter(Boolean).map(ic => {
      const text = ic.nextSibling, ir = ic.getBoundingClientRect(), range = document.createRange();
      range.selectNodeContents(text); const tr = range.getClientRects()[0];
      return { gap: Math.abs((ir.top + ir.bottom) / 2 - (tr.top + tr.bottom) / 2), leftOfText: ir.right <= tr.left + 1 };
    });
    const potion = cards.find(c => /疗伤药剂/.test(c.textContent));
    return { icons, potionNa: potion?.classList.contains('na'), others: cards.filter(c => c !== potion && c.classList.contains('na')).length };
  });
  expect(m.icons.length).toBeGreaterThan(0);
  for (const i of m.icons) { expect(i.gap, '图标与标题同一行').toBeLessThanOrEqual(6); expect(i.leftOfText).toBe(true); }
  expect(m.potionNa).toBe(true);
  // 刚开局：卷轴没买满、遗物没集齐，不应被误灰。
  expect(m.others).toBe(0);
});

test('map: pause and quit stay on screen on a long map', async ({ game, page }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New map polish');
  await page.setViewportSize({ width: 1280, height: 800 });
  await game.open(); await game.start();
  for (const id of ['#mPause', '#mQuit']) {
    const r = await page.locator(id).boundingBox();
    expect(r.y + r.height, id).toBeLessThanOrEqual(800);
  }
});

test('pause: the saved message appears once', async ({ game, page }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New pause copy');
  await game.open(); await game.start(); await game.fight({ word: 'litre', enemyHp: 500 });
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  const text = await page.locator('#s-pause').innerText();
  expect(text).toMatch(/进度已保存/);
  expect(text).not.toMatch(/进度已经存好/);
});
