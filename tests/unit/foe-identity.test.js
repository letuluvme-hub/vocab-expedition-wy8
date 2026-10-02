/* 怪物身份：8 种怪在**规则层面**不再等价（清单「让 8 种怪物真正不同」）。
 *
 * 改这一份之前的事实（已核对 src/app/runtime.js）：
 *   - 敌人血量 = Math.round(perWord * targetWords)，perWord 只由楼层决定；
 *   - src/data/enemies.js 的 base 是**死字段**，全项目零引用；
 *   - 所以 8 种怪只是换了张脸，血量与怪种完全无关。
 *
 * 本文件钉住三件事：
 *   1. 数值层：base 真的进了血量，且对**无 base 的战斗逐字不变**（中性回归）；
 *   2. 结构层：精英/BOSS 不吃怪种倍率（否则会出现「精英比首领强」）；
 *   3. 机制层：怪种机制按**落盘的 foe.n** 解析 —— 快照只存 {n,ic,tint}，
 *      所以刷新之后机制必须还在（这一条是「不改存档格式」的证明）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, advanceRun } from '../../src/domain/run.js';
import { WORDS } from '../../src/data/words.js';
import { ENEMIES, BOSS } from '../../src/data/enemies.js';
import { FOE_HP_SCALE, FOE_TRAITS } from '../../src/data/balance.js';
import { foeHpMult, foeHpMax } from '../../src/domain/foe-stats.js';
import { foeTraits, foeLetterMult, foeFinisherMult } from '../../src/domain/foe-traits.js';
import { hitDmg, wordDmg, WORD_DMG_CAP } from '../../src/domain/damage.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';

/* ---------------- 旧公式：中性回归的**独立**对照口径 ----------------
 * 这一段是从改动前的 runtime.js startFight() 逐字搬过来的（不含怪种倍率），
 * 故意留在测试里当 oracle：foeHpMax 在「没有怪种」时必须和它一模一样。 */
const WORD_RATIO = 4, WORD_COMBO_BOOST = 1.8;
const BOSS_BONUS = 40;
function legacyHpMax({ floor, boss, comboRate }) {
  const hpFloor = boss ? 9 : floor;
  const b = 7 + Math.floor(hpFloor * 0.7);
  const finMult = 1 + 1.45 * comboRate * WORD_COMBO_BOOST;
  const perWord = Math.round(6 * b * 1.45 + b * WORD_RATIO * finMult + hpFloor * 1.5);
  return { perWord, targetWords: boss ? 5 : 4, hpMax: Math.round(perWord * (boss ? 5 : 4)) + (boss ? BOSS_BONUS : 0) };
}

const byName = n => ENEMIES.filter(e => e.n === n)[0];
const COMBO = 0.1;              // 无连击遗物、无英雄加成时 comboRate() 的默认值

/* ---------------- 1. 数据层：base 真的存在、且分层清楚 ---------------- */
test('data: 八种怪有唯一名字和分层清楚的 base', () => {
  assert.equal(ENEMIES.length, 8);
  const names = ENEMIES.map(e => e.n);
  assert.equal(new Set(names).size, 8, '怪名必须唯一：机制按 foe.n 解析');
  for (const e of ENEMIES) {
    assert.equal(typeof e.base, 'number', e.n + ' 缺 base');
    assert.ok(Number.isInteger(e.base) && e.base >= 3 && e.base <= 6, e.n + ' 的 base 超出 3..6');
  }
  assert.deepEqual([...new Set(ENEMIES.map(e => e.base))].sort((a, b) => a - b), [3, 4, 5, 6]);
  assert.equal(BOSS.base, undefined, 'BOSS 没有怪种 base（首领血量走另一套口径）');
});

/* ---------------- 2. 倍率：单调、分层、期望恰为 1 ---------------- */
test('foeHpMult: base 越高越硬，8 种怪的期望倍率恰好是 1（不抬整体难度）', () => {
  assert.ok(FOE_HP_SCALE.min < FOE_HP_SCALE.max);
  // 均值中性：8 种怪等概率抽到，期望倍率必须是 1 —— 否则这次改动就是在偷偷改难度曲线。
  const mean = ENEMIES.reduce((s, e) => s + foeHpMult(e.base), 0) / ENEMIES.length;
  assert.ok(Math.abs(mean - 1) < 1e-9, '8 种怪的平均倍率是 ' + mean + '，必须是 1');
  // 单调：base 每高一层，倍率必须严格更高。
  const rows = [3, 4, 5, 6].map(b => foeHpMult(b));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i] > rows[i - 1], '倍率必须随 base 单调递增');
  for (const m of rows) assert.ok(m >= FOE_HP_SCALE.min && m <= FOE_HP_SCALE.max);
});

