import { test, expect } from './game-harness.js';

/* 暂停 / 保存 / 恢复的真实浏览器回归。
 *
 * 全部跑在真实 Chrome 上，且用**真实刷新**（page.reload）而不是内存改状态：
 * 暂停的价值就在于「关掉页面还能接着玩」，只有真刷新能证明这一点。
 * legacy 目标没有这个功能，所以全部 skip 到 new 项目。 */

const newOnly = (testInfo) => test.skip(testInfo.project.metadata.target === 'legacy',
  'Pause/resume is a new feature; the archived page cannot do it');

/* ---------------- 1. 暂停真的冻结状态 ---------------- */

test('map pause button freezes the run and saves a snapshot', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => { window.__gameTest.G.gold = 77; });
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  expect(await page.locator('#pzSave').textContent()).toMatch(/已保存/);

  const saved = await game.saved();
  expect(saved.activeRun.phase).toBe('map');
  expect(saved.activeRun.run.gold).toBe(77);

  // 暂停期间点地图节点必须无效：可选节点一个都不许少
  const before = (await game.state()).G;
  await page.evaluate(() => {
    const t = window.__gameTest;
    // 绕过 UI 直接调受闸门保护的入口：证明挡住的是状态，不只是那层 DOM。
    t.progress.enterNode(t.G.avail[0]);
    t.progress.advance();
  });
  await page.waitForTimeout(300);
  const after = (await game.state()).G;
  expect(after.floor).toBe(before.floor);
  expect(after.gold).toBe(before.gold);
  expect(await page.evaluate(() => window.__gameTest.B === null)).toBe(true);
});

test('fight pause button freezes input, items, hint, skip and flee', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await game.clickLetter('l');                       // 半词：lit
  const before = await game.state();
  expect(before.B.input).toEqual(['l']);

  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();

  // 暂停屏是一整屏：战斗页连同它的按钮都不在文档流里（真界面，不是透明遮罩）
  await expect(page.locator('#s-fight')).toBeHidden();
  for (const id of ['tHint', 'tFlee', 'tSkip', 'fBank']) {
    await expect(page.locator('#' + id)).toBeHidden();
  }
  // 键盘输入与全部受闸门保护的入口都必须无效（状态一个字节都不许动）
  await page.keyboard.type('itre');
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.progress.typeLetter('i');
    t.progress.useItem('leech');
    t.progress.requestHint();
    t.progress.skipFight();
    t.progress.fleeFight();
    t.progress.pressLetter(1);
    t.progress.undoLetter();
  });
  await page.waitForTimeout(200);
  const after = await game.state();
  expect(after.B.input).toEqual(['l']);
  expect(after.B.combo).toBe(before.B.combo);
  expect(after.B.hints).toBe(before.B.hints);
  expect(after.B.myHp).toBe(before.B.myHp);
  expect(after.G.gold).toBe(before.G.gold);
  expect(after.G.bag).toEqual(before.G.bag);
  expect(after.G.att).toBe(before.G.att);
  // 逃跑/跳过也没有生效：战斗仍在进行
  expect(after.B.over).toBe(false);
});

test('resume returns to the exact screen and the half word still works', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await game.clickLetter('l');
  const before = await game.state();
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.locator('#pzResume').click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const after = await game.state();
  expect(after.B.input).toEqual(before.B.input);
  expect(after.B.letters).toEqual(before.B.letters);
  // 继续后必须能接着拼完这个词（这是「暂停不丢进度」的核心承诺）
  await page.keyboard.type('itre');
  await expect.poll(async () => (await game.state()).B.wordsDone).toBe(1);
  expect((await game.state()).B.input.length).toBeLessThan(5);
});

/* ---------------- 2. 刷新后主动恢复 ---------------- */

test('reload shows only the title with a continue entry, never auto-enters combat', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await game.clickLetter('l');
  await page.evaluate(() => { window.__gameTest.G.gold = 123; window.__gameTest.G.kills = 2; });
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();

  const saved = await game.saved();
  await game.reload();

  // 刷新后必须停在主页，且明确提供「继续远征」
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#continueRow')).toBeVisible();
  await expect(page.locator('#continueRun')).toHaveText('继续远征');
  // 绝不自动进战斗、也不自动恢复
  expect(await page.evaluate(() => window.__gameTest.G === null)).toBe(true);
  expect(await page.evaluate(() => window.__gameTest.B === null)).toBe(true);
  expect(saved.activeRun.phase).toBe('battle');

  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const state = await game.state();
  expect(state.B.input).toEqual(['l']);
  expect(state.B.letters.length).toBeGreaterThan(0);
  expect(state.B.myHp).toBeLessThan(state.G.maxhp + 1);
  expect(state.G.gold).toBe(123);
  expect(state.G.kills).toBe(2);
  // 恢复不是新开一轮：次数不变
  expect(state.DB.runs).toBe(1);
  expect(state.DB.wins).toBe(0);
  // 恢复后的战斗可以继续打完
  await page.keyboard.type('itre');
  expect((await game.state()).B.wordsDone).toBe(1);
});

