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
