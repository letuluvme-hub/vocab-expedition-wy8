// 任务 7 的真实浏览器验收：按单元全部词完成依序解锁 + 同学习轮跨单元继承。
//
// 真实度约定：
//  - 只有**最后一个词**是真的一字一字敲完的（game.harness 的 fight + keyboard.type）。
//  - DEV 状态只用来「把词池准备到最后 1~2 个词」，以及读出 id/计数这类内部事实。
//  - 所有 DB 断言都读应用自己写下的存档（game.saved()），不 mock 存储。
import { test, expect } from './game-harness.js';
import { WORDS } from '../../src/data/words.js';

const U = n => WORDS.filter(w => w.u === n);
const masteredOf = n => U(n).map(w => w.w);
const masteredAll = () => WORDS.map(w => w.w);
const newOnly = (testInfo, why) => {
  if (testInfo.project.metadata.target === 'legacy') test.skip(true, why);
};

// 把本局的退休集合推到「只剩最后 target 个词」，其余真实学习记录由 mastered 提供。
async function prepareFinalWords(page, unit, masteredCount, leave = 2) {
  return page.evaluate(({ unit, masteredCount, leave, all }) => {
    const t = window.__gameTest;
    const words = t.WORDS.filter(w => w.u === unit);
    // 学习记录：除了最后 leave 个，其余全部记为已掌握（跨局口径）。
    t.DB.mastered = [];
    for (const w of words.slice(0, words.length - leave)) t.DB.mastered.push(w.w);
    // 本局退休集合：同样只留最后 leave 个，让抽词只能抽到它们。
    t.G.pool = words.slice();
    t.G.done = new Set(words.slice(0, words.length - leave).map(w => w.w));
    t.G.wrong = [];
    return { pending: t.G.pool.filter(w => !t.G.done.has(w.w)).map(w => w.w), total: words.length, all: !!all };
  }, { unit, masteredCount, leave, all: false });
}

// 逐字敲完整词（真实输入路径：键盘 → typeLetter → pressKey）。word 是英文字符串。
async function typeWholeWord(page, word) {
  for (const ch of word) await page.keyboard.type(ch);
}

test('locked units cannot be selected on the title and the runtime refuses them too', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Unit locking is a new regression guard');
  await game.open();
  // ★ 用 data-unit 定位，不按文本：锁说明里也含「Unit N」，按文本会命中多个元素。
  const u2 = page.locator('#units .unit[data-unit="2"]');
  await expect(u2).toHaveClass(/locked/);
  await expect(u2).toBeDisabled();
  await expect(u2).toContainText('完成 Unit 1 全部词汇后解锁');
  await expect(u2).toHaveAttribute('title', /Unit 1/);
  // 单元名与编号照常可见（不再为了躲定位而藏起来）
  await expect(u2.locator('b')).toHaveText('Unit 2 数字生活');
  // 点它没有任何反应：选中单元仍然是 Unit 1
  await u2.click({ force: true });
  expect((await game.state()).G).toBeNull();
  // ★ 运行时闸门：绕过 UI 把 curUnit 设成 2 再 newRun，必须被拒绝（不是只 disabled）
  const refused = await page.evaluate(() => {
    const t = window.__gameTest;
    t.curUnit = 2;
    const started = t.newRun();
    return { started, unit: t.G ? t.G.unit : null, onMap: document.getElementById('s-map').classList.contains('on') };
  });
  expect(refused.started).toBe(false);
  expect(refused.unit).toBeNull();
  expect(refused.onMap).toBe(false);
  // 自定义词表永远可玩（可选中，且不受教材锁影响）
  const custom = page.locator('#units .unit[data-unit="0"]');
  await expect(custom).not.toHaveClass(/locked/);
  await custom.click();
  expect(await page.evaluate(() => window.__gameTest.curUnit)).toBe(0);
  await expect(custom).toHaveClass(/sel/);
});

