import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const STORAGE_KEY = 'wy8a_rogue_v1';
const legacySource = readFileSync(new URL('../fixtures/legacy.html', import.meta.url), 'utf8');

// Only the HTTP response for the archived page gets this closure bridge.
// No archived or production source is modified, and none of the business logic is mocked.
const legacyProbe = `
if (window.__VOCAB_TEST__) window.__gameTest = {
  get DB() { return DB }, get G() { return G }, get B() { return B },
  get curUnit() { return curUnit }, set curUnit(value) { curUnit = value },
  WORDS, UNITS, HEROES, ITEMS, RELICS,
  newRun, startFight, enterNode, finishNode, advance, endRun,
  renderTitle, renderMap, renderFight, showShop,
  drawLetters, norm, hpBarGeom, wordComplete, pressKey, typeLetter,
  get TTS() { return TTS }, saveDB
};
`;

/* 装一个**记录调用**的 speechSynthesis 平台桩（不合成任何声音）。
 * 它只替代平台能力，游戏自己的 speech.js（含全部优先级闸门）逐字是真的：
 * 测的是「utterance 的调用顺序与 cancel 次数」，**不是**真机可听性。 */
const speechPlatformStub = () => {
  const state = { spoken: [], cancels: 0, current: null,
    end(i) { const rec = this.spoken[i]; if (!rec) return;
      if (rec === this.current) this.current = null;
      if (rec.u.onend) rec.u.onend({ target: rec.u }); },
    fail(i, error) { const rec = this.spoken[i]; if (!rec) return;
      if (rec === this.current) this.current = null;
      if (rec.u.onerror) rec.u.onerror({ target: rec.u, error: error || 'network' }); },
    texts() { return this.spoken.map(s => s.text); } };
  window.__speech = state;
  class UttStub { constructor(text) { this.text = text; this.onstart = null; this.onend = null; this.onerror = null; } }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: UttStub });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    paused: false, pending: false,
    get speaking() { return !!state.current; },
    speak(u) { const rec = { text: u.text, u }; state.current = rec; state.spoken.push(rec);
      setTimeout(() => { if (u.onstart) u.onstart({ target: u }); }, 0); },
    cancel() { state.cancels++; const c = state.current; state.current = null;
      if (c && c.u.onerror) c.u.onerror({ target: c.u, error: 'canceled' }); },
    getVoices: () => [{ lang: 'en-US', name: 'Samantha', localService: true }],
    addEventListener() {},
  } });
};

export function instrumentLegacy(mutation) {
  let source = legacySource;
  if (mutation === 'partial-mastery') {
    const original = 'if(wordComplete() && (!B.elite || B.combo>0)) creditWord(B.word.w);';
    if (!source.includes(original)) throw new Error('Partial-mastery mutation anchor disappeared');
    source = source.replace(original, 'creditWord(B.word.w);');
  } else if (mutation === 'duplicate-mastery') {
    const original = 'if(DB.mastered.indexOf(w)<0){ DB.mastered.push(w); saveDB() }';
    if (!source.includes(original)) throw new Error('Duplicate-mastery mutation anchor disappeared');
    source = source.replace(original, '{ DB.mastered.push(w); saveDB() }');
  } else if (mutation) {
    throw new Error(`Unknown fixture mutation: ${mutation}`);
  }
  const position = source.lastIndexOf('</script>');
  if (position < 0) throw new Error('Archived page has no script');
  return source.slice(0, position) + legacyProbe + source.slice(position);
}

