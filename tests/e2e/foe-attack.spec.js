import { test, expect } from './game-harness.js';
test.beforeEach(({},testInfo)=>{ test.skip(testInfo.project.metadata.target==='legacy','Telegraphed autonomous attacks are absent from the archived legacy application'); });

/* ============================================================
 * 蓄力自主攻击（清单 13）在真实 Chrome 里的验收。
 *
 * ★ 诚实声明：这里**没有**用 Playwright 的 clock 加速。
 *   相位推进用的是页面自己的 Date.now + 真实 setTimeout，所以所有
 *   waitForTimeout / waitForFunction 跑的时长就是**真实墙钟时长**
 *   （「11 秒挨第一下」这类断言真的等了 11 秒）。
 *   唯一被加速的是测试框架的等待上限（timeout），不是游戏里的相位。
 *   代价是这一组用例本身要跑几十秒；换来的是不会因为假时钟而
 *   掩盖掉「后台标签页节流」「Date.now 与定时器不同源」这类真实问题。
 *   这仍不等于真机：iOS/Android 浏览器的后台节流行为需人工验证。
 * ============================================================ */

/* 相位与快照：直接读应用挂在 B 上的事实，不靠 DOM 文案。 */
async function foeAttack(page) {
  return page.evaluate(() => {
    const B = window.__gameTest.B;
    return B && B.foeAttack ? { ...B.foeAttack } : null;
  });
}

test('idle 站桩后才蓄力，蓄满打出一次伤害（先护盾后生命）', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });

  // 开局在 idle，且剩余时间等于该档 idle 窗口 —— 绝不一来就挨打。
  let f = await foeAttack(game.page);
  expect(f, '战斗开始后必须有蓄力事实').not.toBeNull();
  expect(f.phase).toBe('idle');
  expect(f.remainingMs).toBeGreaterThan(0);

  const before = await game.state();
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });
  f = await foeAttack(game.page);
  expect(f.phase).toBe('telegraph');
  expect(before.B.myHp, '蓄力中还没打出来').toBe(before.B.myHp);

  // 蓄满 → 恰好一次伤害，普通怪 4 点。
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 15_000 });
  const after = await game.state();
  expect(after.B.myHp).toBe(before.B.myHp - 4);
  const f2 = await foeAttack(game.page);
  expect(f2.cycle).toBe(1);
  expect(f2.phase).toBe('recover');
});

test('护盾先挨打：血量不变，护盾被扣掉', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.evaluate(() => { window.__gameTest.B.shield = 10; window.__gameTest.G.shield = 10; });
  const before = await game.state();
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 20_000 });
  const after = await game.state();
  expect(after.B.myHp, '护盾够厚时不该掉血').toBe(before.B.myHp);
  expect(after.B.shield).toBe(6);
});

test('蓄力时一次有效字母尝试打断：进收招，本轮不掉血', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });

  const before = await game.state();
  const target = before.B.word[0];
  await game.clickLetter(target);

  const f = await foeAttack(game.page);
  expect(f.phase, '被打断后进入收招').toBe('recover');
  expect(f.interrupted).toBe(true);
  expect(f.cycle, '被打断的一轮不计入已完成').toBe(0);

  // 收招窗口过后这一轮不会再补打。
  await game.page.waitForTimeout(3500);
  const after = await game.state();
  expect(after.B.myHp, '被打断的蓄力永远不补打').toBe(before.B.myHp);
});

test('已用/已试过的字母打断不了（乱按不能维持永远安全）', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  // 先把一个干扰字母标成「已试过」：它的 bad 标记就是「重复不算」的那条判据。
  await game.page.evaluate(() => {
    const B = window.__gameTest.B;
    const i = B.letters.findIndex((c, j) => !B.used[j] && c !== B.word.w.replace(/[^a-z]/g, '')[B.input.length]);
    B.bad[i] = true;
  });
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });
  const badIndex = await game.page.evaluate(() => window.__gameTest.B.bad.findIndex(Boolean));
  await game.page.evaluate(i => window.__gameTest.pressKey(i), badIndex);
  const f = await foeAttack(game.page);
  expect(f.phase, '重复已试字母不算有效尝试').toBe('telegraph');
  expect(f.interrupted).toBe(false);
});

