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
      async open({ saved = {}, seed = 0x51a7, noSpeech = false, mutation = process.env.E2E_MUTATION } = {}) {
        if (meta.target === 'legacy') {
          await page.route('**/tests/fixtures/legacy.html*', route => route.fulfill({
            status: 200, contentType: 'text/html; charset=utf-8', body: instrumentLegacy(mutation),
          }));
        } else if (mutation) {
          throw new Error('Mutation runs must target legacy only');
        }
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
              voice: false, mute: true, vol: 0,
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
        await page.locator('#units .unit').filter({ hasText: unit === 0 ? '我的词表' : `Unit ${unit} ` }).click();
        await page.locator('#startRun').click();
        await expect(page.locator('#s-map')).toBeVisible();
      },
      async fight({ word = 'litre', enemyHp = 10_000, boss = false, elite = false } = {}) {
        await page.evaluate(({ word, enemyHp, boss, elite }) => {
          const t = window.__gameTest;
          const entry = t.WORDS.find(x => x.w === word);
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
              won: !!B.won, wordsDone: B.wordsDone, boss: B.boss },
          };
        });
      },
    };
    await use(game);
    expect(errors, 'No uncaught errors in the real browser').toEqual([]);
  },
});

export { expect };
