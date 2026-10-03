/* ============================================================
 * 蓄力条的合成动画契约（fix: 蓄力条卡顿）
 *
 * 用户实测症状：条每 250ms 被改一次 width，transition 只有 120ms，
 * 于是「动 120ms、停 130ms」—— 半程静止。real Chrome 取样 29 个
 * 50ms 间隔里有 10 个宽度完全不变。本文件锁死修法：
 *
 *   ① 进度用 transform:scaleX(ratio) 表示，width 恒为 100%。
 *      绝不再动 width —— width 是 layout 属性，每帧都重排。
 *   ② 同相位/同伤害/同一 window 且节点仍连接时，paint 与 paintLive
 *      **复用同一批节点**：打一个字母触发的 renderFight 不得重建
 *      进度条（重建 = 动画从 0 重新开始 = 又一次可见跳动）。
 *   ③ 相位变了 / window 变了 / 节点已断开（换屏）才允许重建。
 *   ④ 相同的文案与 class 不重写 —— 250ms 节拍每秒四次写同一个
 *      长字符串，是纯浪费。
 *   ⑤ 组件是**动效无关**的：reduced-motion 的降级全部由 CSS 承担
 *      （组件绝不查询 matchMedia，两处真相会互相打架），也绝不
 *      新增 requestAnimationFrame / setInterval —— 250ms lifecycle
 *      节拍是唯一的时基。
 * ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFoeAttackMeter } from '../../src/ui/components/foe-attack-meter.js';
import { FOE_PHASE } from '../../src/domain/foe-attack.js';

/* 带写入计数的 DOM 桩：只有组件真正用到的那几个能力，无第三方依赖。
 * style / textContent / className 都记录写次数，用来证明「没重写」。 */
function stubDom() {
  const writes = { style: [], text: [], cls: [] };
  const animations = [];
  const mk = tag => {
    const el = {
      tagName: tag, id: '', hidden: false, children: [], isConnected: true,
      _style: {}, _text: '', _cls: '', _html: '',
      get style() {
        const self = el;
        return new Proxy(self._style, {
          set(t, k, v) {
            writes.style.push([k, v]);
            t[k] = v;
            return true;
          },
        });
      },
      get className() { return el._cls; },
      set className(v) { writes.cls.push(v); el._cls = String(v); },
      get textContent() { return el._text; },
      set textContent(v) { writes.text.push(String(v)); el._text = String(v); el.children = []; },
      get innerHTML() { return el._html; },
      set innerHTML(v) { el._html = String(v); if (v === '') el.children = []; },
      appendChild(c) { el.children.push(c); return c; },
      animate(frames, timing) {
        const animation={frames,timing,playState:'running',
          pause(){this.playState='paused'},cancel(){this.playState='idle'}};
        animations.push(animation); return animation;
      },
    };
    return el;
  };
  const box = mk('div');
  return { box, mk, writes, animations, doc: { createElement: mk }, $: id => (id === 'fFoeAtk' ? box : null) };
}

const TEL = (remainingMs, extra = {}) => Object.assign(
  { schemaVersion: 1, phase: FOE_PHASE.TELEGRAPH, remainingMs, cycle: 0, interrupted: false }, extra);
const WIN = { telegraphMs: 5000, damage: 4 };

/* 依次返回 doc / $ 的快捷方式。 */
function meterOn(dom, opts) {
  return createFoeAttackMeter(Object.assign({ $: dom.$, doc: dom.doc }, opts));
}
const fillOf = dom => dom.box.children[0].children[0];

test('one continuous countdown spans the real remaining time without restarting on UI ticks',()=>{
  const dom=stubDom(), meter=meterOn(dom);
  meter.paint(TEL(4000),WIN);
  assert.equal(dom.animations.length,1);
  assert.equal(dom.animations[0].timing.duration,4000);
  assert.deepEqual(dom.animations[0].frames,[{transform:'scaleX(0.8000)'},{transform:'scaleX(0.0000)'}]);
  meter.paintLive(TEL(3750),WIN); meter.paint(TEL(3200),WIN);
  assert.equal(dom.animations.length,1,'late UI refreshes must not restart or postpone the countdown');
});
test('pause stops the compositor; resume uses frozen remaining time and phase changes cancel it',()=>{
  const dom=stubDom(), meter=meterOn(dom);
  meter.paint(TEL(4000),WIN); meter.pause();
  assert.equal(dom.animations[0].playState,'paused');
  meter.paint(TEL(3000),WIN);
  assert.equal(dom.animations[0].playState,'idle');
  assert.equal(dom.animations[1].timing.duration,3000);
  meter.paint({phase:FOE_PHASE.RECOVER,remainingMs:900},WIN);
  assert.equal(dom.animations[1].playState,'idle');
  meter.paint(TEL(5000),WIN); meter.paint(null,WIN);
  assert.equal(dom.animations[2].playState,'idle');
});

