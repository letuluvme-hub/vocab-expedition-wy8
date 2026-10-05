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
  await expect(page.locator('#heroes .hcard')).toHaveCount(9);
  await expect(page.locator('#sRun')).toHaveText('7');
  // 2026-10 预习模式起统一「学会」口径：旧存档里远征拼对的教材词 factory 也算学会单词。
  await expect(page.locator('#sMaster')).toHaveText('1');
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
  await page.reload({waitUntil:'networkidle'});await expect(page.locator('#sMaster')).toHaveText('1');
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
  // 2026-10 起是单词预习：cat 用一次提示后拼完（不算学会、记为辅助词），dog 不看提示拼对（学会）。
  await page.locator('#dailyOpen').click();await page.locator('#dailyCustomText').fill('cat 猫\ndog 狗');await page.locator('#dailyImport').click();await page.locator('#dailyStart').click();
  await expect(page.locator('#dailyStage')).toHaveText('单词预习');
  await page.locator('#dailyHint').click();await expect(page.locator('#dailyInput')).toHaveText('c');
  await expect(page.locator('#dailyPartner')).not.toBeVisible();await expect(page.locator('#dailyAtlasCards')).not.toBeVisible();
  const bank=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,keys:[...document.querySelectorAll('#dailyWarmupKeys button, #dailyHint, #dailySkip')].map(n=>n.getBoundingClientRect().toJSON())}));
  expect(bank.scroll).toBeLessThanOrEqual(width);
  for(const key of bank.keys){expect(key.left).toBeGreaterThanOrEqual(0);expect(key.right).toBeLessThanOrEqual(width);expect(key.height).toBeGreaterThanOrEqual(44);}
  await page.keyboard.type('at');await page.locator('#dailyNext').click();
  await page.keyboard.type('dog');await page.locator('#dailyNext').click();await expect(page.locator('#dailyStage')).toHaveText('预习完成');
  await expect(page.locator('#dailySummary')).toContainText('拼完 2 / 2 词');await expect(page.locator('#dailySummary')).toContainText('不看提示拼对 1 词');
  await expect(page.locator('#dailyGift')).toContainText('今日外观');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')));
  expect(saved.dictationMastered).toEqual([]);expect(saved.mastered).toContain('dog');expect(saved.dailySession.cleanDone).toEqual(['dog']);
  await page.locator('#dailyDoneHome').click();await expect(page.locator('#dailyStart')).toHaveCount(0);
  const date=await page.evaluate(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()));
  await expect(page.locator('#dailyReportDate')).toHaveText(date);await expect(page.locator('#dailyReportDuration')).toHaveText(/练习时长：\d+分\d+秒/);
  await expect(page.locator('#dailyReportWords')).toHaveText('练习词数：2');await expect(page.locator('#dailyReportRate')).toHaveCount(0);
  await expect(page.locator('#dailyReportWrong')).toContainText('cat · 猫');await expect(page.locator('#dailyReportWrong')).not.toContainText('dog');
  await page.locator('#dailyReportCopy').click();await expect(page.locator('#dailyReportCopyStatus')).toHaveText('已复制');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  for(const id of ['dailyReportDate','dailyReportDuration','dailyReportWords'])expect(copied).toContain(await page.locator('#'+id).innerText());
  expect(copied).toContain('cat · 猫');
  await page.reload({waitUntil:'networkidle'});await page.locator('#dailyEntry > summary').click();await expect(page.locator('#dailyReportWords')).toHaveText('练习词数：2');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')).mastered)).toContain('dog');
  expect(await page.evaluate(()=>({probe:typeof window.__gameTest,flag:typeof window.__VOCAB_TEST__}))).toEqual({probe:'undefined',flag:'undefined'});
  return {date,previewLearned:['dog'],hintedWord:'cat',clipboardCopied:true,width};
}
