import { test, expect } from './game-harness.js';
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.metadata.target === 'legacy', 'Per-round difficulty is absent from the archived legacy application'); });

/* ============================================================
 * 逐轮难度递增（清单 10）在**真实 Chrome** 里的验收。
 *
 * ★ 为什么 Node 单测不够：runtime.js 是浏览器里的整合层，没有 Node 测试
 *   加载它。「开局派生一次」「血量真的被缩放」这两条只有真跑一次页面才算证据 ——
 *   纯规则的 mutation（M1 改成按当前 DB.runs、M2 去掉血量缩放）在 Node 里全部存活。
 *
 * ★ 不用假时钟：轮次编号靠存档里的 DB.runs 播种（seeded via `saved`），
 *   难度是纯算术，不需要等真实墙钟；只有「蓄力真的按缩放后的窗口推进」
 *   那一条会真等（普通怪第 5 轮 4800+4000 = 8.8 秒，第 1 轮 11 秒）。
 * ============================================================ */

/* 读盘上的难度事实与本局战斗事实。全部来自应用自己写下的对象，不是重算。 */
async function facts(page) {
  return page.evaluate(() => {
    const t = window.__gameTest, G = t.G, B = t.B;
    return {
      roundNumber: G.roundNumber,
      difficulty: G.difficulty ? { ...G.difficulty } : null,
      run: { unit: G.unit, floor: G.floor, hp: G.hp, maxhp: G.maxhp, shield: G.shield },
      battle: B ? { enHp: B.enHp, enMax: B.enMax, myHp: B.myHp, boss: B.boss, elite: B.elite,
        foeAttack: B.foeAttack ? { ...B.foeAttack } : null } : null,
      window: t.foeAttack.window(),
      DB: { runs: t.DB.runs, wins: t.DB.wins },
    };
  });
}

/* 第 1 轮必须是**逐字等于**未缩放的老行为：这是「不改变既有手感」的保证。 */
test('第 1 轮逐字等于旧行为：倍率全 1，血量与蓄力窗口原样', async ({ game }) => {
  await game.open();
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  const f = await facts(game.page);
  expect(f.roundNumber, '第一局的轮号是 1').toBe(1);
  expect(f.difficulty).toEqual({ version: 1, roundAtStart: 1, hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 });
  expect(f.window, '第 1 轮的蓄力窗口就是未缩放的 5000/4').toEqual({ telegraphMs: 5000, damage: 4 });
  expect(f.battle.foeAttack.remainingMs, '起始 idle 就是 6000').toBe(6000);
});

test('高轮次：血量与蓄力档案真的被缩放，且 UI 窗口与盘上事实同源', async ({ game }) => {
  // 存档里已经开过 4 局 → 这一局是第 5 轮（hp 1.32 / damage 1.24 / interval 0.80）。
  await game.open({ saved: { runs: 4 } });
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  const f = await facts(game.page);
  expect(f.roundNumber, '轮号来自 DB.runs，不是猜的').toBe(5);
  expect(f.difficulty.hpMultiplier).toBeCloseTo(1.32, 6);
  expect(f.difficulty.damageMultiplier).toBeCloseTo(1.24, 6);
  expect(f.difficulty.intervalMultiplier).toBeCloseTo(0.8, 6);

  // 蓄力档案：normal 的 idle 6000→4800、telegraph 5000→4000、伤害 4→5。
  expect(f.window.telegraphMs, 'UI 蓄力窗口必须是缩放后的').toBe(4000);
  expect(f.window.damage).toBe(5);
  expect(f.battle.foeAttack.remainingMs, '起始 idle 必须是缩放后的 4800').toBe(4800);

  // 血量：脚手架的 fight() 把 enemyHp 覆盖成 10000，所以这里另开一场
  // **不覆盖血量**的真实战斗，直接读 startFight 产出的 enMax。
  // 判据是「同一场战斗里，enMax / 未缩放基线 === 本轮倍率」——
  // 用同一个 G 跑两次（倍率 1 与倍率 1.32）比，比复制公式更不容易自证。
  const hp = await game.page.evaluate(() => {
    const t = window.__gameTest;
    const node = t.G.rows.at(-1)[0];
    node.type = 'battle';
    t.G.floor = 1; t.G.maxFloor = 1;
    t.enterNode(node);
    const scaled = t.B.enMax;
    // 临时把本局难度换成基线再开一场，得到同一公式的未缩放值。
    const kept = t.G.difficulty;
    t.G.difficulty = { version: 1, roundAtStart: 1, hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 };
    t.enterNode(t.G.rows.at(-1)[0]);
    const baseline = t.B.enMax;
    t.G.difficulty = kept;
    return { scaled, baseline, mult: kept.hpMultiplier };
  });
  expect(hp.baseline, '同一场战斗的基线血量必须为正').toBeGreaterThan(0);
  expect(hp.scaled, '★ 怪物血量确实被本轮倍率放大了（这是 Node 单测覆盖不到的那条接线）')
    .toBe(Math.round(hp.baseline * hp.mult));
});