test('continue is idempotent across repeated reloads', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await game.clickLetter('l');
  await page.evaluate(() => { window.__gameTest.G.gold = 55; });
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();

  const runs = [];
  for (let i = 0; i < 3; i++) {
    await game.reload();
    await page.locator('#continueRun').click();
    await expect(page.locator('#s-fight')).toBeVisible();
    const s = await game.state();
    runs.push(s.DB.runs);
    expect(s.G.gold).toBe(55);
    expect(s.B.input).toEqual(['l']);
    // 再暂停一次，制造下一次刷新可用的快照
    await page.locator('#tPause').click();
    await expect(page.locator('#s-pause')).toBeVisible();
  }
  expect(runs).toEqual([1, 1, 1]);
});

test('starting a new run with an old snapshot asks before overwriting', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => { window.__gameTest.G.gold = 300; });
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.reload();

  // 先拒绝：旧快照必须原样留着
  page.once('dialog', d => d.dismiss());
  await page.locator('#startRun').click();
  await page.waitForTimeout(200);
  const kept = await game.saved();
  expect(kept.activeRun.run.gold).toBe(300);
  expect(await page.evaluate(() => window.__gameTest.G === null)).toBe(true);

  // 再同意：才建新远征，且是干净的一轮
  page.once('dialog', d => d.accept());
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const s = await game.state();
  expect(s.G.gold).toBe(0);
  expect(s.G.floor).toBe(1);
  expect(s.DB.runs).toBe(2);
});

/* ---------------- 3. 领奖/金币绝不重复 ---------------- */

test('reloading inside the 900ms reward delay does not re-grant gold or re-roll cards', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 1 });
  await page.keyboard.type('litre');
  // 胜利瞬间：金币已入账，奖励卡还在 900ms 延迟里
  await page.waitForFunction(() => window.__gameTest.phase === 'reward', null, { timeout: 3000 });
  const won = (await game.state()).G;
  await page.evaluate(() => window.__gameTest.pauseNow());
  await expect(page.locator('#s-pause')).toBeVisible();
  await game.reload();
  // 刷新后先停在主页：不自动恢复
  expect(await page.evaluate(() => window.__gameTest.G === null)).toBe(true);
  const savedRuns = (await game.saved()).runs;

  await page.locator('#continueRun').click();
  // 回到待领奖：卡还在，但只能领一次
  await expect(page.locator('#s-pick')).toBeVisible();
  const state = await game.state();
  expect(state.G.gold).toBe(won.gold);
  expect(state.G.kills).toBe(won.kills);
  expect(state.DB.runs).toBe(savedRuns);
  const cards = page.locator('#pPicks .pick');
  const first = await cards.first().getAttribute('data-opt');
  expect(first).toBeTruthy();
  await page.locator('#pPicks .pick').first().click();
  const relics = (await game.state()).G.relics.length;
  expect(relics).toBeLessThanOrEqual(1);
  // 再点一次不会二次发放
  await page.evaluate(() => {
    const t = window.__gameTest;
    const again = t.encounter && t.encounter.options[0] && t.encounter.options[0].id;
    if (again) t.progress.takeReward(again);
  });
  expect((await game.state()).G.relics.length).toBe(relics);
});

test('rest choice reload does not heal twice', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const n = t.G.rows[0][0];
    n.type = 'rest';
    t.enterNode(n);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await page.locator('#rPicks .pick').first().click();     // 休息
  const healed = (await game.state()).G.hp;
  // 选完立刻暂停（推进还在 900ms 延迟里）
  await page.evaluate(() => window.__gameTest.pauseNow());
  await expect(page.locator('#s-pause')).toBeVisible();
  await game.reload();
  await page.locator('#continueRun').click();

  expect((await game.state()).G.hp).toBe(healed);
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.floor).toBe(2);
});

