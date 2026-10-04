import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEROES } from '../../src/data/heroes.js';
import { ITEMS } from '../../src/data/items.js';
import { hitDmg, wordDmg } from '../../src/domain/damage.js';
import { estimateWordDamage } from '../../src/domain/word-choice.js';
import { heroStatLines } from '../../src/ui/components/hero.js';

const rules = () => import('../../src/domain/hero-rules.js');
const clean = () => ({ wrong: 0, hint: 0, listen: 0, revealed: 0 });
const run = (heroId, extra = {}) => ({ heroId, floor: 3, maxhp: 70, hregen: 0,
  hleech: 0, hcombo: 1, relics: [], ...extra });
const battle = (extra = {}) => ({ myHp: 30, shield: 0, heroHealed: 0,
  heroShieldGained: 0, wordsDone: 0, autoHint: 0, wordQ: clean(),
  combo: 0, dmgBonus: 0, rageLeft: 0, freezeWord: false, wordStreak: 0, ...extra });

test('six hero starting costs and existing identities stay explicit', () => {
  assert.deepEqual(HEROES.map(h => [h.id, 70 + (h.mod.hp || 0)]), [
    ['scholar', 80], ['warrior', 85], ['scout', 65],
    ['lucky', 65], ['healer', 65], ['ranger', 50], ['berserker',60], ['pyromancer',58], ['assassin',55],
  ]);
  assert.equal(HEROES.find(h => h.id === 'scout').mod.noise, -2);
  assert.equal(HEROES.find(h => h.id === 'healer').mod.regen, 10);
  assert.equal(HEROES.find(h => h.id === 'lucky').mod.combo, 0.9);
  assert.equal(HEROES.find(h => h.id === 'lucky').mod.gold, 15);
});

test('scholar active hint reveals two letters, other heroes one', async () => {
  const { heroHintWidth } = await rules();
  for (const h of HEROES) assert.equal(heroHintWidth(run(h.id)), h.id === 'scholar' ? 2 : 1);
  assert.equal(heroHintWidth({}), 1);
});

test('healer opening grant uses saved regen, converts only overflow, respects shield cap', async () => {
  const { heroOpeningGrant } = await rules();
  const g = Object.freeze(run('healer', { maxhp: 65, hregen: 10 }));
  assert.deepEqual(heroOpeningGrant(g, Object.freeze(battle({ myHp: 50 }))), { heal: 10, shield: 0 });
  assert.deepEqual(heroOpeningGrant(g, battle({ myHp: 63 })), { heal: 2, shield: 4 });
  assert.deepEqual(heroOpeningGrant(g, battle({ myHp: 65, shield: 63 })), { heal: 0, shield: 2 });
  assert.deepEqual(heroOpeningGrant(g, battle({ myHp: 65, shield: 65 })), { heal: 0, shield: 0 });
  assert.deepEqual(heroOpeningGrant(run('healer', { maxhp: 65, hregen: 6 }), battle({ myHp: 50 })), { heal: 6, shield: 0 });
  assert.deepEqual(heroOpeningGrant(run('scholar', { hregen: 6 }), battle({ myHp: 69 })), { heal: 1, shield: 0 });
});

test('warrior earns at most six shield per fight and never exceeds maxhp shield', async () => {
  const { heroWordShield } = await rules();
  const g = Object.freeze(run('warrior', { maxhp: 85 }));
  assert.equal(heroWordShield(g, Object.freeze(battle())), 2);
  assert.equal(heroWordShield(g, battle({ heroShieldGained: 5 })), 1);
  assert.equal(heroWordShield(g, battle({ heroShieldGained: 6 })), 0);
  assert.equal(heroWordShield(g, battle({ shield: 84 })), 1);
  assert.equal(heroWordShield(g, battle({ shield: 85 })), 0);
  assert.equal(heroWordShield(run('scout'), battle()), 0);
});

test('ranger healing requires a new unassisted position and has an eighteen-point fight cap', async () => {
  const { rangerHealAmount } = await rules();
  const g = Object.freeze(run('ranger', { maxhp: 50, hleech: 1 }));
  const b = Object.freeze(battle({ wordQ: Object.freeze(clean()) }));
  assert.equal(rangerHealAmount(g, b, { fresh: true, revealed: false }), 1);
  assert.equal(rangerHealAmount(g, b, { fresh: false, revealed: false }), 0, 'undo/retype cannot earn healing');
  assert.equal(rangerHealAmount(g, b, { fresh: true, revealed: true }), 0);
  assert.equal(rangerHealAmount(g, battle({ heroHealed: 18 }), { fresh: true }), 0);
  assert.equal(rangerHealAmount(g, battle({ myHp: 50 }), { fresh: true }), 0);
  assert.equal(rangerHealAmount({ ...g, hleech: 3 }, battle({ heroHealed: 17 }), { fresh: true }), 1);
  for (const field of ['wrong', 'hint', 'listen']) {
    assert.equal(rangerHealAmount(g, battle({ wordQ: { ...clean(), [field]: 1 } }), { fresh: true }), 0, field);
  }
  assert.equal(rangerHealAmount(g, battle({ wordQ: undefined }), { fresh: true }), 0, 'old missing evidence is not a perfect word');
});

