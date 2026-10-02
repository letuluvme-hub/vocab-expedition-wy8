/* speech 通道的三条回归（docs/feature-word-streak.md 的语音侧加固）。
 *
 * 1) **永久 busy**：一句词如果一个 onend/onerror 都不给（微信隐私模式、静默失败、
 *    标签页被冻结），占用令牌永远不会释放 → 低优先级播报从此永久静默。
 *    修法是加一条**独立的保守硬上界**：
 *      - 它**不复用** utteranceTimeoutMs（那是可关闭的兼容层开关，0 = 显式关）；
 *      - 没注入 capability 时**一个回调都不许改写**（老契约），但有界兜底照样生效；
 *      - 真实 end / error 仍然**早释放**（不让人多等一个上界），onstart 绝不解禁；
 *      - 上一句的上界定时器迟到**不许**解开新一句的占用。
 * 2) **播报被普通台词截断**：announcement 必须自己占住通道；普通 line / foeLine
 *    **即使 force:true** 也不许 cancel 它；新的 word / hint 有资格优先取消它。
 * 3) **胜利台词被直接吞**：词还在念时 line('win', force) 不丢弃、也不抢词，
 *    只排**一条**有界延迟；当前词真结束后留 ≥240ms grace 给每 120ms 的连胜播报
 *    先占通道，终局台词随后 noCancel 补上；stop() / 关掉朗读清队列，绝不补播。
 *
 * 全部用**注入的假时钟/假定时器**，不依赖真实时间，也不碰运行中的 Vite 源。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech } from '../../src/services/speech.js';
import { createAudioCapability } from '../../src/services/audio-capability.js';

/* ---- 可控时钟：now() 与 schedule/clear 都由测试注入，测「多久」不用真等 ---- */
function fakeClock() {
  let t = 1_000_000;
  let seq = 0;
  const jobs = new Map();                       // id → { at, fn }
  const earliest = target => {
    let best = null;
    for (const [id, j] of jobs) {
      if (j.at > target) continue;
      if (!best || j.at < best[1].at || (j.at === best[1].at && id < best[0])) best = [id, j];
    }
    return best;
  };
  return {
    now: () => t,
    schedule: (fn, ms) => { const id = ++seq; jobs.set(id, { at: t + Math.max(0, Math.round(ms || 0)), fn }); return id },
    clear: id => { jobs.delete(id) },
    pending: () => [...jobs.keys()],
    /* 抓一份定时器的回调本身。真实的 setTimeout 里，clearTimeout **挡不住**
       已经排进事件循环的那一次执行；所以「旧定时器迟到」必须能被单独触发。 */
    peek: id => { const j = jobs.get(id); return j ? j.fn : null },
    fire: id => { const j = jobs.get(id); if (!j) return false; jobs.delete(id); j.fn(); return true },
    advance(ms) {
      const target = t + Math.max(0, Math.round(ms));
      for (;;) { const j = earliest(target); if (!j) break; jobs.delete(j[0]); t = j[1].at; j[1].fn() }
      t = target;
    },
  };
}

class Utt { constructor(text) { this.text = text } }

function harness(over = {}) {
  const clock = fakeClock();
  const spoken = [], cancelled = [];
  const synth = {
    paused: false, speaking: false, pending: false,
    speak(u) { spoken.push(u) },
    cancel() { cancelled.push(1) },
    getVoices: () => [
      { lang: 'en-US', name: 'Samantha', localService: true },
      { lang: 'zh-CN', name: 'Microsoft Huihui', localService: true },
    ],
    addEventListener() {},
  };
  const opts = Object.assign({
    heroVoice: () => ({ rate: 0.9, pitch: 1 }), curHeroId: () => 'scholar', rnd: () => 0,
    voiceLines: { scholar: { atk: ['atk line'], win: ['win line'], lose: ['lose line'] } },
    foeLineCfg: () => ({ key: 'k', seed: 1, rate: 1, pitch: 1, lines: ['foe line'] }),
    onChange: () => {},
    environment: { speechSynthesis: synth, SpeechSynthesisUtterance: Utt },
    capability: createAudioCapability({ environment: {} }),
    now: clock.now, schedule: clock.schedule, clearScheduled: clock.clear,
    utteranceTimeoutMs: 0,                      // 关掉兼容层探测定时器，让假时钟独占
  }, over);
  if (opts.capability === null) delete opts.capability;
  const speech = createSpeech(opts);
  return { speech, clock, spoken, cancelled, synth,
    texts: () => spoken.map(u => u.text) };
}

