/* 主页声音设置区（音效 + 单词朗读）的真实浏览器回归。
 *
 * 跑在真实 Chrome 上，并且全部用**真实点击 + 真实刷新**：
 * 这两个开关的价值就在于「刷新后还是我设的样子」，只有真刷新能证明。
 * 归档页面（legacy）里没有这个设置区，所以全部 skip 到 new 项目。 */
import { test, expect } from './game-harness.js';

const newOnly = testInfo => test.skip(testInfo.project.metadata.target === 'legacy',
  'The home audio settings block is a new feature; the archived page cannot do it');

/* ---------------- 1. 设置区在主页，两个开关都看得懂 ---------------- */

/* 存档种子固定是 voice:false, mute:true, vol:0（见 game-harness），
   所以开局音量就在最下面那一档「静音」，两次点击会绕回 55%。 */
const SEEDED_VOL = '静音';

test('the title screen shows one settings block with both controls, in the normal flow', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();

  const box = page.locator('#audioSettings');
  await expect(box).toBeVisible();
  // 玩家看得懂两个开关分别管什么（不是两个孤立的 emoji）
  await expect(box).toContainText('音效');
  await expect(box).toContainText('单词朗读');
  await expect(page.locator('#volBtn')).toBeVisible();
  await expect(page.locator('#voiceBtn')).toBeVisible();
  // 种子是静音档；点一下回到 55%，证明按钮真的在驱动那四档
  await expect(page.locator('#volVal')).toHaveText(SEEDED_VOL);
  await page.locator('#volBtn').click();
  await expect(page.locator('#volVal')).toHaveText('55%');
  await page.locator('#voiceBtn').click();
  await expect(page.locator('#voiceVal')).toHaveText('开启');

  // ★ 不再是浮在页面上的开关：必须留在主页文档流里，position 不能是 fixed
  const placement = await page.evaluate(() => {
    const b = document.getElementById('voiceBtn');
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return {
      position: getComputedStyle(b).position,
      parentScreen: b.closest('.screen') ? b.closest('.screen').id : null,
      onTitle: b.closest('#s-title') !== null,
      inlineStyle: b.getAttribute('style') || '',
      inViewport: r.top >= -1 && r.left >= -1 && r.right <= innerWidth + 1,
      docWidth: document.documentElement.scrollWidth,
      winWidth: innerWidth,
    };
  });
  expect(placement.position, 'voiceBtn 不许再 position:fixed').not.toBe('fixed');
  expect(placement.inlineStyle, '不再允许内联定位样式').toBe('');
  expect(placement.onTitle, '设置区必须属于主页这一层').toBe(true);
  expect(placement.parentScreen).toBe('s-title');
  expect(placement.inViewport).toBe(true);
  expect(placement.docWidth).toBeLessThanOrEqual(placement.winWidth + 1);
});

test('no floating audio switch follows the player into map, fight or reward screens', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();
  await game.start();
  await expect(page.locator('#s-map')).toBeVisible();
  // 地图页不再有第二个语音开关浮在上面
  await expect(page.locator('#voiceBtn')).toBeHidden();
  expect(await page.evaluate(() => document.querySelectorAll('body > button').length),
    '开关不许再被追加到 body 上').toBe(0);

  await game.fight();
  await expect(page.locator('#s-fight')).toBeVisible();
  await expect(page.locator('#voiceBtn')).toBeHidden();
  // 战斗页的「听读音」照旧在
  await expect(page.locator('#tSay')).toBeVisible();
});

/* ---------------- 2. 战斗读音没有因为搬家而消失 ---------------- */

test('the fight listen button still reads the word out and still costs a hint', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();
  // 设置区只在主页：先在这里把单词朗读打开，再进战斗
  await page.locator('#voiceBtn').click();
  expect(await page.evaluate(() => window.__gameTest.TTS.on)).toBe(true);
  await game.start();
  await game.fight({ word: 'litre' });

  const before = await game.state();
  const hints0 = before.B.hints;
  expect(hints0, '本场有提示次数可花').toBeGreaterThan(0);
  await page.locator('#tSay').click();
  const after = await game.state();
  expect(after.B.hints, '听读音消耗一次提示').toBe(hints0 - 1);
  expect(after.B.word, '听读音不揭示任何字母').toBe(before.B.word);
  expect(after.B.input, '听读音不代填字母').toEqual(before.B.input);
});

