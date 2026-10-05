// 远征故事屏：主页入口、四话漫画、九人档案、主页「XX 的档案」直达、Esc 返回、窄屏不溢出。
import { test, expect } from './game-harness.js';

const only = info => test.skip(info.project.metadata.target === 'legacy', 'Story screen is new UI');

for (const width of [320, 390]) {
  test(`story screen shows comics, nine files and returns home at ${width}px`, async ({ game, page }, info) => {
    only(info);
    await page.setViewportSize({ width, height: 844 });
    await game.open();
    await page.locator('#toStory').click();
    await expect(page.locator('#s-story')).toBeVisible();
    await expect(page.locator('#storyBox .st-strip')).toHaveCount(4);
    await expect(page.locator('#storyBox .st-panel')).toHaveCount(16);
    await expect(page.locator('#storyBox .st-file')).toHaveCount(9);
    await expect(page.locator('#storyBox .st-disclaimer')).toContainText('纯属虚构');
    await page.locator('#lore-warrior summary').click();
    await expect(page.locator('#lore-warrior')).toContainText('赵一柱');
    await expect(page.locator('#lore-warrior')).toContainText('技能由来');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(page.locator('#s-title')).toBeVisible();
    await page.locator('#heroStory').click();
    await expect(page.locator('#s-story')).toBeVisible();
    await expect(page.locator('#storyBox .st-file[open]')).toHaveCount(1);
    expect(game.errors).toEqual([]);
  });
}

for (const width of [320, 1280]) {
  test(`title row carries a small story entry beside the heading at ${width}px`, async ({ game, page }, info) => {
    only(info);
    await page.setViewportSize({ width, height: 800 });
    await game.open();
    const top = page.locator('#storyTop');
    await expect(top).toBeVisible();
    await expect(top).toHaveText('📖 远征故事');
    const m = await page.evaluate(() => {
      const b = document.getElementById('storyTop').getBoundingClientRect(), h = document.querySelector('#storyTopRow h1').getBoundingClientRect();
      return { sameRow: Math.abs((b.top + b.bottom) / 2 - (h.top + h.bottom) / 2) < 12, right: b.right > h.right, sw: document.documentElement.scrollWidth };
    });
    expect(m).toEqual({ sameRow: true, right: true, sw: width });
    await top.click();
    await expect(page.locator('#s-story')).toBeVisible();
    expect(game.errors).toEqual([]);
  });
}

for (const width of [320, 1280]) {
  test(`story back button stays pinned at the top while reading at ${width}px`, async ({ game, page }, info) => {
    only(info);
    await page.setViewportSize({ width, height: 700 });
    await game.open();
    await page.locator('#storyTop').click();
    await expect(page.locator('#s-story')).toBeVisible();
    for (const where of ['#comic-team', '.st-disclaimer']) {
      await page.locator(where).scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => ({ y: window.scrollY, top: document.getElementById('storyHdr').getBoundingClientRect().top,
        back: document.querySelector('#storyHdr .back').getBoundingClientRect().toJSON() }));
      expect(m.y, where).toBeGreaterThan(200);
      expect(Math.abs(m.top), where).toBeLessThan(2);
      expect(m.back.top).toBeGreaterThanOrEqual(0);
      expect(m.back.height).toBeGreaterThanOrEqual(40);
    }
    // 顶栏不能盖住正文：最后一段免责声明完整露在顶栏下方
    const cover = await page.evaluate(() => document.querySelector('.st-disclaimer').getBoundingClientRect().top - document.getElementById('storyHdr').getBoundingClientRect().bottom);
    expect(cover).toBeGreaterThanOrEqual(0);
    await page.locator('#storyHdr .back').click();
    await expect(page.locator('#s-title')).toBeVisible();
    expect(game.errors).toEqual([]);
  });
}

