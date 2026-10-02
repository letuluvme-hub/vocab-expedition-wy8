/* 完整词连胜的**接线**测试（docs/feature-word-streak.md）。
 *
 * domain/word-streak.js 的纯规则在 tests/unit/word-streak.test.js 里已经覆盖；
 * 本文件只证明「它真的接进了战斗、语音、暂停与存档」，也就是：
 *  1) combat：整词完成的**唯一**发布点在 TTS.word 之后、致命判定/换词之前；
 *     半词绝不发布；错字母只在「被接受且判错」时发布（重复点 bad 字母、
 *     自动解封、退格、提示、字母盘上没有的输入都不算）。
 *  2) speech：低优先级 announcement 绝不动正在念的词；词的占用只由**真实**
 *     utterance end/error 释放（旧句迟到的 end 不得清掉新句的占用）；
 *     stop() 释放；不支持 TTS / 玩家关掉朗读时返回 false 且不改偏好。
 *  3) 快照：wordStreak / wordEventSeq 往返一致，旧快照回落 0，脏值 fail closed。
 *  4) progress：暂停/结算作废在途播报但**不动**连胜状态；继续只解冻不补播。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatController } from '../../src/app/combat.js';
import { wordComplete } from '../../src/domain/learning.js';
import { createSpeech } from '../../src/services/speech.js';
import { createAudioCapability } from '../../src/services/audio-capability.js';
import { createWordStreakFeedback, FEEDBACK_DEFER_MS, FEEDBACK_DEFER_WINDOW_MS,
  FEEDBACK_MAX_DEFERRALS } from '../../src/app/word-streak-feedback.js';
import { encodeSnapshot, decodeSnapshot, PHASE } from '../../src/domain/run-snapshot.js';
import { createRun } from '../../src/domain/run.js';

/* ---------------- 1. combat 接线 ---------------- */
const el = () => ({ textContent: '', classList: { add() {}, remove() {} }, offsetWidth: 1,
  children: [], setAttribute() {}, getAttribute() { return null; } });
const hud = () => ({ fBank: el(), fCombo: el(), fAv: el(), fMy: el(), fItems: el(), fCat: el(),
  fSlots: el(), fZh: el() });

function makeCombat(over = {}, extraPorts = {}) {
  const G = { floor: 3, hp: 50, maxhp: 50, shield: 0, gold: 30, relics: [], hcombo: 1,
    hm: 0, hnoise: 0, hleech: 0, hregen: 0, done: new Set(), wrong: [], bag: { leech: 2 },
    att: 0, attOk: 0, kills: 0, unit: 1, heroId: 'a', node: { done: false, links: [] },
    nextHint: 0, wordStreak: { count: 0, lastEventId: null }, wordEventSeq: 0 };
  const B = { word: { w: 'keep', z: '保持', u: 1, d: 1 },
    letters: ['k', 'e', 'e', 'p', 'x'], used: [false, false, false, false, false],
    bad: [false, false, false, false, false], input: [], sel: 0, hints: 3, hintUsed: 0, hintTotal: 0,
    combo: 0, maxCombo: 0, dmgBonus: 0, firstWrong: true, lethUsed: 0,
    wordsDone: 0, over: false, won: false, boss: false, elite: false, myHp: 50, enHp: 200, enMax: 200,
    shield: 0, rageLeft: 0, freezeWord: false, chainNext: false, goldMult: 1,
    usedThisFight: {}, wordStreak: 0, mistaken: [], foe: { n: '词灵', ic: '👾', tint: '#fff' } };
  Object.assign(B, over);
  const DB = { mastered: [], runs: 0, wins: 0, rewards: [] };
  const order = [];
  const whole = [], wrong = [];
  const ctrl = createCombatController({ state: { DB, G, B }, ports: Object.assign({
    $: id => hud()[id], norm: s => String(s).toLowerCase().replace(/[^a-z]/g, ''),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), rnd: () => 0,
    hasR: () => false, itemById: () => undefined,
    hitDmg: () => 10, wordDmg: () => 40, wordComplete: () => wordComplete(B),
    creditWord: w => { DB.mastered.push(w); G.done.add(w); }, onWordWrong: w => G.wrong.push(w),
    centerOf: () => ({ x: 1, y: 1 }), heroPoint: () => ({ x: 1, y: 1 }), toast: () => {},
    sfx: new Proxy({}, { get: () => () => {} }),
    TTS: { line: () => { order.push('tts.line'); }, word: () => { order.push('tts.word'); },
      hint: () => { order.push('tts.hint'); }, foeLine: () => {} },
    burst: () => {}, floatTxt: () => {}, flash: () => {}, ring: () => {}, animHero: () => {},
    wordFinisher: () => {}, foeCry: () => {},
    renderFight: () => order.push('renderFight'), nextWord: () => order.push('nextWord'),
    winFight: () => { B.over = true; B.won = true; order.push('winFight'); },
    loseFight: () => order.push('loseFight'), finishNode: () => {}, saveDB: () => {},
    scheduleBattle: fn => { fn(); },
    onWholeWordComplete: w => { whole.push(w); order.push('onWholeWordComplete'); },
    onSpellingMistake: c => { wrong.push(c); order.push('onSpellingMistake'); },
  }, extraPorts) });
  return { ctrl, G, B, DB, order, whole, wrong };
}