test('listening in combat re-enables voice and keeps the home setting consistent', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();
  await expect(page.locator('#voiceVal')).toHaveText('已关');
  await game.start();
  await game.fight({ word: 'litre' });
  await page.locator('#tSay').click();
  expect(await page.evaluate(() => window.__gameTest.TTS.on)).toBe(true);
  expect((await game.saved()).voice).toBe(true);
  await page.locator('#tPause').click();
  await page.locator('#pzHome').click();
  await expect(page.locator('#voiceVal')).toHaveText('开启');
  await page.locator('#voiceBtn').click();
  await expect(page.locator('#voiceVal')).toHaveText('已关');
  expect((await game.saved()).voice).toBe(false);
});

/* ---------------- 3. 两种 prefs 各自即时落盘 ---------------- */

test('muting sound and turning voice off are two separate prefs that each hit storage at once', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();                                // 种子：voice=false, mute=true, vol=0
  const seeded = await game.saved();
  expect(seeded.voice).toBe(false);
  expect(seeded.mute).toBe(true);

  // 只动音量，语音开关不许被顺带改掉
  await page.locator('#volBtn').click();
  await expect(page.locator('#volVal')).toHaveText('55%');
  const afterVol = await game.saved();
  expect(afterVol.vol).toBe(0.55);
  expect(afterVol.mute).toBe(false);
  expect(afterVol.voice, '音量与语音互相独立').toBe(false);

  // 只动语音，音量不许被顺带改掉
  await page.locator('#voiceBtn').click();
  expect(await page.evaluate(() => window.__gameTest.TTS.on)).toBe(true);
  const afterVoice = await game.saved();
  expect(afterVoice.voice).toBe(true);
  expect(afterVoice.vol).toBe(0.55);

  // 盘上的值与屏幕上显示的必须是同一份
  await game.reload();
  const reloaded = await game.saved();
  expect(reloaded.voice).toBe(true);
  expect(reloaded.vol).toBe(0.55);
  await expect(page.locator('#volVal')).toHaveText('55%');
  await expect(page.locator('#voiceVal')).toHaveText('开启');
  expect(await page.evaluate(() => window.__gameTest.TTS.on), '刷新后语音仍然开着').toBe(true);
});

test('muting sound to silence persists and keeps the word-audio pref untouched', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();
  await page.locator('#voiceBtn').click();          // 语音开
  await page.locator('#volBtn').click();             // 静音 → 55%
  // 完整走一遍那四档：55% → 30% → 12% → 静音
  const ladder = ['30%', '12%', '静音'];
  for (const step of ladder) {
    await page.locator('#volBtn').click();
    await expect(page.locator('#volVal')).toHaveText(step);
  }
  await expect(page.locator('#volBtn')).toHaveText('🔇');
  const muted = await game.saved();
  expect(muted.mute).toBe(true);
  expect(muted.voice, '静音音效不等于关掉单词朗读').toBe(true);

  await game.reload();
  await expect(page.locator('#volVal')).toHaveText('静音');
  await expect(page.locator('#voiceVal')).toHaveText('开启');
  expect((await game.saved()).voice).toBe(true);
});

/* ---------------- 4. 开着远征时切语音，不许把快照弄丢 ----------------
 * 旧实现里语音开关浮在 window 上，所以任何界面都能点。
 * 现在它只住在主页 —— 玩家从暂停屏「返回主页」（保留远征）再切，
 * 存档里 activeRun 必须原样还在。这条断言的是行为，不是按钮的位置。 */

