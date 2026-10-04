import { test, expect } from './game-harness.js';
// 宽 641–899 原来既不吃手机紧凑规则也不吃电脑分栏：820×700 时题目区只剩 4px，
// 820×529 直接是 0。现在高的走手机紧凑单列，矮的走横握左右分栏。
const SIZES = [[641, 481], [700, 529], [760, 600], [820, 529], [820, 700], [899, 600], [899, 800], [760, 900]];
test('mid-width windows keep the whole word card and every letter key on screen', async ({ game, page }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New battle layout');
  await game.open(); await game.start(); await game.fight({ word: 'litre', enemyHp: 500 });
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(100);
    const m = await page.evaluate(() => {
      const f = document.querySelector('#s-fight .fmid'), b = document.getElementById('fBank');
      const keys = [...b.querySelectorAll('.key')].map(k => k.getBoundingClientRect());
      const br = b.getBoundingClientRect();
      return {
        fmid: f.clientHeight, need: f.scrollHeight,
        keysInside: keys.every(k => k.top >= br.top - 1 && k.bottom <= br.bottom + 1),
        pageScroll: document.documentElement.scrollHeight > innerHeight + 1,
        hOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const at = `${width}×${height}`;
    expect(m.fmid, at).toBeGreaterThan(100);
    expect(m.need - m.fmid, at).toBeLessThanOrEqual(1);
    expect(m.keysInside, at).toBe(true);
    expect(m.pageScroll, at).toBe(false);
    expect(m.hOverflow, at).toBe(false);
  }
});
