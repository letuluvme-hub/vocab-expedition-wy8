import { test, expect } from './game-harness.js';

test('shield capacity geometry preserves archived map and fight rendering', async ({ game, page }) => {
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
    expect(geometry.hpWidth).toBeCloseTo(62.5);
    expect(geometry.left).toBeCloseTo(37.5);
    expect(geometry.shWidth).toBeCloseTo(25);
    // Characterize the archived g.sh/g.shield mismatch, do not silently invent a fix.
    // The percentage contract is correct, but the shield layer is hidden in legacy.
    expect(geometry.shieldDisplay).toBe('none');
    await expect.poll(async () => page.evaluate(fill => {
      const hp = document.getElementById(fill);
      return hp.getBoundingClientRect().width / (hp.parentElement.getBoundingClientRect().width - 2);
    }, fill), { message: 'Rendered fill eventually matches the 62.5% capacity contract' }).toBeCloseTo(0.625, 2);
  }
  await expect(page.locator('#mHpT')).toHaveText('30/60');
  await check('mHp', 'mHpS');
  await game.fight();
  await expect(page.locator('#fMyT')).toHaveText('30/60');
  await check('fMy', 'fMyS');
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`mobile ${viewport.width}x${viewport.height} keeps core controls in viewport without horizontal overflow`, async ({ game, page }) => {
    await page.setViewportSize(viewport);
    await game.open();
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
