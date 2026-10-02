// 完整词连胜分层播报在**真 Chrome**里的验收（docs/feature-word-streak.md）。
//
// 跑在独立夹具 tests/fixtures/word-streak.html 上：那是**模块本身**的真实页面，
// 真 DOM、真 click、真 setTimeout、真样式表计算。
//
// ★ 重要且不夸大：这条 spec **不能**证明游戏里已经接上了。
//   runtime.js / combat.js / speech.js 三个共享入口本任务没有改动（归整合者），
//   所以这里所有「词正忙 / 战斗进行中」都是**夹具里注入的假状态**，
//   语音是一个记录调用的假 speaker，不是系统 TTS。真机可听性仍未验证。
import { test, expect } from '@playwright/test';

const FIXTURE = '/vocab-expedition-wy8/tests/fixtures/word-streak.html';
const open = (page, query) => page.goto(FIXTURE + (query ? '?' + query : ''));
const newOnly = (testInfo, why) => {
  if (testInfo.project.metadata.target === 'legacy') test.skip(true, why);
};
const complete = async (page, n) => {
  for (let i = 0; i < n; i++) {
    await page.locator('#btnComplete').click();
  }
};
const spokenText = page => page.evaluate(() => window.__probe.spoken.map(s => s.text));
const count = page => page.evaluate(() => window.__probe.state().count);

test.describe('whole-word streak announcement in a real browser', () => {
  test.beforeEach(({}, testInfo) => { newOnly(testInfo, 'Streak feedback is a new module absent from the archived legacy application'); });

  test('one completed word paints First Blood inside the fight flow host', async ({ page }) => {
    await open(page);
    await complete(page, 1);
    const toast = page.locator('#streakAnnouncement');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText('First Blood');
    expect(await count(page)).toBe(1);
  });

  test('the toast never floats over the HUD: it stays in the document flow of its own host', async ({ page }) => {
    await open(page);
    await complete(page, 1);
    const pos = await page.locator('#streakAnnouncement').evaluate(el => getComputedStyle(el).position);
    expect(pos).toBe('static');
    /* 真几何：toast 的底边不能盖到 HUD 容器下面那条日志区。 */
    const geo = await page.evaluate(() => {
      const t = document.getElementById('streakAnnouncement').getBoundingClientRect();
      const hud = document.getElementById('fightHud').getBoundingClientRect();
      const log = document.getElementById('log').getBoundingClientRect();
      return { tBottom: t.bottom, hudBottom: hud.bottom, logTop: log.top };
    });
    expect(geo.tBottom).toBeLessThanOrEqual(geo.hudBottom + 1);
    expect(geo.tBottom).toBeLessThanOrEqual(geo.logTop + 1);
  });

  test('a long stage label wraps at 320px instead of overflowing the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await open(page);
    /* 用真实的最长台阶名（Rampage/Unstoppable 一类）而不是随机串。 */
    await page.evaluate(() => {
      document.getElementById('btnWordBusy').click();
      document.getElementById('btnComplete').click();
    });
    await page.evaluate(() => window.__probe.setBusy(false));
    await complete(page, 6);   /* 连同上面那次 = 第 7 级：Unstoppable，八级里最长的标签 */
    await expect(page.locator('#streakAnnouncement')).toHaveText('Unstoppable');
    const overflow = await page.evaluate(() => {
      const el = document.getElementById('streakAnnouncement');
      return { sw: el.scrollWidth, cw: el.clientWidth, docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth };
    });
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
    expect(overflow.docSw).toBeLessThanOrEqual(overflow.docCw + 1);
  });

  test('stages escalate to Godlike and then stop announcing (no shouting every word)', async ({ page }) => {
    await open(page);
    await complete(page, 10);
    expect(await spokenText(page)).toEqual([
      'First Blood', 'Double Kill', 'Triple Kill', 'Quadra Kill',
      'Penta Kill', 'Rampage', 'Unstoppable', 'Godlike',
    ]);
    expect(await count(page)).toBe(8);
    /* 再完成两个词：计数封顶，语音不再增加。 */
    await complete(page, 2);
    expect((await spokenText(page)).length).toBe(8);
    expect(await count(page)).toBe(8);
  });

  test('a word being spoken is never interrupted: nothing is queued behind it, only text shows', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__probe.setBusy(true));
    await complete(page, 3);
    /* 词正忙：一次声音都不该被请求。 */
    expect(await spokenText(page)).toEqual([]);
    /* 文字反馈照常给（视觉通道不抢话）。 */
    await expect(page.locator('#streakAnnouncement')).toHaveText('Triple Kill');
    expect(await count(page)).toBe(3);
  });

  test('a late pending announcement plays at most once and only the latest one', async ({ page }) => {
    await open(page);
    await page.evaluate(() => { window.__probe.setBusy(true); window.__probe.clearSpoken(); });
    await complete(page, 2);
    expect(await spokenText(page)).toEqual([]);
    /* 词念完了：只补播最新那条，且只播一次。 */
    await page.evaluate(() => window.__probe.setBusy(false));
    await expect.poll(() => spokenText(page)).toEqual(['Double Kill']);
    await page.waitForTimeout(900);
    expect(await spokenText(page)).toEqual(['Double Kill']);
  });

  test('pausing freezes the streak and stops any late announcement', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__probe.setBusy(true));
    await complete(page, 2);
    expect(await count(page)).toBe(2);
    await page.locator('#btnPause').click();
    await page.evaluate(() => window.__probe.setBusy(false));
    await page.waitForTimeout(900);
    expect(await spokenText(page)).toEqual([], '暂停期间与暂停后都不补播');
    expect(await count(page)).toBe(2, '暂停冻结但保留同一段连胜');
  });

  test('a new run resets the count to zero and restarts at First Blood', async ({ page }) => {
    await open(page);
    await complete(page, 4);
    expect(await count(page)).toBe(4);
    await page.locator('#btnNewRun').click();
    expect(await count(page)).toBe(0);
    await page.evaluate(() => window.__probe.clearSpoken());
    await complete(page, 1);
    expect(await spokenText(page)).toEqual(['First Blood']);
  });

  test('a wrong letter breaks the streak back to zero', async ({ page }) => {
    await open(page);
    await complete(page, 5);
    expect(await count(page)).toBe(5);
    await page.locator('#btnMistake').click();
    expect(await count(page)).toBe(0);
  });

  test('reduced motion still shows the text and still clears it (no hung toast)', async ({ page }) => {
    await open(page, 'reduced=1');
    await complete(page, 1);
    const toast = page.locator('#streakAnnouncement');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText('First Blood');
    const cls = await toast.getAttribute('class');
    expect(cls).toContain('streak-toast--still');
    expect(cls).not.toContain('streak-toast--anim');
    /* 到期自动收掉：reduced motion 下不会留一块挂着的死文字。 */
    await expect(toast).toBeHidden({ timeout: 6000 });
  });
});
