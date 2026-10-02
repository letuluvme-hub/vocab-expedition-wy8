import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { wordDmg, wordDmgCap, WORD_DMG_CAP, WORD_RATIO, WORD_COMBO_BOOST }
  from '../../src/domain/damage.js';

/* 难度曲线的天花板（opt/1-difficulty-curve）。
 *
 * 旧设计：整词伤害被一个**常数**上限 WORD_DMG_CAP=560 夹住，而敌人血量按
 * `base = 7 + floor(floor*0.7)` 线性增长、没有上限。于是从 floor 40 起玩家伤害
 * 被钉死、血量继续涨，「打空一个敌人需要的词数」单调恶化而不是收敛。
 *
 * 新设计：上限本身按 base 增长（domain/damage.js 的 wordDmgCap），浅层仍然逐位
 * 等于旧的 560（floor 1-9 的手感一个字节都不变），深层与血量同步增长。
 *
 * 本文件锁三件事：
 *   1) floor 1-9 与归档原版（tests/fixtures/legacy.html）逐位一致；
 *   2) 深层伤害不再有天花板：wordDmg 随 base 等比增长；
 *   3) 「打空一个敌人需要的词数」在深层收敛，而不是无限恶化。
 */

/* 归档原版：只取常量与函数声明，从不执行整个 HTML（那里面有 DOM / 计时器 /
 * 音频 / 存储副作用）。与 domain.test.js 用的是同一份 fixtures/legacy.html。 */
const legacySource = readFileSync(new URL('../fixtures/legacy.html', import.meta.url), 'utf8');
function originalConst(name) {
  const match = legacySource.match(new RegExp(`^const ${name}\\s*=.*?;`, 'm'));
  assert.ok(match, `legacy constant ${name} exists`);
  return match[0];
}
function originalFunction(name) {
  const match = legacySource.match(new RegExp(`^function ${name}\\([^]*?^\\}`, 'm'));
  assert.ok(match, `legacy function ${name} exists`);
  return match[0];
}
const legacyState = { G: null, B: null };
const legacyDamage = vm.runInNewContext(
  `${['clamp', 'has', 'hasR', 'comboRate', 'WORD_RATIO', 'WORD_COMBO_BOOST', 'WORD_MIN_RATIO',
    'WORD_DMG_CAP', 'FIN_TIER_MAX'].map(originalConst).join('\n')}
${['hitDmg', 'finTier', 'wordDmg'].map(originalFunction).join('\n')}
({wordDmg})`, legacyState);

function legacyWordDmg(run, battle) {
  legacyState.G = run;
  legacyState.B = battle;
  return legacyDamage.wordDmg();
}

// 参考构筑：连击 10、无增伤道具、连击词条满档（finTier 1.48）。
// 这正是「满配单词伤害」实测数字的来源：floor 1 → 116，floor 9 → 215，
// floor 25 → 398，floor 40 → 580（未封顶），floor 100 → 1276（未封顶）。
const FULL_KIT = Object.freeze({ combo: 10, dmgBonus: 0, rageLeft: 0, freezeWord: false, wordStreak: 5 });
const fullKitRun = (floor, relics = []) => ({ floor, hcombo: 1, relics });

// runtime.js startFight 里的血量公式（普通怪 targetWords=4）。这里复制一份只是
// 为了把「需要几个词」这个指标算出来；改动那边时这张表会响，不要偷偷漂移。
function enemyHpFor(floor) {
  const avgLen = 6;
  const base = 7 + Math.floor(floor * 0.7);
  const finMult = 1 + 1.45 * 0.1 * WORD_COMBO_BOOST;   // comboRate() 走的是无遗物的 hcombo=1 分支
  const perWord = Math.round(avgLen * base * 1.45 + base * WORD_RATIO * finMult + floor * 1.5);
  return Math.round(perWord * 4);
}
const wordsToKill = floor => enemyHpFor(floor) / wordDmg(fullKitRun(floor), FULL_KIT);

// 敌人血量的已知值（与实跑一致），防止上面那份镜像公式悄悄漂移。
const ENEMY_HP = { 1: 392, 9: 768, 25: 1468, 40: 2164, 100: 4832, 400: 18180 };

test('wordDmgCap keeps the legacy 560 ceiling for floors 1-9 and only then grows', () => {
  for (let floor = 1; floor <= 9; floor++) {
    const base = 7 + Math.floor(floor * 0.7);
    assert.equal(wordDmgCap(base), WORD_DMG_CAP, `floor ${floor} must stay on the legacy ceiling`);
  }
  assert.ok(wordDmgCap(7 + Math.floor(10 * 0.7)) > WORD_DMG_CAP, 'floor 10 is where the ceiling starts moving');
  // 上限永远不低于旧常数：这是一次纯放宽，任何浅层构筑都不会被削弱。
  for (const base of [0, 1, 7, 13, 20, 35, 49, 77, 287, 1e6, -5, NaN]) {
    const cap = wordDmgCap(base);
    assert.ok(Number.isNaN(cap) || cap >= WORD_DMG_CAP, `base ${base} -> cap ${cap}`);
  }
  // 单调不减：上限不能随深度回落，否则深处又会被旧常数掐住。
  let previous = -Infinity;
  for (let base = 0; base <= 5000; base++) {
    const cap = wordDmgCap(base);
    assert.ok(cap >= previous, `cap dropped at base ${base}`);
    previous = cap;
  }
  assert.equal(wordDmgCap(35), Math.round(35 * WORD_DMG_CAP / 13));
});