export const test = base.extend({
  game: async ({ page }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const meta = testInfo.project.metadata;
    const game = {
      page, errors,
      async open({ saved = {}, seed = 0x51a7, noSpeech = false, voice = false, speechStub = false, mutation = process.env.E2E_MUTATION } = {}) {
        if (meta.target === 'legacy') {
          await page.route('**/tests/fixtures/legacy.html*', route => route.fulfill({
            status: 200, contentType: 'text/html; charset=utf-8', body: instrumentLegacy(mutation),
          }));
        } else if (mutation) {
          throw new Error('Mutation runs must target legacy only');
        }
        // 朗读开关：默认 false（静音、只走文字通道）。voice:true 时把玩家的
        // 偏好真的设成「开」—— 用来证明低优先级播报在**开着朗读**时也不抢词。
        if (voice || speechStub) saved = Object.assign({}, saved, { voice: true });
        if (speechStub) await page.addInitScript(speechPlatformStub);
        await page.addInitScript(({ saved, seed, noSpeech, key }) => {
          window.__VOCAB_TEST__ = true;
          let state = seed >>> 0;
          Math.random = () => {
            state = (Math.imul(1664525, state) + 1013904223) >>> 0;
            return state / 4294967296;
          };
          // Only seed once: reloading must read the save written by the actual app.
          if (!sessionStorage.getItem('__e2e_seeded')) {
            localStorage.setItem(key, JSON.stringify({
              runs: 0, wins: 0, mastered: [], best: 0, custom: [], ...saved,
              // voice 放在 saved 之后：默认关（静音、只走文字通道），但调用方
              // 显式要求「开着朗读」时必须真的开 —— 否则那条优先级测试是假绿。
              voice: saved.voice === true, mute: true, vol: 0,
            }));
            sessionStorage.setItem('__e2e_seeded', '1');
          }
          // Platform capability downgrade, not a stub for game logic.
          if (noSpeech) {
            Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
            Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined });
          }
        }, { saved, seed, noSpeech, key: STORAGE_KEY });
        const target = meta.target === 'legacy' ? `${meta.basePath}tests/fixtures/legacy.html` : meta.basePath;
        await page.goto(target);
        await expect(page.locator('#s-title')).toBeVisible();
        await expect.poll(() => page.evaluate(() => !!window.__gameTest)).toBe(true);
      },
      async start(unit = 1) {
        // 新版按钮带 data-unit：按文本 'Unit 2 ' 定位会同时命中「完成 Unit 2 …后解锁」
        // 这类锁说明文案（strict mode 直接报多元素）。legacy 存档页没有这个属性，
        // 那里才退回原来的文本定位。
        const byData = meta.target === 'legacy'
          ? page.locator('#units .unit[data-unit]')
          : page.locator('#units .unit[data-unit="' + unit + '"]');
        const btn = (await byData.count()) > 0
          ? byData.first()
          : page.locator('#units .unit').filter({ hasText: unit === 0 ? '我的词表' : `Unit ${unit} ` });
        await btn.click();
        await page.locator('#startRun').click();
        await expect(page.locator('#s-map')).toBeVisible();
      },
      async fight({ word = 'litre', enemyHp = 10_000, boss = false, elite = false } = {}) {
        await page.evaluate(({ word, enemyHp, boss, elite }) => {
          const t = window.__gameTest;
          // ★ 必须取**本局词池里那一条**（带 u/d/th 的完整形状），不能直接用
          //   DB.custom 的 {w,z} 裸条目 —— 那样 B.word 缺 u/d，快照编解码会
          //   fail closed 判 invalid（自定义单元的暂停/保存因此整条失效）。
          //   真实战斗里的词永远来自 run.pool，所以这里也必须来自 run.pool。
          const entry = (t.G.pool || []).find(x => x.w === word)
            || t.WORDS.find(x => x.w === word);
          if (!entry) throw new Error(`Scenario must use a real vocabulary entry: ${word}`);
          const node = boss ? t.G.rows.at(-1)[0] : t.G.avail.find(n => n.type === 'battle') || t.G.avail[0];
          if (boss) { t.G.floor = 9; t.G.maxFloor = 9; }
          if (elite) node.type = 'elite';
          else if (!boss) node.type = 'battle';
          t.enterNode(node);
          t.B.word = entry;
          const letters = t.drawLetters(entry);
          Object.assign(t.B, {
            letters: letters.letters, used: letters.used, bad: letters.letters.map(() => false),
            input: [], enHp: enemyHp, enMax: enemyHp, combo: 0,
          });
          // 选词出招：场景指定了出招词，候选就只剩它一个（与真实「词池只剩一个词」同形）。
          // 否则候选条里是开场抽到的另外几个词，快照也会因「当前词不在候选里」fail closed。
          if ('offer' in t.B) t.B.offer = [entry];
          t.renderFight();
        }, { word, enemyHp, boss, elite });
        await expect(page.locator('#s-fight')).toBeVisible();
      },
      async clickLetter(letter) {
        await page.locator('#fBank .key:not(.out):not(.gone)').filter({ hasText: new RegExp(`^${letter}$`, 'i') }).first().click();
      },
      async state() {
        return page.evaluate(() => {
          const { DB, G, B } = window.__gameTest;
          return {
            DB,
            G: G && { unit: G.unit, hp: G.hp, maxhp: G.maxhp, shield: G.shield, gold: G.gold,
              floor: G.floor, kills: G.kills, att: G.att, attOk: G.attOk, heroId: G.heroId,
              done: [...G.done], wrong: G.wrong, bag: G.bag, relics: G.relics,
              // 影分身额度是 run 级字段：E2E 必须能直接读到它，证明跨战斗不重置
              ghostUsed: G.ghostUsed,
              shopHints: G.shopHints || 0 },
            B: B && { word: B.word.w, input: B.input, used: B.used, bad: B.bad, myHp: B.myHp,
              enHp: B.enHp, shield: B.shield, combo: B.combo, over: B.over,
              won: !!B.won, wordsDone: B.wordsDone, boss: B.boss,
              // 暂停恢复要逐位对照字母盘与提示次数，所以这两项也读出来。
              letters: B.letters, hints: B.hints, rewardTaken: !!B.rewardTaken },
          };
        });
      },
      // 存档原文：断言「快照与学习记录确实是同一次写入的内容」。
      async saved() {
        return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), STORAGE_KEY);
      },
      async writeSaved(db) {
        await page.evaluate(({ key, db }) => localStorage.setItem(key, JSON.stringify(db)),
          { key: STORAGE_KEY, db });
      },
      // 真正的刷新：读回同一台设备上由应用自己写下的存档。
      async reload() {
        await page.reload();
        await expect(page.locator('#s-title')).toBeVisible();
        await expect.poll(() => page.evaluate(() => !!window.__gameTest)).toBe(true);
      },
    };
    await use(game);
    expect(errors, 'No uncaught errors in the real browser').toEqual([]);
  },
});

export { expect };

// Exercise the native folded home entry before existing practice/collection flows.
export async function openPracticePanel(page) {
  const entry = page.locator('#dailyEntry');
  if (!await entry.evaluate(node => node.open)) await entry.locator(':scope > summary').click();
}
