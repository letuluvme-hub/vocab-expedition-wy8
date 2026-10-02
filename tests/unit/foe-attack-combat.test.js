import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { FOE_ATTACK } from '../../src/data/balance.js';

/* ============================================================
 * 战斗层的两个新契约（清单 13）：
 *  A) enemyHit：自主攻击的伤害路径 —— 护盾 → 生命 → 判负。
 *     它**绝不**复用 hurtPlayer：hurtPlayer 是「答错」的惩罚，
 *     会记错词、把词踢进复习队列、从 mastered 删词、消耗幸运草/首击减半。
 *     自主攻击走那条路径等于凭空把没答错的词判成错词，直接破坏学习主线。
 *  B) pressKey 里「被实际接受的字母尝试」才通知打断；
 *     键盘上不存在/已用/已试过的字母不通知 —— 所以乱按不能维持永远安全。
 * ============================================================ */

function el(extra) {
  return Object.assign({
    id: '', className: '', textContent: '', innerHTML: '', title: '', hidden: false, disabled: false,
    offsetWidth: 10, children: [], onclick: null, dataset: {},
    style: { setProperty() {} }, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }), remove() {},
  }, extra || {});
}

function harness({ maxhp = 60, myHp = 60, shield = 0, freeze = false, lethUsed = 1, firstWrong = true } = {}) {
  const G = { floor: 3, hp: myHp, maxhp, shield: 0, gold: 30, relics: [], hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: {}, att: 0, attOk: 0,
    kills: 0, unit: 1, heroId: 'a', node: { done: false, links: [] }, nextHint: 0 };
  const B = { word: { w: 'keep', z: '保持', u: 1, d: 1 }, letters: ['k', 'e', 'e', 'p', 'x'],
    used: [false, false, false, false, false], bad: [false, false, false, false, false],
    input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0, dmgBonus: 0,
    firstWrong, lethUsed, wordsDone: 0, over: false, boss: false, elite: false,
    myHp, enHp: 200, enMax: 200, shield, rageLeft: 0, freezeWord: freeze, chainNext: false,
    goldMult: 1, usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' } };
  const DB = { mastered: ['keep'], runs: 0, wins: 0, rewards: [] };
  const ids = { fBank: el(), fCombo: el(), fAv: el(), fMy: el(), fItems: el(), fCat: el() };
  const toasts = [], fxCalls = [], lost = [], saved = [];
  let attempts = 0;
  const state = { DB, G, B };
  const ports = {
    $: id => ids[id], norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: () => 0, hasR: () => false,
    itemById: () => undefined, hitDmg: () => 10, wordDmg: () => 40,
    wordComplete: () => state.B.input.length >= 4,
    creditWord: () => {}, onWordWrong: () => {},
    centerOf: () => ({ x: 1, y: 1 }), heroPoint: () => ({ x: 2, y: 2 }),
    toast: m => toasts.push(m),
    sfx: { hit() {}, bad() {}, good() {}, hurt() {}, undo() {}, hint() {}, word() {}, combo() {},
      flee() {}, item() {}, relic() {}, coin() {}, finisher() {}, win() {}, lose() {}, enemy() {} },
    TTS: { line() {}, word() {}, hint() {}, foeLine() {}, stop() {}, supported: false, on: false },
    burst: (...a) => fxCalls.push(['burst', ...a]), floatTxt: (...a) => fxCalls.push(['floatTxt', ...a]),
    flash: () => {}, ring: () => {}, animHero: n => fxCalls.push(['animHero', n]),
    wordFinisher: () => {}, foeCry: () => {},
    renderFight: () => {}, nextWord: () => {}, winFight: () => {}, loseFight: () => lost.push(1),
    finishNode: () => {}, saveDB: () => saved.push(1), scheduleBattle: () => {},
    // 打断通知口：只有这一条会通知战斗层「玩家做了一次有效字母尝试」。
    notifyLetterAttempted: () => { attempts++; return true; },
  };
  const combat = createCombatController({ state, ports });
  return { G, B, DB, combat, toasts, fxCalls, lost, saved,
    get attempts() { return attempts; } };
}

/* ---------------- A) enemyHit：自主攻击的伤害路径 ---------------- */

test('enemyHit：先扣护盾再扣生命，溢出部分才进生命', () => {
  const h = harness({ shield: 3 });
  h.combat.enemyHit(4);
  assert.equal(h.B.shield, 0, '护盾先被吃掉');
  assert.equal(h.B.myHp, 59, '剩余 1 点进生命');
});

test('enemyHit：护盾足够时生命一点不扣', () => {
  const h = harness({ shield: 20 });
  h.combat.enemyHit(4);
  assert.equal(h.B.shield, 16);
  assert.equal(h.B.myHp, 60, '护盾够厚时不该掉血');
});

test('enemyHit：绝不记错词、不删掌握、不动复习队列、不改 ATT 统计', () => {
  const h = harness();
  h.combat.enemyHit(FOE_ATTACK.normal.damage);
  assert.deepEqual(h.DB.mastered, ['keep'], '掌握表一个字都不能少');
  assert.deepEqual(h.G.wrong, [], '复习队列不许凭空多一条');
  assert.deepEqual(h.B.mistaken, []);
  assert.equal(h.G.att, 0, '自主攻击与玩家尝试次数无关');
  assert.equal(h.G.attOk, 0);
  assert.equal(h.B.wordsDone, 0, '怪的攻击绝不算玩家学会了一个词');
});

test('enemyHit：不消耗幸运草、不吃首领首击减半', () => {
  const h = harness({ lethalUsed: 1, firstWrong: true });
  h.B.boss = true;
  h.combat.enemyHit(FOE_ATTACK.boss.damage);
  assert.equal(h.B.lethUsed, 1, '幸运草只对玩家答错生效');
  assert.equal(h.B.firstWrong, true, '首领首击减半是玩家的特权');
  assert.equal(h.B.myHp, 60 - FOE_ATTACK.boss.damage, '伤害按配置足额结算');
});

test('enemyHit：不触发荆棘反弹（反弹属于「答错」路径）', () => {
  const h = harness();
  h.G.relics = ['thorn'];
  const enBefore = h.B.enHp;
  h.combat.enemyHit(4);
  assert.equal(h.B.enHp, enBefore, '被怪打不该让敌人掉血');
});

test('enemyHit：生命归零判负，且只判一次', () => {
  const h = harness({ myHp: 3 });
  h.combat.enemyHit(4);
  assert.ok(h.B.myHp <= 0, '血尽必须真的见底，不能停在 1 血');
  assert.equal(h.lost.length, 1, '血尽必须真的判负（不是把玩家留在 0 血空局）');
});

test('enemyHit：战斗已结算后是 no-op', () => {
  const h = harness();
  h.B.over = true;
  h.combat.enemyHit(4);
  assert.equal(h.B.myHp, 60, '结算之后不得再有任何血量变化');
  assert.equal(h.lost.length, 0);
});

/* ---------------- B) 哪些输入算「有效尝试」 ---------------- */

test('正确字母：既打伤害也通知打断', () => {
  const h = harness();
  h.combat.pressKey(0);                       // k
  assert.equal(h.attempts, 1);
  assert.equal(h.B.input.join(''), 'k');
});

test('错误但可用的字母（不在词里）：通知打断，且原有 12 点惩罚仍生效', () => {
  // lethUsed=0：没有幸运草可用，惩罚才真的落在血上。
  const h = harness({ lethUsed: 0 });
  const hp0 = h.B.myHp;
  h.combat.pressKey(4);                       // x 不在 keep 里
  assert.equal(h.attempts, 1, '错误字母也算一次有效尝试（用户原意是「输入字母」）');
  assert.equal(h.B.myHp, hp0 - 12, '教学惩罚照旧 12 点');
  assert.deepEqual(h.B.mistaken, ['keep'], '错词仍要进复习队列');
});

test('字母在词里但位置不对（soft）：通知打断，6 点惩罚照旧', () => {
  const h = harness({ lethUsed: 0 });
  h.combat.pressKey(3);                       // p 在 keep 里但位置不对（当前要 k）
  assert.equal(h.attempts, 1);
  assert.equal(h.B.myHp, 60 - 6, 'soft 惩罚是 6 点');
  assert.deepEqual(h.B.mistaken, [], 'soft 不记错词（旧语义不变）');
});

test('已试过的错字母（bad）：不通知打断，也不重复扣血', () => {
  const h = harness();
  h.combat.pressKey(4);                       // 第一次：扣 12 并标 bad
  assert.equal(h.attempts, 1);
  const hp = h.B.myHp;
  h.combat.pressKey(4);                       // 再按同一个：只抖动
  assert.equal(h.attempts, 1, '重复已试字母不算有效尝试');
  assert.equal(h.B.myHp, hp, '惩罚只付一次');
});

test('已填入（used）的字母：不通知打断', () => {
  const h = harness();
  h.combat.pressKey(0);
  assert.equal(h.attempts, 1);
  h.combat.pressKey(0);                       // 已 used
  assert.equal(h.attempts, 1);
});

test('越界索引 / 字母盘上不存在的字母：不通知打断', () => {
  const h = harness();
  h.combat.pressKey(99);
  h.combat.pressKey(-1);
  assert.equal(h.attempts, 0);
});

test('typeLetter：字母盘上不存在的字符不当作输入、不通知打断', () => {
  const h = harness();
  assert.equal(h.combat.typeLetter('z'), false, 'z 不在字母盘上');
  assert.equal(h.attempts, 0);
  assert.equal(h.combat.typeLetter('1'), false);
  assert.equal(h.attempts, 0);
});

test('typeLetter：正常输入走同一条路并通知打断', () => {
  const h = harness();
  assert.equal(h.combat.typeLetter('k'), true);
  assert.equal(h.attempts, 1);
  assert.equal(h.B.input.join(''), 'k');
});

test('退格与提示不是字母尝试，不通知打断', () => {
  const h = harness();
  h.combat.pressKey(0);
  assert.equal(h.attempts, 1);
  h.combat.undoLetter();
  h.combat.requestHint();
  assert.equal(h.attempts, 1, '退格与提示不该被算成一次尝试');
});

test('已结算的战斗里不再通知打断', () => {
  const h = harness();
  h.B.over = true;
  h.combat.pressKey(0);
  assert.equal(h.attempts, 0);
});

test('解锁误标字母的那次点击不算有效尝试（它只是把字母放回可选）', () => {
  const h = harness();
  h.B.bad[0] = true;                            // 把必需的 k 误标了
  h.combat.pressKey(0);
  assert.equal(h.B.input.length, 0, '没有输入任何字母');
  assert.equal(h.attempts, 0, '自动解锁不是一次字母尝试');
});