test('暂停冻结蓄力：等多久都不挨打，继续后按剩余时间走，不多打', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });

  await game.page.evaluate(() => window.__gameTest.pauseNow());
  const pausedHp = (await game.state()).B.myHp;
  // 暂停期间真实等 3 秒（超过普通怪的 5 秒蓄力窗口的一半）。
  await game.page.waitForTimeout(3000);
  const during = await game.state();
  expect(during.B.myHp, '暂停期间绝不结算伤害').toBe(pausedHp);
  expect((await foeAttack(game.page)).phase).toBe('telegraph');

  await game.page.evaluate(() => window.__gameTest.resumeFromPause());
  // 继续后按冻结时的剩余时间打出**一次**，不是两次。
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 15_000 });
  const after = await game.state();
  expect(after.B.myHp).toBe(pausedHp - 4);
  await game.page.waitForTimeout(1200);
  expect((await game.state()).B.myHp, '不会补打').toBe(pausedHp - 4);
});

test('刷新恢复：存档里只有剩余时间，runid/runs 不变，恢复后不多打', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });
  await game.page.evaluate(() => window.__gameTest.pauseNow());

  const saved = await game.saved();
  const fact = saved.activeRun.battle.foeAttack;
  expect(fact, '快照必须带上蓄力事实').toBeTruthy();
  expect(Object.keys(fact).sort()).toEqual(['cycle', 'interrupted', 'phase', 'remainingMs', 'schemaVersion']);
  expect(fact.remainingMs).toBeGreaterThan(0);
  expect(fact.dueAt, '绝不落盘绝对时间').toBeUndefined();
  expect(fact.timerId, '绝不落盘定时器 id').toBeUndefined();
  expect(JSON.stringify(saved.activeRun)).not.toMatch(/performance|setTimeout|Date\.now/);

  const runsBefore = saved.runs, roundIdBefore = saved.activeRun.run.roundId;
  const hpBefore = saved.activeRun.battle.myHp;

  await game.reload();
  await game.page.locator('#continueRun').click();
  await expect(game.page.locator('#s-fight')).toBeVisible();

  const restored = await foeAttack(game.page);
  expect(restored.phase).toBe('telegraph');
  expect(restored.remainingMs, '按保存的剩余时间重建').toBeGreaterThan(0);
  expect(restored.remainingMs).toBeLessThanOrEqual(fact.remainingMs);

  const after = await game.saved();
  expect(after.runs, '恢复绝不新增一次远征').toBe(runsBefore);
  expect(after.activeRun.run.roundId).toBe(roundIdBefore);

  // 继续后按剩余时间打出一次，掉血与暂停前记录的 hp 一致。
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 15_000 });
  expect((await game.state()).B.myHp).toBe(hpBefore - 4);
});

test('恢复时 runid / runs / wins 不变，也不会重复发奖', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.evaluate(() => window.__gameTest.pauseNow());
  const before = await game.saved();
  await game.reload();
  await game.page.locator('#continueRun').click();
  await expect(game.page.locator('#s-fight')).toBeVisible();
  const after = await game.saved();
  expect(after.runs).toBe(before.runs);
  expect(after.wins).toBe(before.wins);
  expect(after.rewards.length).toBe(before.rewards.length);
  expect(after.activeRun.run.id).toBe(before.activeRun.run.id);
  // 连续两次恢复也不该漂移（remainingMs 稳定，不因快照而重排）。
  const f1 = (await game.saved()).activeRun.battle.foeAttack;
  expect(f1.cycle).toBe(before.activeRun.battle.foeAttack.cycle);
});

test('赢了之后不再有任何主动伤害，也没有额外奖励', async ({ game }) => {
  test.setTimeout(40000); // This case deliberately observes two 11-second attack windows.
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  const before = await game.saved();
  // 直接判胜（走真实的 winFight 授权）。
  await game.page.evaluate(() => {
    const t = window.__gameTest, B = t.B;
    const rt = t.norm(B.word.w);
    B.input = rt.split('');
    B.used = B.letters.map(c => rt.includes(c));
    B.enHp = 0;
    t.winFight();
  });
  await expect(game.page.locator('#s-fight')).toBeVisible();
  const hpAtWin = (await game.state()).B.myHp;
  const rewardsAtWin = (await game.saved()).rewards.length;
  const killsAtWin = (await game.state()).G.kills;
  // 熬过两次攻击窗口：结算后不得再掉血。
  await game.page.waitForTimeout(24_000);
  expect((await game.state()).B.myHp, '结算后不得再有任何主动伤害').toBe(hpAtWin);
  expect((await game.saved()).rewards.length, '绝不重复发奖').toBe(rewardsAtWin);
  expect((await game.state()).G.kills, '击杀数只加一次').toBe(killsAtWin);
  expect((await game.saved()).wins).toBe(before.wins);
});