test('foeHpMult: 脏值 fail safe —— 认不出来的 base 一律按 1（不制造怪物强度悬崖）', () => {
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, '5', '', {}, []]) {
    assert.equal(foeHpMult(bad), 1, String(bad) + ' 不是合法 base');
  }
  // 是数字但离谱（数据被手改坏）：夹紧到上下限，绝不放大成一场打不赢的战斗，
  // 也不缩成两下就死的软柿子。
  assert.equal(foeHpMult(-9999), FOE_HP_SCALE.min);
  assert.equal(foeHpMult(9999), FOE_HP_SCALE.max);
});

/* ---------------- 3. 中性回归：没有怪种时，血量公式逐字不变 ---------------- */
test('foeHpMax: 无 base 的战斗与改动前逐字相同（BOSS / 精英 / 缺字段）', () => {
  for (let floor = 0; floor <= 12; floor++) {
    for (const comboRate of [0.1, 0.126, 0.21, 0.9]) {
      for (const boss of [false, true]) {
        const want = legacyHpMax({ floor, boss, comboRate });
        for (const base of [undefined, null, NaN, 'x']) {
          assert.deepEqual(
            foeHpMax({ floor, boss, elite: false, comboRate, base }),
            { ...want, hpMult: 1 },
            JSON.stringify([floor, comboRate, boss, base]));
        }
      }
    }
  }
  // 精英与旧版同样是「4 词、无倍率」。
  for (let floor = 0; floor <= 12; floor++) {
    assert.deepEqual(
      foeHpMax({ floor, boss: false, elite: true, comboRate: COMBO, base: 6 }),
      { ...legacyHpMax({ floor, boss: false, comboRate: COMBO }), hpMult: 1 },
      '精英不该吃怪种倍率：floor ' + floor);
  }
});

test('foeHpMax: 同一楼层的 8 种怪血量确实不同（这是本次改动的全部目的）', () => {
  for (const floor of [1, 3, 5, 8, 9]) {
    const hps = ENEMIES.map(e => foeHpMax({ floor, boss: false, elite: false, comboRate: COMBO, base: e.base }).hpMax);
    assert.equal(new Set(hps).size, 4, 'floor ' + floor + ' 的 8 只怪应落在 4 档血量上：' + hps);
    // 强弱顺序必须跟着 base 走：冰封/旋风（6）> 石化/章鱼/蝎（5）> 语素蛛/拼写幽灵（4）> 词灵（3）
    const at = n => hps[ENEMIES.indexOf(byName(n))];
    assert.ok(at('冰封词灵') === at('词形旋风'), '同为 base 6，血量必须相同');
    assert.ok(at('冰封词灵') > at('石化词素'), 'base 6 必须比 base 5 硬');
    assert.ok(at('石化词素') > at('语素蛛'), 'base 5 必须比 base 4 硬');
    assert.ok(at('语素蛛') > at('词灵'), 'base 4 必须比 base 3 硬');
    // 不得跑出夹紧范围。
    const plain = legacyHpMax({ floor, boss: false, comboRate: COMBO }).hpMax;
    for (const h of hps) {
      assert.ok(h <= plain * FOE_HP_SCALE.max + 1 && h >= plain * FOE_HP_SCALE.min - 1,
        'floor ' + floor + ' 的 ' + h + ' 跑出了夹紧范围');
    }
  }
});

/* ---------------- 4. 结构不变式：精英/BOSS 不吃怪种倍率 ---------------- */
test('精英与 BOSS 的血量不随怪种变化，且永远强于同层普通怪（地图 1..9 行）', () => {
  for (let floor = 1; floor <= 9; floor++) {
    const bossHp = foeHpMax({ floor, boss: true, elite: false, comboRate: COMBO, base: 6 }).hpMax;
    const eliteHp = foeHpMax({ floor, boss: false, elite: true, comboRate: COMBO, base: 6 }).hpMax;
    for (const e of ENEMIES) {
      const normalHp = foeHpMax({ floor, boss: false, elite: false, comboRate: COMBO, base: e.base }).hpMax;
      assert.ok(bossHp > normalHp, 'floor ' + floor + '：最强普通怪(' + e.n + ') ' + normalHp + ' 不该高过 BOSS ' + bossHp);
      // 精英不因怪种而变：base 3 与 base 6 的精英血量必须完全相同。
      assert.equal(
        foeHpMax({ floor, boss: false, elite: true, comboRate: COMBO, base: 3 }).hpMax, eliteHp,
        '精英不该因为抽到不同的怪而改变强度');
    }
  }
  // 首领血量本身一个点没动（改前 runtime 的 round(perWord×5)+40）。
  assert.equal(foeHpMax({ floor: 9, boss: true, elite: false, comboRate: COMBO, base: 6 }).hpMax, 1000);
  // 最紧的一处：第 9 层最强普通怪 960 vs 首领 1000 —— 只差 40 血 + 5 词/4 词的口径差。
  // 这条边界交给难度曲线那条线盯（另一个分支），这里只把它钉住不漂。
  assert.equal(foeHpMax({ floor: 9, boss: false, elite: false, comboRate: COMBO, base: 6 }).hpMax, 960);
});

