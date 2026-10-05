import { test, expect } from './game-harness.js';
// 战斗页的空白收进题目卡：卡片撑到道具栏，道具栏贴着字母盘上方；
// 「装备 · 机制」按钮一行显示。字母盘位置仍由 fixed-battle-keyboard 回归把关。
const SIZES = [[390, 844], [412, 915], [375, 667], [820, 1180], [1024, 844], [1280, 800]];
test('the word card fills the middle and the details button stays on one line', async ({ game, page }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New battle layout');
  await game.open(); await game.start(); await game.fight({ word: 'litre', enemyHp: 500 });
  await page.evaluate(() => { const t = window.__gameTest; t.G.bag = { leech: 2 }; t.renderFight(); });
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const q = r('#s-fight .fmid .q'), dock = r('#fActionDock'), bar = r('#s-fight .bankbar');
      const btn = document.getElementById('fDetailsOpen');
      const range = document.createRange(); range.selectNodeContents(btn);
      const tops = new Set([...range.getClientRects()].map(x => Math.round(x.top)));
      return { cardToDock: dock.top - q.bottom, dockToBar: bar.top - dock.bottom, desktop: innerWidth >= 900,
        btnLines: tops.size };
    });
    const at = `${width}×${height}`;
    expect(m.cardToDock, at).toBeLessThanOrEqual(8);
    // 手机版道具栏在字母盘正上方；电脑版字母盘在右栏，不比较这一项。
    if (!m.desktop) expect(Math.abs(m.dockToBar), at).toBeLessThanOrEqual(8);
    expect(m.btnLines, at).toBe(1);
  }
});