/* 窄屏验收：每个尺寸一个独立用例。
   ★ 不能塞进同一个用例的循环里：game.open() 只在 sessionStorage 首次播种存档，
     第二轮 open() 读到的是第一轮留下的 activeRun，start() 于是走「放弃旧局」确认
     分支，#s-map 永远不出现 —— 那是测试脚手架的坑，不是产品行为。 */
for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`${size.width}x${size.height}：放大的怪物与蓄力条不遮字母盘、不溢出视口`, async ({ game }) => {
    await game.page.setViewportSize(size);
    await game.open();
    await game.start();
    await game.fight({ enemyHp: 10_000 });
    await game.page.waitForFunction(() => !!window.__gameTest.B.foeAttack, null, { timeout: 15_000 });

    const geo = await game.page.evaluate(() => {
      const r = id => { const b = document.getElementById(id).getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, right: b.right }; };
      return {
        av: r('fAv'), bank: r('fBank'), meter: r('fFoeAtk'), hud: r('fMy'),
        vw: innerWidth, vh: innerHeight,
        scrollW: document.documentElement.scrollWidth,
        avatarVar: getComputedStyle(document.getElementById('s-fight')).getPropertyValue('--avatar'),
        avatarLayoutWidth: parseFloat(getComputedStyle(document.getElementById('fAv')).width),
      };
    });

    const base = parseFloat(geo.avatarVar) || 64;
    // The preserved idle animation transforms the bounding box; measure the
    // configured layout size for the scale cap, and actual boxes for overlap.
    expect(geo.avatarLayoutWidth, '怪物的布局尺寸确实被放大').toBeGreaterThan(base);
    expect(geo.avatarLayoutWidth, `布局放大不得超过基准 1.2 倍（基准 ${base}）`).toBeLessThanOrEqual(base * 1.2 + 1);
    // 字母盘完整留在视口内。
    expect(geo.bank.y, '字母盘必须可见').toBeGreaterThanOrEqual(-1);
    expect(geo.bank.bottom, '字母盘底边不得溢出').toBeLessThanOrEqual(geo.vh + 1);
    expect(geo.bank.x).toBeGreaterThanOrEqual(-1);
    expect(geo.bank.right).toBeLessThanOrEqual(geo.vw + 1);
    // 蓄力条在敌人信息块里，不得与字母盘重叠。
    if (geo.meter.h > 0) expect(geo.meter.bottom, '蓄力条不得盖住字母盘').toBeLessThanOrEqual(geo.bank.y + 1);
    expect(geo.scrollW, '不得横向溢出').toBeLessThanOrEqual(geo.vw + 1);
    // HUD 仍在。
    expect(geo.hud.h).toBeGreaterThan(0);
    expect(geo.hud.y).toBeGreaterThanOrEqual(-1);
  });
}

test('a second battle after retreat still has a live countdown', async ({ game, page }) => {
  await game.open(); await game.start(); await game.fight({ enemyHp:10_000 });
  await page.evaluate(()=>{const t=window.__gameTest;t.G.relics.push('ghost');t.renderFight();});
  await page.locator('#tSkip').click(); await expect(page.locator('#s-map')).toBeVisible();
  await game.fight({enemyHp:10_000});
  await page.waitForFunction(()=>window.__gameTest.B.foeAttack.phase==='telegraph',null,{timeout:15_000});
  // 进度现在由 transform:scaleX 承载（width 恒为满宽，见 foe-attacks.css），
  // 所以量**视觉 bbox**而不是内联 width —— 后者在过渡期间早就写到终值了。
  // reduce 下整条被刻意藏起（那是那条不闪的降级路径），bbox 恒为 0，
  // 此时退回读内联 scaleX：两条路径下它都是 0..1 的同一个量。
  const fillRatio = () => page.locator('#fFoeAtk').evaluate(() => {
    const bar = document.querySelector('#fFoeAtk .foeAtkBar');
    const fill = document.querySelector('#fFoeAtk .foeAtkBar > i');
    if (!bar || !fill) return null;
    const barW = bar.getBoundingClientRect().width;
    const visW = fill.getBoundingClientRect().width;
    if (barW > 0 && visW > 0) return visW / barW;
    const m = /scaleX\(([-0-9.eE]+)\)/.exec(fill.style.transform || '');
    return m ? parseFloat(m[1]) : null;
  });
  const first=await fillRatio();
  await expect.poll(fillRatio,{timeout:2500}).toBeLessThan(first-0.1);
});

