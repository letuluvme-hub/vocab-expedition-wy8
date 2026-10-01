import {test,expect} from './game-harness.js';

test('new run invalidates old battle settlement and victory voice callbacks',async({game,page},testInfo)=>{
  test.skip(testInfo.project.metadata.target==='legacy','Lifecycle safety is a new regression guard');
  await game.open();await game.start();await game.fight({enemyHp:1});await game.clickLetter('l');
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
