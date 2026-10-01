import { test, expect } from './game-harness.js';

/* ============================================================
 * 单词队列：尽量不重复 + 词池穷尽的诚实检查点（真实浏览器）
 *
 * 全部跑 new 项目：legacy 归档页保留「小词池回灌整池」与「无完成检查点」的
 * 旧行为，它在这里是对照基线不是被测对象。
 *
 * 这些用例用**真实点击与真实打字**走完一整轮，不 mock 任何游戏逻辑：
 * 唯一的数据准备是往自定义词表里放一个极小词池（小池是本功能的核心场景）。
 * ============================================================ */

const newOnly = (testInfo, why) =>
  test.skip(testInfo.project.metadata.target === 'legacy', why);

// 极小自定义词池：一轮里就能把词答完，且覆盖「重复字母」「单字母词」。
const SMALL = [
  { w: 'cat', z: '猫' },
  { w: 'kiwi', z: '猕猴桃' },
  { w: 'banana', z: '香蕉' },   // 重复字母：重复字母 ≠ 重复词条
];

// 单词池：答完这一个词就必然耗尽，用来验「穷尽 → 检查点」这条路径。
const ONE = [{ w: 'cat', z: '猫' }];

const saved = pool => ({ custom: pool, mastered: [], runs: 0, wins: 0 });

// 读出当前目标词与已完成的词
const words = page => page.evaluate(() => {
  const { G, B } = window.__gameTest;
  return { word: B ? B.word.w : null, done: [...G.done], wrong: G.wrong.slice(),
    enHp: B ? B.enHp : null, myHp: B ? B.myHp : null, shield: B ? B.shield : null };
});

// 真实敲完当前这个词（逐字母 pressKey，和玩家点字母盘同一条路径）
async function typeCurrentWord(page) {
  const w = (await words(page)).word;
  for (const ch of w) await page.keyboard.type(ch);
  return w;
}

// Traverse the actual seeded map; the first available node may be rest/event.
async function enterBattle(page) {
  for (let step = 0; step < 9 && !(await page.locator('#s-fight').isVisible()); step++) {
    const fights = page.locator('#map .node.pick[title="遭遇词灵"],#map .node.pick[title="精英战"],#map .node.pick[title="词汇之王"]');
    await (await fights.count() ? fights.first() : page.locator('#map .node.pick').first()).click();
    if (await page.locator('#s-event').isVisible()) {
      await page.locator('#ePicks .pick').last().click();
      await expect(page.locator('#s-map')).toBeVisible();
    } else if (await page.locator('#s-rest').isVisible()) {
      const leave = page.locator('#rPicks [data-opt="shop:leave"]');
      await (await leave.count() ? leave : page.locator('#rPicks .pick').first()).click();
      await expect(page.locator('#s-map')).toBeVisible();
    }
  }
  await expect(page.locator('#s-fight')).toBeVisible();
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.B.enHp = 10_000; t.B.enMax = 10_000; t.renderFight();
  });
}

// 反复答题直到词池耗尽（真实打字），返回出过的词序列
async function playUntilExhausted(page, max = 12) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    if (!(await page.locator('#s-fight').isVisible())) break;
    seen.push(await typeCurrentWord(page));
  }
  return seen;
}

test('one unfinished word left still appears, and finishing it shows the learning-complete checkpoint', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Learning-complete checkpoint is new UI');
  await game.open({ saved: saved([{ w: 'cat', z: '猫' }]) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });   // 血很厚：答完也打不死
  await expect(page.locator('#s-fight')).toBeVisible();

  await typeCurrentWord(page);
  // 词答完了，但怪还活着 → 词汇完成检查点，绝不是战斗通关
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  await expect(page.locator('#s-fight')).toBeHidden();
  await expect(page.locator('#s-over')).toBeHidden();

  const s = await game.state();
  expect(s.DB.wins).toBe(0);              // 没有通关
  expect(s.G.kills).toBe(0);              // 没有击杀
  expect(s.B.over).toBe(false);           // 战斗没有结束
  expect(s.B.enHp).toBeGreaterThan(0);     // 怪还活着
  expect(s.DB.runs).toBe(1);              // 也没有多记一次远征
  await expect(page.locator('#lcTitle')).toContainText('全部完成');
  await expect(page.locator('#lcMon')).toContainText('还没有被打倒');
  // 不许**声称**通关或解锁。这屏会明说「本轮不算通关」「词汇完成不等于击败首领」，
  // 所以断言必须只抓肯定式说法，否则连诚实的免责句都会被误判。
  const body = await page.locator('#s-learning-complete').innerText();
  const claim = body
    .replace(/不算通关|没有通关|词汇完成不等于击败首领|不会替你解锁|不会解锁/g, '');
  expect(claim).not.toMatch(/通关|击败|战胜|解锁/);
  expect(body).toMatch(/不算通关/);       // 明确否认
  expect(body).toMatch(/不等于击败首领/);  // 明确否认
  // 开发说明不进产品文案
  expect(body).not.toMatch(/之后的功能|下一单元/);
  // 两个出口的 tooltip 必须与实际行为一致（结束 = abandon，不是结算）
  await expect(page.locator('#lcBtnQuit')).toHaveAttribute('title', /结束/);
  await expect(page.locator('#lcBtnQuit')).toHaveAttribute('title', /保留|已掌握/);
  await expect(page.locator('#lcBtnQuit')).not.toHaveAttribute('title', /结算/);
});

