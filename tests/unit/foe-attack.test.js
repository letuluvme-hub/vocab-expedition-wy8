import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOE_PHASE, FOE_ATTACK_SCHEMA_VERSION,
  foeAttackKind, foeAttackProfile, createFoeAttackFact, phaseMs,
  advanceFoeAttack, interruptFoeAttack, encodeFoeAttack, decodeFoeAttack,
} from '../../src/domain/foe-attack.js';
import { FOE_ATTACK } from '../../src/data/balance.js';
import { PHASE, encodeSnapshot, decodeSnapshot } from '../../src/domain/run-snapshot.js';

/* ============================================================
 * 蓄力攻击状态机（清单 13 / backlog 正文第 13 条）
 * 纯规则：idle -> telegraph -> attack -> recover -> 循环，
 * 事实只有 {schemaVersion, phase, remainingMs, cycle, interrupted}。
 * ============================================================ */

test('三种怪的蓄力参数是本项固定值，且都是有限正数', () => {
  assert.deepEqual(FOE_ATTACK.normal, { idleMs: 6000, telegraphMs: 5000, recoverMs: 2500, damage: 4 });
  assert.deepEqual(FOE_ATTACK.elite, { idleMs: 5000, telegraphMs: 4000, recoverMs: 2500, damage: 6 });
  assert.deepEqual(FOE_ATTACK.boss, { idleMs: 4000, telegraphMs: 3500, recoverMs: 2500, damage: 8 });
  for (const k of ['normal', 'elite', 'boss']) {
    for (const f of ['idleMs', 'telegraphMs', 'recoverMs', 'damage']) {
      assert.ok(Number.isFinite(FOE_ATTACK[k][f]) && FOE_ATTACK[k][f] > 0, k + '.' + f);
    }
  }
});

test('怪物种类只由 boss/elite 两个既有标记决定，三档齐全', () => {
  assert.equal(foeAttackKind({ boss: false, elite: false }), 'normal');
  assert.equal(foeAttackKind({ boss: true, elite: false }), 'boss');
  assert.equal(foeAttackKind({ boss: false, elite: true }), 'elite');
  // boss + elite 同时为真时首领优先（不新增第四档）。
  assert.equal(foeAttackKind({ boss: true, elite: true }), 'boss');
  assert.equal(foeAttackProfile('normal'), FOE_ATTACK.normal);
  assert.equal(foeAttackProfile('elite'), FOE_ATTACK.elite);
  assert.equal(foeAttackProfile('boss'), FOE_ATTACK.boss);
});

test('新一场战斗从 idle 开始，剩余时间等于该怪的 idle 窗口', () => {
  const f = createFoeAttackFact('normal');
  assert.equal(f.phase, FOE_PHASE.IDLE);
  assert.equal(f.remainingMs, FOE_ATTACK.normal.idleMs);
  assert.equal(f.cycle, 0);
  assert.equal(f.interrupted, false);
  assert.equal(f.schemaVersion, FOE_ATTACK_SCHEMA_VERSION);
  // 绝不能开局就处在 attack / 0 剩余：那等于刷新后立刻挨打。
  assert.notEqual(f.phase, FOE_PHASE.ATTACK);
  assert.ok(f.remainingMs > 0);
});

test('phaseMs：attack 是单次瞬间（0），defeated 不再计时', () => {
  const c = FOE_ATTACK.boss;
  assert.equal(phaseMs(FOE_PHASE.IDLE, c), c.idleMs);
  assert.equal(phaseMs(FOE_PHASE.TELEGRAPH, c), c.telegraphMs);
  assert.equal(phaseMs(FOE_PHASE.ATTACK, c), 0);
  assert.equal(phaseMs(FOE_PHASE.RECOVER, c), c.recoverMs);
  assert.equal(phaseMs(FOE_PHASE.DEFEATED, c), 0);
});

test('idle -> telegraph 不产生伤害事件，且不直接跳过蓄力', () => {
  const c = FOE_ATTACK.normal;
  let f = createFoeAttackFact('normal');
  const r1 = advanceFoeAttack(f, c);
  assert.equal(r1.event, null, '从 idle 走到 telegraph 绝不该有伤害事件');
  assert.equal(r1.fact.phase, FOE_PHASE.TELEGRAPH);
  assert.equal(r1.fact.remainingMs, c.telegraphMs);
  const r2 = advanceFoeAttack(r1.fact, c);
  assert.equal(r2.fact.phase, FOE_PHASE.ATTACK);
  assert.equal(r2.fact.cycle, 1, '每完成一次蓄力 cycle +1');
  assert.deepEqual(r2.event, { type: 'attack', damage: c.damage });
});