test('shop inventory is not re-rolled and purchases are not free after reload', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.gold = 200;
    const n = t.G.rows[0][0];
    n.type = 'shop';
    t.enterNode(n);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  const idsBefore = await page.locator('#rPicks .pick').evaluateAll(els => els.map(e => e.dataset.opt));
  await page.locator('#rPicks .pick').first().click();     // 买第一件
  const afterBuy = (await game.state()).G;
  await page.evaluate(() => window.__gameTest.pauseNow());
  await expect(page.locator('#s-pause')).toBeVisible();
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-rest')).toBeVisible();
  const idsAfter = await page.locator('#rPicks .pick').evaluateAll(els => els.map(e => e.dataset.opt));
  expect(idsAfter).toEqual(idsBefore);                   // 库存不重 roll
  expect((await game.state()).G.gold).toBe(afterBuy.gold);
  await page.locator('#rPicks .pick').first().click();
  expect((await game.state()).G.gold).toBeLessThan(afterBuy.gold);   // 再买照常扣钱
});

test('abandoning clears the snapshot so a reload cannot resurrect the run', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.locator('#pzAbandon').click();
  await expect(page.locator('#s-title')).toBeVisible();
  expect((await game.saved()).activeRun).toBeUndefined();
  await game.reload();
  await expect(page.locator('#continueRow')).toBeHidden();
});

test('finishing a run clears the snapshot', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => { window.__gameTest.G.hp = 1; window.__gameTest.endRun(false); });
  await expect(page.locator('#s-over')).toBeVisible();
  expect((await game.saved()).activeRun).toBeUndefined();
  await page.locator('#oHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  expect((await game.state()).G).toBeNull();
  await game.reload();
  await expect(page.locator('#continueRow')).toBeHidden();
});

/* ---------------- 4. 一次性资源跨暂停守住 ---------------- */

test('a spent ghost charge stays spent across pause and reload', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.relics.push('ghost');
    t.G.hp = t.G.maxhp;
    const n = t.G.avail.find(x => x.type === 'battle') || t.G.avail[0];
    n.type = 'battle';
    t.enterNode(n);
  });
  await page.locator('#tSkip').click();                // 影分身免费撤退
  await page.waitForFunction(() => window.__gameTest.G && window.__gameTest.G.ghostUsed === true,
    null, { timeout: 3000 });
  await expect(page.locator('#s-map')).toBeVisible();
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  expect((await game.saved()).activeRun.run.ghostUsed).toBe(true);
  await game.reload();
  await page.locator('#continueRun').click();
  expect((await game.state()).G.ghostUsed).toBe(true);
});

/* ---------------- 5. 拒绝损坏快照 ---------------- */

test('a corrupted snapshot is not executed and keeps the learning record', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open({ saved: { mastered: ['litre', 'keep'], custom: [{ w: 'mine', z: '我的' }], runs: 5 } });
  await game.start();
  const runsAfterStart = (await game.saved()).runs;   // 开局已 +1，后续不许再动
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  const good = await game.saved();
  // 破坏快照：run.gold 变成非法值
  good.activeRun.run.gold = -1;
  await game.writeSaved(good);
  await game.reload();

  // 拒绝执行：停在主页，不建出半吊子状态
  await expect(page.locator('#s-title')).toBeVisible();
  expect(await page.evaluate(() => window.__gameTest.G === null)).toBe(true);
  page.once('dialog', d => {
    expect(d.message()).toMatch(/损坏|无法恢复/);
    d.dismiss();
  });
  await page.locator('#continueRun').click();
  // 玩家不确认就不丢：学习记录与损坏快照都原样留着
  const after = await game.saved();
  expect(after.activeRun.run.gold).toBe(-1);
  expect(after.mastered).toEqual(['litre', 'keep']);
  expect(after.custom).toEqual([{ w: 'mine', z: '我的' }]);
  expect(after.runs).toBe(runsAfterStart);

  // 确认后才丢，而且只丢快照
  page.once('dialog', d => d.accept());
  await page.locator('#continueRun').click();
  const dropped = await game.saved();
  expect(dropped.activeRun).toBeUndefined();
  expect(dropped.mastered).toEqual(['litre', 'keep']);
  expect(dropped.runs).toBe(runsAfterStart);
});

/* ---------------- 9. 返回主页 ≠ 放弃远征 ---------------- */