test('completing every word of unit 1 unlocks unit 2 and the same run continues with its resources', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Cross-unit continuation is a new regression guard');
  await game.open();
  await game.start();
  // 存档一份「上一段」的物资与消耗额度，用来验证跨单元继承。
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.gold = 210; t.G.bag = { leech: 1 }; t.G.relics = ['shield'];
    t.G.ghostUsed = true; t.G.hp = 33; t.G.maxFloor = 9;
    t.G.att = 12; t.G.attOk = 10;
  });
  const prepared = await prepareFinalWords(page, 1, 0, 2);
  expect(prepared.pending).toHaveLength(2);

  // 先只敲**半个**词：半词既不算学会，也不许推进解锁。
  await game.fight({ word: prepared.pending[0], enemyHp: 10_000 });
  await page.keyboard.type(prepared.pending[0].slice(0, -1));
  const half = await game.state();
  expect(half.DB.mastered.filter(w => w === prepared.pending[0])).toHaveLength(0);
  expect((await game.saved()).unitProgress?.['1']).toBeUndefined();

  // 补完这半个词 + 整个最后一个词：全部走真实输入。
  await page.keyboard.type(prepared.pending[0].slice(-1));
  await expect(page.locator('#s-fight')).toBeVisible();
  // 上一场战斗已经把 avail 清空了：重新给一个可选战斗节点再开下一场。
  await page.evaluate(() => {
    const t = window.__gameTest;
    const battles = t.G.rows.flat().filter(n => n.type === 'battle');
    t.G.avail = battles.length ? battles : t.G.rows[0].slice();
    t.G.node = null;
  });
  await game.fight({ word: prepared.pending[1], enemyHp: 10_000 });
  await typeWholeWord(page, prepared.pending[1]);

  // 词池抽干 → 词汇完成检查点（不是通关）
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  await expect(page.locator('#lcText')).toContainText('不等于击败首领');
  const nextBtn = page.locator('#lcBtnNext');
  await expect(nextBtn).toBeVisible();
  await expect(nextBtn).toHaveText('继续 Unit 2');
  await expect(page.locator('#lcNext')).toContainText(`${prepared.total} / ${prepared.total}`);
  await expect(page.locator('#lcNext')).toContainText('已解锁');

  const before = await game.state();
  expect(before.DB.wins).toBe(0);
  const id = await page.evaluate(() => window.__gameTest.G.id);
  const saved = await game.saved();
  expect(saved.unitProgress['1'].complete).toBe(true);
  expect(saved.activeRun.run.campaign.startedUnit).toBe(1);

  // 继续 Unit 2：同一轮学习 —— 资源继承、次数不加。
  await nextBtn.click();
  await expect(page.locator('#s-map')).toBeVisible();
  const after = await game.state();
  expect(after.G.unit).toBe(2);
  expect(after.G.gold).toBe(210);
  // 背包只可能因战斗消耗变小，绝不因「换单元」被重发（新局默认发 2 个吸血獠牙）。
  expect(Object.keys(after.G.bag)).toEqual(['leech']);
  expect(after.G.bag.leech).toBeLessThanOrEqual(1);
  expect(after.G.relics).toEqual(['shield']);
  expect(after.G.ghostUsed).toBe(true);
  expect(after.G.hp).toBe(before.G.hp);
  expect(after.G.kills).toBe(before.G.kills);
  expect(await page.evaluate(() => window.__gameTest.G.maxFloor)).toBe(9, '历史最好层数不许被改小');
  expect(after.DB.runs).toBe(1, '跨单元不是新开一次远征');
  expect(after.DB.wins).toBe(0, '词汇完成不是击败 BOSS');
  expect(after.DB.rewards).toHaveLength(0);
  expect(after.B).toBeNull();
  expect(await page.evaluate(() => window.__gameTest.G.id)).toBe(id);

  // 刷新后恢复的仍是同一轮、同一单元
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const restored = await game.state();
  expect(restored.G.unit).toBe(2);
  expect(restored.G.gold).toBe(210);
  expect(restored.DB.runs).toBe(1);
  expect(await page.evaluate(() => window.__gameTest.G.id)).toBe(id);
  expect(await page.evaluate(() => window.__gameTest.G.campaign.startedUnit)).toBe(1);
});