/* ---------------- 5. 机制层：按落盘的 foe.n 解析，未知怪种一律中性 ---------------- */
test('foeTraits: 认名字不认字段 —— 只剩 {n,ic,tint} 也解析得出来', () => {
  const stone = FOE_TRAITS['石化词素'];
  assert.ok(stone, '石化词素应当有机制');
  // 快照 encodeBattle 只写 {n,ic,tint}：这三个字段就足以拿回机制。
  const persisted = { n: '石化词素', ic: '🗿', tint: '#78716c' };
  assert.deepEqual(foeTraits(persisted), stone);
  // 认不出来的怪（BOSS、旧存档、测试桩）一律没有机制。
  for (const foe of [undefined, null, {}, { n: '词汇之王' }, { n: 'slime' }, { n: 'constructor' },
    { n: '__proto__' }, { n: 42 }]) {
    assert.equal(foeTraits(foe), null, JSON.stringify(foe));
  }
  // 每条机制都必须给出正倍率（没有机制的那 7 只怪恒为 1）。
  assert.equal(foeLetterMult({ n: '词灵' }), 1);
  assert.equal(foeFinisherMult({ n: '词灵' }), 1);
  assert.ok(stone.letterMult > 0 && stone.finisherMult > 0);
  assert.ok(foeLetterMult({ n: '石化词素' }) === stone.letterMult);
  assert.ok(foeFinisherMult({ n: '石化词素' }) === stone.finisherMult);
});

test('机制在存档往返之后还在：刷新一次，石化词素照样硬化', () => {
  const run = createRun(1, { id: 'ranger', mod: { hp: 0, gold: 0, hint: 0, noise: 0, combo: 1, regen: 0, leech: 0 } },
    WORDS.filter(w => w.u === 1), (() => { let s = 0x51a7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })());
  run.node = run.rows[0][0];
  run.avail = [];
  advanceRun(run, 1000);
  const word = run.pool[3];
  const letters = word.w.split('');
  const battle = {
    word, letters, used: letters.map(() => false), bad: letters.map(() => false),
    node: run.node, foe: byName('石化词素'), boss: false, elite: false,
    myHp: 41, enHp: 118, enMax: 200, shield: 12, input: [], sel: 0,
    hints: 5, hintUsed: 0, hintTotal: 0, combo: 3, maxCombo: 3, dmgBonus: 0,
    firstWrong: false, lethUsed: 0, wordsDone: 1, over: false, mistaken: [],
    wordStreak: 1, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
    usedThisFight: {}, rewardTaken: false, finished: false,
  };
  const env = { phase: PHASE.BATTLE, savedAt: '2026-10-01T12:00:00.000Z', run, battle, encounter: null };
  const raw = JSON.parse(JSON.stringify(encodeSnapshot(env)));
  assert.deepEqual(Object.keys(raw.battle.foe).sort(), ['ic', 'n', 'tint'], '快照里的 foe 仍然只有这三个字段');
  const back = decodeSnapshot(raw);
  assert.equal(back.ok, true, back.reason);
  // 往返之后：血量原样、怪种机制原样，存档格式一个字节都没动。
  assert.equal(back.value.battle.enMax, 200);
  assert.equal(foeLetterMult(back.value.battle.foe), FOE_TRAITS['石化词素'].letterMult);
  assert.equal(foeFinisherMult(back.value.battle.foe), FOE_TRAITS['石化词素'].finisherMult);
  assert.equal(back.value.battle.foe.base, undefined, 'base 不落盘：机制绝不能依赖它');
});

