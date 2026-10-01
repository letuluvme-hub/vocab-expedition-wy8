import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

for (const [kind, url] of [
  ['built website', '/vocab-expedition-wy8/'],
  ['offline single HTML', pathToFileURL(path.resolve('dist/vocab-expedition-standalone.html')).href],
]) {
  test(`${kind} starts, renders approved art and accepts keyboard input without debug globals`, async ({page}) => {
    const errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.addInitScript(() => {
      window.__VOCAB_TEST__=true; // Even an explicit flag cannot enable the production probe.
      let seed=0x51a7;
      Math.random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
      try { localStorage.setItem('wy8a_rogue_v1', JSON.stringify({runs:0,wins:0,mastered:[],best:0,custom:[],voice:false,mute:true,vol:0})); } catch {}
    });
    if (kind === 'offline single HTML') {
      await page.route(/^https?:\/\//, route=>route.abort());
    }
    await page.goto(url);
    await expect(page.locator('#heroes .hcard')).toHaveCount(6);
    await expect(page.locator('#units .unit')).toHaveCount(7);
    expect(await page.evaluate(()=>typeof window.__gameTest)).toBe('undefined');
    await page.locator('#startRun').click();
    await expect(page.locator('#s-map')).toBeVisible();
    for (let step=0;step<9 && !(await page.locator('#s-fight').isVisible());step++) {
      const battle=page.locator('#map .node.pick[title="遭遇词灵"],#map .node.pick[title="精英战"],#map .node.pick[title="词汇之王"]');
      await (await battle.count()?battle.first():page.locator('#map .node.pick').first()).click();
      if (await page.locator('#s-event').isVisible()) {
        await page.locator('#ePicks .pick').first().click();
        await expect(page.locator('#s-map')).toBeVisible();
      } else if (await page.locator('#s-rest').isVisible()) {
        await page.locator('#rPicks .pick').first().click();
        await expect(page.locator('#s-map')).toBeVisible();
      }
    }
    await expect(page.locator('#s-fight')).toBeVisible();
    await expect(page.locator('#fAv svg')).toBeVisible();
    await expect(page.locator('#fPc .pc-head')).toHaveCount(1);
    const key = page.locator('#fBank .key:not(.out)').first();
    const needed = await key.innerText();
    const hpBefore = await page.locator('#fEnT').innerText();
    await page.keyboard.press(needed.toLowerCase());
    await expect.poll(async () => {
      const enemyChanged = (await page.locator('#fEnT').innerText()) !== hpBefore;
      const message = await page.locator('#fMsg').innerText();
      return enemyChanged || message.length > 0;
    }).toBe(true);
    expect(errors).toEqual([]);
  });
}