test('the second click on continue cannot double-apply the transition', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Idempotency is a new regression guard');
  await game.open();
  await game.start();
  const prepared = await prepareFinalWords(page, 1, 0, 1);
  await game.fight({ word: prepared.pending[0], enemyHp: 10_000 });
  await typeWholeWord(page, prepared.pending[0]);
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  // 连点两次「继续 Unit 2」：只应过渡一次
  await page.locator('#lcBtnNext').evaluate(el => { el.click(); el.click(); el.click(); });
  await expect(page.locator('#s-map')).toBeVisible();
  const st = await game.state();
  expect(st.G.unit).toBe(2);
  expect(await page.evaluate(() => window.__gameTest.G.campaign.segments)).toBe(2);
  expect(st.DB.runs).toBe(1);
  expect(st.DB.wins).toBe(0);
  expect(st.DB.mastered.filter(w => w === prepared.pending[0])).toHaveLength(1);
});

/* ---------- 新增精准验收（补丁 B）：真实连续多单元 / 第二段 BOSS / 自定义续练 ---------- */

/* 一个单元 = 把词池备到只剩最后一个词 + 真键盘敲完它 → 词汇完成检查点。 */
async function finishUnitByTyping(game, page, unit, leave = 1) {
  const prepared = await prepareFinalWords(page, unit, 0, leave);
  await game.fight({ word: prepared.pending[0], enemyHp: 10_000 });
  await typeWholeWord(page, prepared.pending[0]);
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  return prepared;
}
const camState = page => page.evaluate(() => {
  const t = window.__gameTest;
  return { unit: t.G.unit, segments: t.G.campaign.segments, startedUnit: t.G.campaign.startedUnit,
    id: t.G.id, gold: t.G.gold, bag: t.G.bag, relics: t.G.relics, ghostUsed: t.G.ghostUsed,
    hp: t.G.hp, maxhp: t.G.maxhp, floor: t.G.floor, maxFloor: t.G.maxFloor, result: t.G.result };
});

