import {growthSummary,GROWTH_VERSION} from '../src/domain/mastery-growth.js';
/**
 * Controlled combat comparison, NOT a full-map/player completion-rate model.
 * Run: node scripts/simulate-hero-balance.mjs --seeds=256 --write-report
 * Inputs are fixed before running; no profile-specific tuning to equalize heroes.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WORDS } from '../src/data/words.js';
import { HEROES } from '../src/data/heroes.js';
import { ENEMIES, BOSS } from '../src/data/enemies.js';
import { ITEMS } from '../src/data/items.js';
import { HERO_BALANCE, ITEM_BALANCE } from '../src/data/hero-balance.js';
import { createRun } from '../src/domain/run.js';
import { drawLetters } from '../src/domain/letter-bank.js';
import { norm } from '../src/domain/text.js';
import { clamp } from '../src/domain/math.js';
import { comboRate, hitDmg, wordDmg } from '../src/domain/damage.js';
import { foeHpMax } from '../src/domain/foe-stats.js';
import { wordComplete, creditWordProgress } from '../src/domain/learning.js';
import { canFinishFight } from '../src/domain/battle-rules.js';
import { createWordQ } from '../src/domain/word-quality.js';
import { heroOpeningGrant, goldGainAmount, battleGoldBase } from '../src/domain/hero-rules.js';
import { deriveRoundDifficulty, scaleEnemyHealth, scaleFoeAttackProfile } from '../src/domain/round-difficulty.js';
import { createFoeAttackFact, foeAttackProfile, advanceFoeAttack, interruptFoeAttack } from '../src/domain/foe-attack.js';
import { createCombatController } from '../src/app/combat.js';
import { createEncounterController } from '../src/app/encounters.js';

const args = new Set(process.argv.slice(2));
const numericArg = (key, fallback, minimum = 1) => {
  const arg = [...args].find(value => value.startsWith(`--${key}=`));
  const value = arg ? Number(arg.split('=')[1]) : fallback;
  assert(Number.isSafeInteger(value) && value >= minimum, `${key} must be an integer >= ${minimum}`);
  return value;
};
const seedCount = numericArg('seeds', 256);
const round = numericArg('round', 1);
const masteredCount = Math.min(259,numericArg('mastered',0,0));
const knowledge = growthSummary(WORDS.slice(0,masteredCount).map(w=>w.w),WORDS);
const profiles = [
  { id: 'accurate', name: '准确', uncertainWordRate: 0, secondClusterRate: 0,
    recallMinMs: 1500, recallSpanMs: 8000, letterMs: 600 },
  { id: 'occasional', name: '偶尔错误', uncertainWordRate: .35, secondClusterRate: .20,
    recallMinMs: 2500, recallSpanMs: 10000, letterMs: 700 },
  { id: 'frequent', name: '频繁错误', uncertainWordRate: .70, secondClusterRate: .70,
    recallMinMs: 4000, recallSpanMs: 14000, letterMs: 800 },
];
const encounters = [
  { floor: 1, kind: 'normal' }, { floor: 3, kind: 'normal' },
  { floor: 5, kind: 'elite' }, { floor: 7, kind: 'normal' }, { floor: 9, kind: 'boss' },
];
const loadouts = [
  { id: 'bare', name: '裸装、无补给' },
  { id: 'supply', name: '开局补给＋两次固定商店' },
];
const noop = () => {};
const fx = new Proxy({}, { get: () => noop });
const point = () => ({ x: 0, y: 0 });

// Independent streams: cosmetic calls, shorter fights and shop RNG cannot move
// another hero's later word/error/recall sequence.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mix(seed, battle = 0, word = 0, stream = 0) {
  return (Math.imul(seed + 1, 2654435761) ^ Math.imul(battle + 1, 2246822519)
    ^ Math.imul(word + 1, 3266489917) ^ Math.imul(stream + 1, 668265263)) >>> 0;
}
function shuffle(values, random) {
  const out = values.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function wordPlan(seed, battle, index, word, profile) {
  const random = rng(mix(seed, battle, index, 1));
  const uncertain = new Set();
  const length = norm(word.w).length;
  const addCluster = () => {
    const pos = Math.floor(random() * Math.max(1, length - 1));
    uncertain.add(pos);
    if (pos + 1 < length) uncertain.add(pos + 1);
  };
  if (random() < profile.uncertainWordRate) {
    addCluster();
    if (random() < profile.secondClusterRate) addCluster();
  }
  return { uncertain, recallMs: profile.recallMinMs + Math.floor(random() * profile.recallSpanMs) };
}
function makeViewPort() {
  const elements = new Map();
  const element = () => ({ dataset: {}, style: {}, children: [],
    appendChild(value) { this.children.push(value); },
    set innerHTML(value) { this.children = []; this.html = value; },
    get innerHTML() { return this.html || ''; },
  });
  return { $: id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }, makeButton: element };
}

function simulate(hero, profile, loadout, seed) {
  const deck = shuffle(WORDS, rng(mix(seed, 0, 0, 2)));
  // Each encounter starts at the same fixed slice for every hero. We do not
  // advance future encounter decks by a hero-specific number of kill words.
  const decks = encounters.map((_, i) => deck.filter((_, n) => n % encounters.length === i));
  const G = createRun(0, hero, WORDS, rng(mix(seed, 0, 0, 3)),{version:GROWTH_VERSION,masteredAtStart:masteredCount,bonusHp:knowledge.bonusHp,bonusAttackPct:knowledge.bonusAttackPct});
  G.difficulty = deriveRoundDifficulty({ roundNumber: round, unit: 0, segments: 1 });
  if (loadout.id === 'bare') G.bag = {};
  const DB = { mastered: [], reviewQueue: [] };
  const state = { G, DB, B: null };
  const m = { survived: 0, wins: 0, battles: 0, words: 0, hpLost: 0, healed: 0,
    heroHealed: 0, heroShield: 0, shieldGained: 0, shieldAbsorbed: 0,
    wrong: 0, hints: 0, revealed: 0, uncertainPositions: 0, autonomousHits: 0,
    earnedGold: 0, spentGold: 0, maxhpAdded: 0, itemUses: 0, shopBuys: 0,
    rangerCapBattles: 0, warriorCapBattles: 0, maxRangerHeal: 0, maxWarriorShield: 0 };
  let wordIndex = 0, battleIndex = 0, attackFact = null, attackConfig = null;
  let combat;
  const check = () => {
    const B = state.B;
    for (const [label, value] of Object.entries({ hp: B.myHp, shield: B.shield,
      enHp: B.enHp, maxhp: G.maxhp, gold: G.gold, heroHealed: B.heroHealed,
      heroShieldGained: B.heroShieldGained, combo: B.combo, damageBonus: B.dmgBonus })) {
      assert(Number.isFinite(value), `non-finite ${hero.id}/${seed}/${label}`);
    }
    assert(B.myHp >= 0 && B.myHp <= G.maxhp, 'player health out of bounds');
    assert(B.shield >= 0 && B.shield <= G.maxhp, 'shield out of bounds');
    assert(B.heroHealed <= HERO_BALANCE.rangerBattleHealCap, 'ranger heal exceeds battle cap');
    assert(B.heroShieldGained <= HERO_BALANCE.warriorBattleShieldCap, 'warrior shield exceeds battle cap');
    // Explicit acceptance thresholds, independent of editable configuration.
    assert(B.heroHealed <= 18, 'ranger heal exceeds acceptance ceiling 18');
    assert(B.heroShieldGained <= 6, 'warrior shield exceeds acceptance ceiling 6');
    for (const value of Object.values(m)) assert(Number.isFinite(value), 'non-finite metric');
  };
  const observe = action => {
    const B = state.B, hp = B.myHp, shield = B.shield;
    const out = action();
    m.hpLost += Math.max(0, hp - B.myHp);
    m.healed += Math.max(0, B.myHp - hp);
    m.shieldGained += Math.max(0, B.shield - shield);
    m.shieldAbsorbed += Math.max(0, shield - B.shield);
    check();
    return out;
  };
  const prepareWord = () => {
    const B = state.B;
    let word;
    do { word = decks[battleIndex][wordIndex++]; } while (word && G.done.has(word.w));
    assert(word, 'fixed encounter word slice exhausted; this is not a win');
    const letters = drawLetters(G, B, word, rng(mix(seed, battleIndex, wordIndex, 4)));
    Object.assign(B, { word, letters: letters.letters, used: letters.used,
      bad: letters.letters.map(() => false), input: [], sel: 0,
      wordQ: createWordQ(), hintUsed: 0, hintTotal: 0, autoHint: 0,
      freezeWord: false, letterProgress: 0, wordLocked: false });
  };
  const addGold = amount => {
    const earned = goldGainAmount(G, amount);
    G.gold += earned;
    m.earnedGold += earned;
    return G.gold;
  };
  combat = createCombatController({ state, ports: {
    $: () => null, norm, clamp, rnd: () => 1,
    hasR: id => G.relics.includes(id), itemById: id => ITEMS.find(item => item.id === id),
    hitDmg: () => hitDmg(G, state.B), wordDmg: () => wordDmg(G, state.B),
    wordComplete: () => wordComplete(state.B),
    creditWord: word => { creditWordProgress(DB, G, word); m.words++; },
    onWordWrong: word => { if (!G.wrong.includes(word)) G.wrong.push(word); },
    centerOf: point, heroPoint: point, toast: noop, sfx: fx, TTS: fx,
    burst: noop, floatTxt: noop, flash: noop, ring: noop, animHero: noop,
    wordFinisher: noop, foeCry: noop, renderFight: noop, nextWord: prepareWord,
    winFight: () => {
      const B = state.B;
      assert(canFinishFight(B), 'simulated win must pass production authorization');
      B.over = true; B.won = true; G.kills++; m.wins++;
      // Same fixed runtime win formula; hero/item percentages stay in domain.
      const base = 25 + (B.boss ? 170 : B.elite ? 60 : 0) + Math.floor(G.floor * 4);
      addGold(battleGoldBase(base, B));
    },
    loseFight: () => { state.B.over = true; state.B.myHp = Math.max(0, state.B.myHp); },
    finishNode: noop, saveDB: noop, scheduleBattle: noop,
    notifyLetterAttempted: () => {
      const next = interruptFoeAttack(attackFact, attackConfig);
      if (!next) return false;
      attackFact = next;
      return true;
    },
  } });
  const view = makeViewPort();
  const encounterController = createEncounterController({ state, ports: {
    ...view, clamp, pick: values => values[0], shuffle: values => values.slice(), rnd: () => 0,
    has: (values, id) => values.includes(id), hasR: id => G.relics.includes(id),
    goldGain: addGold, applyRelicInit: noop, sfx: fx, toast: noop,
    advance: noop, endRun: noop, finishNode: noop, show: noop,
    scheduleRun: noop, scheduleBattle: noop, relicRnd: rng(mix(seed, 0, 0, 5)),
  } });
  function visitShop() {
    encounterController.showShop();
    const id = G.gold >= 70 && G.whetBuys < 2 ? 'shop:whet'
      : G.gold >= 45 && G.maxhp - G.hp >= 15 ? 'shop:potion' : null;
    if (!id) return;
    const button = view.$('rPicks').children.find(value => value.dataset.opt === id);
    assert(button, 'fixed standard shop option missing');
    const before = { hp: G.hp, maxhp: G.maxhp, gold: G.gold };
    button.onclick();
    const added = G.maxhp - before.maxhp;
    m.maxhpAdded += added;
    m.healed += Math.max(0, G.hp - before.hp - added);
    m.spentGold += before.gold - G.gold;
    m.shopBuys++;
  }
  function advanceTime(ms) {
    let remaining = ms;
    while (!state.B.over && remaining >= attackFact.remainingMs) {
      remaining -= attackFact.remainingMs;
      const result = advanceFoeAttack(attackFact, attackConfig);
      attackFact = result.fact;
      if (result.event) {
        m.autonomousHits++;
        observe(() => combat.enemyHit(result.event.damage));
      }
    }
    if (!state.B.over) attackFact.remainingMs -= remaining;
  }
  function useSupplies() {
    const B = state.B;
    if (loadout.id !== 'supply' || B.over) return;
    if (G.maxhp - B.myHp >= ITEM_BALANCE.leechHeal && G.bag.leech > 0
      && (B.usedThisFight.leech || 0) < ITEMS.find(item => item.id === 'leech').max) {
      const before = G.bag.leech;
      observe(() => combat.useItem('leech'));
      m.itemUses += before - G.bag.leech;
    }
  }
  for (battleIndex = 0; battleIndex < encounters.length; battleIndex++) {
    if (loadout.id === 'supply' && [2, 4].includes(battleIndex)) visitShop();
    const { floor, kind } = encounters[battleIndex];
    G.floor = floor; G.maxFloor = floor;
    const boss = kind === 'boss', elite = kind === 'elite';
    const foe = boss ? BOSS : ENEMIES[Math.floor(rng(mix(seed, battleIndex, 0, 6))() * ENEMIES.length)];
    const { hpMax } = foeHpMax({ floor, boss, elite, comboRate: comboRate(G), base: foe.base });
    const enemyHp = scaleEnemyHealth(hpMax, G.difficulty);
    state.B = { foe, boss, elite, node: { type: boss ? 'boss' : elite ? 'elite' : 'battle' },
      myHp: G.hp, enHp: enemyHp, enMax: enemyHp, shield: G.shield,
      hints: 3 + G.hm + (boss ? 2 : 0), combo: 0, maxCombo: 0, dmgBonus: 0,
      firstWrong: true, letterProgress: 0, heroHealed: 0, heroShieldGained: 0,
      lethUsed: 0, wordsDone: 0, over: false, mistaken: [], wordStreak: 0,
      rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1, usedThisFight: {} };
    wordIndex = 0;
    prepareWord();
    const B = state.B;
    observe(() => {
      const opening = heroOpeningGrant(G, B);
      B.myHp += opening.heal; B.shield += opening.shield;
      m.heroHealed += opening.heal; m.heroShield += opening.shield;
    });
    attackConfig = scaleFoeAttackProfile(foeAttackProfile(kind), G.difficulty);
    attackFact = { ...createFoeAttackFact(kind), remainingMs: attackConfig.idleMs };
    m.battles++;
    let seenWordIndex = -1, plan = null, actionCount = 0;
    while (!B.over) {
      assert(++actionCount < 10000, 'combat simulation failed to make progress');
      if (wordIndex !== seenWordIndex) {
        seenWordIndex = wordIndex;
        plan = wordPlan(seed, battleIndex, wordIndex, B.word, profile);
        m.uncertainPositions += plan.uncertain.size;
        useSupplies();
        advanceTime(plan.recallMs);
        if (B.over) break;
      }
      useSupplies();
      const pos = B.input.length, target = norm(B.word.w);
      if (plan.uncertain.has(pos) && !B.hintUsed) {
        if (B.hints > 0) {
          const before = B.wordQ.revealed;
          if (observe(() => combat.requestHint())) {
            m.hints++; m.revealed += B.wordQ.revealed - before;
            advanceTime(500); // requesting a hint does not interrupt a telegraph
          }
        }
        if (B.over) break;
        if (!B.hintUsed) {
          const wantsOrder = rng(mix(seed, battleIndex, wordIndex * 32 + pos, 7))() < .5;
          const eligible = B.letters.map((ch, i) => ({ ch, i })).filter(({ ch, i }) =>
            !B.used[i] && !B.bad[i] && ch !== target[pos]);
          const wrong = eligible.find(({ ch }) => target.includes(ch) === wantsOrder) || eligible[0];
          if (wrong) {
            advanceTime(profile.letterMs);
            if (B.over) break;
            const before = B.wordQ.wrong;
            observe(() => combat.pressKey(wrong.i));
            m.wrong += B.wordQ.wrong - before;
            if (B.over) break;
          }
        }
      }
      advanceTime(profile.letterMs);
      if (B.over) break;
      observe(() => combat.typeLetter(target[pos]));
    }
    m.heroHealed += B.heroHealed;
    m.heroShield += B.heroShieldGained;
    if (hero.id === 'ranger') {
      m.maxRangerHeal = Math.max(m.maxRangerHeal, B.heroHealed);
      if (B.heroHealed === 18) m.rangerCapBattles++;
    }
    if (hero.id === 'warrior') {
      m.maxWarriorShield = Math.max(m.maxWarriorShield, B.heroShieldGained);
      if (B.heroShieldGained === 6) m.warriorCapBattles++;
    }
    G.hp = B.myHp; G.shield = B.shield;
    if (!B.won) break;
    // No final +30 boss heal: the endpoint is the combat result before post-win
    // progression/rewards. It cannot affect whether the five fights were survived.
  }
  m.survived = m.wins === encounters.length ? 1 : 0;
  m.netDamage = m.hpLost - m.healed;
  m.finalHp = G.hp; m.finalShield = G.shield; m.finalGold = G.gold;
  assert.equal(70 + (hero.mod.hp || 0) + knowledge.bonusHp + m.maxhpAdded + m.healed - m.hpLost, G.hp,
    'health accounting must reconcile including max-health purchases');
  assert.equal((hero.mod.gold || 0) + m.earnedGold - m.spentGold, G.gold, 'gold accounting');
  return m;
}

assert.equal(WORDS.length, 259, 'must use the unmodified 259-entry textbook');
assert.equal(HEROES.length, 9, 'report assumes nine heroes');
const sourceFiles = ['src/app/combat.js', 'src/app/encounters.js', 'src/app/runtime.js',
  'src/data/heroes.js', 'src/data/hero-balance.js', 'src/data/items.js', 'src/domain/hero-rules.js',
  'src/domain/damage.js', 'src/domain/foe-stats.js', 'src/domain/foe-attack.js',
  'src/domain/round-difficulty.js', 'src/domain/run.js', 'src/domain/letter-bank.js',
  'src/data/balance.js', 'src/domain/mastery-growth.js', 'scripts/simulate-hero-balance.mjs'];
async function fingerprint() {
  const hash = createHash('sha256');
  for (const path of sourceFiles) hash.update(path).update(await readFile(new URL(`../${path}`, import.meta.url)));
  return hash.digest('hex');
}
const sourceFingerprint = await fingerprint();
const rows = [];
for (const loadout of loadouts) for (const profile of profiles) for (const hero of HEROES) {
  const totals = {};
  let maxRangerHeal = 0, maxWarriorShield = 0;
  for (let seed = 0; seed < seedCount; seed++) {
    const metrics = simulate(hero, profile, loadout, seed);
    for (const [key, value] of Object.entries(metrics)) totals[key] = (totals[key] || 0) + value;
    maxRangerHeal = Math.max(maxRangerHeal, metrics.maxRangerHeal);
    maxWarriorShield = Math.max(maxWarriorShield, metrics.maxWarriorShield);
  }
  rows.push({ loadout: loadout.id, profile: profile.id, hero: hero.id, heroName: hero.n,
    samples: seedCount, survivors: totals.survived,
    averages: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / seedCount])),
    capChecks: { maxRangerHeal, maxWarriorShield,
      rangerCapBattles: totals.rangerCapBattles, warriorCapBattles: totals.warriorCapBattles } });
}
assert.equal(await fingerprint(), sourceFingerprint, 'source changed during the simulation; rerun to get a valid report');
const report = { simulation: 'controlled-five-fight-survival-not-full-map-clear-rate', seedCount,
  seedRange: [0, seedCount - 1], round, masteredCount, knowledge, textbookEntries: WORDS.length,
  sourceFingerprint, profiles, encounters, rows };
const f = value => value.toFixed(1);
function markdown() {
  const lines = [
    '# 角色平衡：同种子连续战模拟', '',
    `运行：\`node scripts/simulate-hero-balance.mjs --seeds=${seedCount} --round=${round} --write-report\``, '',
    `每角色、每档、每套补给 ${seedCount} 个种子（0–${seedCount - 1}），共 ${rows.length * seedCount} 轮；第 ${round} 轮难度，知识成长生命 +${knowledge.bonusHp}、攻击 +${knowledge.bonusAttackPct}%。源码 SHA-256：\`${report.sourceFingerprint}\`。`, '',
    '本报告衡量固定五战的生存比例，不是随机完整地图通关率，更不是实际学生胜率。没有模拟休息节点、随机战利品选择、逃跑、跨单元或玩家主动选词。', '',
    '## 控制条件', '',
    '- 使用仓库全部 259 条真实词库，只洗牌，不改词条。每个种子给五战分配互不重叠的固定词序；同战中不同角色若更早击杀，后续战斗仍从相同词开始。已完整完成的同英文词不会再发放。',
    '- 固定战序：1 层普通、3 层普通、5 层精英、7 层普通、9 层首领。相同种子的怪物一致；敌人血量沿用线上 foeHpMax（包含当前角色连击系数）。',
    '- 使用真实 createRun、drawLetters、createCombatController、damage 和 foe-attack 状态机。输入经过 pressKey/typeLetter；提示经过 requestHint；补给使用真实 useItem；商店购买经过真实 createEncounterController 的按钮动作。视图端口是普通对象，没有浏览器 DOM。',
    '- 每个词的待提示/易错位置及思考延迟由独立种子生成，角色之间相同；连续两个易错位置可被学者的一次双字母提示覆盖。提示用尽后才发生预定错误，然后改正。错误类型以相同种子决定为顺序/非成员，各一半；在实际字母盘无对应候选时退到可用错误字母。',
    '- 准确：不主动出错，词前思考 1.5–9.5 秒，逐字 0.6 秒。偶尔错误：35% 的词有一组相邻易错字母，其中20%再加一组；思考2.5–12.5秒，逐字0.7秒。频繁错误：70% 的词有一组，其中70%再加一组；思考4–18秒，逐字0.8秒。请求一次提示耗时0.5秒，不打断怪物蓄力。以上均为预设压力条件，不代表真实学生分布。',
    '- 裸装组不带消耗品。补给组保留开局2个獠牙；缺血至少8时使用。在第2战/第4战后各给一次固定商店机会：够70金且未达到本轮限购时买1块磨砺石，否则缺血至少15且够45金时买1瓶疗伤药。其余商品不买，不额外发奖励。',
    '- 战士护盾、治愈师溢出盾、游侠有效回血、连击里程碑均由真实控制器结算；护盾、生命跨战延续。首领击败后的固定回血不计入终点。', '',
    '## 结果', '',
    '每行均值包含全部种子及中途失败样本；失败后不再尝试后续战斗。净伤害＝实际生命扣减−有效治疗，不含磨砺石增加上限所新增的生命；负数表示有效治疗超过受伤。护盾新增包含战末剩余的盾，吸收只计实际承伤。', '',
  ];
  for (const loadout of loadouts) {
    lines.push(`### ${loadout.name}`, '',
      '| 错误档 | 角色 | 五战存活 | 完成战数 | 净伤害 | 治疗 | 盾新增/吸收 | 错字 | 提示 | 完成词 | 赚金/花金 | 末金币 |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const row of rows.filter(row => row.loadout === loadout.id)) {
      const a = row.averages, p = profiles.find(p => p.id === row.profile);
      lines.push(`| ${p.name} | ${row.heroName} | ${f(100 * a.survived)}% (${row.survivors}/${seedCount}) | ${f(a.wins)} | ${f(a.netDamage)} | ${f(a.healed)} | ${f(a.shieldGained)}/${f(a.shieldAbsorbed)} | ${f(a.wrong)} | ${f(a.hints)} | ${f(a.words)} | ${f(a.earnedGold)}/${f(a.spentGold)} | ${f(a.finalGold)} |`);
    }
    lines.push('');
  }
  const rangerRows = rows.filter(row => row.hero === 'ranger');
  const warriorRows = rows.filter(row => row.hero === 'warrior');
  lines.push('## 自动断言', '',
    `- 全部动作校验有限数、生命/护盾边界；每轮核对生命收支与金币收支；所有胜利必须通过真实 canFinishFight。`,
    `- 游侠每战有效角色回血不超过18；观测最大 ${Math.max(...rangerRows.map(row => row.capChecks.maxRangerHeal))}，${rangerRows.reduce((sum, row) => sum + row.capChecks.rangerCapBattles, 0)} 场达到18。`,
    `- 战士每战职业盾不超过6；观测最大 ${Math.max(...warriorRows.map(row => row.capChecks.maxWarriorShield))}，${warriorRows.reduce((sum, row) => sum + row.capChecks.warriorCapBattles, 0)} 场达到6。`, '',
    '## 如何读这些数字', '',
    '提示策略是“遇到预定易错位置就先请求帮助”，所以学者会少付部分错误代价；这只证明其定位在该策略下有效，不能推断玩家都会这样使用。探险家的干扰字母减少没有被额外转换成更低错误概率，因而主要量到首词爆发、少打几个词的收益。', '',
    '幸运儿在裸装组金币可以强化大招，但补给无法兑换，必须连同补给组看；两次固定商店是受控情境，真实地图是否及时出现商店会改变收益。补给组采用相同购买策略，并未针对各职业寻找最优路线。', '',
    '游侠上限更低，受到连续错误或长时间停顿时可能在回血前死亡；其回血严格依赖真实无主动帮助的新字母。战士更高生命与整词护盾、治愈师开场治疗/溢出盾属于不同的承伤节奏。不能仅凭一个平均数让所有角色强度完全相同。', '',
    '本脚本不检验 UI、音效、暂停恢复或完整随机地图；旧存档兼容由仓库相应测试承担。角色长期选择率、真实学生通关率和学习效果仍需使用数据或实玩验证。', '',
  );
  return lines.join('\n');
}
if (args.has('--write-report')) {
  const destination = new URL('../docs/hero-balance-simulation.md', import.meta.url);
  await writeFile(destination, markdown());
  console.log(`Wrote ${fileURLToPath(destination)}`);
}
if (args.has('--json')) console.log(JSON.stringify(report, null, 2));
else console.log(markdown());
