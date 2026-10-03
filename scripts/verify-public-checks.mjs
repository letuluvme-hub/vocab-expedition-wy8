import { expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Compare the whole build, including downloads, rather than trusting version.json alone. */
export async function verifyPublishedFiles({request,url,directory,expectedVersion}) {
  const version=JSON.parse(readFileSync(path.join(directory,'version.json'),'utf8')).version;
  if(!expectedVersion || version!==expectedVersion)throw new Error(`Build version ${version} differs from expected ${expectedVersion}`);
  const names=readdirSync(directory,{recursive:true,withFileTypes:true})
    .filter(entry=>entry.isFile())
    .map(entry=>path.relative(directory,path.join(entry.parentPath,entry.name)).split(path.sep).join('/')).sort();
  const files=[], stamp=String(Date.now());
  for(const name of names){
    const address=new URL(name,url);address.searchParams.set('verify',stamp);
    const response=await request.get(address.href);
    if(!response.ok())throw new Error(`Public ${name} returned HTTP ${response.status()}`);
    const expected=readFileSync(path.join(directory,name)),actual=await response.body();
    const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
    const sha256=digest(expected);
    if(actual.length!==expected.length || digest(actual)!==sha256)throw new Error(`Public ${name} differs from verified build`);
    files.push({path:name,bytes:actual.length,sha256});
  }
  return {version,files};
}

export async function verifyLegacyPlay(page) {
  await expect(page.locator('#heroes .hcard')).toHaveCount(6);
  await expect(page.locator('#sRun')).toHaveText('7');
  // Legacy mastered remains practice history; it cannot grant formal mastery.
  await expect(page.locator('#sMaster')).toHaveText('0');
  await page.locator('#units .unit').filter({hasText:'我的词表'}).click();
  await page.locator('#startRun').click();await expect(page.locator('#s-map')).toBeVisible();
  for(let step=0;step<9 && !(await page.locator('#s-fight').isVisible());step++){
    const choices=page.locator('#map .node.pick[title="遭遇词灵"],#map .node.pick[title="精英战"],#map .node.pick[title="词汇之王"]');
    await (await choices.count()?choices.first():page.locator('#map .node.pick').first()).click();
    if(await page.locator('#s-event').isVisible()){await page.locator('#ePicks .pick').last().click();await expect(page.locator('#s-map')).toBeVisible();}
    else if(await page.locator('#s-rest').isVisible()){await page.locator('#rPicks .pick').first().click();await expect(page.locator('#s-map')).toBeVisible();}
  }
  await expect(page.locator('#s-fight')).toBeVisible();await expect(page.locator('#fAv svg')).toBeVisible();
  await expect(page.locator('#fZh')).toHaveText('猫');await page.keyboard.type('cat');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')).mastered.includes('cat'))).toBe(true);
  await page.reload({waitUntil:'networkidle'});await expect(page.locator('#sMaster')).toHaveText('0');
  const save=await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')));
  expect(save.mastered).toEqual(expect.arrayContaining(['factory','cat']));expect(save.dictationMastered).toEqual([]);
  expect(save.hero).toBe('ranger');expect(save.custom).toEqual([{w:'cat',z:'猫'}]);expect(save.kbMode).toBe(true);expect(save.kbUpper).toBe(true);expect(save.future).toEqual({keep:true});
  expect(await page.evaluate(()=>window.__gameTest)).toBeUndefined();expect(await page.evaluate(()=>window.__VOCAB_TEST__)).toBeUndefined();
  return {savePreserved:true,customWordPracticed:true,formalMastered:0};
}

export async function verifyDailyPlay(page) {
  const width=page.viewportSize().width;
  await expect(page.locator('#dailyEntry')).toHaveJSProperty('open',false);
  await expect(page.locator('#dailyOpen')).not.toBeVisible();
  await expect(page.locator('#homeAtlas')).toBeVisible();
  await page.locator('#dailyEntry > summary').click();
  await expect(page.locator('#dailyPartner')).toBeVisible();await page.locator('#dailyAtlasToggle').click();
  await expect(page.locator('#dailyAtlasCards .daily-card')).toHaveCount(45);
  const home=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,boxes:[document.querySelector('#dailyPartner'),...document.querySelectorAll('#dailyAtlasCards .daily-card')].map(n=>n.getBoundingClientRect().toJSON())}));
  expect(home.scroll).toBeLessThanOrEqual(width);for(const box of home.boxes){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width);}
  await page.locator('#dailyOpen').click();await page.locator('#dailyCustomText').fill('cat 猫\ndog 狗');await page.locator('#dailyImport').click();await page.locator('#dailyStart').click();
  for(const word of ['cat','dog']){await page.keyboard.type(word);await page.locator('#dailyNext').click();}
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')).dictationMastered)).toEqual([]);
  await page.locator('#dailyFormal').click();await expect(page.locator('#dailyKeys .dictation-key')).toHaveCount(27);
  await expect(page.locator('#dailyPartner')).not.toBeVisible();await expect(page.locator('#dailyAtlasCards')).not.toBeVisible();
  const keyboard=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,input:document.querySelector('#dailyInput').getBoundingClientRect().bottom,top:document.querySelector('#dailyKeys').getBoundingClientRect().top,keys:[...document.querySelectorAll('#dailyKeys button')].map(n=>n.getBoundingClientRect().toJSON())}));
  expect(keyboard.scroll).toBeLessThanOrEqual(width);expect(keyboard.top).toBeGreaterThanOrEqual(keyboard.input);
  for(const key of keyboard.keys){expect(key.left).toBeGreaterThanOrEqual(0);expect(key.right).toBeLessThanOrEqual(width);expect(key.height).toBeGreaterThanOrEqual(44);}
  await page.locator('#dailyHint').click();await page.keyboard.type('cat');await page.locator('#dailyNext').click();
  await page.keyboard.type('dog');await page.locator('#dailyNext').click();await expect(page.locator('#dailyStage')).toHaveText('今日完成');
  await expect(page.locator('#dailySummary')).toContainText('一次拼对 1 / 2（50%）');await expect(page.locator('#dailyGift')).toContainText('今日外观');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')));
  expect(saved.dictationMastered).toEqual(['dog']);expect(saved.reviewQueue).toContain('cat');expect(saved.dailySession.results[0]).toMatchObject({completed:true,eligible:false});
  await page.locator('#dailyDoneHome').click();await expect(page.locator('#dailyStart')).toHaveCount(0);
  const date=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()));
  await expect(page.locator('#dailyReportDate')).toHaveText(date);await expect(page.locator('#dailyReportDuration')).toHaveText(/练习时长：\d+分\d+秒/);
  await expect(page.locator('#dailyReportWords')).toHaveText('练习词数：2');await expect(page.locator('#dailyReportRate')).toHaveText('一次拼对率：50%（1/2）');
  await expect(page.locator('#dailyReportWrong')).toContainText('cat · 猫');await expect(page.locator('#dailyReportWrong')).not.toContainText('dog');
  await page.locator('#dailyReportCopy').click();await expect(page.locator('#dailyReportCopyStatus')).toHaveText('已复制');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  for(const id of ['dailyReportDate','dailyReportDuration','dailyReportWords','dailyReportRate'])expect(copied).toContain(await page.locator('#'+id).innerText());
  expect(copied).toContain('cat · 猫');
  await page.reload({waitUntil:'networkidle'});await page.locator('#dailyEntry > summary').click();await expect(page.locator('#sMaster')).toHaveText('1');await expect(page.locator('#dailyReportRate')).toHaveText('一次拼对率：50%（1/2）');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')).dictationMastered)).toEqual(['dog']);
  expect(await page.evaluate(()=>({probe:typeof window.__gameTest,flag:typeof window.__VOCAB_TEST__}))).toEqual({probe:'undefined',flag:'undefined'});
  return {date,warmupMastered:0,formalMastered:['dog'],firstTryRate:'一次拼对率：50%（1/2）',clipboardCopied:true,width};
}