test('a duplicated custom entry still saves, pauses and resumes without a corrupt save', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Duplicate-entry tolerance is part of the new rule');
  // 玩家把同一行导入两次：DB.custom 两行完全一样 → 词池里两条 w/u/d/z 全同。
  // 旧判据 pool.length !== 1 让每一次暂停/保存都判 invalid（界面报存档损坏）。
  await game.open({ saved: saved([{ w: 'cat', z: '猫' }, { w: 'cat', z: '猫' }]) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });
  await page.keyboard.type('ca');                     // 半词：必须是可恢复的半词

  // 真实暂停（走真实按钮 → 真实 codec 落盘）
  await page.locator('#tPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  const raw = await game.saved();
  expect(raw.activeRun, '暂停必须真的存下快照，而不是判存档损坏').toBeTruthy();
  expect(raw.activeRun.phase).toBe('battle');
  expect(raw.activeRun.battle.word.w).toBe('cat');
  // 原始两条自定义词一个都不许被删
  expect(raw.activeRun.run.pool.filter(w => w.w === 'cat')).toHaveLength(2);
  expect(raw.custom.filter(w => w.w === 'cat')).toHaveLength(2);

  // 真实刷新 + 继续：半词与词池都原样回来
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();
  const after = await game.state();
  expect(after.B.input).toEqual(['c', 'a']);
  expect(after.B.word).toBe('cat');
  // 继续把词答完 → 唯一身份只出一个 cat，随后进完成检查点（不是重复出题）
  await page.keyboard.type('t');
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  const done = await game.state();
  expect(done.G.done).toEqual(['cat']);
  expect(done.G.kills).toBe(0);
  expect(done.DB.wins).toBe(0);
});

test('a case variant of a custom word is one target, and different spellings stay separate', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Word identity is the new rule');
  // CAT 与 cat 是同一个身份（只差大小写）；ice cream / icecream / ice-cream 是三个。
  await game.open({ saved: saved([
    { w: 'CAT', z: '猫' }, { w: 'cat', z: '猫二' },
    { w: 'ice cream', z: '冰淇淋' }, { w: 'icecream', z: '冰激凌' }, { w: 'ice-cream', z: '奶油冻' },
  ]) });
  await game.start(0);
  await game.fight({ word: 'CAT', enemyHp: 10_000 });

  const seen = [];
  for (let i = 0; i < 8; i++) {
    if (!(await page.locator('#s-fight').isVisible())) break;
    const w = await typeCurrentWord(page);
    // 身份比较只看 trim + lower：同一个身份本轮只许出现一次
    const key = x => x.trim().toLowerCase();
    expect(seen.map(key)).not.toContain(key(w));
    seen.push(w);
  }
  // CAT / cat 是**同一个身份**：只出第一条拼写，且整轮只出一次。
  expect(seen).toHaveLength(4, '四个身份各一次：' + JSON.stringify(seen));
  expect(seen.filter(w => w.trim().toLowerCase() === 'cat')).toHaveLength(1);
  expect(seen[0], '唯一身份的第一条就是 CAT').toBe('CAT');
  for (const w of ['ice cream', 'icecream', 'ice-cream']) {
    expect(seen).toContain(w, '拼写不同的词必须能练到：' + JSON.stringify(seen));
  }
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  const s = await game.state();
  expect(s.G.kills).toBe(0);
  expect(s.DB.wins).toBe(0);
});