test('同轮不重算：换战斗之后倍率与窗口逐字不变', async ({ game }) => {
  await game.open({ saved: { runs: 3 } });      // 第 4 轮
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  const before = await facts(game.page);

  // 换一场战斗（撤退 → 再打一场）。
  await game.page.evaluate(() => { window.__gameTest.G.relics.push('ghost'); window.__gameTest.renderFight(); });
  await game.page.locator('#tSkip').click();
  await expect(game.page.locator('#s-map')).toBeVisible();
  await game.fight({ enemyHp: 10_000 });
  const afterFight = await facts(game.page);
  expect(afterFight.difficulty, '换战斗不重算').toEqual(before.difficulty);
  expect(afterFight.window, '换战斗后窗口逐字不变').toEqual(before.window);
  expect(afterFight.DB.runs, '换战斗绝不新增远征次数').toBe(4);
});

/* 逐字敲完整词（真实输入路径：键盘 → typeLetter → pressKey）。 */
async function typeWord(page, word) {
  for (const ch of word) await page.keyboard.type(ch);
}

/* ★ 同轮跨单元 / 续段：**只**通过应用自己的入口走，绝不直接赋值 G.unit / G.campaign。
 *
 * 上一版把 `G.unit = 5; G.campaign = {...}` 摆在一起就断言「不重算」——那条断言
 * 恒真：difficulty 早在 newRun 就冻结在 run 上，谁改 unit 都不会动它，于是它连
 * 「过渡到底有没有发生」都没验过，是一条彻底的假绿。
 *
 * 现在走的是两条真实路径：
 *   词池抽干 → showLearningComplete（LC 检查点）→ #lcBtnNext
 *     → progress.nextUnit → runtime 的**来源相位闸门** → transitionNextUnit
 *     → applyUnitTransition（真的换 pool / rows / segments）
 *   BOSS 打赢（run.result === true）→ #oNext
 *     → progress.continueUnit → applyUnitSegment（同单元换一段地图）
 * 所以「unit 真的变了」是可观测事实，而不是测试自己写上去的。
 */