test('queued final line is discarded after its battle scope ends without cancelling the word',()=>{
  const h=harness();let current=true;
  h.speech.word('keep');
  h.speech.line('win',null,{force:true,isCurrent:()=>current});
  current=false;
  h.spoken[0].onend({target:h.spoken[0]});
  h.clock.advance(1000);
  assert.deepEqual(h.texts(),['keep'],'no victory speech may leak into a later map or fight');
  assert.equal(h.cancelled.length,1,'scope rejection must not cancel the word');
  assert.equal(h.speech._final,null);
});

/* ================ 1. 永久 busy：独立的保守硬上界 ================ */

test('speech：注入 capability 也绝不会被一个永远不来的 end 永久锁成 busy', () => {
  const h = harness();
  h.speech.word('keep');                       // 一个 onend/onerror 都不给
  assert.equal(h.speech.wordPriorityBusy(), true);
  h.clock.advance(4999);
  assert.equal(h.speech.wordPriorityBusy(), true, '保守上界之内绝不早放行');
  h.clock.advance(1);
  assert.equal(h.speech.wordPriorityBusy(), false, '硬上界到了必须自己松手');
  assert.equal(h.speech.announcement('First Blood'), true, '播报重新有声');
});

test('speech：没注入 capability 时一个回调都不许改写，但有界兜底照样生效', () => {
  const h = harness({ capability: null });
  h.speech.word('keep');
  const u = h.spoken[0];
  assert.equal(u.onend, undefined, '没注入 capability 就不许改写 utterance 的 onend');
  assert.equal(u.onerror, undefined, '也不许改写 onerror');
  assert.equal(h.speech.wordPriorityBusy(), true);
  h.clock.advance(4999);
  assert.equal(h.speech.wordPriorityBusy(), true, '不早放行');
  h.clock.advance(1);
  assert.equal(h.speech.wordPriorityBusy(), false, '有界兜底独立于 capability 生效');
});

test('speech：长词没结束时按长词自己的上界算，绝不按短词提前放行', () => {
  const h = harness();
  const long = 'extraordinarily';
  h.speech.word(long);                         // hint 语速 0.7 → 估算更长，上界也更宽
  h.clock.advance(5000);
  assert.equal(h.speech.wordPriorityBusy(), true, '长词绝不按 5s 地板提前放行');
  h.clock.advance(40000);
  assert.equal(h.speech.wordPriorityBusy(), false, '长词自己的上界到了才放行');
});

test('speech：上一句的上界定时器迟到也不许解开新一句的占用', () => {
  const h = harness();
  h.speech.word('keep');
  const staleId = h.clock.pending()[0];
  const staleFn = h.clock.peek(staleId);
  assert.ok(staleFn != null, '第一句必须挂了自己的上界定时器');
  h.clock.advance(1000);
  h.speech.word('again');                      // 新一句占住
  assert.equal(h.clock.pending().includes(staleId), false, '新占用顺手收掉旧定时器（不留悬挂句柄）');
  staleFn();                                   // 但已经排进事件循环的那一次执行照样会发生
  assert.equal(h.speech.wordPriorityBusy(), true, '旧上界定时器不许释放新占用');
  assert.equal(h.speech.announcement('Double Kill'), false, '新词还在念 → 仍然不插话');
  assert.equal(h.clock.pending().length, 1, '新占用自己的那一个定时器必须还在');
});

test('speech：真实 end 早释放且清掉自己那一个定时器；stop() 同理', () => {
  const h = harness();
  h.speech.word('keep');
  assert.equal(h.clock.pending().length, 1);
  h.spoken[0].onend({ target: h.spoken[0] });
  assert.equal(h.speech.wordPriorityBusy(), false, '真实 end 早释放，不让人多等一个上界');
  assert.equal(h.clock.pending().length, 0, '真实 end 清掉自己的上界定时器');

  h.speech.word('again');
  assert.equal(h.clock.pending().length, 1);
  h.speech.stop();
  assert.equal(h.speech.wordPriorityBusy(), false, 'stop() 释放占用');
  assert.equal(h.clock.pending().length, 0, 'stop() 清掉上界定时器');
});

test('speech：onstart 只是「开始」，绝不在那里解禁', () => {
  const h = harness();
  h.speech.word('keep');
  h.spoken[0].onstart({ target: h.spoken[0] });
  assert.equal(h.speech.wordPriorityBusy(), true, '词还在念，onstart 不许解禁');
  assert.equal(h.speech.announcement('First Blood'), false);
});

/* ================ 2. 播报被普通台词截断 ================ */