test('attack -> recover -> idle 闭环，事件只在进 attack 的那一步出现', () => {
  const c = FOE_ATTACK.elite;
  let f = createFoeAttackFact('elite');
  let events = 0;
  // 走完整一圈：idle→telegraph→attack→recover→idle（4 步，1 次伤害）
  for (let i = 0; i < 4; i++) {
    const r = advanceFoeAttack(f, c);
    f = r.fact;
    if (r.event) { events++; assert.equal(r.event.damage, c.damage); }
  }
  assert.equal(events, 1, '一整圈只打一次');
  assert.equal(f.cycle, 1);
  assert.equal(f.phase, FOE_PHASE.IDLE, '一圈走完回到 idle');
  // 再走 4 步 = 第二圈的 idle→telegraph→attack→recover：2 次伤害、cycle 2
  for (let i = 0; i < 4; i++) {
    const r = advanceFoeAttack(f, c);
    f = r.fact;
    if (r.event) events++;
  }
  assert.equal(events, 2);
  assert.equal(f.cycle, 2);
  assert.equal(f.phase, FOE_PHASE.IDLE, '第二圈同样完整走完一圈，回到 idle');
});

test('defeated 相位是吸收态：不再产生任何伤害事件，也不回到 idle', () => {
  const c = FOE_ATTACK.normal;
  let f = createFoeAttackFact('normal');
  f = Object.assign(f, { phase: FOE_PHASE.DEFEATED });
  const r = advanceFoeAttack(f, c);
  assert.equal(r.fact.phase, FOE_PHASE.DEFEATED);
  assert.equal(r.event, null);
  assert.equal(advanceFoeAttack(r.fact, c).event, null, '迟到的定时回调不得复活已击败的怪');
});

/* ---------------- 打断 ---------------- */

test('蓄力期间打断：进入 recover，被记录一次，下一轮仍可再打断', () => {
  const c = FOE_ATTACK.normal;
  let f = createFoeAttackFact('normal');
  f = advanceFoeAttack(f, c).fact;                 // idle -> telegraph
  const cut = interruptFoeAttack(f, c);
  assert.ok(cut, 'telegraph 必须可打断');
  assert.equal(cut.phase, FOE_PHASE.RECOVER, '打断后进入 recover，不是直接 idle');
  assert.equal(cut.remainingMs, c.recoverMs);
  assert.equal(cut.interrupted, true);
  // recover -> idle -> telegraph，下一轮仍能再打断一次
  let g = advanceFoeAttack(cut, c).fact;          // recover -> idle
  g = advanceFoeAttack(g, c).fact;                // idle -> telegraph
  assert.equal(g.phase, FOE_PHASE.TELEGRAPH);
  assert.ok(interruptFoeAttack(g, c), '下一轮蓄力必须仍可打断');
});

test('非 telegraph 相位打断返回 null（一次蓄力只被相位闸门放行一次）', () => {
  const c = FOE_ATTACK.normal;
  const idle = createFoeAttackFact('normal');
  assert.equal(interruptFoeAttack(idle, c), null, 'idle 打断无意义');
  const rec = Object.assign(advanceFoeAttack(idle, c).fact, { phase: FOE_PHASE.RECOVER, remainingMs: c.recoverMs });
  assert.equal(interruptFoeAttack(rec, c), null, '已经在 recover 里不再二次打断');
  const atk = Object.assign(advanceFoeAttack(idle, c).fact, { phase: FOE_PHASE.ATTACK });
  assert.equal(interruptFoeAttack(atk, c), null, 'attack 瞬间不可打断');
  const def = Object.assign({}, idle, { phase: FOE_PHASE.DEFEATED });
  assert.equal(interruptFoeAttack(def, c), null);
  assert.equal(interruptFoeAttack(null, c), null, '没有事实时返回 null 而不是抛错');
});