test('one real run walks unit 1 to 3 keeping every resource, and reaches 6 the same way', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Cross-unit continuity is a new regression guard');
  test.setTimeout(120_000);
  await game.open();
  await game.start();
  // 一份贯穿全程的物资快照：每一跳都必须一模一样。
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.gold = 321; t.G.bag = { leech: 1 }; t.G.relics = ['shield'];
    t.G.ghostUsed = true; t.G.maxFloor = 9; t.G.hp = 40;
  });
  const id = await page.evaluate(() => window.__gameTest.G.id);
  const before = await camState(page);
  const bagKeysBefore = Object.keys(before.bag).sort();

  for (const from of [1, 2, 3]) {
    const pending = await finishUnitByTyping(game, page, from);
    expect(pending.pending).toHaveLength(1);
    const btn = page.locator('#lcBtnNext');
    await expect(btn).toHaveText('继续 Unit ' + (from + 1));
    await btn.click();
    await expect(page.locator('#s-map')).toBeVisible();
    const st = await camState(page);
    expect(st.unit, 'Unit ' + from + ' 学完后必须真的换到下一单元').toBe(from + 1);
    expect(st.segments, '每一跳 segments 恰好 +1').toBe(from + 1);
    expect(st.startedUnit, 'startedUnit 恒为 1').toBe(1);
    expect(st.id, '同一轮：run.id 不变').toBe(id);
    expect(st.gold).toBe(before.gold);
    // 吸血獠牙会被真实战斗消耗，所以只断言「不重发」：键集合不变、数量只减不增。
    expect(Object.keys(st.bag).sort(), '绝不重发新手道具').toEqual(bagKeysBefore);
    expect(st.bag.leech).toBeLessThanOrEqual(before.bag.leech);
    expect(st.relics).toEqual(before.relics);
    expect(st.ghostUsed, '影分身额度绝不重置').toBe(true);
    // 「不回血」指的是**不许补满**：战斗中真实发生的回血（游侠答对回血 +1）照算，
    // 但过渡本身绝不允许把血量拉回上限。hp 必须来自活着的战斗，而不是 run 的旧值。
    expect(st.hp, '换单元不回血').toBeGreaterThanOrEqual(before.hp);
    expect(st.hp, '换单元绝不回满血').toBeLessThan(st.maxhp);
    expect(st.floor).toBe(1);
    expect(st.maxFloor, '历史最好层数不许改小').toBe(9);
    expect(st.result, '同一轮还在进行中').toBeUndefined();
    const g = await game.state();
    expect(g.DB.runs, '跨单元不是新开一次远征').toBe(1);
    expect(g.DB.wins, '词汇完成不是击败 BOSS').toBe(0);
    expect(g.DB.rewards).toHaveLength(0);
    expect(g.B).toBeNull();
  }
  // 走到 Unit 4 后刷新：仍是同一轮、同一份物资
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const back = await camState(page);
  expect(back.unit).toBe(4);
  expect(back.id).toBe(id);
  expect(back.gold).toBe(before.gold);
  expect((await game.state()).DB.runs).toBe(1);

  // 一路走到本册最后一个单元：Unit 6 学完后只说「本册完成」，绝无「下一单元」。
  for (const from of [4, 5, 6]) {
    await finishUnitByTyping(game, page, from);
    if (from === 6) {
      await expect(page.locator('#lcBtnNext')).toBeHidden();
      await expect(page.locator('#lcNext')).toContainText('本册词汇已完成');
      await expect(page.locator('#lcNext')).not.toContainText(/击败|战胜|通关|胜利/);
      continue;
    }
    await expect(page.locator('#lcBtnNext')).toHaveText('继续 Unit ' + (from + 1));
    await page.locator('#lcBtnNext').click();
    await expect(page.locator('#s-map')).toBeVisible();
  }
  const last = await camState(page);
  expect(last.unit).toBe(6);
  expect(last.segments).toBe(6);
  expect(last.id).toBe(id);
  expect((await game.state()).DB.runs).toBe(1);
});

test('a historically all-mastered save cannot skip units through a triple click', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'The source-phase guard is a new regression guard');
  test.setTimeout(60_000);
  // ★ 最危险的存档形态：259 个词**全部**记为已掌握，于是每一跳在领域层都合法。
  //   旧实现（只靠 run.campaign.startedUnit 判重）在这里连点三次就能 1→2→3→4。
  await game.open({ saved: { mastered: masteredAll() } });
  await game.start();
  await finishUnitByTyping(game, page, 1);
  const id = await page.evaluate(() => window.__gameTest.G.id);
  await page.locator('#lcBtnNext').evaluate(el => { el.click(); el.click(); el.click(); });
  await expect(page.locator('#s-map')).toBeVisible();
  const st = await camState(page);
  expect(st.unit, '★ 一次点击只许走一段，绝不许 1→2→3→4').toBe(2);
  expect(st.segments).toBe(2);
  expect(st.id).toBe(id);

  // 回到地图后（已不是词汇完成相位）再调一次：必须被拒，且一个字段都不动。
  const again = await page.evaluate(() => {
    const t = window.__gameTest;
    const before = { unit: t.G.unit, seg: t.G.campaign.segments, gold: t.G.gold, hp: t.G.hp };
    const ok = t.nextUnit();
    return { ok, before, after: { unit: t.G.unit, seg: t.G.campaign.segments, gold: t.G.gold, hp: t.G.hp } };
  });
  expect(again.ok, '普通地图上不允许跳段').toBe(false);
  expect(again.after).toEqual(again.before);
  // 「继续本单元词汇」同理：没有打完 BOSS 就不存在这个动作。
  const cont = await page.evaluate(() => window.__gameTest.continueUnit());
  expect(cont, '地图上不许凭空续练').toBe(false);
  expect((await camState(page)).unit).toBe(2);
  expect((await game.state()).DB.runs).toBe(1);
});

