import { test, expect } from './game-harness.js';
// 平板显示方式：真浏览器里改 meta viewport 后，媒体查询确实换了版式。
const TABLET_UA = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
test.use({ viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, userAgent: TABLET_UA });

test('tablet home switches between phone, desktop and auto layouts, and the choice survives reload', async ({ game, page }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New tablet display control');
  await game.open();
  const host = page.locator('#displaySettings');
  await expect(host).toBeVisible();
  await expect(page.locator('#display-auto')).toHaveAttribute('aria-pressed', 'true');
  const width = () => page.evaluate(() => innerWidth);
  expect(await width()).toBe(820);

  await page.locator('#display-phone').click();
  await expect.poll(width).toBe(480);
  await expect(page.locator('#display-phone')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(480);

  await page.reload();
  await expect.poll(width).toBe(480);
  await expect(page.locator('#display-phone')).toHaveAttribute('aria-pressed', 'true');
  await game.start(); await game.fight({ word: 'litre', enemyHp: 500 });
  // 手机版式：单列，题目卡在字母盘上方且有实际高度。
  const box = await page.evaluate(() => {
    const q = document.querySelector('#s-fight .fmid').getBoundingClientRect();
    const k = document.querySelector('#fBank').getBoundingClientRect();
    return { qh: q.height, qBottom: q.bottom, kTop: k.top, cols: getComputedStyle(document.getElementById('s-fight')).display };
  });
  expect(box.cols).toBe('flex');
  expect(box.qh).toBeGreaterThan(100);
  expect(box.qBottom).toBeLessThanOrEqual(box.kTop + 1);
  await page.locator('#tPause').click();
  await page.goto(page.url());
  await page.locator('#display-desktop').click();
  await expect.poll(width).toBe(1024);
  await page.locator('#display-auto').click();
  await expect.poll(width).toBe(820);
  expect(await page.evaluate(() => localStorage.getItem('wy8a_display_v1'))).toBeNull();
});

test('phones never see the display control', async ({ browser }, info) => {
  test.skip(info.project.metadata.target === 'legacy', 'New tablet display control');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' });
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem('wy8a_display_v1', 'desktop'));
  await p.goto(info.project.metadata.basePath);
  await expect(p.locator('#displaySettings')).toBeHidden();
  expect(await p.evaluate(() => innerWidth)).toBe(390);
  await ctx.close();
});