/* ---------------- 6. 伤害：机制真的接进了伤害公式 ---------------- */
test('石化词素：字母伤害打折、整词大招加成，且永远不越过伤害上限', () => {
  const run = { floor: 6, relics: [] };
  const base = { combo: 4, dmgBonus: 0, rageLeft: 0, freezeWord: false, wordStreak: 1 };
  const plain = { ...base }, stone = { ...base, foe: { n: '石化词素', ic: '🗿', tint: '#78716c' } };
  const trait = FOE_TRAITS['石化词素'];
  assert.equal(hitDmg(run, stone), Math.round(hitDmg(run, plain) * trait.letterMult));
  assert.ok(hitDmg(run, stone) < hitDmg(run, plain));
  assert.ok(wordDmg(run, stone) >= wordDmg(run, plain), '大招应当更强');
  // 上限仍然是既有上限：机制只是倍率，不得绕过夹紧。
  const huge = { floor: 9, relics: ['combo'] };
  const hugeStone = { combo: 1000, dmgBonus: 1000, rageLeft: 1, freezeWord: false, wordStreak: 5, foe: { n: '石化词素' } };
  assert.equal(wordDmg(huge, hugeStone), WORD_DMG_CAP);
  // 没有 foe 字段的老战斗对象不受影响（中性回归）。
  assert.equal(hitDmg(run, plain), hitDmg(run, { ...base, foe: { n: 'slime' } }));
  // 单字母伤害永远压得住：打折不会把伤害打成 0。
  for (let floor = 1; floor <= 20; floor++)
    for (let combo = 0; combo <= 20; combo++)
      assert.ok(hitDmg({ floor, relics: [] }, { ...base, combo, foe: { n: '石化词素' } }) >= 1,
        'floor ' + floor + ' combo ' + combo + ' 的字母伤害塌成 0 了');
});

/* ---------------- 7. UI：机制必须让玩家**看得见**，否则无从「针对性应对」 ---------------- */
const FIGHT_IDS = ['fEn', 'fEnT', 'fMy', 'fMyS', 'fMyT', 'fPc', 'fMyName', 'fAv', 'fName', 'fZh',
  'fCat', 'fTags', 'fSlots', 'fBank', 'tHintN', 'tHint', 'tSkip', 'tFlee', 'fCombo', 'fItems',
  'tBankMode', 'tBankCase', 'tBankModeV', 'tBankCaseV'];

class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.attrs = {}; this.dataset = {}; this.className = '';
    this.hidden = false; this.disabled = false; this.title = ''; this.onclick = null;
    this.offsetWidth = 0; this.clientWidth = 100; this.parentElement = null;
    this._text = ''; this._html = '';
    this.style = { setProperty() {}, getPropertyValue: () => '' };
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

async function renderTags(foe) {
  const reg = new Map(FIGHT_IDS.map(id => [id, new StubEl('div')]));
  const doc = { getElementById: id => (reg.has(id) ? reg.get(id) : null), createElement: t => new StubEl(t) };
  const run = { floor: 3, hp: 60, maxhp: 100, shield: 0, gold: 30, relics: [], hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, bag: {}, unit: 1, heroId: 'a' };
  const battle = {
    word: { w: 'keep', z: '保持', u: 1, d: 1 }, letters: ['k', 'e', 'e', 'p', 'x'],
    used: [false, false, false, false, false], bad: [false, false, false, false, false],
    input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0,
    dmgBonus: 0, firstWrong: true, lethUsed: 0, wordsDone: 0, over: false,
    boss: false, elite: false, myHp: 60, enHp: 200, enMax: 200, shield: 0,
    rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1, usedThisFight: {},
    wordStreak: 0, mistaken: [], foe,
  };
  const prev = globalThis.document;
  globalThis.document = doc;
  try {
    const { createFightScreen } = await import('../../src/ui/screens/fight.js');
    createFightScreen({
      getRun: () => run, getBattle: () => battle, getDB: () => ({ kbMode: false, kbUpper: false }),
      onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {},
    }).renderFight();
  } finally { globalThis.document = prev; }
  return { tags: reg.get('fTags').children.map(c => c.textContent), name: reg.get('fName').textContent };
}

test('UI：有机制的怪把机制写在标签行上；没机制的怪不多占一个标签', async () => {
  const stone = await renderTags(byName('石化词素'));
  const trait = FOE_TRAITS['石化词素'];
  assert.ok(stone.tags.includes(trait.tag), '石化词素必须显出「硬化」：' + stone.tags);
  assert.ok(stone.tags.some(t => /×0\.75/.test(t) && /×1\.5/.test(t)), '必须写清两档倍率：' + stone.tags);
  assert.match(stone.name, /石化词素/);
  // 没有机制的怪：标签行一个都不许多（否则每场战斗都在占玩家的注意力）。
  const plain = await renderTags(byName('词灵'));
  assert.deepEqual(plain.tags, [], '普通怪不该多出机制标签');
  assert.equal(plain.name, '词灵');
});