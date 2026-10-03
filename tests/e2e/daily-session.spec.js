import { test, expect } from './game-harness.js';
const newOnly = info => test.skip(info.project.metadata.target === 'legacy', 'Daily session is a new feature');
async function customStart(page, text) {
  await page.locator('#dailyOpen').click();
  await page.locator('#dailyCustomText').fill(text);
  await page.locator('#dailyImport').click();
  await page.locator('#dailyStart').click();
  await expect(page.locator('#dailyStage')).toHaveText('热身');
}
async function warm(page, words) {
  for(const word of words) { await page.keyboard.type(word.replace(/[^a-z]/g,'')); await page.locator('#dailyNext').click(); }
  await expect(page.locator('#dailyStage')).toHaveText('准备正式默写');
  await page.locator('#dailyFormal').click();
}

test('complete real dailyflow: warmup notmastery, hintreview, cleanmastery, done noauto next',async({game,page},info)=>{
  newOnly(info);await game.open();await customStart(page,'cat 猫\ndog 狗');await warm(page,['cat','dog']);
  expect((await game.saved()).dictationMastered).toEqual([]);
  await expect(page.locator('#dailyKeys .dictation-key')).toHaveCount(27);
  await expect(page.locator('#dailyPrompt')).toHaveText('猫');
  await page.locator('#dailyHint').click();await expect(page.locator('#dailyHintAnswer')).toContainText('C');
  await page.keyboard.type('cat');await page.locator('#dailyNext').click();
  await page.locator('#dailyKeys [data-key="d"]').click();await page.keyboard.type('og');await page.locator('#dailyNext').click();
  await expect(page.locator('#dailyStage')).toHaveText('今日完成');
  await expect(page.locator('#dailySummary')).toContainText('正式完成 2 / 2 词');
  await expect(page.locator('#dailySummary')).toContainText('一次拼对 1 / 2');
  await expect(page.locator('#dailyWrong')).toContainText('cat · 猫');
  const save=await game.saved();expect(save.dictationMastered).toEqual(['dog']);expect(save.reviewQueue).toEqual(['cat']);
  expect(save.dailySession.phase).toBe('completed');expect(save.runs).toBe(0);expect(save.wins).toBe(0);
  await page.waitForTimeout(400);await expect(page.locator('#dailyStart')).toHaveCount(0);
});

for(const width of [320,390])test(`real dailykeyboard/phrase fits ${width}px, originalmonster not covering input`,async({game,page},info)=>{
  newOnly(info);await game.open();await page.setViewportSize({width,height:720});
  await customStart(page,"look after one's self 照顾自己\nwell-known 著名的");await warm(page,["look after one's self",'well-known']);
  await expect(page.locator('#dailyKeys .dictation-key')).toHaveCount(29);
  await page.screenshot({path:`/tmp/pr2-formal-${width}.png`});
  const boxes=await page.evaluate(()=>({width:document.documentElement.scrollWidth,input:document.querySelector('#dailyInput').getBoundingClientRect().toJSON(),keys:document.querySelector('#dailyKeys').getBoundingClientRect().toJSON(),monster:document.querySelector('.daily-monster').getBoundingClientRect().toJSON(),buttons:[...document.querySelectorAll('#dailyKeys button')].map(b=>b.getBoundingClientRect().toJSON())}));
  expect(boxes.width).toBeLessThanOrEqual(width);expect(boxes.monster.bottom).toBeLessThanOrEqual(boxes.input.top);expect(boxes.input.bottom).toBeLessThanOrEqual(boxes.keys.top);
  for(const b of boxes.buttons){expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(width);expect(b.height).toBeGreaterThanOrEqual(44);}
  await page.locator('#dailyKeys [data-key="l"]').click();await page.keyboard.type("ook after one's self");await page.locator('#dailyNext').click();
  await expect(page.locator('#dailyKeys [data-key="-"]')).toHaveCount(1);await page.keyboard.type('well-known');await page.locator('#dailyNext').click();
  expect((await game.saved()).dictationMastered).toEqual(["look after one's self",'well-known']);
});