test('打断不消耗教学语义：既不改 cycle，也不产生伤害事件', () => {
  const c = FOE_ATTACK.normal;
  let f = advanceFoeAttack(createFoeAttackFact('normal'), c).fact;
  const before = { cycle: f.cycle };
  const cut = interruptFoeAttack(f, c);
  assert.equal(cut.cycle, before.cycle, '被打断的蓄力不计入已完成轮次');
  const after = advanceFoeAttack(cut, c).fact;    // recover -> idle
  const next = advanceFoeAttack(after, c);       // idle -> telegraph
  assert.equal(next.event, null, '打断本身绝不产生攻击事件');
});

/* ---------------- 编解码 ---------------- */

test('编解码往返：只剩那四个事实字段，状态机/闭包/绝对时间一律不落盘', () => {
  const f = Object.assign(advanceFoeAttack(createFoeAttackFact('boss'), FOE_ATTACK.boss).fact,
    { remainingMs: 1234, interrupted: true, cycle: 3 });
  const enc = encodeFoeAttack(f);
  assert.deepEqual(enc, { schemaVersion: 1, phase: 'telegraph', remainingMs: 1234, cycle: 3, interrupted: true });
  assert.equal(enc.timId, undefined);
  assert.equal(enc.dueAt, undefined);
  assert.equal(enc.now, undefined);
  assert.doesNotThrow(() => JSON.stringify(enc));
  const back = decodeFoeAttack(JSON.parse(JSON.stringify(enc)));
  assert.deepEqual(back, enc);
});

test('合法边界：remainingMs=0、interrupted 缺省（false）都合法', () => {
  const raw = { schemaVersion: 1, phase: 'recover', remainingMs: 0, cycle: 0 };
  assert.deepEqual(decodeFoeAttack(raw), { ...raw, interrupted: false });
  assert.deepEqual(decodeFoeAttack({ ...raw, interrupted: true }), { ...raw, interrupted: true });
});

test('脏值一律 fail closed（返回 undefined），绝不猜一个安全值', () => {
  const bads = [
    null, undefined, 42, 'telegraph', [], true,
    { schemaVersion: 2, phase: 'idle', remainingMs: 1, cycle: 0 },   // 版本不支持
    { schemaVersion: 1, phase: 'sneak', remainingMs: 1, cycle: 0 }, // 未知相位
    { schemaVersion: 1, phase: 'idle', remainingMs: -1, cycle: 0 }, // 负剩余
    { schemaVersion: 1, phase: 'idle', remainingMs: 1e9, cycle: 0 },// 超上限
    { schemaVersion: 1, phase: 'idle', remainingMs: 1.5, cycle: 0 }, // 非整数毫秒
    { schemaVersion: 1, phase: 'idle', remainingMs: '900', cycle: 0 },
    { schemaVersion: 1, phase: 'idle', remainingMs: 1, cycle: -1 },
    { schemaVersion: 1, phase: 'idle', remainingMs: 1, cycle: 1.5 },
    { schemaVersion: 1, phase: 'idle', remainingMs: 1, cycle: 0, interrupted: 'yes' },
    { phase: 'idle', remainingMs: 1, cycle: 0 },                      // 缺版本
  ];
  for (const raw of bads) assert.equal(decodeFoeAttack(raw), undefined, JSON.stringify(raw));
});

test('旧快照没有 foeAttack 字段：合法，恢复成 undefined 而不是凭空造一次攻击', () => {
  assert.equal(decodeFoeAttack(undefined), undefined);
  assert.equal(encodeFoeAttack(undefined), undefined);
  assert.equal(encodeFoeAttack(null), undefined);
});

/* ---------------- 与进度快照的接口 ---------------- */

const pool = [{ w: 'keep', z: '保持', u: 1, d: 1, th: 'x' }];