test('returning to the title keeps the run: same page and after a reload', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await game.clickLetter('l');
  await page.evaluate(() => { window.__gameTest.G.gold = 246; });
  const before = await game.state();
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();

  // 返回主页 ≠ 放弃：快照与内存都留着，主页仍给入口
  await page.locator('#pzHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#continueRow')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__gameTest.G !== null)).toBe(true);
  expect((await game.saved()).activeRun.run.gold).toBe(246);

  // 同页继续：原样回到战斗页，半词与数据原封不动
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const same = await game.state();
  expect(same.B.input).toEqual(before.B.input);
  expect(same.G.gold).toBe(246);
  expect(same.DB.runs).toBe(1);

  // 再暂停 → 返回主页 → 刷新：数据跨刷新仍然保住
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.locator('#pzHome').click();
  await game.reload();
  await expect(page.locator('#continueRow')).toBeVisible();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const after = await game.state();
  expect(after.B.input).toEqual(before.B.input);
  expect(after.G.gold).toBe(246);
  expect(after.DB.runs).toBe(1);
});

test('a new run from the title drops the held run only after confirmation', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => { window.__gameTest.G.gold = 400; });
  await page.locator('#mPause').click();
  await page.locator('#pzHome').click();
  await expect(page.locator('#s-title')).toBeVisible();

  // 先拒绝：这一局必须还在
  page.once('dialog', d => d.dismiss());
  await page.locator('#startRun').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__gameTest.G !== null)).toBe(true);
  expect((await game.saved()).activeRun.run.gold).toBe(400);

  // 再同意：新局建立，且这一局不再挡路（不被闸门永远挡住）
  page.once('dialog', d => d.accept());
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const s = await game.state();
  expect(s.G.gold).toBe(0);
  expect(s.DB.runs).toBe(2);
  // 新局可正常推进（上一局的冻结标记没有残留）
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.locator('#pzResume').click();
  await expect(page.locator('#s-map')).toBeVisible();
});

/* ---------------- 10. 闸门覆盖到按钮回调本身 ---------------- */

test('event cards are inert while paused even via a stale button reference', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.hp = 20;
    const n = t.G.rows[0][0];
    n.type = 'rest';
    t.enterNode(n);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  const hpBefore = (await game.state()).G.hp;

  // 抓一个真实的按钮引用，暂停后再对它 dispatchEvent：
  // 暂停屏挡得住点击，挡不住玩家手里这个旧引用。
  await page.evaluate(() => { window.__staleBtn = document.querySelector('#rPicks .pick') });
  await page.evaluate(() => window.__gameTest.pauseNow());
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.evaluate(() => window.__staleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await page.waitForTimeout(500);
  expect((await game.state()).G.hp).toBe(hpBefore);
});

/* ---------------- 11. 事件/道具跨刷新保真 ---------------- */

test('rest choice resumes on the same page without healing twice', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.hp = 20;
    const n = t.G.rows[0][0];
    n.type = 'rest';
    t.enterNode(n);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await page.locator('#rPicks .pick').first().click();
  const healed = (await game.state()).G.hp;
  expect(healed).toBeGreaterThan(20);

  // 同页：暂停 → 返回主页 → 继续。回血只该有一次，所以血量必须留有余量而不是回满
  await page.evaluate(() => window.__gameTest.pauseNow());
  await page.locator('#pzHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  await page.locator('#continueRun').click();
  await page.waitForTimeout(1600);
  expect((await game.state()).G.hp).toBe(healed);
  await expect(page.locator('#s-map')).toBeVisible();
});

test('an unchosen event survives a reload with title, body and every card', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const n = t.G.rows[0][0];
    n.type = 'event';
    t.enterNode(n);
  });
  await expect(page.locator('#s-event')).toBeVisible();
  const title = await page.locator('#eTitle').textContent();
  const body = await page.locator('#eText').textContent();
  const icon = await page.locator('#eIcon').textContent();
  const idsBefore = await page.locator('#ePicks .pick').evaluateAll(els => els.map(e => e.dataset.opt));
  expect(idsBefore.length).toBeGreaterThan(1);

  await page.evaluate(() => window.__gameTest.pauseNow());
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-event')).toBeVisible();

  expect(await page.locator('#eTitle').textContent()).toBe(title);
  expect(await page.locator('#eText').textContent()).toBe(body);
  expect(await page.locator('#eIcon').textContent()).toBe(icon);
  const idsAfter = await page.locator('#ePicks .pick').evaluateAll(els => els.map(e => e.dataset.opt));
  expect(idsAfter).toEqual(idsBefore);
  // 卡片必须真的能选（不是画出来好看的死界面）
  await page.locator('#ePicks .pick').first().click();
  await expect(page.locator('#s-map')).toBeVisible();
});