test('speech：播报一旦送出就自己占住通道，普通台词即使 force 也不许 cancel 它', () => {
  const h = harness();
  assert.equal(h.speech.announcement('Godlike'), true, '播报真的送出去了');
  assert.equal(h.cancelled.length, 0, '播报自己绝不 cancel 任何东西');
  assert.equal(h.speech.line('atk', null, { force: true }), false, 'force 也不许截断播报');
  assert.equal(h.speech.line('atk'), false);
  assert.equal(h.speech.foeLine({ n: '词灵' }, { force: true }), false, '中文台词同样不许截断');
  assert.equal(h.spoken.length, 1, '没有任何新的 utterance，也没有 cancel');
  assert.equal(h.cancelled.length, 0);
  h.spoken[0].onend({ target: h.spoken[0] });    // 播报真结束
  assert.equal(h.speech.line('atk', null, { force: true }), true, '播报念完之后台词才可能出声');
  assert.deepEqual(h.texts(), ['Godlike', 'atk line']);
});

test('speech：播报的占用由真实 end 早释放；旧播报的迟到 end 不许清掉新播报', () => {
  const h = harness();
  h.speech.announcement('Godlike');
  const stale = h.spoken[0];
  h.spoken[0].onend({ target: stale });
  h.speech.announcement('Unstoppable');          // 第二条播报占住通道
  assert.equal(h.speech.line('atk', null, { force: true }), false, '新播报在念 → 台词让路');
  stale.onend({ target: stale });                // 上一条播报的迟到 end（已排进事件循环）
  assert.equal(h.speech.line('atk', null, { force: true }), false, '旧播报的迟到 end 不许释放新播报的占用');
  h.spoken[1].onend({ target: h.spoken[1] });
  assert.equal(h.speech.line('atk', null, { force: true }), true);
});

test('speech：新的词 / 提示有资格优先取消正在播的报', () => {
  const h = harness();
  h.speech.announcement('Godlike');
  assert.equal(h.speech.word('keep'), true, '词永远优先');
  assert.equal(h.cancelled.length, 1, '词那一次 cancel 是合法抢占');
  assert.deepEqual(h.texts(), ['Godlike', 'keep']);
  assert.equal(h.speech.announcement('Rampage'), false, '新词在念 → 不插话');
  h.spoken[1].onend({ target: h.spoken[1] });
  assert.equal(h.speech.announcement('Rampage'), true, '词念完之后播报重新有声');
  assert.deepEqual(h.texts(), ['Godlike', 'keep', 'Rampage']);
});

test('speech：播报自己也不许被自己的上一条占住（连续两条不排队）', () => {
  const h = harness();
  h.speech.announcement('First Blood');
  assert.equal(h.speech.announcement('Double Kill'), false, '播报自己占着通道时不再插一条');
  assert.deepEqual(h.texts(), ['First Blood']);
});

/* ============ 3. 胜利/失败终局台词被直接吞 ============
   终局台词在词还在念的时候 line('win', force) 只会拿到 false —— 玩家打赢的
   那一刻恰好听到的是词的读音，然后什么也没有。要求：只排**一条**有界延迟，
   等词（和播报）都真结束之后 noCancel 补上，绝不抢词、绝不无限排队。 */

test('speech：词还在念时终局台词被受理但不抢词，一个 utterance 都不产生', () => {
  const h = harness();
  h.speech.word('keep');
  assert.equal(h.speech.line('win', null, { force: true }), true, '终局台词被受理（排队，不是丢弃）');
  assert.deepEqual(h.texts(), ['keep'], '排队期间绝不产生新 utterance');
  assert.equal(h.cancelled.length, 1, '绝不动正在念的词（只有 word() 自己那一次 cancel）');
  assert.equal(h.speech.wordPriorityBusy(), true, '绝不为等终局台词而提前放掉词');
  h.clock.advance(4000);
  assert.deepEqual(h.texts(), ['keep'], '词还在念就继续等，绝不插话');
});

test('speech：词真结束后留 240ms grace 给每 120ms 的连胜播报，终局台词随后 noCancel 补上', () => {
  const h = harness();
  h.speech.word('keep');
  h.speech.line('win', null, { force: true });
  h.spoken[0].onend({ target: h.spoken[0] });    // 词真的念完了
  h.clock.advance(239);
  assert.deepEqual(h.texts(), ['keep'], 'grace 之内终局台词绝不抢在播报前面');
  // 连胜反馈的 120ms 轮询在这段 grace 里抢到通道
  assert.equal(h.speech.announcement('Godlike'), true);
  h.clock.advance(4000);
  assert.deepEqual(h.texts(), ['keep', 'Godlike'], '播报在念 → 终局台词继续等');
  h.spoken[1].onend({ target: h.spoken[1] });    // 播报真结束
  h.clock.advance(240);
  assert.deepEqual(h.texts(), ['keep', 'Godlike', 'win line'], '两者都结束后终局台词补上');
  assert.equal(h.cancelled.length, 1, '终局台词 noCancel，绝不 cancel 任何东西');
});

