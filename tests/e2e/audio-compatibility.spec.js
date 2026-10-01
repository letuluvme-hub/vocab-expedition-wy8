/* 音频兼容提示条的真实浏览器验收（真 Chrome + 真点击 + 真布局计算）
 *
 * 跑在独立夹具 tests/fixtures/audio-compatibility.html 上：那是**模块本身**的真实页面，
 * 证明「模块在浏览器里真的能画、真的能点、点了真的隐藏、窄屏不溢出」。
 *
 * ★ 重要且不夸大：这条 spec **不能**证明微信 iOS / 安卓真机能出声。
 *   浏览器自动化替换不了真机试听，也伪造不出微信内置浏览器的自动播放策略。
 *   夹具里也只验证「API 失败 → 提示出现 → 可关闭 → 布局不破」这一条链。
 *   真实游戏接线（runtime.js）属于整合者，未在本分支改动。
 *
 * 独立端口 4192、reuseExistingServer:false，与其它并行任务互不干扰。
 */
import { test, expect } from '@playwright/test';

const FIXTURE = '/vocab-expedition-wy8/tests/fixtures/audio-compatibility.html';
const ROOT = '#audioCompatibility-root';

const open = (page, query) => page.goto(FIXTURE + (query ? '?' + query : ''));

test.describe('audio compatibility notice in a real browser', () => {
  test.beforeEach(({},testInfo)=>{ test.skip(testInfo.project.metadata.target==='legacy','New compatibility module fixture is not part of the archived legacy application'); });
  test('a blocked state paints a visible, dismissible notice in the normal flow', async ({ page }) => {
    await open(page, 'state=blocked&channel=sfx');
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    await expect(root).toContainText('当前浏览器暂未能播放音效');
    // 绝不承诺真机能听见
    await expect(root).not.toContainText('一定');
    // 可以关掉
    await expect(page.locator('#acomp-dismiss')).toBeVisible();
  });

  test('closing the notice hides it for the session, with no inline style added', async ({ page }) => {
    await open(page, 'state=blocked&channel=sfx');
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    await page.locator('#acomp-dismiss').click();
    await expect(root).toBeHidden();

    const inline = await page.evaluate(sel => {
      const n = document.querySelector(sel);
      return n ? n.getAttribute('style') || '' : 'missing';
    }, ROOT);
    expect(inline, '不许带内联 style').toBe('');
  });

  test('an unknown state never shows a notice', async ({ page }) => {
    await open(page, 'state=unknown');
    await expect(page.locator(ROOT)).toBeHidden();
  });

  test('a WeChat notice teaches the menu route and offers no fake jump button', async ({ page }) => {
    await open(page, 'state=blocked&channel=sfx&wechat=1');
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    await expect(root).toContainText('右上角');
    // 微信里点按钮跳到 Safari 做不到，绝不摆一个假按钮
    expect(await page.locator('#acomp-open-external').count()).toBe(0);
    // 微信里也不该出现「重试」（那是给普通浏览器的）
    expect(await page.locator('#acomp-retry').count()).toBe(0);
  });

  test('a non-WeChat notice offers retry and does not mention WeChat', async ({ page }) => {
    await open(page, 'state=blocked&channel=sfx&wechat=0');
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    await expect(root).not.toContainText('右上角');
    await expect(page.locator('#acomp-retry')).toBeVisible();
    const before = await page.evaluate(() => window.__retried || 0);
    await page.locator('#acomp-retry').click();
    const after = await page.evaluate(() => window.__retried || 0);
    expect(after, '点重试必须真的派发出去').toBe(before + 1);
  });

  test('the read-aloud channel is described separately from sound effects', async ({ page }) => {
    await open(page, 'state=blocked&channel=speech&wechat=0');
    await expect(page.locator(ROOT)).toContainText('朗读');
    await open(page, 'state=blocked&channel=sfx&wechat=0');
    await expect(page.locator(ROOT)).toContainText('音效');
  });

  test('the notice sits in the document flow and never covers the game board', async ({ page }) => {
    await open(page, 'state=blocked&channel=sfx&wechat=0');
    const box = await page.evaluate(sel => {
      const n = document.querySelector(sel);
      const r = n.getBoundingClientRect();
      const b = document.getElementById('board').getBoundingClientRect();
      return { position: getComputedStyle(n).position, overlaps: r.bottom > b.top + 1 && r.top < b.bottom - 1,
               inFlow: r.width > 0 && r.height > 0 };
    }, ROOT);
    expect(box.position, '通知不许 position:fixed/absolute 挡住玩法').toBe('static');
    expect(box.inFlow).toBe(true);
    expect(box.overlaps, '不许盖住下面的内容区').toBe(false);
  });

  test('no horizontal overflow on a 320px phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await open(page, 'state=blocked&channel=sfx&wechat=1');
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth, win: innerWidth,
      btnH: document.querySelector('#acomp-dismiss').getBoundingClientRect().height,
    }));
    expect(m.doc, '320px 下不许横向溢出').toBeLessThanOrEqual(m.win + 1);
    expect(m.btnH, '按钮高度要够矮手指点').toBeGreaterThanOrEqual(38);
  });

  test('an unsupported platform is explained without accusing the player', async ({ page }) => {
    await open(page, 'state=unsupported&channel=speech&wechat=0');
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    await expect(root).toContainText('不支持');
    await expect(root).toContainText('不影响');
  });
});