test('combat：整词完成在 TTS.word 之后、致命判定与换词之前发布一次', () => {
  const h = makeCombat();
  for (const i of [0, 1, 2, 3]) h.ctrl.pressKey(i);        // k e e p
  assert.deepEqual(h.whole, ['keep'], '整词完成只发布一次');
  const at = h.order.indexOf('onWholeWordComplete');
  assert.ok(h.order.indexOf('tts.word') < at, '必须先发最高优先级朗读，再通知订阅者');
  assert.ok(at < h.order.indexOf('nextWord'), '必须在换词之前');
  assert.ok(h.order.indexOf('renderFight') < at, '不是换词之后才补报');
});

test('combat：半词绝不发布；最后一击赢下整场战斗那一局照样发布', () => {
  const h = makeCombat();
  h.ctrl.pressKey(0); h.ctrl.pressKey(1);
  assert.deepEqual(h.whole, [], '字母级完成不算学会');
  h.B.enHp = 5;
  h.ctrl.pressKey(2); h.ctrl.pressKey(3);
  assert.deepEqual(h.whole, ['keep'], '致命大招那一局同样发布（在 winFight 之前）');
  assert.ok(h.order.indexOf('onWholeWordComplete') < h.order.indexOf('winFight'));
  assert.equal(h.order.includes('nextWord'), false, '打死了就不换词');
});

test('combat：错字母被接受且判错才发布；重复点已标错字母、退格、提示都不算', () => {
  const h = makeCombat();
  h.ctrl.pressKey(4);                                   // x：不在词里 → 真实失手
  assert.deepEqual(h.wrong, ['x'], '真实失手发布一次');
  h.ctrl.pressKey(4);                                   // 再点同一个（已标 bad）
  assert.deepEqual(h.wrong, ['x'], '重复点已标错字母不算新的失手（惩罚已付过）');
  h.ctrl.pressKey(0);
  h.ctrl.undoLetter();                                  // 退格不是知识性失手
  assert.deepEqual(h.wrong, ['x'], '退格不发布');
  h.ctrl.requestHint();                                 // 提示是显式求助
  assert.deepEqual(h.wrong, ['x'], '提示不发布');
  assert.equal(h.ctrl.typeLetter('q'), false, '字母盘上没有的输入不发布');
  assert.deepEqual(h.wrong, ['x']);
});

test('combat：没接 port 时战斗行为不变（可选接线缺省成 no-op）', () => {
  const bare = makeCombat({}, { onWholeWordComplete: undefined, onSpellingMistake: undefined });
  bare.ctrl.pressKey(4);
  assert.deepEqual(bare.B.bad, [false, false, false, false, true], '照常标错');
  for (const i of [0, 1, 2, 3]) bare.ctrl.pressKey(i);
  assert.equal(bare.B.wordsDone, 1, '照常结算整词');
});