test('the second BOSS of the next segment settles for real without a second win or card', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Per-segment boss settlement is a new regression guard');
  test.setTimeout(90_000);
  await game.open();
  await game.start();

  // --- 第 1 段：真 BOSS 战，只打一个字就秒杀（伤害路径真实） ---
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await typeWholeWord(page, 'litre');
  await expect(page.locator('#s-pick')).toBeVisible();
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  const id = await page.evaluate(() => window.__gameTest.G.id);
  let st = await game.state();
  expect(st.DB.wins).toBe(1);
  expect(st.DB.rewards).toHaveLength(1);
  const cardId = st.DB.rewards[0].id;
  const goldAfterFirst = st.G.gold;
  const killsAfterFirst = st.G.kills;

  // --- 结算屏 → 「继续本单元词汇」（同一单元，第 2 段） ---
  const nextBtn = page.locator('#oNext');
  // C1 有意漂移：见 docs/optimization-plan-2026-10.md 的 C1。
  // 「继续练剩下 N 个词（物资保留）」—— N 会变，所以只咬「继续」这个动作词。
  await expect(nextBtn).toHaveText(/继续/);
  await nextBtn.click();
  await expect(page.locator('#s-map')).toBeVisible();
  st = await game.state();
  expect(st.G.unit).toBe(1, '本单元没学完就不许进 Unit 2');
  expect(await page.evaluate(() => window.__gameTest.G.result)).toBeUndefined();
  expect(st.DB.runs).toBe(1);
  expect(st.DB.wins, '继续学习不是第二次通关').toBe(1);

  // 刷新发生在第 2 段中途：续练与「本段尚未结算」的标记都必须活下来。
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  st = await game.state();
  expect(await page.evaluate(() => window.__gameTest.G.id)).toBe(id);
  expect(st.G.unit).toBe(1);

  // --- 第 2 段的真 BOSS 战（'rare' 是 Unit 1 的真实词条）---
  await game.fight({ boss: true, word: 'rare', enemyHp: 1 });
  await page.keyboard.type('rare');
  await expect(page.locator('#s-pick')).toBeVisible();
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();

  st = await game.state();
  expect(st.DB.wins, '★ 通关数全程只 +1').toBe(1);
  expect(st.DB.rewards, '★ 纪念卡绝不重复生成').toHaveLength(1);
  expect(st.DB.rewards[0].id, '★ 跨刷新后复用同一张卡').toBe(cardId);
  expect(st.G.kills, '第二段真的结算了：击杀 +1').toBe(killsAfterFirst + 1);
  expect(st.G.gold, '第二段真的结算了：金币入账').toBeGreaterThan(goldAfterFirst);
  // 同一场战斗不许重复发奖：金币/击杀都是这一次结算的增量，不是双份。
  const saved = await game.saved();
  expect(saved.activeRun, '结算后快照已被清掉').toBeUndefined();
});