test('a three-word unit never repeats a word across questions', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Non-repeating queue is a new rule');
  await game.open({ saved: saved(SMALL) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });

  const seen = [];
  for (let i = 0; i < 6; i++) {
    if (!(await page.locator('#s-fight').isVisible())) break;
    const w = await typeCurrentWord(page);
    expect(seen).not.toContain(w);       // 本轮绝不重复
    seen.push(w);
  }
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen.length).toBe(SMALL.length);
  expect([...seen].sort()).toEqual(SMALL.map(w => w.w).sort());
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  const s = await game.state();
  expect(s.G.kills).toBe(0);
  expect(s.DB.wins).toBe(0);
});

test('skipping a word without finishing it does not mark it done and it comes back later', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Non-repeating queue is a new rule');
  await game.open({ saved: saved(SMALL) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });

  // 只拼一半然后跳过：这个词不算学会
  await page.keyboard.type('c');
  const partial = await words(page);
  expect(partial.word).toBe('cat');
  expect(partial.done).not.toContain('cat');
  await page.locator('#tSkip').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await game.state()).G.done).not.toContain('cat');

  // 再进一场：没答完的 cat 必须还能出现（跳过不是「跳过未完成词」）
  await enterBattle(page);
  const later = await playUntilExhausted(page);
  expect(later).toContain('cat');
  expect(new Set(later).size).toBe(later.length);
  expect(later.length).toBe(SMALL.length);
});

test('a wrong word stays reviewable and never blocks the fresh words', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Wrong-word review queue is part of the new rule');
  await game.open({ saved: saved(SMALL) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });
  // 真实点一个字母盘上**不存在于目标词**的干扰字母（真实错答路径）
  const target = await page.evaluate(() => window.__gameTest.B.word.w);
  const decoy = await page.evaluate(w => {
    const B = window.__gameTest.B;
    const i = B.letters.findIndex((c, j) => !B.used[j] && !B.bad[j] && !w.includes(c));
    if (i < 0) return null;
    return { i, ch: B.letters[i] };
  }, target);
  expect(decoy, '需要一个词库里没有的干扰字母才能验错词').not.toBeNull();
  await page.locator('#fBank .key').nth(decoy.i).click();
  const afterWrong = await words(page);
  expect(afterWrong.wrong).toContain(target);
  expect(afterWrong.done).not.toContain(target);
  // 完整答完这个错词后它必须从复习队列里消失（creditWord 去掉 wrong）
  await typeCurrentWord(page);
  const after = await words(page);
  expect(after.done).toContain(target);
  expect(after.wrong).not.toContain(target);
});

test('reloading on the checkpoint keeps the run and does not hand out a repeated word', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Learning-complete checkpoint is new UI');
  await game.open({ saved: saved(ONE) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });
  await typeCurrentWord(page);
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  // 先让这一局真的消耗掉一些资源/额度：影分身用过、护盾被打掉、身上有遗物。
  // 恢复后这些都必须原样回来（额度不重置 = 玩家不能靠刷新刷一次免费撤退）。
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.ghostUsed = true; t.G.relics = ['battery', 'greed']; t.G.gold = 128;
    t.B.shield = 7; t.B.myHp = 41; t.G.hp = 41;
    t.progress.checkpoint();
  });
  const before = await game.state();

  await game.reload();
  await page.locator('#continueRun').click();
  // 恢复后必须仍是同一个检查点，不是地图也不是战斗
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  const after = await game.state();
  expect(after.G.done.sort()).toEqual(before.G.done.sort());
  expect(after.G.kills).toBe(before.G.kills);
  expect(after.DB.wins).toBe(before.DB.wins);
  expect(after.DB.runs).toBe(before.DB.runs);       // 恢复绝不重复计次
  expect(after.G.ghostUsed).toBe(true);             // 影分身额度不重置
  expect(after.G.gold).toBe(before.G.gold);         // 金币不变
  expect(after.G.relics.sort()).toEqual(['battery', 'greed']);   // 遗物不丢
  expect(after.B.enHp).toBe(before.B.enHp);         // 怪物血量往返不变
  expect(after.B.myHp).toBe(before.B.myHp);
  expect(after.B.shield).toBe(before.B.shield);
  // 再恢复一次也不变（幂等）
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  const again = await game.state();
  expect(again.G.kills).toBe(before.G.kills);
  expect(again.DB.runs).toBe(before.DB.runs);
  expect(again.G.ghostUsed).toBe(true);
  expect(again.B.shield).toBe(before.B.shield);
  expect(again.DB.mastered).toEqual(after.DB.mastered);
});

