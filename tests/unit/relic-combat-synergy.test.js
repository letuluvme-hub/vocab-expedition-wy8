/* 组合技与传说遗物在**战斗里的真实效果**。
 *
 * 这里不看文案，只看状态迁移：
 *  - 荆棘壁垒：反弹伤害提高，且把一部分反弹伤害转成护盾；
 *  - 连击共鸣：答错保留的连击必须**变成伤害**，否则它只是 focus 的复读；
 *  - 预知残卷（传说）：答错 → 全词揭示，代价是吃掉一点提示额度；没有额度就完全不触发；
 *  - 透视之眼：揭示类道具必须有代价，否则它永远优于按提示键。
 *
 * 另外逐条确认「没凑齐组合就完全是旧行为」—— 这是并行的真相：
 * 组合技不许偷偷改写单件遗物的数值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { RELIC_SYNERGY } from '../../src/data/balance.js';
import { ITEMS } from '../../src/data/items.js';

function el(extra) {
  return Object.assign({
    id: '', className: '', textContent: '', innerHTML: '', title: '', hidden: false, disabled: false,
    offsetWidth: 10, children: [], onclick: null, dataset: {},
    style: { setProperty() {} }, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
    remove() {},
  }, extra || {});
}

const ITEMS_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));

function harness({ relics = [], hints = 3, combo = 0, shield = 0, myHp = 60, maxhp = 60, freeze = false } = {}) {
  const G = {
    floor: 3, hp: myHp, maxhp, shield: 0, gold: 30, relics: relics.slice(), hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: {}, att: 0, attOk: 0,
    kills: 0, unit: 1, heroId: 'a', node: { done: false, links: [] }, nextHint: 0,
  };
  const B = {
    word: { w: 'keep', z: '保持', u: 1, d: 1 }, letters: ['k', 'e', 'e', 'p', 'x'],
    used: [false, false, false, false, false], bad: [false, false, false, false, false],
    input: [], sel: 0, hints, hintUsed: 0, hintTotal: 0, combo, maxCombo: combo, dmgBonus: 0,
    firstWrong: false, lethUsed: 0, wordsDone: 0, over: false, boss: false, elite: false,
    myHp, enHp: 200, enMax: 200, shield, rageLeft: 0, freezeWord: freeze, chainNext: false,
    goldMult: 1, usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' },
  };
  const DB = { mastered: [], runs: 0, wins: 0, rewards: [] };
  const ids = { fBank: el(), fCombo: el(), fAv: el(), fMy: el(), fItems: el(), fCat: el() };
  const toasts = [];
  const state = { DB, G, B };
  const combat = createCombatController({
    state,
    ports: {
      $: id => ids[id], norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: () => 0,
      hasR: id => G.relics.indexOf(id) >= 0,
      itemById: id => ITEMS_BY_ID[id],
      hitDmg: () => 10, wordDmg: () => 40,
      wordComplete: () => state.B.input.length >= 4,
      creditWord: () => {}, onWordWrong: () => {},
      centerOf: () => ({ x: 1, y: 1 }), heroPoint: () => ({ x: 2, y: 2 }),
      toast: m => toasts.push(String(m)),
      sfx: new Proxy({}, { get: () => () => {} }),
      TTS: { line() {}, word() {}, hint() {}, foeLine() {}, stop() {}, supported: false, on: false },
      burst() {}, floatTxt() {}, flash() {}, ring() {}, animHero() {}, wordFinisher() {}, foeCry() {},
      renderFight() {}, nextWord() {}, winFight() {}, loseFight() {}, finishNode() {},
      saveDB() {}, scheduleBattle() {}, notifyLetterAttempted: () => true,
    },
  });
  return { G, B, DB, combat, toasts, ids };
}
/* 字母盘第 5 个是 'x'，不在 keep 里 —— 一次干净的真实答错。 */
const WRONG = 4;

/* ---------------- 荆棘壁垒（shield + thorn） ---------------- */

test('只有荆棘护符：反弹伤害维持原样（组合技不许偷改单件数值）', () => {
  const h = harness({ relics: ['thorn'], myHp: 60 });
  const before = h.B.enHp;
  h.combat.pressKey(WRONG);
  assert.equal(before - h.B.enHp, 5, '没凑齐组合时反弹必须是老的 5 点');
  assert.equal(h.B.shield, 0, '单件荆棘不产生护盾');
});

test('护盾符文 + 荆棘护符：反弹提高到 8，并把 4 点转成护盾', () => {
  const h = harness({ relics: ['shield', 'thorn'], myHp: 60 });
  const before = h.B.enHp;
  h.combat.pressKey(WRONG);
  assert.equal(before - h.B.enHp, RELIC_SYNERGY.thornReflect, '反弹伤害应提高到组合技数值');
  assert.equal(h.B.shield, RELIC_SYNERGY.thornShield, '反弹的一部分必须变成护盾');
});

test('荆棘壁垒的反弹照样打不死敌人 —— 组合技不许绕过「必须拼完整个词」', () => {
  const h = harness({ relics: ['shield', 'thorn'], myHp: 60 });
  h.B.enHp = 3;                                  // 敌人只差一口气
  h.combat.pressKey(WRONG);
  assert.equal(h.B.enHp, 1, '非完整词伤害永远钉在 1 血地板');
  assert.equal(h.B.over, false, '半路绝不能判胜');
});