test('a half word or a skipped fight never unlocks anything', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Unlock honesty is a new regression guard');
  test.setTimeout(60_000);
  await game.open();
  await game.start();
  const prepared = await prepareFinalWords(page, 1, 0, 2);
  const [first, second] = prepared.pending;

  // ① 只敲半个词：既不算学会，也不许解锁，更不许跳段。
  await game.fight({ word: first, enemyHp: 10_000 });
  await page.keyboard.type(first.slice(0, -1));
  expect((await game.state()).DB.mastered.filter(w => w === first)).toHaveLength(0);
  expect((await game.saved()).unitProgress?.['1']).toBeUndefined();
  const half = await page.evaluate(() => window.__gameTest.nextUnit());
  expect(half, '半词状态下不许跳段').toBe(false);
  expect((await camState(page)).unit).toBe(1);

  // ② 逃跑这一场（逃跑要 ≥10 金币，且逃跑按钮的禁用态由 renderFight 写，
  //   所以改完金币必须重画一次才点得动）：这一场结束，但没答完的词依然没被记学会，
  //   而且逃跑既不是通关也不是词汇完成 —— 回到的是地图，不是结算屏。
  await page.evaluate(() => { window.__gameTest.G.gold = 100; window.__gameTest.renderFight(); });
  await expect(page.locator('#tFlee')).toBeEnabled();
  await page.locator('#tFlee').click();
  await expect(page.locator('#s-map')).toBeVisible();
  let st = await game.state();
  expect(st.DB.mastered.filter(w => w === second)).toHaveLength(0);
  expect(st.DB.wins, '逃跑不算通关').toBe(0);
  expect((await game.saved()).unitProgress?.['1'], '逃跑不构成词汇完成').toBeUndefined();
  // 地图上不存在任何跨单元入口：调用必须被拒，且一个字段都不动。
  const probe = await page.evaluate(() => {
    const t = window.__gameTest;
    const before = { unit: t.G.unit, seg: t.G.campaign.segments, gold: t.G.gold };
    const next = t.nextUnit();
    const cont = t.continueUnit();
    return { next, cont, before, after: { unit: t.G.unit, seg: t.G.campaign.segments, gold: t.G.gold } };
  });
  expect(probe.next, '普通地图上不许跳段').toBe(false);
  expect(probe.cont, '没打完 BOSS 就不许凭空续练').toBe(false);
  expect(probe.after).toEqual(probe.before);

  // ③ 同一轮里继续练，把最后一个词真的敲完 → 这才是唯一凭据。
  await prepareFinalWords(page, 1, 0, 1);
  await page.evaluate(() => {
    const t = window.__gameTest;
    const battles = t.G.rows.flat().filter(n => n.type === 'battle');
    t.G.avail = battles.length ? battles : t.G.rows[0].slice();
    t.G.node = null;
  });
  await game.fight({ word: second, enemyHp: 10_000 });
  await typeWholeWord(page, second);
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  await expect(page.locator('#lcBtnNext')).toHaveText('继续 Unit 2');
  const saved = await game.saved();
  expect(saved.unitProgress['1'].complete).toBe(true);
  expect(saved.unitProgress['1'].completedAt, '完成凭据带真实时间戳').toEqual(expect.any(String));
  expect(st.DB.wins, '词汇完成依然不是通关').toBe(0);
  expect(st.DB.mastered.filter(w => w === first),
    '半词从头到尾都不算学会').toHaveLength(0);
});

