import { test, expect } from './game-harness.js';

test('shield capacity geometry preserves archived map and fight rendering', async ({ game, page }, testInfo) => {
  // 这条同时跑归档页与新版：几何契约两边都要守，但「护盾层显示/文字带盾」是
  // 2026-10-02 才修好的 —— 归档页**故意**保留旧 bug（登记在 tests/e2e/README.md），
  // 所以显示层的断言按目标分支，不能一刀切。
  const legacy = testInfo.project.metadata.target === 'legacy';
  const shownText = legacy ? '30/60' : '30/60 +20盾';
  await game.open();
  await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    Object.assign(t.G, { hp: 30, maxhp: 60, shield: 20 });
    t.renderMap();
  });
  async function check(fill, shield) {
    const geometry = await page.evaluate(({ fill, shield }) => {
      const hp = document.getElementById(fill);
      const sh = document.getElementById(shield);
      const container = hp.parentElement.getBoundingClientRect();
      const h = hp.getBoundingClientRect();
      const s = sh.getBoundingClientRect();
      return { hpWidth: parseFloat(hp.style.width), left: parseFloat(sh.style.left),
        shWidth: parseFloat(sh.style.width), containerWidth: container.width - 2,
        realFillWidth: h.width, realShWidth: s.width, realLeft: s.left - h.left,
        shieldDisplay: getComputedStyle(sh).display };
    }, { fill, shield });
    // 几何契约（容量百分比、两层位置与宽度）在任何情况下都不许变 —— 两边都断言。
    expect(geometry.hpWidth).toBeCloseTo(62.5);
    expect(geometry.left).toBeCloseTo(37.5);
    expect(geometry.shWidth).toBeCloseTo(25);
    if (legacy) {
      // 归档页的真实行为：paintHpBar 读 g.sh，而 hpBarGeom 返回的叫 shield，
      // 所以护盾层永远藏着。这条断言就是那份登记的旧事实本身。
      expect(geometry.shieldDisplay).toBe('none');
    } else {
      // 修好之后：护盾层按几何显示出来，而且**真的占到应有的宽度**
      // （只断言「不是 none」不够：宽度 0 的层也满足那条）。
      expect(geometry.shieldDisplay).not.toBe('none');
      expect(geometry.realShWidth).toBeGreaterThan(0);
    }
    await expect.poll(async () => page.evaluate(fill => {
      const hp = document.getElementById(fill);
      return hp.getBoundingClientRect().width / (hp.parentElement.getBoundingClientRect().width - 2);
    }, fill), { message: 'Rendered fill eventually matches the 62.5% capacity contract' }).toBeCloseTo(0.625, 2);
  }
  await expect(page.locator('#mHpT')).toHaveText(shownText);
  await check('mHp', 'mHpS');
  await game.fight();
  await expect(page.locator('#fMyT')).toHaveText(shownText);
  await check('fMy', 'fMyS');
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`mobile ${viewport.width}x${viewport.height} keeps core controls in viewport without horizontal overflow`, async ({ game, page }) => {
    await page.setViewportSize(viewport);
    // 这条要量的是「切到 QWERTY 键盘之后底部控件还装得下」，所以显式从网格出发：
    // 任务14 起无 kbMode 字段的新档默认已是键盘。显式 false 对 legacy 归档页
    // 同样合法，两边行为一致。
    await game.open({ saved: { kbMode: false } });
    const assertNoOverflow = async () => {
      const metrics = await page.evaluate(() => ({
        width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      }));
      expect(metrics.document).toBeLessThanOrEqual(metrics.width + 1);
      expect(metrics.body).toBeLessThanOrEqual(metrics.width + 1);
    };
    await assertNoOverflow();
    await game.start();
    await assertNoOverflow();
    await game.fight({ word: 'living conditions' });
    await expect(page.locator('#fSlots .slot')).toHaveCount(16);
    await expect(page.locator('#fSlots .slotsep')).toHaveCount(1);
    async function assertCore() {
      await assertNoOverflow();
      for (const selector of ['#fBank', '#tBankMode', '#tSay', '#tHint', '#tSkip', '#tFlee']) {
        const box = await page.locator(selector).boundingBox();
        expect(box, `${selector} has rendered geometry`).not.toBeNull();
        expect(box.x, `${selector} left edge`).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, `${selector} right edge`).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y, `${selector} top edge`).toBeGreaterThanOrEqual(-1);
        expect(box.y + box.height, `${selector} bottom edge`).toBeLessThanOrEqual(viewport.height + 1);
      }
      const target = await page.locator('#tHint').evaluate(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el === hit || el.contains(hit);
      });
      expect(target, 'bottom controls are not covered by effects or overlays').toBe(true);
    }
    await assertCore();
    await page.locator('#tBankMode').click();
    await expect(page.locator('#fBank')).toHaveClass(/kb/);
    await assertCore();
    await page.locator('#tHint').click();
    await expect(page.locator('#fSlots .slot.hint')).toHaveCount(1);
    await assertCore();
  });
}