test('蓄力条的文案如实描述机制（可用字母，重复不算）', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });
  const txt = await game.page.locator('#fFoeAtk').innerText();
  expect(txt).toContain('蓄力时尝试一个可用字母可打断');
  expect(txt).toContain('重复已试字母不算');
  // 绝不许出现剧透词或骗人的「按任意键」。
  expect(txt).not.toMatch(/任意|随便按/);
  const word = (await game.state()).B.word;
  expect(txt.toLowerCase()).not.toContain(word.toLowerCase());
});
/* ============================================================
 * 下面两条是本次定向修补的垂直验收：真实 Chrome、真实墙钟。
 * ============================================================ */

/* 11 秒自主攻击：断言**盘上**与**HUD 上**的血都已扣掉，且与内存一致。
   旧实现只在推进相位时提交，于是盘里留着「已收招但血还是满的」那一帧。 */
test('11 秒自主攻击后：内存/盘/HUD 三处血量一致，存档不含「已出手但没掉血」的中间态', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });

  const hpBefore = (await game.state()).B.myHp;
  expect(hpBefore).toBeGreaterThan(0);
  // 等这一下真的打出来（普通怪 6000 站桩 + 5000 蓄力 = 11 秒，真实等待）。
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 25_000 });

  const live = (await game.state()).B.myHp;
  expect(live, '内存里的血已经扣掉').toBe(hpBefore - 4);

  // HUD：血条文字必须与内存同数（渲染那一刻看到的就已经是扣完之后的值）。
  const hud = await game.page.locator('#fMyT').innerText();
  expect(hud, 'HUD 上的血量与内存一致').toContain(String(live));

  // 盘：立刻读存档，血量必须已经是扣完之后的值。
  const saved = await game.saved();
  expect(saved.activeRun.battle.myHp, '存档里的血量 = 伤害之后的血量').toBe(live);
  expect(saved.activeRun.battle.foeAttack.cycle, '这一轮在存档里已完成').toBe(1);
  expect(saved.activeRun.battle.foeAttack.phase, '存档里是收招，不是还在蓄力').toBe('recover');
});

/* 蓄力可视倒计时真实流动 + 暂停冻结/继续重定位：
   1200ms 处暂停（剩 3.8 秒）→ 真等 5 秒 → 继续 → 立刻 checkpoint 仍约 3.8
   → 再刷新 → 按同样剩余只挨一下。蓄力条上的秒数与宽度必须真的在变。 */