test('automatic first-letter reveal excludes that letter without disqualifying later ranger letters', async () => {
  const { rangerHealAmount } = await rules();
  const g = run('ranger', { maxhp: 50, hleech: 1 });
  const b = battle({ autoHint: 1, wordQ: { ...clean(), hint: 1, revealed: 1 } });
  assert.equal(rangerHealAmount(g, b, { fresh: true, revealed: true }), 0);
  assert.equal(rangerHealAmount(g, b, { fresh: true, revealed: false }), 1);
  b.wordQ.hint++;
  assert.equal(rangerHealAmount(g, b, { fresh: true, revealed: false }), 0, 'subsequent active hint stops healing');
});

test('scout first finisher bonus is only on the first completed word', async () => {
  const { heroFinisherMultiplier } = await rules();
  assert.equal(heroFinisherMultiplier(run('scout'), battle()), 1.5);
  assert.equal(heroFinisherMultiplier(run('scout'), battle({ wordsDone: 1 })), 1);
  assert.equal(heroFinisherMultiplier(run('warrior'), battle()), 1);
  const b = battle({ combo: 6 });
  assert.equal(wordDmg(run('scout'), b), Math.round(wordDmg(run('warrior'), b) * 1.5));
  assert.equal(wordDmg(run('scout'), { ...b, wordsDone: 1 }), wordDmg(run('warrior'), b));
  assert.equal(hitDmg(run('scout'), b), hitDmg(run('warrior'), b), 'first strike affects the finisher only');
});

test('gold bonuses add once; lucky and greed relic stack to seventy percent', async () => {
  const { goldGainAmount } = await rules();
  assert.equal(goldGainAmount(run('warrior'), 100), 100);
  assert.equal(goldGainAmount(run('lucky'), 100), 120);
  assert.equal(goldGainAmount(run('warrior', { relics: ['greed'] }), 100), 150);
  assert.equal(goldGainAmount(run('lucky', { relics: ['greed', 'greed'] }), 100), 170);
  assert.equal(goldGainAmount(run('lucky'), 29), 35);
  assert.equal(goldGainAmount(run('lucky'), -1), 0);
});

test('greed coin bonus is capped even for old triple-gold battles', async () => {
  const { battleGoldBase, goldGainAmount } = await rules();
  assert.equal(battleGoldBase(29, { goldMult: 1.5 }), 44);
  assert.equal(battleGoldBase(231, { goldMult: 1.5 }), 291);
  assert.equal(battleGoldBase(231, { goldMult: 3 }), 291);
  assert.equal(battleGoldBase(29, { goldMult: 1 }), 29);
  assert.equal(battleGoldBase(29, {}), 29);
  assert.equal(goldGainAmount(run('lucky', { relics: ['greed'] }), battleGoldBase(231, { goldMult: 3 })), 495);
});

test('item effects, costs and per-fight limits are an explicit balance table', async () => {
  const { ITEM_BALANCE } = await import('../../src/data/hero-balance.js');
  assert.deepEqual(ITEM_BALANCE, { leechHeal: 8, stoneShield: 16, greedMultiplier: 1.5,
    greedBonusCap: 60, rageMultiplier: 2.5, rageLetters: 3 });
  const byId = id => ITEMS.find(it => it.id === id);
  assert.equal(byId('leech').max, 3);
  assert.equal(byId('greed').max, 1);
  assert.equal(byId('greed').price, 75);
  assert.equal(byId('purge').price, 25);
  assert.equal(byId('stone').max, 2);
});

test('word offers carry scout first-word state and include rage on the last-letter finisher', () => {
  const g = run('scout'), b = battle({ combo: 2, rageLeft: 1 });
  const one = { w: 'a' };
  const estimate = estimateWordDamage(g, b, one);
  const atHit = { ...b, combo: 3 };
  assert.equal(estimate.letters, hitDmg(g, atHit));
  assert.equal(estimate.finisher, wordDmg(g, atHit), 'last charge boosts its finisher before being spent');
  const later = estimateWordDamage(g, { ...b, wordsDone: 1 }, one);
  assert.equal(later.finisher, wordDmg(g, { ...atHit, wordsDone: 1 }));
  assert.ok(estimate.finisher > later.finisher);
  assert.deepEqual(b, battle({ combo: 2, rageLeft: 1 }), 'forecast must not mutate live battle');
});

test('rage on an earlier letter does not spill over to later finisher', () => {
  const g = run('warrior'), b = battle({ rageLeft: 1 });
  const estimate = estimateWordDamage(g, b, { w: 'ab' });
  assert.equal(estimate.letters, hitDmg(g, { ...b, combo: 1 }) + hitDmg(g, { ...b, combo: 2, rageLeft: 0 }));
  assert.equal(estimate.finisher, wordDmg(g, { ...b, combo: 2, rageLeft: 0 }));
});

test('hero stat labels expose identity and the ranger cap without changing artwork', () => {
  const text = id => heroStatLines(HEROES.find(h => h.id === id)).join(' / ');
  assert.match(text('scholar'), /提示揭示 2 字母/);
  assert.match(text('warrior'), /每战最多 6/);
  assert.match(text('scout'), /首词大招 \+50%/);
  assert.match(text('lucky'), /金币收益 \+20%/);
  assert.match(text('healer'), /溢出转盾最多 4/);
  assert.match(text('ranger'), /每战最多 18/);
});