test('toggling voice from the home page keeps the running expedition snapshot intact', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open();
  await page.locator('#voiceBtn').click();          // 先开语音，制造一个非默认 pref
  await game.start();
  await page.evaluate(() => { window.__gameTest.G.gold = 77; });
  await page.locator('#mPause').click();
  await expect(page.locator('#s-pause')).toBeVisible();
  await page.locator('#pzHome').click();             // 返回主页，远征保留
  await expect(page.locator('#s-title')).toBeVisible();
  await expect(page.locator('#continueRow')).toBeVisible();

  await page.locator('#voiceBtn').click();          // 在主页把它关掉
  expect(await page.evaluate(() => window.__gameTest.TTS.on)).toBe(false);
  const saved = await game.saved();
  expect(saved.voice).toBe(false, '语音开关必须当场落盘');
  expect(saved.activeRun, '开着远征时切语音不能把快照弄丢').toBeTruthy();
  expect(saved.activeRun.phase).toBe('map');
  expect(saved.activeRun.run.gold, '快照内容一字未改').toBe(77);
});

/* ---------------- 5. 窄屏可见、不遮 HUD ---------------- */

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`the settings block stays reachable and non-overlapping at ${viewport.width}px`, async ({ game, page }, testInfo) => {
    newOnly(testInfo);
    await page.setViewportSize(viewport);
    await game.open();
    for (const id of ['#audioSettings', '#volBtn', '#voiceBtn', '#startRun']) {
      const box = await page.locator(id).boundingBox();
      expect(box, `${id} renders`).not.toBeNull();
      expect(box.x, `${id} left edge`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${id} right edge`).toBeLessThanOrEqual(viewport.width + 1);
    }
    // 语音开关点得到：中心点命中它自己或它的子元素
    const hits = await page.locator('#voiceBtn').evaluate(el => {
      const r = el.getBoundingClientRect();
      el.scrollIntoView({ block: 'center' });
      const r2 = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2);
      return el === hit || el.contains(hit);
    });
    expect(hits, '语音开关可点，不被别的层盖住').toBe(true);

    // 进战斗后：设置区整层隐藏，HUD 与字母盘一个都不许被遮
    await game.start();
    await expect(page.locator('#voiceBtn')).toBeHidden();
    await game.fight({ word: 'living conditions' });
    for (const id of ['#fBank', '#tSay', '#tHint', '#fMy', '#fEn']) {
      const box = await page.locator(id).boundingBox();
      expect(box, `${id} still visible in the fight`).not.toBeNull();
      expect(box.x + box.width, `${id} right edge`).toBeLessThanOrEqual(viewport.width + 1);
    }
    const audioBox = await page.locator('#audioSettings').boundingBox();
    expect(audioBox, '设置区在战斗页整块不渲染，因此没有盒子').toBeNull();
    // 隐藏是「那一层 .screen 不在文档流」造成的，不是内联 display 切出来的
    expect(await page.evaluate(() => {
      const b = document.getElementById('voiceBtn');
      return { inline: b.getAttribute('style') || '', screenOn: b.closest('.screen').classList.contains('on') };
    })).toEqual({ inline: '', screenOn: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth),
      '没有横向溢出').toBeLessThanOrEqual(viewport.width + 1);
  });
}

/* ---------------- 5. 平台没有语音：禁用但不影响游戏 ---------------- */

test('without browser speech the voice row is disabled, explained, and the game still runs', async ({ game, page }, testInfo) => {
  newOnly(testInfo);
  await game.open({ noSpeech: true });
  const voice = page.locator('#voiceBtn');
  await expect(voice).toBeDisabled();
  await expect(page.locator('#voiceVal')).toHaveText('不可用');
  await expect(page.locator('#audioNote')).toContainText('不支持语音朗读');
  // 音效那一路照常可用
  await expect(page.locator('#volBtn')).toBeEnabled();
  await page.locator('#volBtn').click();
  expect((await game.saved()).vol).toBe(0.55);

  await game.start();
  await expect(page.locator('#s-map')).toBeVisible();
  await game.fight({ word: 'litre' });
  await game.clickLetter('l');                     // 点一个真字母（不是干扰字母）
  expect((await game.state()).B.input, '缺语音时字母盘照常能玩').toEqual(['l']);
});
