import {test,expect} from './game-harness.js';
const newOnly=info=>test.skip(info.project.metadata.target==='legacy','Desktop shortcuts are new');

test('desktop Enter, map numbers, help and pause use real buttons without stealing typing',async({game,page},info)=>{
  newOnly(info);await game.open();
  await expect(page.locator('#startRun')).toHaveAttribute('data-shortcut','Enter');
  await expect(page.locator('#startRun > .keyShortcutHint')).toBeVisible();
  await page.keyboard.press('Enter');await expect(page.locator('#s-map')).toBeVisible();
  const index=await page.locator('#map .node.pick').evaluateAll(nodes=>nodes.findIndex(n=>n.title==='遭遇词灵'));
  expect(index).toBeGreaterThanOrEqual(0);await page.keyboard.press(String(index+1));
  await expect(page.locator('#s-fight')).toBeVisible();
  await page.keyboard.press('Shift+Digit3');
  expect(await page.evaluate(()=>{const b=window.__gameTest.B;return b.word.w===b.offer[2].w})).toBe(true);
  const before=await game.state();await page.keyboard.press('Control+a');
  expect((await game.state()).G.att).toBe(before.G.att);
  await page.keyboard.press('F2');expect((await game.state()).B.hints).toBe(before.B.hints-1);
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',repeat:true,bubbles:true})));
  expect((await game.state()).B.hints).toBe(before.B.hints-1);
  await page.keyboard.press('Escape');await expect(page.locator('#s-pause')).toBeVisible();
  const paused=await game.state();await page.keyboard.type('abc');expect((await game.state()).G.att).toBe(paused.G.att);
  await page.keyboard.press('Escape');await expect(page.locator('#s-fight')).toBeVisible();
});

test('numeric reward shortcuts settle once and reuse the existing reward action',async({game,page},info)=>{
  newOnly(info);await game.open();await game.start();await game.fight({word:'litre',enemyHp:1});
  await page.keyboard.type('litre');await expect(page.locator('#s-pick')).toBeVisible();
  await expect(page.locator('#pPicks .pick').first()).toHaveAttribute('data-shortcut','1');
  await page.keyboard.press('1');await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.kills).toBe(1);
});

test('daily Enter advances while textarea keys and native focused controls keep their meaning',async({game,page},info)=>{
  newOnly(info);await game.open();await page.keyboard.press('F2');await expect(page.locator('#s-daily')).toBeVisible();
  await page.locator('#dailyCustomText').fill('cat 猫');await page.keyboard.press('Enter');
  await expect(page.locator('#dailyCustomText')).toHaveValue('cat 猫\n');
  await page.keyboard.press('Escape');await expect(page.locator('#dailyStart')).toBeVisible();
  await page.locator('#dailyImport').click();await page.locator('#dailyStage').click();
  await page.keyboard.press('Enter');await expect(page.locator('#dailyWarmupKeys')).toBeVisible();
  await page.keyboard.type('cat');await page.keyboard.press('Enter');await expect(page.locator('#dailyFormal')).toBeVisible();
  await page.keyboard.press('Enter');await expect(page.locator('#dailyKeys')).toBeVisible();
  await page.keyboard.press('F2');expect((await game.saved()).dailySession.attempt.hints).toBe(1);
  await page.keyboard.press('Escape');await expect(page.locator('#dailyResume')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#dailyKeys')).toBeVisible();
});

test('phone screens hide keyboard badges and retain the same touch controls',async({game,page},info)=>{
  newOnly(info);await page.setViewportSize({width:390,height:844});await game.open();
  await expect(page.locator('#startRun')).toHaveAttribute('data-shortcut','Enter');
  await expect(page.locator('#startRun > .keyShortcutHint')).toBeHidden();
  await game.start();await game.fight();
  await expect(page.locator('#tHint')).toHaveAttribute('data-shortcut','F2');
  await expect(page.locator('#tHint > .keyShortcutHint')).toBeHidden();
  await expect(page.locator('#fOffer')).not.toContainText('电脑键盘');
  await page.locator('#tPause').click();await expect(page.locator('#s-pause')).toBeVisible();
});

test('checkpoint and secondary pages expose working keyboard exits',async({game,page},info)=>{
  newOnly(info);
  await game.open({saved:{custom:[{w:'cat',z:'猫',u:0,d:1}],mastered:[],wrong:{},best:0,runs:0,wins:0}});
  await game.start(0);await game.fight({word:'cat',enemyHp:10000});
  await page.keyboard.type('cat');await expect(page.locator('#s-learning-complete')).toBeVisible();
  await expect(page.locator('#lcBtnHome')).toHaveAttribute('data-shortcut','Enter / Esc');
  await page.keyboard.press('Escape');await expect(page.locator('#s-title')).toBeVisible();
  await page.locator('#toRelics').click();
  await page.keyboard.press('Escape');await expect(page.locator('#s-title')).toBeVisible();
  await page.locator('#toImport').click();await page.locator('#s-import .hdrtitle').click();
  await page.keyboard.press('Escape');await expect(page.locator('#s-title')).toBeVisible();
});

test('map shortcut hints preserve node type labels on desktop and phone',async({game,page},info)=>{
  newOnly(info);await game.open();await game.start();
  const node=page.locator('#map .node.pick[title="遭遇词灵"]').first();
  await expect(node.locator('.keyShortcutHint')).toHaveAttribute('data-label',/[1-9]/);
  for(const width of [1024,390]){
    await page.setViewportSize({width,height:844});
    const label=await node.evaluate(n=>({display:getComputedStyle(n,'::after').display,content:getComputedStyle(n,'::after').content}));
    expect(label.display).not.toBe('none');expect(label.content).toContain('战斗');
    if(width===390)await expect(node.locator('.keyShortcutHint')).toBeHidden();
    else await expect(node.locator('.keyShortcutHint')).toBeVisible();
  }
});
