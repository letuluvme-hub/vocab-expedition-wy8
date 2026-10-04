import {test,expect} from './game-harness.js';
test('home switches textbooks without mixing units or previous-book completion',async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Extensible textbook selection');
 await game.open({saved:{unitProgress:{'1':{complete:true,completedAt:'2026-10-01T00:00:00Z'}},mastered:['normal'],dictationMastered:['normal']}});
 await expect(page.locator('#textbookSelect')).toHaveValue('wy8a');await expect(page.locator('#units [data-unit="1"]')).toContainText('45 词');
 await page.locator('#textbookSelect').selectOption('wy8b');await expect(page.locator('#units [data-unit="1"]')).toContainText('29 词');
 await expect(page).toHaveTitle('词汇远征 · 外研版八下');
 await expect(page.locator('#units [data-unit="2"]')).toBeDisabled();await expect(page.locator('#units [data-unit="1"]')).toContainText('未开始');
 await game.start();expect(await page.evaluate(()=>window.__gameTest.G.bookId)).toBe('wy8b');
 expect(await page.evaluate(()=>window.__gameTest.G.pool.length)).toBe(29);
 await page.locator('#mPause').click();await page.locator('#pzHome').click();await page.locator('#textbookSelect').selectOption('wy8a');
 await page.reload();await page.locator('#continueRun').click();
 expect(await page.evaluate(()=>window.__gameTest.G.bookId)).toBe('wy8b');expect(await page.evaluate(()=>window.__gameTest.G.pool[0].w)).toBe('self-expression');
});
for(const width of [320,390]) test(`atlas browses eight upper and lower at ${width}px`,async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Book-scoped atlas');
 await page.setViewportSize({width,height:844});await game.open({saved:{mastered:['normal'],dictationMastered:['normal']}});
 await page.locator('#dailyAtlasToggle').click();await expect(page.locator('#dailyAtlasBook')).toHaveValue('wy8a');
 await page.locator('#dailyAtlasBook').selectOption('wy8b');await expect(page.locator('#dailyAtlasCards .daily-card')).toHaveCount(29);
 await expect(page.locator('#dailyAtlasCards')).toContainText('self-expression');await expect(page.locator('#dailyAtlasProgress')).toContainText('已收集 0 / 29');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#dailyAtlasBook').selectOption('wy8a');await expect(page.locator('#dailyAtlasCards .daily-card')).toHaveCount(45);
});
for(const boss of [false,true]) test(`lower-book final word records only its book at ${boss?'boss settlement':'learning checkpoint'}`,async({game,page},info)=>{
 test.skip(info.project.metadata.target==='legacy','Book-scoped runtime completion');
 await game.open();await page.locator('#textbookSelect').selectOption('wy8b');await game.start();
 const last=await page.evaluate(()=>{const t=window.__gameTest,p=t.G.pool;t.G.done=new Set(p.slice(0,-1).map(w=>'wy8b:'+w.w.toLowerCase()));return p.at(-1).w});
 await game.fight({word:last,enemyHp:boss?1:10000,boss});await page.keyboard.type(last.replace(/[^a-z]/gi,'').toLowerCase());
 if(boss){await expect(page.locator('#s-pick')).toBeVisible();await page.locator('#pSkip').click();await expect(page.locator('#s-over')).toBeVisible()}
 else await expect(page.locator('#s-learning-complete')).toBeVisible();
 const db=await game.saved();expect(db.bookUnitProgress?.wy8b?.['1']?.complete).toBe(true);expect(db.unitProgress?.['1']).toBeUndefined();
 if(boss)expect(db.playLog.at(-1).bookId).toBe('wy8b');
});