/* ---------------- ① 进度走 transform，绝不走 width ---------------- */

/* 比例 → scaleX(ratio)：断言数值，不锁死字符串格式（格式是实现细节）。 */
const scaleOf_ = el => {
  const m = /^scaleX\(([-0-9.eE]+)\)$/.exec(el.style.transform || '');
  return m ? parseFloat(m[1]) : null;
};

test('进度用 transform:scaleX 表示；width 恒为满宽，绝不被写成比例', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(5000), WIN);
  const fill = fillOf(dom);
  assert.equal(scaleOf_(fill), 1, '满格 = scaleX(1)');
  assert.equal(fill.style.width, undefined, '组件绝不写 width —— 那是 layout 属性');

  meter.paintLive(TEL(3000), WIN);
  assert.equal(scaleOf_(fill), 0.6, '3000/5000 = 60%');
  assert.equal(fill.style.width, undefined, '刷新也不写 width');
  assert.equal(fillOf(dom), fill, '同一个节点');
});

test('比例永远夹在 0..1：脏 remainingMs 不会画出 scaleX(>1) 或负值', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(5000), WIN);
  const fill = fillOf(dom);
  for (const ms of [-50, 0, 999999]) {
    meter.paintLive(TEL(ms), WIN);
    const r = scaleOf_(fill);
    assert.ok(r !== null && r >= 0 && r <= 1, `remainingMs=${ms} → scaleX=${r} 必须落在 [0,1]`);
  }
  assert.equal(scaleOf_(fill), 1, '999999ms 被夹到满格，而不是画出一根溢出的条');
});

/* ---------------- ② 同相位复用节点（打字母不许重建） ---------------- */

test('同相位同伤害的 paint 复用同一批节点：不重建、不把进度弹回满格', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(4000), WIN);
  const fill = fillOf(dom), bar = dom.box.children[0], txt = dom.box.children[1];

  // 打一个字母 → renderFight → paint。相位没变，绝不重建。
  meter.paint(TEL(3500), WIN);
  assert.equal(dom.box.children.length, 2, 'DOM 结构没变');
  assert.equal(dom.box.children[0], bar, '进度条是同一个对象');
  assert.equal(fillOf(dom), fill, '填充是同一个对象');
  assert.equal(dom.box.children[1], txt, '文案节点是同一个对象');
  // 复用时必须直接落到当前比例，绝不先归 1 再动 —— 那正是可见的跳动。
  assert.equal(scaleOf_(fill), 0.7);
  // 真正的不变量：复用路径上的进度写入**单调不增**。
  // 一旦出现「涨回去」，就说明动画被弹回起点重新开始了。
  const scaleWrites = dom.writes.style.filter(w => w[0] === 'transform')
    .map(w => parseFloat(/scaleX\(([-0-9.eE]+)\)/.exec(w[1])[1]));
  assert.ok(scaleWrites.length >= 2, `复用了就要写进度（实际：${JSON.stringify(scaleWrites)}）`);
  for (let i = 1; i < scaleWrites.length; i++) {
    assert.ok(scaleWrites[i] <= scaleWrites[i - 1],
      `进度绝不许往回弹（写序：${JSON.stringify(scaleWrites)}）`);
  }
});

test('paintLive 与 paint 交替调用仍然复用同一批节点', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(5000), WIN);
  const bar = dom.box.children[0], fill = fillOf(dom);
  meter.paintLive(TEL(4500), WIN);
  meter.paint(TEL(4000), WIN);      // 打字母
  meter.paintLive(TEL(3500), WIN);
  meter.paint(TEL(3000), WIN);
  assert.equal(dom.box.children[0], bar);
  assert.equal(fillOf(dom), fill);
  assert.equal(scaleOf_(fill), 0.6);
});

/* ---------------- ③ 允许重建的三种情况 ---------------- */

test('相位变了才重建（绝不把上一相位的残骸留在屏幕上）', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(1000), WIN);
  const before = fillOf(dom);
  meter.paint({ schemaVersion: 1, phase: FOE_PHASE.RECOVER, remainingMs: 900, cycle: 1, interrupted: true }, WIN);
  assert.notEqual(fillOf(dom), before, '换了相位就是新的节点');
  assert.equal(scaleOf_(fillOf(dom)), 0, '收招相位的条必须为空');
});

test('window 变了才重建（telegraphMs 变了，旧比例的含义已经不同）', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(3000), WIN);
  const before = fillOf(dom);
  meter.paint(TEL(3000), { telegraphMs: 3000, damage: 4 });
  assert.notEqual(fillOf(dom), before, '总窗口变了必须重建');
  meter.paint(TEL(3000), WIN);
  assert.notEqual(fillOf(dom), before, '换回去也要重建');
});