function envelope(battleExtra) {
  // 地图身份：两行节点，第 0 行链到第 1 行。links 必须指向**真实 node 对象**
  //（codec 内部按 nodeId(node) 编码），不能直接写 nodeID 字符串 —— 那会编出 null
  // 链接，整份快照判 invalid，测试就会因为无关原因恒假。
  const rows = [
    [{ type: 'battle', x: 0.5, row: 0, done: false, links: [] }],
    [{ type: 'battle', x: 0.5, row: 1, done: false, links: [] }],
  ];
  rows[0][0].links.push(rows[1][0]);
  const nid = rows[0][0];
  const run = {
    unit: 1, id: 'R1', hp: 50, maxhp: 60, shield: 0, gold: 0, floor: 1, maxFloor: 9,
    relics: [], skipFree: false, ghostUsed: false, heroId: 'scholar',
    hm: 0, hnoise: 0, hcombo: 1, hregen: 0, hleech: 0, kills: 0, att: 0, attOk: 0, deckHint: 0,
    countedStart: false, clearedRun: false, shieldGiven: false, nextHint: 0, shopHints: 0,
    pool, done: [], wrong: [], history: [], bag: {},
    rows, avail: [nid], cur: null, node: nid,
  };
  const battle = Object.assign({
    word: pool[0], letters: ['k', 'e', 'e', 'p'], used: [false, false, false, false],
    bad: [false, false, false, false], myHp: 50, enHp: 20, enMax: 100, shield: 0,
    input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0, combo: 0, maxCombo: 0,
    dmgBonus: 0, firstWrong: true, lethUsed: 0, wordsDone: 0, over: false, won: false,
    mistaken: [], wordStreak: 0, rageLeft: 0, freezeWord: false, chainNext: false,
    goldMult: 1, usedThisFight: {}, boss: false, elite: false,
    foe: { n: '词灵', ic: '👾', tint: '#8b5cf6' }, node: nid,
    finished: false, rewardTaken: false,
  }, battleExtra);
  return encodeSnapshot({ phase: PHASE.BATTLE, run, battle, encounter: null }, { now: 0 });
}

test('战斗快照带上 foeAttack 事实并能原样解码回来', () => {
  const foeAttack = { schemaVersion: 1, phase: 'telegraph', remainingMs: 3120, cycle: 2, interrupted: false };
  const env = envelope({ foeAttack });
  assert.deepEqual(env.battle.foeAttack, foeAttack);
  const back = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(back.ok, true, back.reason);
  assert.deepEqual(back.value.battle.foeAttack, foeAttack);
});

test('旧战斗快照（无 foeAttack 键）仍能恢复，且键整个不出现', () => {
  const env = envelope({});
  assert.equal('foeAttack' in env.battle, false, '缺事实时整个键都不出现');
  const back = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(back.ok, true, back.reason);
  assert.equal(back.value.battle.foeAttack, undefined);
});

test('foeAttack 脏值让整份快照 fail closed（编码返回 null，绝不写缺事实的快照）', () => {
  // 编码侧：内存态脏 → 整份不写（null）。写一份「缺了攻击事实」的快照看着能恢复，
  // 实际把蓄力剩余时间丢了 —— 刷新后攻击时机凭空变化。
  assert.equal(envelope({ foeAttack: { schemaVersion: 1, phase: 'idle', remainingMs: -5, cycle: 0 } }), null);
  assert.equal(envelope({ foeAttack: { schemaVersion: 9, phase: 'idle', remainingMs: 1, cycle: 0 } }), null);
  assert.equal(envelope({ foeAttack: { schemaVersion: 1, phase: 'sneak', remainingMs: 1, cycle: 0 } }), null);
  // 缺失（undefined / null）仍是合法形状：照常写快照，不受影响。
  assert.ok(envelope({ foeAttack: undefined }), '缺事实不能连累整局存不下');
  assert.ok(envelope({ foeAttack: null }));
  // 解码侧：手改过的存档里出现脏事实 → 整份拒绝，绝不静默丢成「没有攻击状态」。
  const good = JSON.parse(JSON.stringify(envelope({})));
  const tampered = JSON.parse(JSON.stringify(good));
  tampered.battle.foeAttack = { schemaVersion: 1, phase: 'idle', remainingMs: -1, cycle: 0 };
  assert.equal(decodeSnapshot(tampered).reason, 'invalid');
  const tampered2 = JSON.parse(JSON.stringify(good));
  tampered2.battle.foeAttack = { schemaVersion: 2, phase: 'idle', remainingMs: 100, cycle: 0 };
  assert.equal(decodeSnapshot(tampered2).reason, 'invalid');
  // 对照：没被改的同一份存档必须能过 —— 证明上面两条不是因为别的原因失败。
  assert.equal(decodeSnapshot(good).ok, true);
});