test('floors 1-9 are byte-identical to the archived original for every build', () => {
  let count = 0;
  for (const floor of [-10, 0, 1, 1.4, 2, 5, 8, 9]) {
    for (const relics of [[], ['combo'], ['combo', 'focus']]) {
      for (const hcombo of [undefined, 0.9, 1, 1.5]) {
        const run = { floor, hcombo, relics };
        for (const combo of [0, 1, 10, 1000]) {
          for (const dmgBonus of [-150, -50, 0, 25, 1000]) {
            for (const rageLeft of [0, 1]) {
              for (const freezeWord of [false, true]) {
                for (const wordStreak of [0, 1, 2, 4, 5, 6]) {
                  const battle = { combo, dmgBonus, rageLeft, freezeWord, wordStreak };
                  assert.equal(wordDmg(run, battle), legacyWordDmg(run, battle),
                    JSON.stringify([floor, relics, hcombo, battle]));
                  count++;
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(count > 1000, `shallow parity matrix ran ${count} cases`);
});

test('deep floors no longer clip: word damage scales with base instead of stopping at 560', () => {
  // 修复前的实测：floor 40/60/100 的原始伤害 580/812/1276 全部被夹到 560。
  assert.equal(wordDmg(fullKitRun(40), FULL_KIT), 580);
  assert.equal(wordDmg(fullKitRun(60), FULL_KIT), 812);
  assert.equal(wordDmg(fullKitRun(100), FULL_KIT), 1276);
  assert.equal(wordDmg(fullKitRun(400), FULL_KIT), 4757);

  // 核心判据：伤害按 base 等比增长（误差只有取整），所以永远追得上同样按 base
  // 增长的敌人血量。旧设计在 floor 40 之后这条比值是一条平线（560）。
  for (let floor = 10; floor <= 400; floor++) {
    const base = 7 + Math.floor(floor * 0.7);
    const perBase = wordDmg(fullKitRun(floor), FULL_KIT) / base;
    assert.ok(perBase > 16.4 && perBase < 16.8, `floor ${floor}: ${perBase.toFixed(3)} per base`);
  }
  assert.ok(wordDmg(fullKitRun(400), FULL_KIT) > wordDmg(fullKitRun(40), FULL_KIT) * 8);
});

test('the cap still bounds runaway builds — it just scales now', () => {
  const absurd = { combo: 1000, dmgBonus: 1000, rageLeft: 1, freezeWord: false, wordStreak: 5 };
  for (const floor of [1, 9, 10, 40, 100, 400]) {
    const run = { floor, hcombo: 1, relics: ['combo'] };
    const base = 7 + Math.floor(floor * 0.7);
    assert.equal(wordDmg(run, absurd), wordDmgCap(base), `floor ${floor}`);
    assert.ok(wordDmg(run, absurd) >= WORD_DMG_CAP);
  }
  assert.equal(wordDmg({ floor: 9, relics: ['combo'] }, absurd), WORD_DMG_CAP);
});

test('words to kill converges at depth instead of diverging', () => {
  for (const [floor, hp] of Object.entries(ENEMY_HP)) {
    assert.equal(enemyHpFor(Number(floor)), hp, `enemy HP at floor ${floor}`);
  }
  // 修复前：floor 40 → 3.9 词，floor 100 → 8.6 词，floor 400 → 31.7 词。
  // 修复后：深层稳在 3.7-3.9（保守构筑）/ 2.3 词（拿到连击徽章的真实构筑）。
  const deep = [40, 60, 100, 150, 200, 300, 400].map(wordsToKill);
  assert.ok(Math.max(...deep) - Math.min(...deep) < 0.2, `spread ${JSON.stringify(deep)}`);
  assert.ok(Math.max(...deep) < 4, `deepest words ${Math.max(...deep)}`);
  assert.deepEqual(deep.map(n => Number(n.toFixed(2))), [3.73, 3.76, 3.79, 3.8, 3.81, 3.82, 3.82]);

  // 血量本身没有被压低（那属于清单 10 的范围，本次没碰）：敌人还在变强。
  assert.ok(enemyHpFor(400) > enemyHpFor(1) * 40);
  // 拿到连击徽章的构筑落在建议的 2-3 词区间。
  const geared = [40, 100, 200, 400].map(f => enemyHpFor(f) / wordDmg(fullKitRun(f, ['combo']), FULL_KIT));
  assert.ok(Math.max(...geared) - Math.min(...geared) < 0.1, `geared spread ${JSON.stringify(geared)}`);
  assert.ok(geared.every(n => n >= 2 && n <= 3), JSON.stringify(geared));

  // 浅层手感不变：floor 1-9 的词数与修复前完全一致。
  assert.deepEqual([1, 5, 9].map(wordsToKill).map(n => Number(n.toFixed(2))), [3.38, 3.49, 3.57]);
});