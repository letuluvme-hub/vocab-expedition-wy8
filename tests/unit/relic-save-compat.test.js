/* 遗物数据加字段（rarity）后的**旧存档兼容**契约。
 *
 * 背景：本次给每件遗物加了 rarity 档位，外加一件新遗物、一组组合技。
 * 这些事实**一个都不许进存档** —— 存档里仍然只有「一串遗物 id」。
 * 这个文件专门守住那条边界：
 *
 *  1) 快照里的 relics 永远是字符串 id 数组，绝不是遗物对象。
 *     一旦有人图省事把 {id, rarity} 塞进存档，旧解码器就会 fail closed，
 *     玩家直接丢一整局 —— 而且要等到他自己回档那天才会发现。
 *  2) **手写的旧版存档**（一个 rarity 都不存在、可能还有已下架的 id）
 *     必须照常解出来，且遗物按 id 原样保留。
 *  3) 稀有度是**读的时候**从当前数据表现查的：老存档里的旧遗物
 *     自动获得它今天的档位，不因为「当时没有 rarity」而降级或丢失。
 *  4) 组合技同样只由 id 推导，因此旧存档里凑齐的两件遗物**立刻**享有组合效果，
 *     不需要玩家重开一局才生效。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, advanceRun } from '../../src/domain/run.js';
import { WORDS } from '../../src/data/words.js';
import { ENEMIES } from '../../src/data/enemies.js';
import { RELICS } from '../../src/data/relics.js';
import { encodeSnapshot, decodeSnapshot, SNAPSHOT_SCHEMA_VERSION, PHASE } from '../../src/domain/run-snapshot.js';
import { relicRarity, relicPrice, hasSynergy, activeSynergies } from '../../src/domain/relic-rules.js';
import { RELIC_RARITY } from '../../src/data/balance.js';

const HERO = { id: 'ranger', mod: { hp: -8, gold: 15, hint: 1, noise: -1, combo: 1.05, regen: 0, leech: 1 } };
const UNIT1 = WORDS.filter(w => w.u === 1);

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 4294967296; };
}
function seededRun(over = {}) {
  const run = createRun(1, HERO, UNIT1, mulberry(0x51a7));
  run.node = run.rows[0][0];
  run.avail = [];
  advanceRun(run, 1000);
  return Object.assign(run, over);
}
function battleFor(run, over = {}) {
  const word = UNIT1[3];
  const letters = word.w.split('');
  return {
    word, letters, used: letters.map((_, i) => i < 2), bad: letters.map((_, i) => i === 3),
    node: run.node, foe: ENEMIES[1], boss: false, elite: false,
    myHp: 41, enHp: 118, enMax: 200, shield: 12,
    input: letters.slice(0, 2), sel: 4, hints: 5, hintUsed: 2, hintTotal: 3,
    combo: 7, maxCombo: 9, dmgBonus: 15, firstWrong: false, lethUsed: 1,
    wordsDone: 2, over: false, mistaken: ['other'], wordStreak: 2,
    rageLeft: 2, freezeWord: true, chainNext: true, goldMult: 3,
    usedThisFight: { leech: 2, stone: 1 }, rewardTaken: false, finished: false,
    ...over,
  };
}
const envelopeOf = (over = {}) => {
  const run = seededRun();
  return { phase: PHASE.BATTLE, savedAt: '2026-10-01T12:00:00.000Z', run, battle: battleFor(run), encounter: null, ...over };
};

/* 一份**手写的**旧版存档：字段集合与加 rarity 之前完全一致 ——
   遗物是纯 id 数组，run/battle 上没有任何稀有度或组合技的痕迹。 */
function legacySave(relicIds) {
  const env = envelopeOf();
  const snap = JSON.parse(JSON.stringify(encodeSnapshot(env)));
  snap.run.relics = relicIds.slice();
  // 旧存档不该出现的键，明确断言它们不存在（防止有人"顺手"写进去）
  for (const key of ['relicRarities', 'synergies', 'rarity']) {
    assert.equal(key in snap.run, false, '存档里不该出现 ' + key);
  }
  assert.ok(!JSON.stringify(snap).includes('"rarity"'), '整份存档不该出现 rarity 字段');
  return snap;
}

/* ---------------- 1) 编码侧：存档里只有 id ---------------- */

test('快照里的遗物仍然是纯 id 字符串数组（rarity 绝不进存档）', () => {
  const run = seededRun();
  run.relics = ['shield', 'combo', 'prophecy'];
  const snap = encodeSnapshot(envelopeOf({ run }));
  assert.ok(Array.isArray(snap.run.relics));
  assert.deepEqual(snap.run.relics, ['shield', 'combo', 'prophecy']);
  for (const r of snap.run.relics) assert.equal(typeof r, 'string', '存档里的遗物必须是 id 字符串');
  assert.ok(!JSON.stringify(snap).includes('rarity'));
});

/* ---------------- 2) 解码侧：旧存档照常恢复 ---------------- */

test('手写的旧存档（完全没有 rarity 字段）能原样恢复', () => {
  const snap = legacySave(['hint', 'shield', 'combo']);
  const out = decodeSnapshot(snap);
  assert.equal(out.ok, true, out.reason);
  assert.deepEqual(out.value.run.relics, ['hint', 'shield', 'combo'], '遗物按 id 原样回来');
});