/* ---------------- 2. speech 低优先级播报 ---------------- */
class Utt { constructor(text) { this.text = text; } }
function speechHarness(behaviour = {}) {
  const spoken = [], cancelled = [];
  const cap = createAudioCapability({ environment: {} });
  const synth = {
    paused: false, speaking: !!behaviour.speaking, pending: !!behaviour.pending,
    speak(u) { spoken.push(u); if (behaviour.throwOnSpeak) throw new Error('refused'); },
    cancel() { cancelled.push(1); }, getVoices: () => [], addEventListener() {},
  };
  const speech = createSpeech({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['go'] } },
    foeLineCfg: () => ({ key: 'k', seed: 1, rate: 1, pitch: 1, lines: ['hi'] }),
    onChange: () => {}, environment: { speechSynthesis: synth, SpeechSynthesisUtterance: Utt },
    capability: cap,
  });
  return { speech, spoken, cancelled, synth };
}

test('speech：词正在念时低优先级播报不插话、不 cancel，词真结束后才可能出声', () => {
  const h = speechHarness();
  assert.equal(h.speech.word('keep'), true);
  assert.equal(h.speech.wordPriorityBusy(), true, '词念着就是忙');
  assert.equal(h.speech.announcement('First Blood'), false, '词在念时绝不插话');
  assert.equal(h.cancelled.length, 1, '只有 word() 自己那一次 cancel；播报不许再 cancel');
  assert.equal(h.spoken.length, 1, '播报没有产生任何 utterance');
  h.spoken[0].onend({ target: h.spoken[0] });            // 真实结束
  assert.equal(h.speech.wordPriorityBusy(), false, '真实 end 才释放');
  assert.equal(h.speech.announcement('First Blood'), true, '词念完之后才播');
  assert.equal(h.spoken[1].text, 'First Blood');
  assert.equal(h.cancelled.length, 1, '低优先级播报绝不 cancel 任何东西');
});

test('speech：上一句迟到的 end 不得清掉新一句的占用', () => {
  const h = speechHarness();
  h.speech.word('keep');
  const stale = h.spoken[0];
  h.speech.word('again');                               // 新一句占住
  stale.onend({ target: stale });                       // 旧的迟到 end
  assert.equal(h.speech.wordPriorityBusy(), true, '旧句的 end 不许释放新句的占用');
  assert.equal(h.speech.announcement('Double Kill'), false, '新词还在念 → 仍然不插话');
  h.spoken[1].onend({ target: h.spoken[1] });
  assert.equal(h.speech.wordPriorityBusy(), false);
});

test('speech：stop() 释放占用；战斗台词即使 force 也不许打断正在念的词', () => {
  const h = speechHarness();
  h.speech.word('keep');
  // ★ 终局台词（win/lose + force）现在走「一条有界延迟」：返回 true = **已受理**
  //   （记下来等通道空出来补播），但这一刻绝不产生 utterance、绝不 cancel 词。
  //   非终局台词的 false 仍然是「没播」的原义。
  assert.equal(h.speech.line('win', null, { force: true }), true, '终局台词被受理并排队');
  assert.equal(h.speech.wordPriorityBusy(), true, '词绝不被提前放掉');
  assert.equal(h.speech.line('atk', null, { force: true }), false, '普通台词不得抢词的读音');
  assert.equal(h.speech.foeLine({ n: '词灵' }, { force: true }), false);
  assert.equal(h.spoken.length, 1, '没有新增 utterance');
  assert.equal(h.cancelled.length, 1, '只有 word() 自己那一次 cancel');
  h.speech.stop();
  assert.equal(h.speech.wordPriorityBusy(), false, 'stop() 释放占用');
  assert.equal(h.speech.announcement('Triple Kill'), true);
  assert.equal(h.spoken.length, 2, 'stop() 之后绝不补播陈旧的终局台词');
});

test('speech：没有 TTS、玩家关掉朗读、合成器还在忙时都是 false，且绝不改偏好', () => {
  const bare = createSpeech({ heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar',
    rnd: () => 0, voiceLines: { scholar: { atk: ['go'] } }, foeLineCfg: () => null,
    onChange: () => {}, environment: {} });
  assert.equal(bare.announcement('First Blood'), false, '没有 speechSynthesis 时静默');
  assert.equal(bare.wordPriorityBusy(), false);

  const h = speechHarness();
  h.speech.setOn(false);
  assert.equal(h.speech.announcement('First Blood'), false, '玩家关掉朗读时不播');
  assert.equal(h.speech.on, false, '绝不替玩家打开偏好');
  h.speech.setOn(true);
  assert.equal(h.speech.announcement('First Blood'), true, '开着就播');

  const busy = speechHarness({ speaking: true });
  assert.equal(busy.speech.announcement('First Blood'), false, '合成器自己还在说 → 不插话');
});