test('a boolean nextHint survives pause and reload, then the next fight uses it', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  // 先知卡把 G.nextHint 置成布尔 true（不是 1 / 2 那种计数）：
  // 快照必须原样存下布尔值，否则恢复后这一发提示就白买了。
  await page.evaluate(() => { window.__gameTest.G.nextHint = true });
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  expect((await game.saved()).activeRun.run.nextHint).toBe(true);

  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect(await page.evaluate(() => window.__gameTest.G.nextHint)).toBe(true);

  // 进下一场战斗：首字母应当已被揭示（hintUsed ≥ 1），且这一发被消耗掉
  await page.evaluate(() => {
    const t = window.__gameTest;
    const n = t.G.avail.find(x => x.type === 'battle') || t.G.avail[0];
    n.type = 'battle';
    t.enterNode(n);
  });
  await expect(page.locator('#s-fight')).toBeVisible();
  // 提示是「揭示首字母」而不是替玩家打字：槽位上会出现一个已揭示的槽（.hint）。
  await expect(page.locator('#fSlots .slot.hint')).toHaveCount(1);
  // 揭示的必须是这个词真正的首字母（不能是随机字母，也不能是空槽）
  const revealed = (await page.locator('#fSlots .slot.hint').first().textContent()).toLowerCase();
  const first = await page.evaluate(() => window.__gameTest.B.word.w[0].toLowerCase());
  expect(revealed).toBe(first);
  expect(revealed.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__gameTest.G.nextHint)).toBe(0);
});

/* ---------------- 12. 结算阶段恢复：只结算一次 ---------------- */

test('the loss settlement is frozen by a pause and completes exactly once on resume', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  // 扣的是战斗里的血（B.myHp），不是远征血（G.hp）：finishNode 之后才会结转回去。
  await page.evaluate(() => { window.__gameTest.B.myHp = 1; });
  // 答错一个字母 → 战败 → 800ms 后才结算
  await page.evaluate(() => {
    const t = window.__gameTest;
    const bad = t.B.letters.findIndex(c => c !== 'l');
    t.progress.pressLetter(bad);
    // 同一个 tick 里立刻暂停：战败 → 800ms 结算 → 暂停，全部在这段延迟之内。
    // 分成两次调用会与那个 800ms 赛跑，测的就不是「暂停能不能冻结结算」了。
    t.pauseNow();
  });
  await expect(page.locator('#s-pause')).toBeVisible();
  expect(await page.evaluate(() => window.__gameTest.phase)).toBe('ending');
  // 暂停期间结算**不许**发生（裸 setTimeout 会在这里跑掉）
  await page.waitForTimeout(1400);
  await expect(page.locator('#s-over')).toBeHidden();
  expect((await game.saved()).activeRun.phase).toBe('ending');

  await page.locator('#pzResume').click();
  await expect(page.locator('#s-over')).toBeVisible();
  expect((await game.saved()).activeRun).toBeUndefined();
  const s = await game.state();
  expect(s.DB.rewards.length).toBe(0, '输了没有纪念卡');
});

test('a boss win is settled once across pause, reload and resume', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 1, boss: true });
  await page.keyboard.type('litre');
  await page.waitForFunction(() => window.__gameTest.phase === 'reward', null, { timeout: 3000 });
  await page.locator('#pPicks .pick').first().click();      // 领奖 → BOSS 收尾
  await page.waitForFunction(() => window.__gameTest.phase === 'ending', null, { timeout: 3000 });
  await page.evaluate(() => window.__gameTest.pauseNow());
  await expect(page.locator('#s-pause')).toBeVisible();
  const snapshot = await game.saved();
  expect(snapshot.activeRun.phase).toBe('ending');
  expect(snapshot.activeRun.outcome).toBe(true);

  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-over')).toBeVisible();
  const s = await game.state();
  expect(s.DB.wins).toBe(1, '通关数只记一次');
  expect(s.DB.rewards.length).toBe(1, '纪念卡只生成一张');
  expect((await game.saved()).activeRun).toBeUndefined();
});

test('a finished run is neither re-saved nor re-paused by pagehide', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => { window.__gameTest.G.hp = 1; window.__gameTest.endRun(false); });
  await expect(page.locator('#s-over')).toBeVisible();
  expect((await game.saved()).activeRun).toBeUndefined();

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  // 结算屏不许被暂停屏抢走，也不许把这一局重新存下来
  await expect(page.locator('#s-over')).toBeVisible();
  await expect(page.locator('#s-pause')).toBeHidden();
  expect((await game.saved()).activeRun).toBeUndefined();
  await game.reload();
  await expect(page.locator('#continueRow')).toBeHidden();
});