test('旧存档里已下架 / 认不出的遗物 id 仍然解得出来，不 fail closed', () => {
  const snap = legacySave(['hint', '__retired_relic__', 'combo']);
  const out = decodeSnapshot(snap);
  assert.equal(out.ok, true, out.reason);
  assert.deepEqual(out.value.run.relics, ['hint', '__retired_relic__', 'combo']);
});

test('旧存档在所有相位都照常解码（地图 / 战斗 / 奖励 / 事件）', () => {
  const run = seededRun({ relics: ['shield', 'thorn'] });
  const env = envelopeOf({ run });
  for (const phase of [PHASE.BATTLE, PHASE.MAP]) {
    const e = Object.assign({}, env, { phase, battle: phase === PHASE.BATTLE ? env.battle : null });
    const snap = JSON.parse(JSON.stringify(encodeSnapshot(e)));
    snap.run.relics = ['shield', 'thorn'];
    const out = decodeSnapshot(snap);
    assert.equal(out.ok, true, phase + ' 相位解码失败: ' + out.reason);
    assert.deepEqual(out.value.run.relics, ['shield', 'thorn']);
  }
});

test('带遗物的事件屏快照（旧版商店卡 id 不带价格）也能解码', () => {
  const run = seededRun({ relics: ['shield'] });
  const encounter = {
    kind: 'shop', gold: 120, chosenId: 'shop:relic:shield',
    title: '商店 🛒', text: undefined, icon: undefined,
    node: run.node,
    options: [
      { id: 'shop:relic:shield', cat: 'relic', ic: '🛡️', t: '护盾符文 · 80 金币', d: '开局获得 15 点护盾' },
      { id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买', leave: true },
    ],
  };
  const snap = JSON.parse(JSON.stringify(encodeSnapshot(envelopeOf({ run, encounter, phase: PHASE.REWARD }))));
  const out = decodeSnapshot(snap);
  assert.equal(out.ok, true, out.reason);
  assert.deepEqual(out.value.encounter.options.map(o => o.id), ['shop:relic:shield', 'shop:leave'],
    '旧版卡 id（不带价格）必须原样留着，恢复路径再自己映射');
  assert.equal(out.value.encounter.options[0].t, '护盾符文 · 80 金币', '卡面文案来自存档，不被重算');
});

/* ---------------- 3) 档位是读时派生：老遗物自动升级 ---------------- */

test('旧存档里的遗物按当前数据表拿到今天的稀有度与价格', () => {
  const out = decodeSnapshot(legacySave(['hint', 'combo']));
  assert.equal(out.ok, true, out.reason);
  // 档位不在存档里 —— 它是**读的时候**从当前数据表现查的。
  // 玩家中途退出、隔版本升级，进游戏第一眼看到的就是今天的档位。
  assert.deepEqual(out.value.run.relics, ['hint', 'combo']);
  for (const id of out.value.run.relics) {
    const def = RELICS.filter(r => r.id === id)[0];
    assert.equal(relicRarity(def), def.rarity, id + ' 应当直接读到数据表里的档位');
    assert.equal(relicPrice(def), RELIC_RARITY[def.rarity].price);
  }
  // 反过来：一个**没有 rarity 字段**的残缺遗物对象（外部输入 / 未来改表），
  // 必须回落到普通档，而不是 undefined/NaN。
  assert.equal(relicRarity({ id: 'combo' }), 'common');
  assert.equal(relicPrice({ id: 'combo' }), RELIC_RARITY.common.price);
});

/* ---------------- 4) 组合技由 id 推导，旧存档立刻生效 ---------------- */

test('旧存档里凑齐组合技的两件遗物，读出来立刻算组合成立', () => {
  const pair = ['shield', 'thorn'];
  const out = decodeSnapshot(legacySave(pair));
  assert.equal(out.ok, true, out.reason);
  assert.equal(hasSynergy(out.value.run.relics, 'thornwall'), true,
    '组合技不依赖任何存档字段，只看 id —— 老存档不该被排除在外');
});

test('不同玩家存档互不影响：只差一件遗物，组合技状态必须不同', () => {
  const yes = decodeSnapshot(legacySave(['shield', 'thorn'])).value.run.relics;
  const no = decodeSnapshot(legacySave(['shield'])).value.run.relics;
  assert.equal(activeSynergies(yes).length, 1);
  assert.equal(activeSynergies(no).length, 0);
});

/* ---------------- 5) 往返稳定性 ---------------- */

test('解码后再编码，存档形状与加 rarity 之前完全一致', () => {
  const snap = legacySave(['hint', 'shield', 'combo', 'prophecy']);
  const out = decodeSnapshot(snap);
  const again = JSON.parse(JSON.stringify(encodeSnapshot({
    phase: out.value.phase, savedAt: out.value.savedAt,
    run: out.value.run, battle: out.value.battle, encounter: out.value.encounter,
  })));
  assert.deepEqual(again.run.relics, snap.run.relics);
  assert.deepEqual(Object.keys(again.run).sort(), Object.keys(snap.run).sort(),
    '往返不许长出新字段');
});