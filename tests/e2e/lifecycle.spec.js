import {test,expect} from './game-harness.js';

// 真打一场并赢下来：必须拼完整个词才结束战斗（半词只有 1 血地板）。
async function winFight(page, game) {
  await game.fight({word:'litre', enemyHp:1});
  await game.clickLetter('l');
  expect((await game.state()).B.over).toBe(false);
  await page.keyboard.type('itre');
  await expect(page.locator('#s-pick')).toBeVisible();
}

test('new run invalidates old battle settlement and victory voice callbacks',async({game,page},testInfo)=>{
  test.skip(testInfo.project.metadata.target==='legacy','Lifecycle safety is a new regression guard');
  await game.open();await game.start();await winFight(page,game);
  await page.evaluate(()=>window.__gameTest.newRun());
  await page.waitForTimeout(1100);
  await expect(page.locator('#s-map')).toBeVisible();
  const state=await game.state();expect(state.B).toBeNull();expect(state.G.floor).toBe(1);
});

test('new run invalidates old event and camp progression timers',async({game,page},testInfo)=>{
  test.skip(testInfo.project.metadata.target==='legacy','Lifecycle safety is a new regression guard');
  await game.open();await game.start();
  await page.evaluate(()=>window.__gameTest.showRest());
  await page.locator('#rPicks .pick').first().click();
  await page.evaluate(()=>window.__gameTest.newRun());
  await page.waitForTimeout(1100);
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.floor).toBe(1);
});