/* ---------------- 13. 拒绝面：浏览器里的损坏快照 ---------------- */

test('a snapshot missing a battle word is rejected on the title screen without breaking the page', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open({ saved: { mastered: ['litre'], runs: 2 } });
  await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  const good = await game.saved();
  delete good.activeRun.battle.word;              // 缺一个必需字段：解不开
  await game.writeSaved(good);
  await game.reload();

  // 主页照常可用（没有红屏、没有自动恢复），并明确说这份进度有问题
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#continueRow')).toBeVisible();
  await expect(page.locator('#continueRun')).toHaveText('远征进度已损坏');
  expect(await page.evaluate(() => window.__gameTest.G === null)).toBe(true);
  expect((await game.saved()).mastered).toEqual(['litre']);

  page.once('dialog', d => d.accept());
  await page.locator('#continueRun').click();
  const dropped = await game.saved();
  expect(dropped.activeRun).toBeUndefined();
  expect(dropped.mastered).toEqual(['litre']);
  expect(dropped.runs).toBe(3);
});

/* ---------------- 14. 真实动作当场落盘（不暂停、不刷新）----------------
 * 这一组全部**不**调用 pauseNow、不 reload：每个真实动作（点字母、提示、道具、
 * 事件/营火/商店选项、领奖、语音开关）做完立刻读 localStorage，与内存逐项对比。
 * 旧实现的受闸门动作只在 saveDB() 标脏时才提交，而大部分动作（enterNode、
 * 半词、提示、道具、商店按钮、语音开关）根本不调 saveDB —— 于是这些进度
 * 只活在内存里，直到玩家碰巧触发一次别的原因才被顺带写下去。 */

const savedBattle = async (game) => (await game.saved()).activeRun.battle;

test('entering a battle node is written to storage immediately', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  // 真实地图点击（不是探针直调）：把可选节点标成战斗后点它
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.avail.forEach(n => { n.type = 'battle' });
    t.renderMap();
  });
  await page.locator('#map .node.pick').first().click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const saved = await game.saved();
  expect(saved.activeRun.phase, '进战斗后盘上必须是 battle，而不是还停在 map').toBe('battle');
  expect(saved.activeRun.battle, '战斗事实必须当场落盘').toBeTruthy();
  expect(saved.activeRun.battle.word.w).toBe((await game.state()).B.word);
});

test('a half word, a hint and a spent item are all on disk at once', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });

  // 半词：点一个字母就落盘，不等到拼完整词
  await game.clickLetter('l');
  let onDisk = await savedBattle(game);
  expect(onDisk.input, '半词必须当场在盘上').toEqual(['l']);

  // 提示：消耗的是一次性资源，刷新/暂停后必须仍是消耗过的
  const hintsBefore = (await game.state()).B.hints;
  await page.locator('#tHint').click();
  onDisk = await savedBattle(game);
  expect(onDisk.hints).toBe(hintsBefore - 1);
  expect(onDisk.hintTotal).toBeGreaterThan(0);

  // 道具：吸血獠牙是真实背包里真实持有的那一个
  const bagBefore = (await game.state()).G.bag.leech;
  expect(bagBefore).toBeGreaterThan(0);
  await page.evaluate(() => window.__gameTest.progress.useItem('leech'));
  const saved2 = await game.saved();
  expect(saved2.activeRun.run.bag.leech, '道具必须当场扣在盘上').toBe(bagBefore - 1);
  expect(saved2.activeRun.battle.usedThisFight.leech).toBe(1);

  // 退格也要落盘：否则刷新回来会多出一个字母
  await page.keyboard.press('Backspace');
  expect((await savedBattle(game)).input, '退格必须当场落盘').toEqual([]);
});

test('a wrong letter is recorded on disk with the damage it caused', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  const before = await game.state();
  await page.evaluate(() => {
    const t = window.__gameTest;
    // 必须挑一个**不在这个词里**的字母：字母在词里但位置不对属于「顺序错」，
    // 那是软错误、只扣血不标 bad（也不该被这里断言）。
    const word = t.B.word.w.toLowerCase();
    const bad = t.B.letters.findIndex(c => word.indexOf(c) < 0);
    if (bad < 0) throw new Error('字母盘上必须有一个不在这个词里的干扰字母');
    t.progress.pressLetter(bad);
  });
  const saved = await game.saved();
  expect(saved.activeRun.battle.bad.some(Boolean), '答错的字母必须记在盘上').toBe(true);
  expect(saved.activeRun.run.att, '尝试次数必须与内存一致').toBe(before.G.att + 1);
  expect(saved.activeRun.battle.myHp).toBeLessThan(before.B.myHp);
});