/* ---------------- 3. 快照往返 / 旧存档 / 脏值 ---------------- */
const POOL = [{ w: 'keep', z: '保持', u: 1, d: 1, th: 'kiːp' }];
const baseRun = () => {
  const run = createRun(1, { id: 'scholar', mod: {} }, POOL);
  run.roundId = 'R-abc';
  run.node = run.rows[0][0];
  return run;
};
const env = (run, extra = {}) => ({ phase: PHASE.MAP, run, battle: null, encounter: null, ...extra });

test('snapshot：wordStreak 与 wordEventSeq 往返一致，且不落 UI/句柄/定时器', () => {
  const run = baseRun();
  run.wordStreak = { count: 3, lastEventId: 'R-abc:7' };
  run.wordEventSeq = 7;
  const envelope = encodeSnapshot(env(run), { now: 1000 });
  assert.deepEqual(envelope.run.wordStreak, { count: 3, lastEventId: 'R-abc:7' });
  assert.equal(envelope.run.wordEventSeq, 7);
  const back = decodeSnapshot(JSON.parse(JSON.stringify(envelope)));
  assert.equal(back.ok, true, '往返必须仍然合法');
  assert.deepEqual(back.value.run.wordStreak, { count: 3, lastEventId: 'R-abc:7' });
  assert.equal(back.value.run.wordEventSeq, 7);
  // 绝不序列化 UI / utterance / 定时器：只有两个事实字段。
  assert.deepEqual(Object.keys(envelope.run.wordStreak).sort(), ['count', 'lastEventId']);
});

test('snapshot：旧存档缺这两个字段时回落成 0，脏值整份 fail closed', () => {
  const run = baseRun();
  const envelope = encodeSnapshot(env(run), { now: 1000 });
  delete envelope.run.wordStreak; delete envelope.run.wordEventSeq;
  const legacy = decodeSnapshot(JSON.parse(JSON.stringify(envelope)));
  assert.equal(legacy.ok, true, '旧存档仍然可恢复');
  assert.deepEqual(legacy.value.run.wordStreak, { count: 0, lastEventId: null });
  assert.equal(legacy.value.run.wordEventSeq, 0);

  for (const bad of [{ count: '3', lastEventId: null }, { count: 99, lastEventId: null },
    { count: 1, lastEventId: 7 }, { count: -1, lastEventId: null }, 'nope', [1, 2]]) {
    const dirty = JSON.parse(JSON.stringify(envelope));
    dirty.run.wordStreak = bad;
    assert.equal(decodeSnapshot(dirty).ok, false, '脏 wordStreak 必须 fail closed: ' + JSON.stringify(bad));
  }
  const dirtySeq = JSON.parse(JSON.stringify(envelope));
  dirtySeq.run.wordEventSeq = -3;
  assert.equal(decodeSnapshot(dirtySeq).ok, false, '负序号 fail closed');
  const fracSeq = JSON.parse(JSON.stringify(envelope));
  fracSeq.run.wordEventSeq = 1.5;
  assert.equal(decodeSnapshot(fracSeq).ok, false, '非整数序号 fail closed');
});

/* ---------------- 4. 反馈协调器：默认窗口 / 暂停 / 新一轮 ---------------- */
function fb(over = {}) {
  let state = { count: 0, lastEventId: null };
  const calls = [];
  const jobs = [];
  const f = createWordStreakFeedback(Object.assign({
    getState: () => state, setState: s => { state = s; },
    speakAnnouncement: req => { calls.push(req.text); return true; },
    onAnnounce: () => {}, cancelSchedule: h => { const i = jobs.indexOf(h); if (i >= 0) jobs.splice(i, 1); },
    schedule: (fn) => { jobs.push(fn); return fn; },
    isBattleLive: () => true, getWordPriorityBusy: () => false,
  }, over));
  return { f, calls, jobs, state: () => state };
}

