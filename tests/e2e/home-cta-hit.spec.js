import { test, expect } from './game-harness.js';

for (const [width, height] of [[390, 844], [375, 667], [360, 780], [320, 568]]) {
  test(`home start button receives clicks across its width at ${width}x${height}`, async ({ game, page }, info) => {
    test.skip(info.project.metadata.target === 'legacy', 'The archived page has no sticky home CTA');
    await page.setViewportSize({ width, height });
    await game.open();

    const start = page.locator('#startRun');
    await expect(start).toBeInViewport();
    const readHits = () => start.evaluate(button => {
      const rect = button.getBoundingClientRect();
      return [0.5, 0.2, 0.8].map(fraction => {
        const x = rect.left + rect.width * fraction;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { fraction, x, y, inside: !!hit && button.contains(hit),
          hit: hit && { tag: hit.tagName, id: hit.id, class: hit.getAttribute('class') } };
      });
    });
    const initial = await readHits();
    expect(initial.every(hit => hit.inside), JSON.stringify(initial)).toBe(true);

    // Scroll a real portrait through the sticky row, as when browsing the heroes.
    // The initial viewport alone can miss the overlap by only a few pixels.
    await start.evaluate(button => {
      // The mobile computer tip is now absent. First assert the natural layout
      // above; add inert spacing only to stress portrait overlap at every viewport.
      const portraits=[...document.querySelectorAll('#heroes .pc-head')];
      const center=button.getBoundingClientRect().top+button.getBoundingClientRect().height/2;
      if(!portraits.some(p=>p.getBoundingClientRect().top+p.getBoundingClientRect().height/2>center)){
        const heroes=document.getElementById('heroes');
        heroes.style.paddingTop=innerHeight+'px';
      }
    });
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const scrollBy = await start.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      const lowerPortraits = [...document.querySelectorAll('#heroes .pc-head')]
        .map(part => part.getBoundingClientRect())
        .map(part => part.top + part.height / 2)
        .filter(center => center > y)
        .sort((a, b) => a - b);
      return lowerPortraits.length ? lowerPortraits[0] - y : 0;
    });
    expect(scrollBy, 'A lower hero portrait must cross the sticky CTA during scrolling').toBeGreaterThan(0);
    await page.evaluate(top => window.scrollBy(0, top), scrollBy);
    const scrolled = await readHits();
    expect(scrolled.every(hit => hit.inside), JSON.stringify(scrolled)).toBe(true);

    // A real pointer click must work without force, synthetic dispatch, or invoking newRun.
    await page.click('#startRun');
    await expect(page.locator('#s-map')).toBeVisible();
    await expect(page.locator('#s-title')).toBeHidden();
  });
}