test('speech：只排一条终局台词，绝不无限排队', () => {
  const h = harness();
  h.speech.word('keep');
  assert.equal(h.speech.line('win', null, { force: true }), true);
  assert.equal(h.speech.line('lose', null, { force: true }), false, '已有待播 → 第二条直接丢弃');
  assert.equal(h.speech.line('win', null, { force: true }), false);
  h.spoken[0].onend({ target: h.spoken[0] });
  h.clock.advance(240);
  assert.deepEqual(h.texts(), ['keep', 'win line'], '补播且只补一条');
});

test('speech：通道一直不空时终局台词有寿命上限，过期就安静丢弃', () => {
  const h = harness();
  h.speech.word('keep');
  h.speech.line('win', null, { force: true });
  h.clock.advance(60000);                         // 词一个回调都不给，但硬上界已放行
  assert.deepEqual(h.texts(), ['keep'], '过期（或仍被占着）的待播绝不无限期补播');
  assert.equal(h.clock.pending().length, 0, '队列里不留悬挂定时器');
});

test('speech：stop() 与关掉朗读都清掉终局队列，绝不在停场 / 静音之后补播', () => {
  const h = harness();
  h.speech.word('keep');
  h.speech.line('win', null, { force: true });
  h.speech.stop();
  h.clock.advance(60000);
  assert.deepEqual(h.texts(), ['keep'], 'stop() 之后绝不补播');

  const h2 = harness();
  h2.speech.word('keep');
  h2.speech.line('win', null, { force: true });
  h2.speech.setOn(false);
  h2.clock.advance(60000);
  assert.deepEqual(h2.texts(), ['keep'], '关掉朗读之后绝不补播');
});

test('speech：通道本来就空时终局台词立刻出声，不走队列', () => {
  const h = harness();
  assert.equal(h.speech.line('win', null, { force: true }), true);
  assert.deepEqual(h.texts(), ['win line'], '没有竞争就直接念');
  assert.equal(h.clock.pending().length, 0, '不进队列就不留定时器');
  h.speech.line('lose', null, { force: true });
  assert.deepEqual(h.texts(), ['win line', 'lose line']);
});

test('speech：失败终局台词同样排队补播', () => {
  const h = harness();
  h.speech.word('keep');
  assert.equal(h.speech.line('lose', null, { force: true }), true);
  h.spoken[0].onend({ target: h.spoken[0] });
  h.clock.advance(240);
  assert.deepEqual(h.texts(), ['keep', 'lose line']);
});

test('speech：普通台词与终局台词都绝不许抢词的读音（force 也不豁免）', () => {
  const h = harness();
  h.speech.word('keep');
  assert.equal(h.speech.line('atk', null, { force: true }), false, '普通台词让路');
  assert.equal(h.speech.line('atk'), false);
  assert.equal(h.speech.foeLine({ n: '词灵' }, { force: true }), false, '中文台词让路');
  assert.deepEqual(h.texts(), ['keep'], '一个 utterance 都不产生');
  assert.equal(h.cancelled.length, 1, '绝不动正在念的词');
  // 终局台词是**排队**而不是抢占：受理了，但这一刻绝不抢词。
  assert.equal(h.speech.line('win', null, { force: true }), true);
  assert.deepEqual(h.texts(), ['keep'], '终局台词排队期间也不抢词');
  assert.equal(h.speech.wordPriorityBusy(), true, '绝不为等终局台词而提前放掉词');
});

test('speech：stop() 之后队列里那条绝不在之后的任何时刻复活', () => {
  const h = harness();
  h.speech.word('keep');
  assert.equal(h.speech.line('win', null, { force: true }), true);
  h.speech.stop();
  // stop() 之后又开始新的一句词 —— 这是最可能让「悬挂的待播」复活的一刻。
  h.speech.word('again');
  h.spoken[1].onend({ target: h.spoken[1] });        // 真实结束 → 通道再次空出来
  h.clock.advance(60000);
  assert.deepEqual(h.texts(), ['keep', 'again'], '停场之后绝不补播陈旧的胜利台词');
  assert.equal(h.clock.pending().length, 0, '队列里不留悬挂定时器');
});