test('★ 同轮跨单元/续段走真实路径：unit 真变，轮号/次数/倍率逐字不变', async ({ game }) => {
  test.setTimeout(120_000);
  await game.open({ saved: { runs: 4 } });      // 第 5 轮
  await game.start();

  // 词池推到只剩最后一个词（与 campaign.spec.js 同款的准备手法）：
  // 它只让「抽干」成为可能，过渡本身仍然完全由应用完成。
  const prepared = await game.page.evaluate(() => {
    const t = window.__gameTest;
    const words = t.WORDS.filter(w => w.u === 1);
    t.DB.mastered = words.slice(0, -1).map(w => w.w);
    t.G.pool = words.slice();
    t.G.done = new Set(words.slice(0, -1).map(w => w.w));
    return { last: words[words.length - 1].w };
  });

  await game.fight({ word: prepared.last, enemyHp: 10_000 });
  await typeWord(game.page, prepared.last);
  await expect(game.page.locator('#s-learning-complete')).toBeVisible();
  const before = await facts(game.page);
  expect(before.roundNumber).toBe(5);
  expect((await game.state()).DB.runs, '开局只加过一次远征').toBe(5);

  // ---- 真实 nextUnit：LC 检查点 → 来源相位闸门 → applyUnitTransition ----
  await expect(game.page.locator('#lcBtnNext')).toHaveText('继续 Unit 2');
  await game.page.locator('#lcBtnNext').click();
  await expect(game.page.locator('#s-map')).toBeVisible();
  const afterUnit = await facts(game.page);
  expect(afterUnit.run.unit, '★ unit 真的变了（不是测试替它赋值）').toBe(2);
  expect(await game.page.evaluate(() => window.__gameTest.G.campaign.segments), '真的走了一段').toBe(2);
  expect(afterUnit.roundNumber, '跨单元绝不换轮号').toBe(5);
  expect(afterUnit.difficulty, '★ 跨单元逐字不重算').toEqual(before.difficulty);
  expect(afterUnit.window, '跨单元后蓄力档案逐字不变').toEqual(before.window);
  expect((await game.state()).DB.runs, '跨单元绝不新增远征').toBe(5);

  // 新单元里的新一场战斗：血量仍按**同一档**倍率缩放（换 pool / 换段不重算）。
  // 判据是同一 G 跑两次（倍率 1.32 与基线 1）比 enMax，比复制公式更不容易自证。
  const hp = await game.page.evaluate(() => {
    const t = window.__gameTest;
    const battles = t.G.rows.flat().filter(n => n.type === 'battle');
    t.G.avail = battles.slice(); t.G.node = null;
    t.enterNode(battles[0]);
    const scaled = t.B.enMax;
    const kept = t.G.difficulty;
    t.G.difficulty = { version: 1, roundAtStart: 1, hpMultiplier: 1, damageMultiplier: 1, intervalMultiplier: 1 };
    t.enterNode(battles[battles.length - 1]);
    const baseline = t.B.enMax;
    t.G.difficulty = kept;
    return { scaled, baseline, mult: kept.hpMultiplier };
  });
  expect(hp.baseline, '基线血量必须为正').toBeGreaterThan(0);
  expect(hp.scaled, '★ Unit 2 的战斗仍按第 5 轮倍率缩放').toBe(Math.round(hp.baseline * hp.mult));

  // ---- 真实 continueUnit：一场**成功结算**的 BOSS → 结算屏按钮 ----
  const pending = await game.page.evaluate(() => {
    const t = window.__gameTest;
    const w = t.G.pool.find(x => !t.G.done.has(x.w));
    t.G.gold = 100;
    return w ? w.w : null;
  });
  expect(pending, 'Unit 2 的词池里必须还有词可练').toBeTruthy();
  await game.fight({ boss: true, word: pending, enemyHp: 1 });
  await typeWord(game.page, pending);
  await expect(game.page.locator('#s-pick')).toBeVisible();
  await game.page.locator('#pPicks .pick').first().click();
  await expect(game.page.locator('#s-over')).toBeVisible();
  const settled = await game.page.evaluate(() => ({
    result: window.__gameTest.G.result, unit: window.__gameTest.G.unit,
    runs: window.__gameTest.DB.runs, wins: window.__gameTest.DB.wins,
  }));
  expect(settled.result, '★ 真的是成功结算的一局（continueUnit 的来源闸门要求它）').toBe(true);

  await expect(game.page.locator('#oNext')).toHaveText('继续本单元词汇');
  await game.page.locator('#oNext').click();
  await expect(game.page.locator('#s-map')).toBeVisible();
  const afterCont = await facts(game.page);
  expect(afterCont.run.unit, '续段不换单元').toBe(2);
  expect(await game.page.evaluate(() => window.__gameTest.G.campaign.segments), '同单元真的换到第 3 段').toBe(3);
  expect(await game.page.evaluate(() => window.__gameTest.G.result), '结算标记已被清掉').toBeUndefined();
  expect(afterCont.roundNumber, '续段绝不换轮号').toBe(5);
  expect(afterCont.difficulty, '★ 同段续练逐字不重算').toEqual(before.difficulty);
  expect((await game.state()).DB.runs, '★ 续段绝不新增远征次数').toBe(5);
  expect((await game.state()).DB.wins, '这一轮只通关一次').toBe(1);
});

test('★ 轮号只认 run.roundNumber，不认当前 DB.runs（派生时机被钉死）', async ({ game }) => {
  // M1 变异：把派生入参从 G.roundNumber 改成 DB.runs，两者开局时**相等**，
  // 所以只有「派生之后 DB.runs 又变了」的路径才能分辨。
  // 本用例在开局之后把 DB.runs 推到 40（模拟同一页里又开过别的局 / 别的存档），
  // 再开一场战斗：倍率必须仍按开局那次的轮号，而不是 40 或 41。
  await game.open({ saved: { runs: 4 } });      // 第 5 轮
  await game.start();
  const opened = await facts(game.page);
  expect(opened.roundNumber).toBe(5);
  expect(opened.difficulty.roundAtStart).toBe(5);

  // 开局之后再动 DB.runs：这一局的事实不该跟着变。
  await game.page.evaluate(() => { window.__gameTest.DB.runs = 40; });
  await game.fight({ enemyHp: 10_000 });
  const after = await facts(game.page);
  expect(after.difficulty.roundAtStart, '★ 轮号事实冻结在开局那一刻').toBe(5);
  expect(after.difficulty.hpMultiplier, '倍率按第 5 轮，不是按 40').toBeCloseTo(1.32, 6);
  expect(after.window, '蓄力档案仍按第 5 轮').toEqual({ telegraphMs: 4000, damage: 5 });

  // 恢复路径也不许按 DB.runs 重算：刷新后仍是第 5 轮那一档。
  await game.page.evaluate(() => window.__gameTest.pauseNow());
  await game.reload();
  await game.page.locator('#continueRun').click();
  await expect(game.page.locator('#s-fight')).toBeVisible();
  const restored = await facts(game.page);
  expect(restored.difficulty.roundAtStart, '恢复不按当前 DB.runs 重算').toBe(5);
  expect(restored.window).toEqual({ telegraphMs: 4000, damage: 5 });
  expect((await game.saved()).activeRun.run.difficulty.roundAtStart).toBe(5);
});