test('daily selects locked Unit6 while freeexpedition remains locked and schoolpool bounded16',async({game,page},info)=>{
  newOnly(info);await game.open();await expect(page.locator('#units [data-unit="6"]')).toBeDisabled();
  await page.locator('#dailyOpen').click();await page.locator('#dailyUnit').selectOption('6');await page.locator('#dailyStart').click();
  const save=await game.saved();expect(save.dailySession.words).toHaveLength(16);expect(save.dailySession.unit).toBe(6);expect(save.dailySession.words.every(w=>w.u===6)).toBe(true);
  await expect(page.locator('#dailySelectionInfo')).toContainText('余下 23');
});

test('daily pauses freeexpedition, preserves snapshot and fullword evidence on reload',async({game,page},info)=>{
  newOnly(info);await game.open();await game.start();await game.fight();
  await page.locator('#tPause').click();await page.locator('#pzHome').click();
  const before=(await game.saved()).activeRun;
  await customStart(page,'cat 猫');await warm(page,['cat']);await page.keyboard.type('c');await page.locator('#dailyPause').click();
  const paused=await game.saved();expect(paused.activeRun.run.id).toBe(before.run.id);expect(paused.dailySession.attempt.input).toBe('c');
  await page.keyboard.type('at');expect((await game.saved()).dailySession.attempt.input).toBe('c');
  await game.reload();await page.locator('#dailyOpen').click();await expect(page.locator('#dailyResume')).toBeVisible();await page.locator('#dailyResume').click();
  await page.keyboard.type('at');await page.locator('#dailyNext').click();expect((await game.saved()).dictationMastered).toEqual(['cat']);
  await page.locator('#dailyHome').click();await page.locator('#continueRun').click();await expect(page.locator('#s-fight')).toBeVisible();
});

test('wrongorder only不对, partial wrongwordreview persists on home, stalecontrols inert',async({game,page},info)=>{
  newOnly(info);await game.open();await customStart(page,'cat 猫');await warm(page,['cat']);await page.keyboard.type('a');
  await expect(page.locator('#dailyFeedback')).toHaveText('不对');expect((await game.saved()).reviewQueue).toEqual(['cat']);
  await page.locator('#dailyPause').click();await page.keyboard.type('cat');await page.locator('#dailyFinish').click();
  await expect(page.locator('#dailySummary')).toContainText('正式完成 0 / 1 词');expect((await game.saved()).dictationMastered).toEqual([]);
});

test('customdefinitions safelyrender text and retained list is re-used',async({game,page},info)=>{
  newOnly(info);await game.open();await customStart(page,'cat <img src=x onerror=alert(1)>猫');
  await expect(page.locator('#dailyPrompt')).toHaveText('<img src=x onerror=alert(1)>猫');await expect(page.locator('#s-daily img')).toHaveCount(0);
  await page.locator('#dailyPause').click();await page.locator('#dailyFinish').click();await page.locator('#dailyHome').click();await page.locator('#dailyOpen').click();
  await expect(page.locator('#dailyCustomText')).toHaveValue('cat <img src=x onerror=alert(1)>猫');
});

test('15active minutes checkpointends partialsession honestlyand carries unfinishedword',async({game,page},info)=>{
  newOnly(info);await page.clock.install();await game.open();await customStart(page,'cat 猫');await warm(page,['cat']);await page.keyboard.type('a');
  await page.clock.fastForward('15:01');await expect(page.locator('#dailyStage')).toHaveText('今天先到这里');await expect(page.locator('#dailyResume')).toHaveCount(0);
  await page.locator('#dailyFinish').click();await expect(page.locator('#dailyStage')).toHaveText('今日完成');await expect(page.locator('#dailySummary')).toContainText('正式完成 0 / 1 词');await expect(page.locator('#dailyWrong')).toContainText('cat · 猫');
  expect((await game.saved()).dailySession.reason).toBe('time-budget');expect((await game.saved()).dictationMastered).toEqual([]);
});

test('homepage repaintpreserves reportandcollection hostidentityand childnodes',async({game,page},info)=>{
  newOnly(info);await game.open();
  await page.evaluate(()=>{window.dailyHostProof=['dailyHomeReport','dailyCollectionHost'].map(id=>{const host=document.getElementById(id);const child=document.createElement('span');child.textContent='已挂载的部件';host.append(child);return {host,child,id};});window.__gameTest.renderTitle();});
  const facts=await page.evaluate(()=>window.dailyHostProof.map(({host,child,id})=>({same:document.getElementById(id)===host,child:document.getElementById(id).contains(child)})));
  expect(facts).toEqual([{same:true,child:true},{same:true,child:true}]);
});