/* ---------------- 连击共鸣（combo + focus） ---------------- */

test('只有专注头环：连击保留一半，但保留的连击不会变成伤害', () => {
  const h = harness({ relics: ['focus'], combo: 7 });
  h.combat.pressKey(WRONG);
  assert.equal(h.B.combo, 3, '专注头环照旧保留一半');
  assert.equal(h.B.dmgBonus, 0, '没有徽章就没有共鸣，保留的连击不额外加伤');
});

test('连击徽章 + 专注头环：保留的连击按点数转成本场伤害加成', () => {
  const h = harness({ relics: ['combo', 'focus'], combo: 7 });
  h.combat.pressKey(WRONG);
  assert.equal(h.B.combo, 3);
  assert.equal(h.B.dmgBonus, 3 * RELIC_SYNERGY.resonancePerCombo,
    '保留 3 点连击就应当换 3 档永久增伤');
});

test('连击为 0 时共鸣不凭空加伤', () => {
  const h = harness({ relics: ['combo', 'focus'], combo: 1 });
  h.combat.pressKey(WRONG);
  assert.equal(h.B.combo, 0);
  assert.equal(h.B.dmgBonus, 0, '保留 0 点连击不该有增伤');
});

/* ---------------- 预知残卷（传说） ---------------- */

test('预知残卷：答错时揭示整词剩余字母，并扣 1 点提示额度', () => {
  const h = harness({ relics: ['prophecy'], hints: 3 });
  h.combat.pressKey(0);                       // 先正确填 k
  assert.equal(h.B.input.join(''), 'k');
  h.combat.pressKey(WRONG);                   // 再答错
  assert.equal(h.B.hints, 2, '揭示必须付出提示额度');
  assert.equal(h.B.hintTotal, 1);
  assert.equal(h.B.hintUsed, 3, 'keep 剩 3 个字母，一次全揭示');
});

test('预知残卷：提示额度用尽后彻底失效，绝不白揭示', () => {
  const h = harness({ relics: ['prophecy'], hints: 0 });
  h.combat.pressKey(WRONG);
  assert.equal(h.B.hintUsed, 0, '没有额度就不许揭示');
  assert.equal(h.B.hintTotal, 0);
});

test('预知残卷：揭示会顺便解开被误标的字母，不会把玩家锁死', () => {
  const h = harness({ relics: ['prophecy'], hints: 2 });
  h.B.bad[1] = true;                          // 手滑把要用的 e 标成了错
  h.combat.pressKey(WRONG);
  assert.equal(h.B.bad[1], false, '揭示必须顺带解封，否则玩家可能永远填不完这个词');
});

test('没有预知残卷时，答错绝不改变提示状态', () => {
  const h = harness({ relics: [], hints: 3 });
  h.combat.pressKey(WRONG);
  assert.equal(h.B.hints, 3);
  assert.equal(h.B.hintTotal, 0);
  assert.equal(h.B.hintUsed, 0);
});

/* ---------------- 透视之眼：揭示类道具必须有代价 ---------------- */

test('透视之眼揭示 2 个字母，但消耗 1 点提示额度', () => {
  const h = harness({ relics: [], hints: 3 });
  h.G.bag.reveal = 1;
  h.combat.useItem('reveal');
  assert.equal(h.B.hintUsed, 2, '仍然揭示 2 个字母');
  assert.equal(h.B.hints, 2, '但要付 1 点提示额度');
  assert.equal(h.G.bag.reveal, 0);
});

test('提示额度为 0 时透视之眼照样揭示（道具效果不取消），但额度不会变负', () => {
  const h = harness({ relics: [], hints: 0 });
  h.G.bag.reveal = 1;
  h.combat.useItem('reveal');
  assert.equal(h.B.hintUsed, 2);
  assert.equal(h.B.hints, 0, '额度绝不能被扣成负数');
});

test('透视之眼的文案必须说明这个代价', () => {
  const reveal = ITEMS.filter(i => i.id === 'reveal')[0];
  assert.match(reveal.d + reveal.tip, /提示/, '揭示类道具的代价必须写在文案里，否则玩家会以为白赚');
  assert.ok(!/不消耗提示/.test(reveal.d), '旧文案「不消耗提示次数」已经与新行为矛盾');
});

/* ---------------- 并行真相：单件遗物行为不变 ---------------- */

test('持有全部组合成员时，反弹 / 连击 / 揭示三条规则各自独立生效', () => {
  const h = harness({ relics: ['shield', 'thorn', 'combo', 'focus', 'prophecy'], hints: 5, combo: 8 });
  const before = h.B.enHp;
  h.combat.pressKey(WRONG);
  assert.equal(before - h.B.enHp, RELIC_SYNERGY.thornReflect);
  assert.equal(h.B.shield, RELIC_SYNERGY.thornShield);
  assert.equal(h.B.combo, 4);
  assert.equal(h.B.dmgBonus, 4 * RELIC_SYNERGY.resonancePerCombo);
  assert.equal(h.B.hintUsed, 4, 'keep 四个字还没填，剩余 4 个一次全揭示');
  assert.equal(h.B.hints, 4);
});