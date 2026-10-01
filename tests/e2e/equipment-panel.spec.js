/* 「装备与能力」面板的真实浏览器回归（Chromium）。
 *
 * 目标全部 skip 到 new 项目：归档页面本来就没有这个面板，
 * legacy 对照跑的是旧版，不是这个功能。
 *
 * 覆盖的是**单测证明不了的部分**：真实 <details> 的点开行为、真实点击
 * 可用道具、320/390 窄屏不溢出且不挡住字母盘 HUD、暂停恢复后清单跟着
 * 存档同步、以及面板不许偷偷改状态。
 */
import { test, expect } from './game-harness.js';

const newOnly = (testInfo) => test.skip(testInfo.project.metadata.target === 'legacy',
  'Equipment panel is a new feature; the archived page cannot do it');

// 这份规格用 locator.tap()（真实触摸，而不是 hover 才展开），
// Playwright 要求 context 上开 hasTouch，否则整份规格会在 tap 上全部报错。
test.use({ hasTouch: true });

/* 给本局塞一批真实存在的装备（遗物/道具 id 必须来自数据表，否则断言没意义）。 */
async function grant(page, { relics = [], bag = {}, heroId = null, ghostUsed = false } = {}) {
  await page.evaluate(({ relics, bag, heroId, ghostUsed }) => {
    const t = window.__gameTest;
    t.G.relics = relics;
    t.G.bag = bag;
    t.G.ghostUsed = ghostUsed;
    if (heroId) t.G.heroId = heroId;
    t.renderFight();
  }, { relics, bag, heroId, ghostUsed });
}

const panel = page => page.locator('#fEquipment');

test('the panel appears on the fight screen with a compact summary line', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await expect(panel(page)).toHaveCount(1);
  // 折叠态是一行紧凑标题，不是展开的大清单
  await expect(panel(page)).not.toHaveAttribute('open', /.*/);
  const summary = page.locator('#fEquipment > summary');
  await expect(summary).toBeVisible();
  await expect(summary).toHaveText(/^装备与能力 · \d+$/);
  // 它挂在道具栏旁边，不是覆盖在道具栏或词卡上
  const next = await page.evaluate(() =>
    document.getElementById('fItems').nextElementSibling.id);
  expect(next).toBe('fEquipment');
});

test('tapping the summary expands the effects — no hover required', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await grant(page, { heroId: 'scout', relics: ['purse', 'lucky', 'scholar'], bag: { rage: 2 } });

  const body = page.locator('#fEquipment .eq-body');
  await expect(body).toBeHidden();
  await page.locator('#fEquipment > summary').tap();
  await expect(panel(page)).toHaveAttribute('open', '');
  await expect(body).toBeVisible();

  const text = await body.textContent();
  // 角色被动读的是本局的 G.heroId
  expect(text).toContain('探险家');
  // 全部遗物都列出（不止前三个），效果文案直接可见
  expect(text).toContain('聚宝盆');
  expect(text).toContain('每场战斗胜利额外获得 25 金币');
  expect(text).toContain('幸运草');
  expect(text).toContain('学者之书');
  expect(text).toContain('怒火护符');
  expect(text).toContain('本场已用 0/3');
});

test('the title count matches the number of owned entries', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  // 英雄 1 + 去重后遗物 1（shield 出现两次算一件）+ 道具 1 = 3
  await grant(page, { relics: ['shield', 'shield'], bag: { purge: 1 } });
  await expect(page.locator('#fEquipment > summary')).toHaveText('装备与能力 · 3');
  await page.locator('#fEquipment > summary').tap();
  const text = await page.locator('#fEquipment .eq-body').textContent();
  // 合并成 ×2，但护盾效果只出现一次（叠两遍不会多给一次护盾）
  expect(text).toContain('护盾符文 ×2');
  expect(text.match(/开局获得 15 点护盾/g)).toHaveLength(1);
});

test('every owned relic shows, not just the first three', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  const all = ['hint', 'shield', 'combo', 'purse', 'thorn', 'battery', 'lucky', 'scholar', 'forge'];
  await grant(page, { relics: all });
  await expect(page.locator('#fEquipment > summary')).toHaveText('装备与能力 · ' + (1 + all.length));
  await page.locator('#fEquipment > summary').tap();
  const text = await page.locator('#fEquipment .eq-body').textContent();
  for (const n of ['提示水晶', '护盾符文', '连击徽章', '聚宝盆', '荆棘护符', '永动电池', '幸运草', '学者之书', '锻造台']) {
    expect(text, '遗物 ' + n + ' 必须可见').toContain(n);
  }
});