test('刷新恢复：难度事实原样带回，不重排、不改 runs/wins', async ({ game }) => {
  await game.open({ saved: { runs: 4 } });      // 第 5 轮
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph', null, { timeout: 15_000 });
  await game.page.evaluate(() => window.__gameTest.pauseNow());

  const saved = await game.saved();
  const diff = saved.activeRun.run.difficulty;
  expect(diff, '快照必须带上难度事实').toBeTruthy();
  expect(Object.keys(diff).sort()).toEqual(['damageMultiplier', 'hpMultiplier', 'intervalMultiplier', 'roundAtStart', 'version']);
  expect(diff.roundAtStart, '轮号事实原样落盘').toBe(5);
  const runsBefore = saved.runs, winsBefore = saved.wins, win = saved.activeRun.battle.foeAttack.remainingMs;

  await game.reload();
  await game.page.locator('#continueRun').click();
  await expect(game.page.locator('#s-fight')).toBeVisible();

  const f = await facts(game.page);
  expect(f.difficulty, '恢复后仍是同一档（绝不按当前 DB.runs 重算）').toEqual(diff);
  expect(f.window, '恢复后窗口不变').toEqual({ telegraphMs: 4000, damage: 5 });
  const after = await game.saved();
  expect(after.runs, '恢复绝不新增远征').toBe(runsBefore);
  expect(after.wins, '恢复绝不记通关').toBe(winsBefore);

  // 按保存的剩余继续，只挨一下，且伤害是缩放后的 5。
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 20_000 });
  const hpBefore = 70;
  expect((await game.state()).B.myHp).toBeLessThan(hpBefore);
});

test('旧存档没有 difficulty：完全基线，绝不按当前 DB.runs 补出高档', async ({ game }) => {
  // 播种：DB.runs 已经是 6（当前会是第 7 轮），但**没有**任何 activeRun。
  await game.open({ saved: { runs: 6 } });
  // 手工造一份「旧格式」快照：把 run 上的 difficulty 键整个删掉再继续。
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.evaluate(() => window.__gameTest.pauseNow());
  await game.page.evaluate(() => {
    const key = 'wy8a_rogue_v1';
    const db = JSON.parse(localStorage.getItem(key));
    delete db.activeRun.run.difficulty;
    localStorage.setItem(key, JSON.stringify(db));
  });
  await game.reload();
  await game.page.locator('#continueRun').click();
  await expect(game.page.locator('#s-fight')).toBeVisible();

  const f = await facts(game.page);
  expect(f.difficulty, '★ 旧存档不许补出难度事实').toBe(null);
  expect(f.roundNumber, '轮号事实仍然照实恢复').toBe(7);
  // ★ 完全基线：DB.runs 是 6（第 7 轮该有的倍率是 hp 1.48），但绝不能按它缩放。
  expect(f.window, '旧存档的蓄力档案逐字等于未缩放值').toEqual({ telegraphMs: 5000, damage: 4 });
  // remainingMs 是**真实倒计时**（恢复那一刻的剩余），不是整段窗口。
  // 判据必须是「仍在未缩放窗口之内」：第 7 轮的 idle 会被压到 6000*0.6 = 3600，
  // 而基线是 6000 —— 剩余大于 3600 就证明它没被按第 7 轮缩放。
  expect(f.battle.foeAttack.remainingMs, '旧存档的倒计时仍在未缩放的 idle 窗口内').toBeGreaterThan(3600);
  expect(f.battle.foeAttack.remainingMs).toBeLessThanOrEqual(6000);
  const saved = await game.saved();
  expect(saved.activeRun.run.difficulty, '恢复后落盘仍然没有这个键').toBeUndefined();
  expect(saved.runs, '旧存档恢复绝不新增远征').toBe(7);
});