test('a mastered word victory writes gold, kills, mastery and the card list together', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => { window.__gameTest.DB.mastered = ['keep']; });
  await game.fight({ word: 'litre', enemyHp: 1 });
  await page.keyboard.type('litre');
  await page.waitForFunction(() => window.__gameTest.phase === 'reward', null, { timeout: 3000 });
  await expect(page.locator('#s-pick')).toBeVisible();

  // 一整次战斗胜利的**全部**事实必须在同一次写里都在盘上
  const saved = await game.saved();
  const live = await game.state();
  expect(saved.activeRun.phase).toBe('reward');
  expect(saved.activeRun.run.gold, '金币当场落盘').toBe(live.G.gold);
  expect(live.G.gold).toBeGreaterThan(0);
  expect(saved.activeRun.run.kills, '击杀当场落盘').toBe(live.G.kills);
  expect(saved.activeRun.run.done, '本局退休的词当场落盘').toEqual(live.G.done);
  expect(saved.mastered, '跨局掌握表与快照同一次写').toEqual(live.DB.mastered);
  expect(saved.activeRun.encounter.options.length, '已 roll 的卡面当场落盘').toBeGreaterThan(0);
  const onScreen = await page.locator('#pPicks .pick').evaluateAll(els => els.map(e => e.dataset.opt));
  expect(saved.activeRun.encounter.options.map(o => o.id)).toEqual(onScreen);
});

test('rest choice and its delayed advance both reach storage', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.hp = 20;
    const n = t.G.rows[0][0];
    n.type = 'rest';
    t.enterNode(n);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await page.locator('#rPicks .pick').first().click();

  // 选择当下：回血与 chosenId 检查点都已经在盘上
  const mid = await game.saved();
  expect(mid.activeRun.run.hp).toBeGreaterThan(20);
  expect(mid.activeRun.encounter.chosenId, '选择当下就必须有可恢复的检查点').toBeTruthy();

  // 延迟推进跑完后：层数推进也必须落盘
  await expect(page.locator('#s-map')).toBeVisible();
  const after = await game.saved();
  expect(after.activeRun.phase).toBe('map');
  expect(after.activeRun.run.floor).toBe(2);
  expect(after.activeRun.run.hp).toBeGreaterThan(20);
});

test('a shop purchase and leaving the shop both reach storage', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.gold = 200;
    const n = t.G.rows[0][0];
    n.type = 'shop';
    t.enterNode(n);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await page.locator('#rPicks .pick').first().click();     // 买第一件
  const afterBuy = await game.saved();
  expect(afterBuy.activeRun.run.gold, '买药扣钱当场落盘').toBe(155);

  const leave = page.locator('#rPicks .pick[data-opt="shop:leave"]');
  await leave.click();
  await expect(page.locator('#s-map')).toBeVisible();
  const after = await game.saved();
  expect(after.activeRun.run.gold).toBe(155);
  expect(after.activeRun.run.floor).toBe(2);
});

/* 快速 advance→shop→leave 会踩中 400ms 双击去重窗口：advance 返回 'locked'，
 * 相位停在 encounter-done。旧实现在 leave 分支从不发布 chosenId，
 * 这一刻的快照会被 codec 判成 invalid，刷新后这一局直接没了。 */
test('leaving a shop inside the 400ms advance window still leaves a restorable save', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.gold = 200;
    const n = t.G.rows[0][0];
    n.type = 'shop';
    t.enterNode(n);
    // 把去重窗口推到「刚刚」，制造 advance 的 'locked' 分支（用真实字段，不改玩法）
    t.G.advAt = Date.now();
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await page.locator('#rPicks .pick[data-opt="shop:leave"]').click();

  const saved = await game.saved();
  expect(saved.activeRun.encounter.chosenId, '离开商店必须留下 chosenId 检查点').toBe('shop:leave');
  // 关键断言：这份存档必须真的能恢复（不是被判损坏）
  await game.reload();
  await expect(page.locator('#continueRow')).toBeVisible();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const s = await game.state();
  expect(s.G.gold, '刷新后不会重新进商店、不会重新购物').toBe(200);
  expect(s.G.floor, '只补一次推进，不多推进').toBe(2);
});

/* ---------------- 15. 语音开关立刻落盘并跨刷新一致 ---------------- */

