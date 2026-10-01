import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';

const url=process.argv[2];
if(!/^https:\/\/letuluvme-hub\.github\.io\/vocab-expedition-wy8\/(?:\?.*)?$/.test(url||''))throw new Error('Expected exact public game URL');
const chrome=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:existsSync(chrome)?chrome:undefined,args:['--mute-audio']});
const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  await page.addInitScript(()=>{
    let seed=0x51a7;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    if(!sessionStorage.getItem('public-check')){
      localStorage.setItem('wy8a_rogue_v1',JSON.stringify({runs:7,wins:2,mastered:['factory'],best:4,custom:[{w:'cat',z:'猫'}],hero:'ranger',kbMode:true,kbUpper:true,rewards:[],voice:false,mute:true,vol:0}));
      sessionStorage.setItem('public-check','1');
    }
  });
  await page.goto(url,{waitUntil:'networkidle',timeout:60000});
  await expect(page.locator('#heroes .hcard')).toHaveCount(6);
  await expect(page.locator('#sRun')).toHaveText('7');
  await expect(page.locator('#sMaster')).toHaveText('1');
  await page.locator('#units .unit').filter({hasText:'我的词表'}).click();
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  for(let step=0;step<9 && !(await page.locator('#s-fight').isVisible());step++){
    const choices=page.locator('#map .node.pick[title="遭遇词灵"],#map .node.pick[title="精英战"],#map .node.pick[title="词汇之王"]');
    await (await choices.count()?choices.first():page.locator('#map .node.pick').first()).click();
    if(await page.locator('#s-event').isVisible()){await page.locator('#ePicks .pick').last().click();await expect(page.locator('#s-map')).toBeVisible()}
    else if(await page.locator('#s-rest').isVisible()){await page.locator('#rPicks .pick').first().click();await expect(page.locator('#s-map')).toBeVisible()}
  }
  await expect(page.locator('#s-fight')).toBeVisible();
  await expect(page.locator('#fAv svg')).toBeVisible();
  await expect(page.locator('#fZh')).toHaveText('猫');
  await page.keyboard.type('cat');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')).mastered.includes('cat'))).toBe(true);
  expect(await page.evaluate(()=>window.__gameTest)).toBeUndefined();
  const width=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));expect(width.content).toBeLessThanOrEqual(width.viewport+1);
  await page.reload({waitUntil:'networkidle'});
  await expect(page.locator('#sMaster')).toHaveText('2');
  const save=await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')));
  expect(save.hero).toBe('ranger');expect(save.custom).toEqual([{w:'cat',z:'猫'}]);expect(save.kbMode).toBe(true);
  expect(errors).toEqual([]);
  const version=await page.request.get(new URL('version.json',url).href+'?verify='+Date.now());expect(version.ok()).toBe(true);
  const report={url,browser:browser.version(),version:await version.json(),savePreserved:true,customWordMastered:true,width,pageErrors:errors};
  const output=path.resolve('test-results/public-verification');mkdirSync(output,{recursive:true});
  writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(output,'title.png'),fullPage:true});
  console.log(JSON.stringify(report,null,2));
} finally {await context.close();await browser.close()}