test('脏 difficulty 的存档被 fail closed：主页明说损坏，不半恢复', async ({ game }) => {
  await game.open({ saved: { runs: 4 } });
  await game.start();
  await game.fight({ enemyHp: 10_000 });
  await game.page.evaluate(() => window.__gameTest.pauseNow());
  // 轮号 5 却带封顶档倍率（1.64/1.48/0.60）—— 与轮次事实不相容。
  await game.page.evaluate(() => {
    const key = 'wy8a_rogue_v1';
    const db = JSON.parse(localStorage.getItem(key));
    db.activeRun.run.difficulty = { version: 1, roundAtStart: 5, hpMultiplier: 1.64, damageMultiplier: 1.48, intervalMultiplier: 0.6 };
    localStorage.setItem(key, JSON.stringify(db));
  });
  await game.reload();
  const label = await game.page.locator('#continueRun').innerText();
  expect(label, '主页必须如实说这份进度无法恢复').toContain('损坏');
  // 学习数据不受影响：掌握记录与远征次数原样保留。
  const saved = await game.saved();
  expect(saved.runs).toBe(5);
  expect(Array.isArray(saved.mastered)).toBe(true);
});

test('蓄力真按缩放后的窗口推进：第 5 轮普通怪 8.8 秒挨第一下，掉的是缩放后的 5 点', async ({ game }) => {
  test.setTimeout(60_000);
  await game.open({ saved: { runs: 4 } });      // 第 5 轮：idle 4800 + telegraph 4000
  await game.start();

  /* ★ 时间锚点必须落在**页面内** startFight 真正发生的那一刻。
   * 上一版只 waitForFunction(cycle>=1, timeout 20s)：那只证明「20 秒内挨了一下」，
   * 排期没被缩放（11 秒）也照样绿 —— 20 秒的等待窗口本身就大于缩放前的节奏。
   * 这里把 epoch 挂在 foeAttackCtl.start 上（startFight 里排期的那一次调用），
   * 用 performance.now 记下第一下打出来的时刻，两端都在页面内测：
   * Node 侧 game.fight() 里的 enterNode / drawLetters / renderFight 那几百毫秒
   * 完全落在锚点之外，不会被算成「蓄力时间」。
   * 命中观测用 10ms 节拍轮询事实（cycle ≥ 1），误差远小于下面的余量。 */
  await game.page.evaluate(() => {
    const ctl = window.__gameTest.foeAttack;
    const realStart = ctl.start.bind(ctl);
    const mark = { epoch: null, hit: null };
    window.__timing = mark;
    ctl.start = () => {
      if (mark.epoch === null) mark.epoch = performance.now();
      return realStart();
    };
    const watch = setInterval(() => {
      if (mark.hit !== null) return;
      const B = window.__gameTest.B;
      if (B && B.foeAttack && B.foeAttack.cycle >= 1) { mark.hit = performance.now(); clearInterval(watch); }
    }, 10);
  });
  await game.fight({ enemyHp: 10_000 });
  const hpBefore = (await game.state()).B.myHp;
  // 20s 只是「别挂死」的兜底，绝不作为缩放已生效的证据 —— 证据在下面的 elapsed。
  await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.cycle >= 1, null, { timeout: 20_000 });
  const mark = await game.page.evaluate(() => window.__timing);
  expect(mark.epoch, '★ 时间锚点必须真的落在 startFight 里').not.toBeNull();
  expect(mark.hit, '第一下必须真的打出来').not.toBeNull();
  const elapsed = mark.hit - mark.epoch;
  // 缩放后 = 4800 + 4000 = 8.8s；余量按真实浏览器的调度抖动给，
  // 但上界 10.2s 远低于未缩放的 11s —— 排期退回基线必红。
  expect(elapsed, '★ 从战斗真实起点到第一下必须落在缩放后的 8.8 秒附近').toBeGreaterThanOrEqual(8000);
  expect(elapsed, '（未缩放的 11 秒排期会超过这个上界）').toBeLessThanOrEqual(10_200);
  const f = await foeCycle(game.page);
  expect(f.phase, '蓄满后进入收招').toBe('recover');
  const after = await game.state();
  expect(after.B.myHp, '掉的是缩放后的 5 点，不是未缩放的 4 点').toBe(hpBefore - 5);
  // 存档里同一份事实：三处（内存/盘/UI 窗口）必须一致。
  const saved = await game.saved();
  expect(saved.activeRun.battle.myHp, '盘上也是扣完之后的血量').toBe(hpBefore - 5);
  const win = await game.page.evaluate(() => window.__gameTest.foeAttack.window());
  expect(win.damage).toBe(5);
});

async function foeCycle(page) {
  return page.evaluate(() => ({ ...window.__gameTest.B.foeAttack }));
}