test('an exhausted ghost quota says so, while a fresh one shows one left', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });

  await grant(page, { relics: ['ghost'], ghostUsed: false });
  await page.locator('#fEquipment > summary').tap();
  await expect(page.locator('#fEquipment .eq-body')).toContainText('本轮剩余 1 次');

  // 用掉之后同一场战斗里立刻变成耗尽（额度是 run 级，不随战斗重置）
  await page.evaluate(() => { window.__gameTest.G.ghostUsed = true; window.__gameTest.renderFight(); });
  const text = await page.locator('#fEquipment .eq-body').textContent();
  expect(text).toContain('影分身额度');
  expect(text).toContain('本轮已耗尽');
  expect(text).not.toContain('本轮剩余 1 次');
});

test('an item at its per-fight cap is marked spent, and using one updates the panel', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  // 给 5 个但本场上限是 3：这样能测到真正有意义的「还有存货却已用满」状态。
  // （若只给 3 个，用掉 3 次后 owned 归零，行会按 #fItems 的口径整行消失，
  //   测到的就不是「已用满」而是「道具没了」。）
  await grant(page, { bag: { rage: 5 } });
  await page.locator('#fEquipment > summary').tap();
  await expect(page.locator('#fEquipment .eq-body')).toContainText('本场已用 0/3');

  // 点道具栏的按钮真的能消耗（面板是只读的，但绝不能妨碍原有使用路径）
  await page.locator('#fItems .item', { hasText: '怒火护符' }).click();
  await expect(page.locator('#fEquipment .eq-body')).toContainText('本场已用 1/3');
  await expect(page.locator('#fEquipment .eq-body')).toContainText('×4');

  // 用满 3 次：面板标出已用满，道具栏按钮同步禁用（两处口径一致）
  await page.locator('#fItems .item', { hasText: '怒火护符' }).click();
  await page.locator('#fItems .item', { hasText: '怒火护符' }).click();
  await expect(page.locator('#fEquipment .eq-body')).toContainText('本场已用 3/3');
  await expect(page.locator('#fEquipment .eq-body')).toContainText('已用满');
  await expect(page.locator('#fItems .item', { hasText: '怒火护符' })).toHaveClass(/off/);
});

test('the panel shows the real in-fight shield, and nothing gets re-applied', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  // 先发遗物再进战斗：护盾符文必须在 startFight 那一刻就在 G.relics 里，
  // 顺序反了 B 还是 null（renderFight 会直接抛），测的就不是同一件事了。
  await page.evaluate(() => { window.__gameTest.G.relics = ['shield']; });
  await game.fight({ word: 'litre', enemyHp: 500 });
  await page.locator('#fEquipment > summary').tap();

  const before = await game.state();
  // 护盾符文开局给了 15 点；战斗中被消耗掉一部分后面板必须跟着变，
  // 反复重渲染也不能把它补回 15
  await page.evaluate(() => { window.__gameTest.B.shield = 4; window.__gameTest.renderFight(); });
  await expect(page.locator('#fEquipment .eq-body')).toContainText('4 点');
  await page.evaluate(() => { window.__gameTest.renderFight(); window.__gameTest.renderFight(); });
  await expect(page.locator('#fEquipment .eq-body')).toContainText('4 点');

  const after = await game.state();
  expect(after.B.shield).toBe(4);
  expect(after.B.hints).toBe(before.B.hints);            // 面板不许偷偷补提示
  expect(after.G.relics).toEqual(before.G.relics);      // 也不许重新施加遗物
  expect(after.G.bag).toEqual(before.G.bag);
});

test('rendering the panel mutates neither G nor B', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await grant(page, { heroId: 'ranger', relics: ['hint', 'ghost'], bag: { leech: 2, purge: 1 } });
  const before = await game.state();
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__gameTest.renderFight(); });
  const after = await game.state();
  expect(after.G).toEqual(before.G);
  expect(after.B).toEqual(before.B);
});

test('re-render does not collapse a panel the player just opened', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await grant(page, { relics: ['hint'] });
  await page.locator('#fEquipment > summary').tap();
  await expect(panel(page)).toHaveAttribute('open', '');

  await game.clickLetter('l');                       // 半词：会触发 renderFight
  await expect(panel(page)).toHaveAttribute('open', '');
  await grant(page, { relics: ['hint', 'combo'] });  // 状态变了，内容也必须跟着更新
  await expect(panel(page)).toHaveAttribute('open', '');
  await expect(page.locator('#fEquipment > summary')).toHaveText('装备与能力 · 3');
  await expect(page.locator('#fEquipment .eq-body')).toContainText('连击徽章');
});

