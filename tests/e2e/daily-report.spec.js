import { test, expect } from './game-harness.js';
const newOnly = info => test.skip(info.project.metadata.target === 'legacy','Dated daily reports are new');
async function clockAt(page, iso) { const time=new Date(iso);await page.clock.install({time:new Date(time.getTime()-60000)});await page.clock.pauseAt(time); }
async function start(page,text='cat 猫\ndog 狗'){
 await page.locator('#dailyOpen').click();await page.locator('#dailyCustomText').fill(text);await page.locator('#dailyImport').click();await page.locator('#dailyStart').click();
}
async function warm(page,words=['cat','dog']){for(const word of words){await page.keyboard.type(word);await page.locator('#dailyNext').click();}await page.locator('#dailyFormal').click();}

test('full daily warmup, hint cat, clean dog, actual parent report and real clipboard text',async({game,page,context},info)=>{
 newOnly(info);await context.grantPermissions(['clipboard-read','clipboard-write']);await clockAt(page,'2026-10-02T04:00:00Z');await game.open();
 await expect(page.locator('#dailyHomeReport')).toContainText('今日记录');await start(page);await page.clock.fastForward(65000);await warm(page);expect((await game.saved()).dictationMastered).toEqual([]);
 await page.locator('#dailyHint').click();await page.keyboard.type('cat');await page.locator('#dailyNext').click();await page.keyboard.type('dog');await page.locator('#dailyNext').click();await expect(page.locator('#dailyStage')).toHaveText('今日完成');await page.locator('#dailyHome').click();
 await expect(page.locator('#dailyReportDate')).toHaveText('2026-10-02');await expect(page.locator('#dailyReportDuration')).toContainText('1分05秒');await expect(page.locator('#dailyReportWords')).toContainText('2');await expect(page.locator('#dailyReportRate')).toContainText('50%');await expect(page.locator('#dailyReportWrong')).toContainText('cat · 猫');await expect(page.locator('#dailyReportWrong')).not.toContainText('dog');
 await page.locator('#dailyReportCopy').click();await expect(page.locator('#dailyReportCopyStatus')).toHaveText('已复制');const text=await page.evaluate(()=>navigator.clipboard.readText());expect(text).toContain('一次拼对率：50%（1/2）');expect(text).toContain('cat · 猫');expect(text).toContain('练习词数：2');
 const before=(await game.saved()).dailyReports;await game.reload();await page.evaluate(()=>window.__gameTest.renderTitle());expect((await game.saved()).dailyReports).toEqual(before);expect((await game.saved()).dictationMastered).toEqual(['dog']);
});

test('actual due word failure removes mastery immediately and corrected word stays at one day',async({game,page},info)=>{
 newOnly(info);await clockAt(page,'2026-10-02T04:00:00Z');await game.open({saved:{custom:[{w:'cat',z:'猫'},{w:'dog',z:'狗'}],dictationMastered:['cat'],reviewSchedule:{cat:{word:{w:'cat',z:'猫'},intervalIndex:4,dueDate:'2026-10-02',stable:true}}}});
 await start(page);expect((await game.saved()).dailySession.reviewKeys).toEqual(['cat']);await warm(page);await page.keyboard.type('a');await expect(page.locator('#dailyFeedback')).toHaveText('不对');let saved=await game.saved();expect(saved.dictationMastered).toEqual([]);expect(saved.reviewSchedule.cat.dueDate).toBe('2026-10-03');expect(saved.reviewSchedule.cat.intervalIndex).toBe(0);expect(saved.reviewSchedule.cat.stable).toBe(false);
 await page.keyboard.type('cat');await page.locator('#dailyNext').click();await page.keyboard.type('dog');await page.locator('#dailyNext').click();await page.locator('#dailyHome').click();await expect(page.locator('#dailyReportRate')).toContainText('50%');await expect(page.locator('#dailyReportWrong')).toContainText('cat · 猫');expect((await game.saved()).dictationMastered).toEqual(['dog']);
});

test('clipboard rejection offers selectable exact plain text and never says copied',async({game,page},info)=>{
 newOnly(info);await clockAt(page,'2026-10-02T04:00:00Z');await game.open();await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}}));
 await page.locator('#dailyReportCopy').click();await expect(page.locator('#dailyReportCopyStatus')).toContainText('手动复制');await expect(page.locator('#dailyReportCopyStatus')).not.toHaveText('已复制');await expect(page.locator('#dailyReportFallback')).toBeVisible();await expect(page.locator('#dailyReportFallback')).toHaveValue(/2026-10-02/);
 expect(await page.locator('#dailyReportFallback').evaluate(el=>getComputedStyle(el).userSelect)).toBe('text');
 const selection=await page.locator('#dailyReportFallback').evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,length:el.value.length}));expect(selection).toEqual({start:0,end:selection.length,length:selection.length});
});

test('Shanghai midnight report splits active practice and excludes paused waiting',async({game,page},info)=>{
 newOnly(info);await clockAt(page,'2026-10-02T15:59:57Z');await game.open();await start(page,'cat 猫');await page.keyboard.type('c');await page.clock.fastForward(5000);await page.locator('#dailyPause').click();await page.clock.fastForward(3600000);await page.locator('#dailyResume').click();await page.clock.fastForward(1000);await page.locator('#dailyPause').click();await page.locator('#dailyFinish').click();await page.locator('#dailyHome').click();
 await expect(page.locator('#dailyReportDate')).toHaveText('2026-10-03');await expect(page.locator('#dailyReportDuration')).toContainText('0分03秒');const reports=(await game.saved()).dailyReports.days;expect(reports['2026-10-02'].activeMs).toBe(3000);expect(reports['2026-10-03'].activeMs).toBe(3000);
});

test('homepage today record advances at Shanghai midnight without starting a session',async({game,page},info)=>{
 newOnly(info);await clockAt(page,'2026-10-02T15:59:58Z');await game.open();await expect(page.locator('#dailyReportDate')).toHaveText('2026-10-02');await page.clock.fastForward(3000);await expect(page.locator('#dailyReportDate')).toHaveText('2026-10-03');await expect(page.locator('#dailyReportWords')).toHaveText('练习词数：0');await expect(page.locator('#dailyReportRate')).toContainText('暂无正式尝试');
});
for(const width of [320,390])test(`parent report mobile ${width}px readable card, no horizontal overflow`,async({game,page},info)=>{
 newOnly(info);await page.setViewportSize({width,height:720});await game.open();await page.locator('#dailyHomeReport').scrollIntoViewIfNeeded();await page.screenshot({path:`/tmp/pr3-home-${width}.png`});
 const bounds=await page.locator('#dailyHomeReport').evaluate(el=>({box:el.getBoundingClientRect().toJSON(),color:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor,width:document.documentElement.scrollWidth}));expect(bounds.width).toBeLessThanOrEqual(width);expect(bounds.box.left).toBeGreaterThanOrEqual(0);expect(bounds.box.right).toBeLessThanOrEqual(width);expect(bounds.background).toBe('rgb(251, 253, 246)');
});
