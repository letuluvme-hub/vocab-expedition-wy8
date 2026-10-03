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
  test(`${kind} completes public daily dictation, defers helped word and keeps an honest parent report`,async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      try{localStorage.setItem('wy8a_rogue_v1',JSON.stringify({runs:0,wins:0,mastered:[],custom:[],voice:false,mute:true,vol:0}))}catch{}
    });
    if(kind==='offline single HTML')await page.route(/^https?:\/\//,route=>route.abort());
    if(kind==='built website')await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.goto(url);expect(await page.evaluate(()=>typeof window.__gameTest)).toBe('undefined');expect(await page.evaluate(()=>typeof window.__VOCAB_TEST__)).toBe('undefined');
    await page.locator('#dailyOpen').click();await page.locator('#dailyCustomText').fill('cat 猫\ndog 狗');await page.locator('#dailyImport').click();await page.locator('#dailyStart').click();
    for(const word of ['cat','dog']){await page.keyboard.type(word);await page.locator('#dailyNext').click()}
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')).dictationMastered)).toEqual([]);
    await page.locator('#dailyFormal').click();await expect(page.locator('#dailyKeys .dictation-key')).toHaveCount(27);
    await page.locator('#dailyHint').click();await page.locator('#dailyDefer').click();await page.keyboard.type('dog');await page.locator('#dailyNext').click();
    await expect(page.locator('#dailyStage')).toHaveText('今日完成');await expect(page.locator('#dailySummary')).toContainText('正式完成 1 / 2 词');await expect(page.locator('#dailySummary')).toContainText('一次拼对 1 / 2（50%）');
    const db=await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')));expect(db.dictationMastered).toEqual(['dog']);expect(db.dailySession.results[0]).toMatchObject({deferred:true,completed:false,eligible:false});expect(db.reviewQueue).toContain('cat');expect(db.runs).toBe(0);
    await page.locator('#dailyDoneHome').click();await expect(page.locator('#dailyReportWords')).toContainText('2');await expect(page.locator('#dailyReportRate')).toContainText('50%（1/2）');await expect(page.locator('#dailyReportWrong')).toContainText('cat · 猫');
    await page.locator('#dailyReportCopy').click();
    if(kind==='built website'){
      await expect(page.locator('#dailyReportCopyStatus')).toHaveText('已复制');const text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain('50%（1/2）');expect(text).toContain('cat · 猫');
    }else{
      await expect(page.locator('#dailyReportCopyStatus')).toHaveText(/已复制|手动复制/);
      const status=await page.locator('#dailyReportCopyStatus').innerText();
      if(status==='已复制'){expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('cat · 猫')}
      else{await expect(page.locator('#dailyReportFallback')).toBeVisible();await expect(page.locator('#dailyReportFallback')).toHaveValue(/cat · 猫/)}
    }
    await expect(page.locator('#dailyStart')).toHaveCount(0);expect(errors).toEqual([]);
  });
}