test('toggling voice on the title is stored immediately and survives a reload', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();                       // 种子把 voice 置为 false
  const before = (await game.saved()).voice;
  expect(before).toBe(false);
  const live = await page.evaluate(() => window.__gameTest.TTS.on);
  expect(live).toBe(false);

  await page.locator('#voiceBtn').click();
  expect(await page.evaluate(() => window.__gameTest.TTS.on)).toBe(true);
  expect((await game.saved()).voice, '语音开关必须当场落盘，不能只在内存里').toBe(true);

  await game.reload();
  expect((await game.saved()).voice).toBe(true);
  expect(await page.evaluate(() => window.__gameTest.TTS.on), '刷新后语音仍然开着').toBe(true);
});

test('toggling voice with an expedition running saves it together with the snapshot', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  const before = await game.state();
  // 任务15 起语音开关只在主页的 #audioSettings 面板里（不再是挂在 body 上的浮动按钮），
  // 所以从地图暂停回主页再切语音：中途会经过暂停屏并把快照落盘。
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.locator('#pzHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  await page.locator('#voiceBtn').click();
  const saved = await game.saved();
  expect(saved.voice).toBe(true);
  expect(saved.activeRun, '开着远征时切语音不能把快照弄丢').toBeTruthy();
  expect(saved.activeRun.phase).toBe('map');
  // 绕一圈回来，地图资源必须原样还在（不能因为暂停→主页这一趟被重置或推进）
  expect(saved.activeRun.run.gold).toBe(before.G.gold);
  expect(saved.activeRun.run.floor).toBe(before.G.floor);
});

/* ---------------- 16. 恢复文本不重复转义（真实 Chrome）----------------
 * 快照里的展示字段是玩家暂停前看到的原文。旧实现在恢复时把转义后的串写回
 * 描述，刷新两次就会看到「&amp;lt;」这种实体堆叠；而 <img onerror> 这类
 * 文本必须永远只是文字，不能变成真 DOM。 */

test('restored card text is escaped once and never becomes live DOM', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const n = t.G.rows[0][0];
    n.type = 'rest';
    t.enterNode(n);
  });
  await expect(page.locator('#s-rest')).toBeVisible();
  await page.evaluate(() => window.__gameTest.pauseNow());
  await expect(page.locator('#s-pause')).toBeVisible();

  // 往存档里塞一段带标签与实体的原文（模拟被手改/未来版本写下的存档）
  const dirty = await game.saved();
  dirty.activeRun.encounter.options[0].t = 'A & B <b>粗体</b>';
  dirty.activeRun.encounter.options[0].d = '<img src=x onerror=alert(1)>';
  await game.writeSaved(dirty);
  await game.reload();

  await page.locator('#continueRun').click();
  await expect(page.locator('#s-rest')).toBeVisible();
  const card = page.locator('#rPicks .pick').first();
  // 标题里带图标前缀，比较的是文本本身：原文必须原样显示，且没有二次转义
  const title = (await card.locator('b').textContent()).replace(/^\S+\s/, '');
  expect(title, '原文必须原样显示').toBe('A & B <b>粗体</b>');
  expect(await card.locator('img').count(), '存档里的标签不许变成真元素').toBe(0);
  const first = await card.innerHTML();

  // 再刷新一次：不允许出现 &amp;amp; / &amp;lt; 这种二次转义
  await page.evaluate(() => window.__gameTest.pauseNow());
  await expect(page.locator('#s-pause')).toBeVisible();
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-rest')).toBeVisible();
  expect(await page.locator('#rPicks .pick').first().innerHTML(), '两次恢复的卡面必须逐字相同').toBe(first);
  expect((await page.locator('#rPicks .pick').first().locator('b').textContent()).replace(/^\S+\s/, ''))
    .toBe('A & B <b>粗体</b>');
});

/* ---------------- 6. 窄屏布局 ---------------- */
for (const width of [320, 390]) {
  test(`pause screen lays out at ${width}px without overflow`, async ({ game, page }, testInfo) => {
    newOnly(testInfo);
    await page.setViewportSize({ width, height: 720 });
    await game.open(); await game.start();
    await game.fight({ word: 'litre', enemyHp: 500 });
    await page.locator('#tPause').click();
    await expect(page.locator('#s-pause')).toBeVisible();
    for (const id of ['pzResume', 'pzHome', 'pzAbandon']) {
      const box = await page.locator('#' + id).boundingBox();
      expect(box.width).toBeLessThanOrEqual(width);
      expect(box.x).toBeGreaterThanOrEqual(0);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
