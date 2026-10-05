// 2026-10 起界面新开的是预习；这里显式开旧版默写会话，守住旧存档恢复后的默写界面与掌握规则。
import { test, expect, openPracticePanel } from './game-harness.js';
const newOnly=info=>test.skip(info.project.metadata.target==='legacy','Daily comfort is new');
async function begin(page,text,words){
  await page.locator('#dailyOpen').click();await page.locator('#dailyCustomText').fill(text);await page.locator('#dailyImport').click();await page.evaluate(()=>window.__gameTest.dailyController.start({unit:Number(document.getElementById('dailyUnit').value),bookId:document.getElementById('dailyBook').value,mode:'dictation'}));
  for(const w of words){await page.keyboard.type(w);await page.locator('#dailyNext').click()}
  await page.locator('#dailyFormal').click();
}
test('clean, failed deferred, clean daily words preserve facts and actual parent clipboard',async({game,page},info)=>{
  newOnly(info);await page.context().grantPermissions(['clipboard-read','clipboard-write']);await game.open();await openPracticePanel(page);
  await begin(page,'cat 猫\ndog 狗\npig 猪',['cat','dog','pig']);await page.keyboard.type('cat');await page.locator('#dailyNext').click();
  await page.keyboard.type('xxxxxxxxxx');await expect(page.locator('#dailyFeedback')).toHaveText('不对');
  await page.locator('#dailyDefer').click();await expect(page.locator('#dailyPrompt')).toHaveText('猪');
  await page.keyboard.type('pig');await page.locator('#dailyNext').click();
  await expect(page.locator('#dailySummary')).toContainText('正式完成 2 / 3 词');await expect(page.locator('#dailySummary')).toContainText('留到复习 1 词（未拼完）');
  await expect(page.locator('#dailySummary')).toContainText('一次拼对 2 / 3（67%）');await expect(page.locator('#dailyWrong')).toContainText('dog · 狗');
  const db=await game.saved();expect(db.dictationMastered).toEqual(['cat','pig']);expect(db.dailySession.results[1]).toMatchObject({completed:false,deferred:true,eligible:false});
  await page.locator('#dailyDoneHome').click();await expect(page.locator('#dailyHomeReport')).toContainText('67%');
  await page.locator('#dailyReportCopy').click();await expect(page.locator('#dailyReportCopyStatus')).toHaveText('已复制');
  const copied=await page.evaluate(()=>navigator.clipboard.readText());expect(copied).toContain('2/3');expect(copied).toContain('dog · 狗');
});
test('hinted lastword defer ends exactly once, reload and input cannot grant mastery',async({game,page},info)=>{
  newOnly(info);await game.open();await openPracticePanel(page);await begin(page,'cat 猫',['cat']);await expect(page.locator('#dailyDefer')).toHaveCount(0);
  await page.keyboard.type('c');await expect(page.locator('#dailyDefer')).toHaveCount(0);await page.locator('#dailyHint').click();await page.locator('#dailyDefer').click();
  await expect(page.locator('#dailyStage')).toHaveText('今日完成');await expect(page.locator('#dailySummary')).toContainText('一次拼对 0 / 1（0%）');
  const before=await game.saved();expect(before.dictationMastered).toEqual([]);expect(before.dailySession.results[0].input).toBe('c');
  await page.keyboard.type('at');await game.reload();await openPracticePanel(page);const after=await game.saved();expect(after.dailySession).toEqual(before.dailySession);expect(after.dailyReports.days).toEqual(before.dailyReports.days);
  await expect(page.locator('#dailyEntry')).toContainText('本次完成 0 / 1 词');
});
test('free telegraph stays frozen while formal mistakes wait through a real attack cycle',async({game,page},info)=>{
  newOnly(info);test.setTimeout(40000);await game.open();await openPracticePanel(page);await game.start();await game.fight({enemyHp:10000});
  await page.waitForFunction(()=>window.__gameTest.B.foeAttack.phase==='telegraph',null,{timeout:15000});
  await page.locator('#tPause').click();await page.locator('#pzHome').click();const before=await game.saved();
  await begin(page,'cat 猫\ndog 狗',['cat','dog']);await page.keyboard.type('cat');await page.locator('#dailyNext').click();await page.keyboard.type('xxxxxxxxxxxxxxxxxxxx');
  await page.waitForTimeout(12000);await expect(page.locator('#dailyStage')).toHaveText('正式默写');
  const state=await game.state(),saved=await game.saved();expect(state.B.myHp).toBe(before.activeRun.battle.myHp);
  expect(saved.activeRun.battle).toEqual(before.activeRun.battle);expect(saved.dictationMastered).toEqual(['cat']);expect(saved.dailySession.attempt.errors).toBe(20);
  await page.locator('#dailyDefer').click();await expect(page.locator('#dailyStage')).toHaveText('今日完成');
});
test('reload after deferredword keeps clean credit, partial input and failed evidence',async({game,page},info)=>{
  newOnly(info);await game.open();await openPracticePanel(page);await begin(page,'cat 猫\ndog 狗\npig 猪',['cat','dog','pig']);
  await page.keyboard.type('cat');await page.locator('#dailyNext').click();await page.keyboard.type('x');await page.locator('#dailyDefer').click();await page.keyboard.type('p');await page.locator('#dailyPause').click();
  const before=await game.saved();await game.reload();await openPracticePanel(page);await page.locator('#dailyOpen').click();await page.locator('#dailyResume').click();
  await expect(page.locator('#dailyInput')).toHaveText('p');await page.keyboard.type('ig');await page.locator('#dailyNext').click();
  const after=await game.saved();expect(after.dictationMastered).toEqual(['cat','pig']);expect(after.dailySession.results.slice(0,2)).toEqual(before.dailySession.results);
  await expect(page.locator('#dailySummary')).toContainText('一次拼对 2 / 3');
});
for(const width of [320,390])test(`${width}px formal keyboard and defer action remain in flow below input, collection stays home`,async({game,page},info)=>{
  newOnly(info);await page.setViewportSize({width,height:720});await game.open();await openPracticePanel(page);await page.locator('#dailyAtlasToggle').click();
  const home=await page.evaluate(()=>({width:document.documentElement.scrollWidth,partner:document.querySelector('#dailyPartner').getBoundingClientRect().toJSON(),atlas:document.querySelector('#dailyAtlasCards').getBoundingClientRect().toJSON()}));
  expect(home.width).toBeLessThanOrEqual(width);expect(home.partner.right).toBeLessThanOrEqual(width);expect(home.atlas.right).toBeLessThanOrEqual(width);
  await begin(page,'cat 猫',['cat']);await page.keyboard.type('x');
  const geo=await page.evaluate(()=>{const rect=id=>document.getElementById(id).getBoundingClientRect().toJSON();return {width:document.documentElement.scrollWidth,input:rect('dailyInput'),keys:rect('dailyKeys'),defer:rect('dailyDefer'),partner:rect('dailyPartner'),buttons:[...document.querySelectorAll('#dailyKeys button')].map(b=>b.getBoundingClientRect().toJSON())}});
  expect(geo.width).toBeLessThanOrEqual(width);expect(geo.input.bottom).toBeLessThanOrEqual(geo.keys.top);expect(geo.keys.bottom).toBeLessThanOrEqual(geo.defer.top);
  expect(geo.defer.left).toBeGreaterThanOrEqual(0);expect(geo.defer.right).toBeLessThanOrEqual(width);expect(geo.partner.height).toBe(0);
  for(const b of geo.buttons){expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(width);expect(b.height).toBeGreaterThanOrEqual(44)}
  await page.screenshot({path:`/tmp/pr5-formal-${width}.png`});await page.locator('#dailyDefer').click();await expect(page.locator('#dailyStage')).toHaveText('今日完成');
});