test('feedback：默认等待窗口容得下一整句词（不再是「每词必丢弃」）', () => {
  assert.equal(FEEDBACK_DEFER_MS, 120);
  assert.equal(FEEDBACK_DEFER_WINDOW_MS, 5000);
  assert.equal(FEEDBACK_MAX_DEFERRALS, 30);
  // 模拟一句真实长度的词：先念 25 拍（3.0s），念完之后频道空出来。
  // 两条界谁先到：默认 30 × 120ms = 3.6s 标称 < 5s 窗口，所以**重排次数上限**
  // 通常先到（25 拍远未用完 30 拍）；5s 窗口只在回调被事件循环拖迟到时才先到。
  let busy = true;
  const h = fb({ getWordPriorityBusy: () => busy });
  h.f.complete({ eventId: 'a:1', complete: true, correct: true });
  assert.deepEqual(h.calls, [], '词在念时不播');
  for (let i = 0; i < 25; i++) { const j = h.jobs.shift(); if (!j) break; j(); }
  assert.deepEqual(h.calls, [], '还在念的时候绝不插话');
  busy = false;
  const tail = h.jobs.shift(); if (tail) tail();
  assert.deepEqual(h.calls, ['First Blood'], '一个正常长度的词念完之后播报必须真的出声');
  assert.equal(h.jobs.length, 0, '播出之后不留悬挂的待播定时器');
});

test('feedback：迟到超过窗口的待播被丢弃，绝不补播陈旧阶段', () => {
  let t = 0;
  const h = fb({ getWordPriorityBusy: () => true, now: () => t });
  h.f.complete({ eventId: 'a:1', complete: true, correct: true });
  t = FEEDBACK_DEFER_WINDOW_MS + 1;                    // 事件循环卡顿，回调迟到
  const j = h.jobs.shift(); j();
  assert.deepEqual(h.calls, [], '过期的那一只必须安静丢弃');
});

test('feedback：暂停清在途播报但不动状态；继续不补播；新一局清零并解冻', () => {
  const h = fb({ getWordPriorityBusy: () => true });
  h.f.complete({ eventId: 'a:1', complete: true, correct: true });
  assert.equal(h.state().count, 1);
  h.f.pause();
  assert.deepEqual(h.jobs, [], '暂停取消在途待播');
  assert.equal(h.state().count, 1, '暂停一个字节都不动状态');
  const r = h.f.complete({ eventId: 'a:2', complete: true, correct: true });
  assert.equal(r.ok, false); assert.equal(r.reason, 'paused');
  h.f.resume();
  assert.deepEqual(h.calls, [], '继续绝不补播暂停期间丢掉的阶段');
  const after = h.f.complete({ eventId: 'a:3', complete: true, correct: true });
  assert.equal(after.state.count, 2, '继续之后继续正常计数');

  h.f.pause();
  h.f.newRun();
  assert.deepEqual(h.state(), { count: 0, lastEventId: null }, '新一局清零');
  assert.equal(h.f.isPaused(), false, '新一局必须解冻（否则新局第一词永远不计数）');
  const fresh = h.f.complete({ eventId: 'b:1', complete: true, correct: true });
  assert.equal(fresh.reason, 'grown', '新一局第一词是 First Blood');
});

test('feedback：真实打错清零，随后第一词重新出 First Blood；重复事件不重复播', () => {
  const h = fb();
  h.f.complete({ eventId: 'a:1', complete: true, correct: true });
  h.f.complete({ eventId: 'a:2', complete: true, correct: true });
  assert.deepEqual(h.calls, ['First Blood', 'Double Kill']);
  h.f.mistake({ eventId: 'a:3' });
  assert.equal(h.state().count, 0, '真实打错把连胜清零');
  const again = h.f.complete({ eventId: 'a:4', complete: true, correct: true });
  assert.equal(again.announcement.label, 'First Blood', '下一词重新从第一级开始');
  const dup = h.f.complete({ eventId: 'a:4', complete: true, correct: true });
  assert.equal(dup.reason, 'duplicate', '同一事件重复投递幂等');
  assert.equal(h.calls.length, 3, '重复投递不再产生播报');
});

test('feedback：第 8 级之后饱和，不再狂喊', () => {
  const h = fb();
  for (let i = 1; i <= 12; i++) h.f.complete({ eventId: 'a:' + i, complete: true, correct: true });
  assert.equal(h.state().count, 8);
  assert.deepEqual(h.calls, ['First Blood', 'Double Kill', 'Triple Kill', 'Quadra Kill',
    'Penta Kill', 'Rampage', 'Unstoppable', 'Godlike']);
});
