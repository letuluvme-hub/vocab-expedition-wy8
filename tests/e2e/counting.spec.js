import { test, expect } from './game-harness.js';

// 真实浏览器里的次数计数。legacy 目标是未修改的归档页面，这些是不变式守卫而非旧版行为基线，
// 因此只在 new 项目上运行 —— 与 tests/e2e/lifecycle.spec.js 的处理一致。
const newOnly = (testInfo, why) =>
  test.skip(testInfo.project.metadata.target === 'legacy', why);

// 真打 BOSS 并结算：走真实的字母输入 → 整词大招 → winFight → 奖励面板 → finishNode。
// ★ 必须拼完整个词才能赢（1 血地板 + 授权闸门），不能只敲一个 'l'。
async function clearBoss(game, page) {
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await game.clickLetter('l');                        // 半词：战斗继续
  expect((await game.state()).B.over).toBe(false);
  await page.keyboard.type('itre');                  // 整词拼完 → 大招收尾
  await expect(page.locator('#pTitle')).toContainText('击败词汇之王');
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
}

test('double-clicking start counts one expedition, not two', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  await game.open();
  // One turn, two real DOM clicks on the real button.
  await page.locator('#startRun').evaluate(el => { el.click(); el.click(); });
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).DB.runs).toBe(1);
});

test('double-clicking next unit starts one expedition, not two', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  await game.open();
  await game.start();
  await clearBoss(game, page);
  expect((await game.state()).DB.runs).toBe(1);
  await page.locator('#oNext').evaluate(el => { el.click(); el.click(); });
  await expect(page.locator('#s-map')).toBeVisible();
  const next = await game.state();
  expect(next.DB.runs).toBe(2);
  expect(next.G.unit).toBe(2);
  expect(next.G.floor).toBe(1);
});

test('double-clicking replay after a loss counts one expedition, not two', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  await game.open();
  await game.start();
  await page.evaluate(() => window.__gameTest.endRun(false));
  await expect(page.locator('#s-over')).toBeVisible();
  await page.locator('#oAgain').evaluate(el => { el.click(); el.click(); });
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).DB.runs).toBe(2);
});

test('two BOSS victories inside one expedition count one clear', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  await game.open();
  await game.start();
  const result = await page.evaluate(() => {
    const t = window.__gameTest;
    const out = [];
    // Raise maxhp so the +30 clear heal is not hidden behind the clamp, and give the
    // second settlement a fresh boss node plus a lower myHp: without a run-level guard
    // both would be observable side effects of an already-cleared expedition.
    t.G.maxhp = 100;
    for (let i = 0; i < 2; i++) {
      const node = { type: 'boss', x: 0.5, row: 8, done: false, links: [] };
      t.G.floor = 9; t.enterNode(node);
      t.B = {
        word: t.WORDS.find(w => w.w === 'litre'), node, foe: { n: 'z', ic: 'z', tint: '#fff' },
        letters: [], used: [], bad: [], input: [], myHp: 100 - i * 40, shield: 0, boss: true, elite: false,
        won: true, over: true, finished: false, rewardTaken: false,
        enHp: 0, enMax: 1, combo: 0, maxCombo: 0, wordsDone: 0, usedThisFight: {},
      };
      const hpBefore = t.G.hp;
      t.finishNode();
      out.push({ wins: t.DB.wins, hp: t.G.hp, hpBefore, nodeDone: node.done, shield: t.G.shield });
    }
    return out;
  });
  // Before the fix this read wins [1, 2] with a second +30 heal (hp 60 -> 100 -> 130
  // clamped) and a second scheduled settlement.
  expect(result[0].wins).toBe(1);
  expect(result[1].wins).toBe(1);
  // The repeat is ignored by the run-level clearedRun guard: no second heal, node untouched.
  expect(result[1].hp).toBe(100);
  expect(result[1].hp).toBe(result[1].hpBefore);
  expect(result[1].nodeDone).toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.__gameTest.DB.wins))
    .toBe(1);
});

test('a real clear counts one win, and reloading does not recount it', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  await game.open();
  await game.start();
  await clearBoss(game, page);
  const win = await game.state();
  expect(win.DB.wins).toBe(1);
  expect(win.DB.runs).toBe(1);
  await page.reload();
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#sRun')).toHaveText('1');
  await expect(page.locator('#sWin')).toHaveText('1');
  expect((await game.state()).DB.runs).toBe(1);
});

test('abandoning an expedition mid-run still counts the one run that started', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  page.on('dialog', d => d.accept());
  await game.open();
  await game.start();
  expect((await game.state()).DB.runs).toBe(1);
  await page.locator('#mQuit').click();
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).DB.runs).toBe(2);
});

test('historical totals survive a new expedition and a clear', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  await game.open({ saved: { runs: 41, wins: 17, best: 9 } });
  await expect(page.locator('#sRun')).toHaveText('41');
  await expect(page.locator('#sWin')).toHaveText('17');
  await game.start();
  expect((await game.state()).DB.runs).toBe(42);
  await clearBoss(game, page);
  const win = await game.state();
  expect(win.DB.runs).toBe(42);
  expect(win.DB.wins).toBe(18);
});

test('skipping the BOSS still counts a run but no clear', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Counting invariant is a new regression guard');
  await game.open();
  await game.start();
  await game.fight({ boss: true });
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-over')).toBeVisible();
  const state = await game.state();
  expect(state.DB.runs).toBe(1);
  expect(state.DB.wins).toBe(0);
});