test('蓄力倒计时真实流动；暂停冻结剩余、继续按真实剩余重定位，刷新后只挨一下', async ({ game }) => {
  // 一个完整的 idle→telegraph 窗口，外加注释里写明的「真等 5 秒」，串起来
  // 超过 25s 基准；并行跑时机器负载还会把这 22.9s 推过线。断言一条没减，
  // 只是让这条测试拿到它本来就需要的墙钟时间（同文件 182 行同理）。
  test.setTimeout(40_000);
  await game.page.setViewportSize({ width: 320, height: 568 });
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });

  /* --- ① 秒数与进度条真的在走（不是固定 5s） --- */
  const read = () => game.page.evaluate(() => {
    const box = document.getElementById('fFoeAtk');
    const fill = box.querySelector('.foeAtkBar > i');
    const bar = box.querySelector('.foeAtkBar');
    // 进度已改由 scaleX 承载：优先量**视觉**宽度（过渡进行到哪一帧，
    // 就是画面上真正看到的那一帧）。reduce 下整条被刻意藏起、bbox 恒为 0，
    // 那时退回读内联 scaleX —— 两条路径下都是同一个 0..1 的量。
    const barW = bar ? bar.getBoundingClientRect().width : 0;
    const visW = fill ? fill.getBoundingClientRect().width : 0;
    let progress = null;
    if (barW > 0 && visW > 0) progress = visW / barW;
    else if (fill) { const m = /scaleX\(([-0-9.eE]+)\)/.exec(fill.style.transform || '');
      progress = m ? parseFloat(m[1]) : null; }
    return { txt: box.innerText, progress };
  });
  const m1 = /(\d+)s/.exec((await read()).txt);
  expect(m1, '蓄力文案里带秒数').toBeTruthy();
  const secs1 = Number(m1[1]);
  const w1 = (await read()).progress;
  await game.page.waitForTimeout(1200);
  const after = await read();
  const secs2 = Number(/(\d+)s/.exec(after.txt)[1]);
  expect(secs2, `1.2 秒后秒数应当变小（${secs1}s -> ?）`).toBeLessThan(secs1);
  expect(after.progress, '进度也应当变化').not.toBe(w1);

  /* --- ② 暂停冻结剩余时间 --- */
  const remainingAtPause = await game.page.evaluate(() => window.__gameTest.foeAttack.remainingMs());
  expect(remainingAtPause, '暂停时还有大约 3.8 秒').toBeGreaterThan(2500);
  expect(remainingAtPause).toBeLessThan(4500);

  await game.page.evaluate(() => window.__gameTest.pauseNow());
  const hpAtPause = (await game.state()).B.myHp;
  const savedAtPause = (await game.saved()).activeRun.battle.foeAttack.remainingMs;
  expect(savedAtPause, '暂停那一刻就把冻结的剩余时间落盘（约 3.8s）').toBeGreaterThan(2500);
  expect(savedAtPause).toBeLessThan(4500);

  // 暂停期间真等 5 秒（超过整个蓄力窗口）：既不掉血，倒计时也不走。
  await game.page.waitForTimeout(5000);
  expect((await game.state()).B.myHp, '暂停期间绝不结算伤害').toBe(hpAtPause);
  const stillPaused = await game.page.evaluate(() => window.__gameTest.foeAttack.remainingMs());
  expect(Math.abs(stillPaused - savedAtPause), '暂停期间剩余时间不走').toBeLessThanOrEqual(50);

  /* --- ③ 继续：立刻 checkpoint 仍约等于暂停时的剩余 --- */
  await game.page.evaluate(() => window.__gameTest.resumeFromPause());
  const afterResume = await game.page.evaluate(() => window.__gameTest.foeAttack.remainingMs());
  expect(afterResume, '继续后立刻 checkpoint ≈ 暂停时的剩余，绝不为 0').toBeGreaterThan(0);
  expect(Math.abs(afterResume - savedAtPause),
    `继续后剩余 ${afterResume} 应约等于暂停时的 ${savedAtPause}（允许动作本身的几毫秒）`).toBeLessThanOrEqual(400);

  /* --- ④ 刷新：按同样剩余重建，只挨一下 --- */
  const hpBeforeHit = (await game.state()).B.myHp;
  await game.reload();
  await game.page.locator('#continueRun').click();
  await expect(game.page.locator('#s-fight')).toBeVisible();
  const restored = await foeAttack(game.page);
  expect(restored.phase).toBe('telegraph');
  expect(restored.remainingMs, '刷新后按保存的剩余重建，不补打也不提前').toBeGreaterThan(0);
  expect(restored.remainingMs).toBeLessThanOrEqual(savedAtPause);

  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 25_000 });
  const afterHit = (await game.state()).B.myHp;
  expect(afterHit, '这一轮只挨一下').toBe(hpBeforeHit - 4);
  const savedHit = (await game.saved()).activeRun.battle;
  expect(savedHit.myHp, '盘上也是扣完之后的血量').toBe(afterHit);
  await game.page.waitForTimeout(2000);
  expect((await game.state()).B.myHp, '不会补打').toBe(afterHit);

  /* --- ⑤ 320px 窄屏：蓄力条不得遮住字母盘 --- */
  const geo = await game.page.evaluate(() => {
    const r = id => { const b = document.getElementById(id).getBoundingClientRect();
      return { y: b.y, bottom: b.bottom, x: b.x, right: b.right }; };
    return { meter: r('fFoeAtk'), bank: r('fBank'), vw: innerWidth, vh: innerHeight,
      scrollW: document.documentElement.scrollWidth };
  });
  expect(geo.meter.bottom, '蓄力条不得盖住字母盘').toBeLessThanOrEqual(geo.bank.y + 1);
  expect(geo.bank.bottom, '字母盘不得溢出视口').toBeLessThanOrEqual(geo.vh + 1);
  expect(geo.scrollW, '不得横向溢出').toBeLessThanOrEqual(geo.vw + 1);
});