test('the custom list shows real progress and stays continuable in the same run', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Custom-unit continuity is a new regression guard');
  test.setTimeout(60_000);
  const custom = [
    { u: 0, d: 1, w: 'cat', z: '猫' },
    { u: 0, d: 1, w: 'dog', z: '狗' },
  ];
  await game.open({ saved: { custom } });
  // 主页按真实词表显示自定义进度（不再伪报「未开始」/0 词）
  const btn = page.locator('#units .unit[data-unit="0"]');
  await expect(btn.locator('b')).toHaveText('我的词表');
  await expect(btn).toContainText('2 词');

  await btn.click();
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const id = await page.evaluate(() => window.__gameTest.G.id);

  // 先打完 BOSS 但自己的词表还有词没练完 → 结算屏必须给出**同轮续练**入口。
  await game.fight({ boss: true, word: 'cat', enemyHp: 1 });
  await page.keyboard.type('cat');
  await expect(page.locator('#s-pick')).toBeVisible();
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  const nextBtn = page.locator('#oNext');
  await expect(nextBtn, '自定义单元也绝不能卡住').toBeVisible();
  // C1 有意漂移：见 docs/optimization-plan-2026-10.md 的 C1。
  // 「继续练剩下 N 个词（物资保留）」—— N 会变，所以只咬「继续」这个动作词。
  await expect(nextBtn).toHaveText(/继续/);
  await expect(nextBtn).not.toContainText('Unit 1');

  await nextBtn.click();
  await expect(page.locator('#s-map')).toBeVisible();
  const st = await game.state();
  expect(st.G.unit, '自定义续练留在单元 0').toBe(0);
  expect(await page.evaluate(() => window.__gameTest.G.id)).toBe(id);
  expect(st.DB.runs).toBe(1);

  // 把最后一个词真的敲完 → 词汇完成；自定义单元**没有**下一单元。
  const pending = await page.evaluate(() => {
    const t = window.__gameTest;
    return t.G.pool.filter(w => !t.G.done.has(w.w)).map(w => w.w);
  });
  expect(pending).toEqual(['dog']);
  await game.fight({ word: 'dog', enemyHp: 10_000 });
  await typeWholeWord(page, 'dog');
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  await expect(page.locator('#lcBtnNext'), '自定义单元没有下一单元').toBeHidden();
  await expect(page.locator('#lcNext')).toContainText('2 / 2');

  // 回主页后自定义进度按真实掌握表显示，并且教材单元仍然锁着。
  await page.locator('#lcBtnHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#units .unit[data-unit="0"]')).toContainText('2/2');
  await expect(page.locator('#units .unit[data-unit="2"]')).toHaveClass(/locked/);
});

test('beating the boss first keeps this unit playable without another win or card', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Boss-vs-vocabulary separation is a new regression guard');
  await game.open();
  await game.start();
  // BOSS 先打完，但本单元还有 44 个词没学。
  await game.fight({ boss: true, word: 'litre', enemyHp: 1 });
  await page.keyboard.type('litre');
  await expect(page.locator('#s-pick')).toBeVisible();
  await page.locator('#pPicks .pick').first().click();
  await expect(page.locator('#s-over')).toBeVisible();
  const nextBtn = page.locator('#oNext');
  await expect(nextBtn).toBeVisible();
  // C1 有意漂移：见 docs/optimization-plan-2026-10.md 的 C1。
  // 「继续练剩下 N 个词（物资保留）」—— N 会变，所以只咬「继续」这个动作词。
  await expect(nextBtn).toHaveText(/继续/);
  await expect(nextBtn).not.toContainText('Unit 2');
  const won = await game.state();
  expect(won.DB.wins).toBe(1);
  expect(won.DB.rewards).toHaveLength(1);
  const id = await page.evaluate(() => window.__gameTest.G.id);

  await nextBtn.click();
  await expect(page.locator('#s-map')).toBeVisible();
  const cont = await game.state();
  expect(cont.G.unit).toBe(1, '本单元没完成就不许进 Unit 2');
  expect(await page.evaluate(() => window.__gameTest.G.result)).toBeUndefined();
  expect(cont.DB.runs).toBe(1);
  expect(cont.DB.wins).toBe(1, '继续学习不是第二次通关');
  expect(cont.DB.rewards).toHaveLength(1, '纪念卡不因继续而重复生成');
  expect(await page.evaluate(() => window.__gameTest.G.id)).toBe(id);
  expect(cont.G.done).toHaveLength(1);

  // 恢复后仍在同一轮、同一单元，且可以继续抽未完成的词
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  const back = await game.state();
  expect(back.G.unit).toBe(1);
  expect(back.G.done).toHaveLength(1);
  expect(back.DB.wins).toBe(1);
  expect(back.DB.rewards).toHaveLength(1);
});