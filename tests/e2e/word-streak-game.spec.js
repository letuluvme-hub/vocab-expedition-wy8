/* 完整词连胜在**真实游戏**里的验收（docs/feature-word-streak.md）。
 *
 * 与 tests/e2e/word-streak.spec.js 的区别：那份跑在独立夹具上，只能证明模块本身；
 * 这一份跑在**真实应用**（basePath 根页面）上，用真键盘、真字母盘、真暂停保存、
 * 真刷新，证明 runtime/combat/speech 这条接线真的存在。
 *
 * 语音：默认存档把朗读关着（voice:false）→ 只验证文字通道，**不谎称**有声音。
 * 需要验证语音顺序的那几条用 speechStub=true：装一个**记录调用**的
 * speechSynthesis 平台桩（不合成任何声音），游戏自己的 speech.js 逐字是真的。
 * ★ 这里验证的是「utterance 的调用顺序与取消次数」，**不是**真机可听性。
 */
import { test, expect } from './game-harness.js';

const newOnly = (testInfo, why) => {
  if (testInfo.project.metadata.target === 'legacy') test.skip(true, why);
};
const SKIP_WHY = 'Whole-word streak feedback is new; the archived page has no such wiring';

/* 用真键盘把当前词拼完（走 typeLetter → pressKey 的真实路径，不是直接改状态）。 */
async function typeWord(page) {
  const word = await page.evaluate(() => window.__gameTest.B.word.w);
  for (const ch of word) {
    await page.keyboard.press(ch);
    await page.waitForTimeout(20);
  }
  return word;
}
const streak = page => page.evaluate(() => window.__gameTest.wordStreak);
const toastText = page => page.locator('#streakAnnouncement').textContent();