test('the checkpoint can be saved back to the title and resumed without losing anything', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Learning-complete checkpoint is new UI');
  await game.open({ saved: saved(ONE) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });
  await typeCurrentWord(page);
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  const before = await game.state();

  await page.locator('#lcBtnHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#continueRun')).toBeVisible();
  // 快照真的落盘了
  const raw = await game.saved();
  expect(raw.activeRun).toBeTruthy();
  expect(raw.activeRun.phase).toBe('learning-complete');

  await page.locator('#continueRun').click();
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  const after = await game.state();
  expect(after.G.kills).toBe(before.G.kills);
  expect(after.DB.runs).toBe(before.DB.runs);
  expect(after.B.enHp).toBe(before.B.enHp);
});

test('ending the learning round from the checkpoint clears the run without a defeat label', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Learning-complete checkpoint is new UI');
  await game.open({ saved: saved(ONE) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });
  await typeCurrentWord(page);
  await expect(page.locator('#s-learning-complete')).toBeVisible();

  page.once('dialog', d => d.accept());
  await page.locator('#lcBtnQuit').click();
  await expect(page.locator('#s-title')).toBeVisible();
  // 明确不许出现战败/结算屏
  await expect(page.locator('#s-over')).toBeHidden();
  expect(await page.locator('#oAgain').isVisible()).toBe(false);
  const raw = await game.saved();
  expect(raw.activeRun).toBeFalsy();
  // 已学会的词与掌握记录保留
  expect(raw.mastered).toContain('cat');
  expect(raw.wins).toBe(0);
});

test('a lethal final word takes the normal victory path exactly once', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Learning-complete checkpoint is new UI');
  // 一个词 + 敌人只剩 1 血：最后一词真的能打死它
  await game.open({ saved: saved(ONE) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 1 });
  await typeCurrentWord(page);
  // 真打死 → 既有胜利奖励，不是完成检查点
  await expect(page.locator('#s-over')).toBeHidden();
  await expect(page.locator('#pTitle')).toBeVisible();
  const s = await game.state();
  expect(s.B.over).toBe(true);
  expect(s.B.won).toBe(true);
  expect(s.G.kills).toBe(1);
  expect(s.DB.mastered.filter(w => w === 'cat')).toHaveLength(1);
  // 领奖只发一次
  await page.locator('#pPicks .pick').first().click();
  const after = await game.state();
  expect(after.G.kills).toBe(1);
  expect(after.DB.wins).toBe(0);         // 普通怪不是 BOSS 通关
  expect(after.DB.mastered.filter(w => w === 'cat')).toHaveLength(1);
  // 领奖后推进：词池已空 → 显示同一个检查点，而不是再开一场空战斗
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  expect((await game.state()).G.kills).toBe(1);
});

test('re-entering a map node after the unit is complete shows the same checkpoint, not an empty board', async ({ game, page }, testInfo) => {
  newOnly(testInfo, 'Learning-complete checkpoint is new UI');
  await game.open({ saved: saved(SMALL) });
  await game.start(0);
  await game.fight({ word: 'cat', enemyHp: 10_000 });
  // 把整个词池答完（每次出题用真实打字）
  for (let i = 0; i < SMALL.length; i++) await typeCurrentWord(page);
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  // 刷新后从检查点回主页，再手动进一个战斗节点
  await game.reload();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  await page.locator('#lcBtnHome').click();
  await expect(page.locator('#s-title')).toBeVisible();

  // 直接走公开入口：再点一次同一个战斗节点
  const nodeCount = await page.evaluate(() => {
    const t = window.__gameTest;
    const n = t.B.node; // The known battle node, not an arbitrary rest/event.
    if (!['battle', 'elite', 'boss'].includes(n.type)) throw new Error('Expected the restored battle node');
    t.enterNode(n);
    return t.G.rows[0].length;
  });
  expect(nodeCount).toBeGreaterThan(0);
  await expect(page.locator('#s-learning-complete')).toBeVisible();
  await expect(page.locator('#fBank .key')).toHaveCount(0);
});