test('a hostile relic id from the save renders as text, not markup', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  await page.evaluate(() => {
    const t = window.__gameTest;
    t.G.relics = ['<img src=x onerror="window.__pwned=1">'];
    window.__pwned = 0;
    t.renderFight();
  });
  await page.locator('#fEquipment > summary').tap();
  await expect(page.locator('#fEquipment .eq-body')).toContainText('未知装备');
  // 真实 IMG 元素一个都没有，onerror 也没有触发
  expect(await page.locator('#fEquipment img').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBe(0);
  await expect(page.locator('#fEquipment .eq-unknown').first()).toBeVisible();
});

test('restoring a saved fight re-syncs the panel from the restored snapshot', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open(); await game.start();
  await game.fight({ word: 'litre', enemyHp: 500 });
  // 必须真的持有影分身：ghostUsed=true 单独存在时，额度本来就是 false（没那件遗物）。
  await grant(page, { relics: ['shield', 'scholar', 'ghost'], bag: { purge: 2 }, ghostUsed: true });
  await page.locator('#tPause').click();
  await expect(page.locator('#pzSave')).toContainText(/已保存/);

  await game.reload();                       // 真正的刷新：读应用自己写的存档
  // 刷新后按设计停在主页并给出「继续远征」入口，绝不自动进战斗。
  await expect(page.locator('#s-title')).toBeVisible();
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();

  await expect(page.locator('#fEquipment')).toHaveCount(1);
  const text = await page.locator('#fEquipment .eq-body').textContent();
  expect(text).toContain('护盾符文');
  expect(text).toContain('学者之书');
  expect(text).toContain('扫除术');
  expect(text).toContain('本轮已耗尽');
  // 英雄 + shield + scholar + ghost + purge = 5
  await expect(page.locator('#fEquipment > summary')).toHaveText('装备与能力 · 5');
});

for (const width of [320, 390]) {
  test(`the panel fits ${width}px without horizontal overflow or covering the letter bank`, async ({ game, page }, testInfo) => {
    newOnly(testInfo);
    await page.setViewportSize({ width, height: 844 });
    await game.open(); await game.start();
    await game.fight({ word: 'litre', enemyHp: 500 });
    await grant(page, { heroId: 'scholar', relics: ['hint', 'shield', 'combo', 'purse', 'thorn'], bag: { leech: 2, rage: 1, purge: 3, stone: 1 } });

    // 折叠态：整页不许出现横向滚动
    const overflow = () => page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow(), width + 'px 折叠态不允许横向溢出').toBeLessThanOrEqual(1);

    await page.locator('#fEquipment > summary').tap();
    await expect(page.locator('#fEquipment .eq-body')).toBeVisible();
    expect(await overflow(), width + 'px 展开态不允许横向溢出').toBeLessThanOrEqual(1);

    // 面板长在 .fmid 这个滚动区里（responsive.css 已把它设成 flex:1 + overflow-y:auto），
    // 所以「不挡键盘 HUD」的准确判据是：面板被裁在 .fmid 的框内，
    // 字母盘仍在框外且真的点得到 —— 而不是拿未裁剪的 rect 去比。
    const boxes = await page.evaluate(() => {
      const fm = document.querySelector('#s-fight .fmid');
      const f = fm.getBoundingClientRect();
      const p = document.getElementById('fEquipment').getBoundingClientRect();
      const b = document.getElementById('fBank').getBoundingClientRect();
      return { fmTop: f.top, fmBottom: f.bottom, pTop: p.top, pBottom: p.bottom,
        pRight: p.right, bTop: b.top, overflowY: getComputedStyle(fm).overflowY };
    });
    expect(boxes.pTop).toBeGreaterThanOrEqual(boxes.fmTop - 1);
    expect(boxes.pRight).toBeLessThanOrEqual(width + 1);
    if (boxes.pBottom > boxes.fmBottom) {
      // 内容高于中段滚动区：必须是「可滚动的 fmid 裁掉它」，字母盘仍在下方可见
      expect(boxes.overflowY, '面板超高时只能靠 .fmid 内部滚动消化').toBe('auto');
    }
    expect(boxes.bTop).toBeGreaterThanOrEqual(boxes.fmBottom - 1);

    // 真实交互：展开状态下点字母盘，事件必须真的到达字母盘（没被面板压住）
    await page.evaluate(() => { window.__bankHit = 0;
      document.getElementById('fBank').addEventListener('click', () => window.__bankHit++, true); });
    await expect(page.locator('#fBank .key:not(.gone)').first()).toBeVisible();
    await page.locator('#fBank .key:not(.gone)').first().click();
    expect(await page.evaluate(() => window.__bankHit), '展开面板不许吃掉字母盘的点击').toBeGreaterThan(0);
  });
}