test('节点已断开（换屏 / 容器被换掉）必须重建，绝不复用孤魂', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(4000), WIN);
  const before = fillOf(dom);

  before.isConnected = false;                       // 旧节点被摘走了
  meter.paint(TEL(3500), WIN);
  assert.notEqual(fillOf(dom), before, '断开的节点绝不复用');
  assert.equal(fillOf(dom).isConnected, true, '新节点接上了');

  // 容器本身被换掉（另一个 screen 的同名节点）：refs.box 对不上 → 重建。
  const fresh = stubDom();
  fresh.box.children = [];
  const meter2 = createFoeAttackMeter({
    $: id => (id === 'fFoeAtk' ? fresh.box : null), doc: fresh.doc,
  });
  meter2.paint(TEL(4000), WIN);
  assert.equal(fresh.box.children.length, 2);
});

/* ---------------- ④ 不重写相同文案 / class ---------------- */

test('秒数没跨整秒就不重写那段长文案（250ms 节拍每秒四次，纯浪费）', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(4200), WIN);
  const before = dom.writes.text.length;

  // 同一秒内连刷四次（都在 (4000,5000] → ceil 全部 = 5）：一次都不该再写。
  meter.paintLive(TEL(4100), WIN);
  meter.paintLive(TEL(4050), WIN);
  meter.paintLive(TEL(4020), WIN);
  meter.paintLive(TEL(4001), WIN);
  assert.equal(dom.writes.text.length, before, '同一秒内绝不重写文案');

  // 跨过整秒界线：必须写一次新的秒数（ceil(2.9) = 3 → "3s"）。
  meter.paintLive(TEL(2900), WIN);
  assert.equal(dom.writes.text.length, before + 1, '跨秒才写一次');
  assert.match(dom.box.children[1].textContent, /3s/);
});

test('class 没变就不重写', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(4200), WIN);
  const before = dom.writes.cls.length;
  meter.paintLive(TEL(4100), WIN);
  meter.paintLive(TEL(4000), WIN);
  assert.equal(dom.writes.cls.length, before, '同相位 class 不重写');
});

/* ---------------- ⑤ 动效无关，且不新增时基 ---------------- */

test('组件绝不查询 matchMedia：reduced-motion 的降级只有一个真相（CSS）', () => {
  const dom = stubDom();
  const orig = globalThis.window;
  let asked = 0;
  globalThis.window = { matchMedia: () => { asked++; return { matches: false, addEventListener() { } }; } };
  try {
    const meter = meterOn(dom);
    meter.paint(TEL(4000), WIN);
    meter.paintLive(TEL(3000), WIN);
  } finally {
    if (orig === undefined) delete globalThis.window; else globalThis.window = orig;
  }
  assert.equal(asked, 0, 'JS 侧不判 prefers-reduced-motion');
});

test('组件不新增 requestAnimationFrame / setInterval（250ms lifecycle 节拍是唯一时基）', () => {
  const dom = stubDom();
  const origWin = globalThis.window, origRaF = globalThis.requestAnimationFrame,
    origInt = globalThis.setInterval, origT = globalThis.setTimeout;
  globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() { } }) };
  globalThis.requestAnimationFrame = () => { throw new Error('组件不许新增 rAF'); };
  globalThis.setInterval = () => { throw new Error('组件不许新增 setInterval'); };
  try {
    const meter = meterOn(dom);
    meter.paint(TEL(4000), WIN);
    for (let i = 0; i < 20; i++) meter.paintLive(TEL(4000 - i * 100), WIN);
  } finally {
    globalThis.window = origWin;
    globalThis.requestAnimationFrame = origRaF;
    globalThis.setInterval = origInt;
    globalThis.setTimeout = origT;
  }
  assert.ok(true);
});

/* ---------------- 原有功能不许被这次改动弄丢 ---------------- */

test('降级/归零/无 DOM 三条原有行为原样保留', () => {
  const dom = stubDom();
  const meter = meterOn(dom);
  meter.paint(TEL(5000), WIN);
  assert.equal(dom.box.children.length, 2, '条 + 文案');
  const out = meter.paintLive(TEL(-50), WIN);
  assert.equal(out.ratio, 0, '脏值不许画出负进度');
  assert.equal(out.secs, 0);
  assert.match(dom.box.children[1].textContent, /0s/);

  const bare = createFoeAttackMeter({
    $: () => null, doc: { createElement: () => { throw new Error('不该建元素'); } },
  });
  assert.doesNotThrow(() => bare.paintLive(TEL(1000), WIN));
});