test.describe('whole-word streak in the real application', () => {
  test.beforeEach(({}, testInfo) => { newOnly(testInfo, SKIP_WHY); });

  test('one completed word paints First Blood inside the fight flow host', async ({ game, page }) => {
    await game.open(); await game.start();
    await game.fight({ word: 'litre', enemyHp: 5000 });
    await typeWord(page);
    await expect(page.locator('#streakAnnouncement')).toBeVisible();
    await expect(page.locator('#streakAnnouncement')).toHaveText('First Blood');
    expect((await streak(page)).count).toBe(1);
    // 留在战斗页词框下方的文档流里：绝不浮在 HUD 上。
    const box = await page.locator('#streakAnnouncement').boundingBox();
    const qbox = await page.locator('#s-fight .q').boundingBox();
    expect(box.y).toBeGreaterThan(qbox.y);
    expect(await page.locator('#streakAnnouncement').evaluate(el => getComputedStyle(el).position)).toBe('static');
  });

  test('the streak survives a second battle: Double Kill, and the toast carries no answer word', async ({ game, page }) => {
    await game.open(); await game.start();
    await game.fight({ word: 'litre', enemyHp: 5000 });
    await typeWord(page);
    await expect(page.locator('#streakAnnouncement')).toHaveText('First Blood');
    // 推进到下一层并进入**另一场**战斗（真实 advance → startFight 路径）：
    // 连胜是 run 级事实，必须原样接上（B 整个被重建，B.wordStreak 归零）。
    await page.evaluate(() => window.__gameTest.advance());
    await expect(page.locator('#s-map')).toBeVisible();
    await game.fight({ word: 'salty', enemyHp: 5000 });
    await typeWord(page);
    await expect(page.locator('#streakAnnouncement')).toHaveText('Double Kill');
    expect((await streak(page)).count).toBe(2);
    // 播报通道里绝不出现当前英文单词（那是学习答案）。
    const text = await toastText(page);
    expect(text).not.toContain('salty');
    expect(text).not.toContain('litre');
  });

  test('stage 8 saturates: no ninth shout', async ({ game, page }) => {
    await game.open(); await game.start();
    // 直接把计数推到 7（真实完成一个词），再完成 3 个词：8 级封顶。
    await game.fight({ word: 'litre', enemyHp: 90000 });
    await page.evaluate(() => { window.__gameTest.G.wordStreak = { count: 7, lastEventId: 'seed:0' }; });
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await typeWord(page);
      const t = await toastText(page);
      if (t && !seen.includes(t)) seen.push(t);
      await page.waitForTimeout(60);
    }
    expect((await streak(page)).count).toBe(8);
    expect(seen).toEqual(['Godlike']);       // 只喊一次，之后彻底安静
  });

  test('a wrong accepted letter resets the streak and the next whole word starts again at First Blood', async ({ game, page }) => {
    await game.open(); await game.start();
    await game.fight({ word: 'litre', enemyHp: 90000 });
    await typeWord(page);
    await expect(page.locator('#streakAnnouncement')).toHaveText('First Blood');
    // 真键盘打一个「被接受但错」的字母：从**真实字母盘**上挑一个此刻不需要、
    //   还没被标错的实例（不是随便一个键 —— 字母盘上没有的输入不算失手）。
    const wrong = await page.evaluate(() => {
      const B = window.__gameTest.B;
      const need = B.word.w.replace(/[^a-z]/g, '')[B.input.length];
      for (let i = 0; i < B.letters.length; i++) {
        if (!B.used[i] && !B.bad[i] && B.letters[i] !== need) return B.letters[i];
      }
      return null;
    });
    expect(wrong, '字母盘上必须真的有一个可按错的字母').toBeTruthy();
    await page.keyboard.press(wrong);
    await page.waitForTimeout(80);
    expect((await streak(page)).count).toBe(0, '真实打错清零');
    await typeWord(page);
    await expect(page.locator('#streakAnnouncement')).toHaveText('First Blood');
  });

  test('pause keeps the streak and the event sequence; a reload restores both', async ({ game, page }) => {
    await game.open(); await game.start();
    await game.fight({ word: 'litre', enemyHp: 5000 });
    await typeWord(page);
    const before = await streak(page);
    expect(before.count).toBe(1);

    await page.locator('#tPause').click();
    await expect(page.locator('#s-pause')).toBeVisible();
    const saved = await game.saved();
    expect(saved.activeRun.run.wordStreak.count).toBe(1, '暂停把连胜事实落盘');
    expect(saved.activeRun.run.wordEventSeq).toBe(before.seq);

    // 真刷新 → 继续远征：连胜与事件序号都必须原样接上。
    await game.reload();
    await page.locator('#continueRun').click();
    await expect(page.locator('#s-fight')).toBeVisible();
    const after = await streak(page);
    expect(after.count).toBe(1);
    expect(after.seq).toBe(before.seq);
    // 恢复之后不补播：屏上没有任何新 toast。
    expect(await page.locator('#streakAnnouncement').count()).toBe(0);

    await typeWord(page);
    await expect(page.locator('#streakAnnouncement')).toHaveText('Double Kill');
    expect((await streak(page)).seq).toBe(before.seq + 1);
  });

  test('a new run starts a fresh streak', async ({ game, page }) => {
    await game.open(); await game.start();
    await game.fight({ word: 'litre', enemyHp: 5000 });
    await typeWord(page);
    expect((await streak(page)).count).toBe(1);
    await page.evaluate(() => window.__gameTest.newRun());
    await expect(page.locator('#s-map')).toBeVisible();
    expect((await streak(page)).count).toBe(0, '新一局清零');
    await game.fight({ word: 'salty', enemyHp: 5000 });
    await typeWord(page);
    await expect(page.locator('#streakAnnouncement')).toHaveText('First Blood');
  });

  test('with speech on, the announcement never appears before the word finishes and never cancels it', async ({ game, page }) => {
    await game.open({ voice: true, speechStub: true });
    await game.start();
    await game.fight({ word: 'litre', enemyHp: 5000 });
    await typeWord(page);
    await page.waitForTimeout(30);
    // 基线：整词朗读**已经开口**（TTS.word 自己那一次 cancel 已在基线里）。
    const during = await page.evaluate(() => window.__speech.texts());
    expect(during).toContain('litre');
    const cancelsAtWord = await page.evaluate(() => window.__speech.cancels);

    // 1) 词还没 end 的整段时间里：不许出现 announcement，也**不许**多一次 cancel
    //    （任何 cancel 都意味着有人打断了正在读的单词）。
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__speech.texts())).not.toContain('First Blood');
    expect(await page.evaluate(() => window.__speech.cancels)).toBe(cancelsAtWord);
    expect(await page.locator('#streakAnnouncement').count()).toBe(1);   // 文字先到，不等语音

    // 3) 词真的念完（真实 onend，用的是**单词那一句**的 utterance）之后，
    //    播报才有机会出声。
    await page.evaluate(() => {
      const list = window.__speech.spoken;
      window.__speech.end(list.length - 1);
    });
    await expect.poll(() => page.evaluate(() => window.__speech.texts()), { timeout: 4000 })
      .toContain('First Blood');
    const after = await page.evaluate(() => window.__speech.texts());
    const wordAt = after.indexOf('litre');
    expect(wordAt).toBeGreaterThanOrEqual(0);
    expect(after.indexOf('First Blood')).toBeGreaterThan(wordAt);   // 顺序：先词，后播报

    // 4) 下一个词照样优先：新的词朗读先于任何播报，且不被 cancel。
    await typeWord(page);
    await page.waitForTimeout(50);
    const next = await page.evaluate(() => window.__speech.texts());
    expect(next[next.length - 1]).not.toBe('Double Kill');
    expect(next).toContain('litre');                 // 下一轮仍然是词在念
  });

  test('the final kill still speaks the milestone, in order, after the word finishes', async ({ game, page }) => {
    // ★ 这一条钉住「最后一击赢下整场战斗」那一局的播报（父复现的丢报）。
    //   整词完成的瞬间词正在念 → 里程碑排进队列；紧接着 applyDamage 打空敌人
    //   → winFight 把 B.over 置真。旧的 isBattleLive（`B && !B.over`）于是把这条
    //   待播判成「战斗没了」而丢弃 —— 玩家刚拼出里程碑却在结算屏听不到。
    //   契约：同一场战斗（B 身份不变）打赢了、仍在它的待领奖相位 → 仍然播出，
    //   且顺序必须是「词 → 里程碑 → 胜利台词」，全程一个 cancel 都不许多。
    await game.open({ voice: true, speechStub: true });
    await game.start();
    // 敌人血量压到「这一记大招刚好打死」：winFight 会在 pressKey 内同步触发。
    await game.fight({ word: 'litre', enemyHp: 5 });
    await typeWord(page);
    await expect(page.locator('#s-fight')).toBeVisible();

    // 基线：整词朗读已经开口，且这一局确实赢了（B.over && B.won）。
    const during = await page.evaluate(() => window.__speech.texts());
    expect(during, '整词朗读必须先开口').toContain('litre');
    expect(await page.evaluate(() => window.__gameTest.phase)).toBe('reward');
    expect(await page.evaluate(() => !!(window.__gameTest.B.over && window.__gameTest.B.won))).toBe(true);
    const cancelsAtWord = await page.evaluate(() => window.__speech.cancels);

    // 词还没 end 之前：里程碑与胜利台词都**不许**出现，也不许多一次 cancel。
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__speech.texts())).not.toContain('First Blood');
    expect(await page.evaluate(() => window.__speech.cancels)).toBe(cancelsAtWord);

    // 词真的念完（真实 onend）之后，里程碑必须出声 —— 尽管战斗已经 over。
    await page.evaluate(() => {
      const list = window.__speech.spoken;
      window.__speech.end(list.length - 1);
    });
    await expect.poll(() => page.evaluate(() => window.__speech.texts()), { timeout: 4000 })
      .toContain('First Blood');

    const after = await page.evaluate(() => window.__speech.texts());
    const wordAt = after.indexOf('litre');
    const milestoneAt = after.indexOf('First Blood');
    expect(wordAt).toBeGreaterThanOrEqual(0);
    expect(milestoneAt, '里程碑必须在词之后').toBeGreaterThan(wordAt);

    // 胜利台词（终局台词）在里程碑之后 —— 里程碑不许盖掉收场白。
    // A conditional assertion can silently pass without any win utterance.
    // End the actual milestone stub utterance, then require the queued win.
    await page.evaluate(()=>window.__speech.end(window.__speech.spoken.length-1));
    await expect.poll(()=>page.evaluate(()=>{
      const ts=window.__speech.texts(),at=ts.indexOf('First Blood');
      return ts.slice(at+1).filter(t=>t!=='litre'&&t!=='First Blood').length;
    }),{timeout:3000}).toBe(1);
    const finalTexts=await page.evaluate(()=>window.__speech.texts());
    expect(finalTexts.findIndex((t,i)=>i>milestoneAt&&t!=='litre'&&t!=='First Blood')).toBeGreaterThan(milestoneAt);
    expect(await page.evaluate(()=>window.__speech.cancels)).toBe(cancelsAtWord);
    // 语音请求里绝不带当前英文单词（学习答案不进播报通道）。
    expect(after.filter(t => t === 'First Blood').length).toBe(1);
    // 待播彻底清干净：不留悬挂的延时代理。
    expect(await page.evaluate(() => window.__gameTest.streakFeedback.pendingCount())).toBe(0);
  });

  test('claiming the reward before speech ends never replays victory on the map',async({game,page})=>{
    await game.open({voice:true,speechStub:true});await game.start();
    await game.fight({word:'litre',enemyHp:5});await typeWord(page);
    await expect(page.locator('#s-pick')).toBeVisible();
    await page.locator('#pPicks .pick').first().click();
    await expect(page.locator('#s-map')).toBeVisible();
    const before=await page.evaluate(()=>window.__speech.texts());
    await page.evaluate(()=>window.__speech.end(window.__speech.spoken.length-1));
    await page.waitForTimeout(650);
    expect(await page.evaluate(()=>window.__speech.texts())).toEqual(before);
    expect(await page.evaluate(()=>window.__gameTest.streakFeedback.pendingCount())).toBe(0);
  });

  test('cancelling speech mid-word frees the channel without a stale callback stealing the next one', async ({ game, page }) => {
    await game.open({ voice: true, speechStub: true });
    await game.start();
    await game.fight({ word: 'litre', enemyHp: 90000 });
    await typeWord(page);
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window.__speech.texts())).not.toContain('First Blood');
    // 玩家自己按下暂停：TTS.stop() 释放占用，但**不补播**。
    await page.locator('#tPause').click();
    await expect(page.locator('#s-pause')).toBeVisible();
    expect(await page.evaluate(() => window.__speech.texts())).not.toContain('First Blood');
    await page.locator('#pzResume').click();
    await expect(page.locator('#s-fight')).toBeVisible();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__speech.texts())).not.toContain('First Blood');
  });
});
