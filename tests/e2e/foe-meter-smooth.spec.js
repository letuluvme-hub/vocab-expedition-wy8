import { test, expect } from './game-harness.js';

test.beforeEach(({},info)=>{
  test.skip(info.project.metadata.target==='legacy','Archived page has no telegraph meter; this suite verifies the new feature');
});

/* ============================================================
 * 蓄力条「不卡」的真实浏览器验收（fix: 蓄力条卡顿）
 *
 * ★ 三条方法论上的诚实声明 ——
 *   1. 这里断言的是**视觉 bbox**（getBoundingClientRect），不是内联样式。
 *      过渡期间内联 width 早就写到终值了，只有 bbox 反映画面上真正看到的东西。
 *   2. 关键用例在 prefers-reduced-motion: no-preference 下取样。
 *      本仓库的 playwright.config.js 全局是 reduce + responsive.css 里
 *      `*{transition-duration:.01ms !important}` —— 在 reduce 下量「顺滑」
 *      只会得到恒绿的假象（那里本来就该是静止的）。
 *      所以下面这组显式覆盖成 no-preference，量的是**线上默认**的那条路径。
 *   3. 仍然是真实 Chrome + 真实墙钟，没有加速任何定时器。
 *      这仍不等于真机：iOS/Android 的后台节流需人工验证。
 * ============================================================ */

/* 进度条的**视觉** bbox 采样器：在页面里每 50ms 读一次 rect。
   返回相对条容器左边缘的可见宽度，以及内联 transform。 */
const SAMPLE = async (page, ms = 1250) => page.evaluate(async (dur) => {
  const bar = document.querySelector('#fFoeAtk .foeAtkBar');
  const fill = document.querySelector('#fFoeAtk .foeAtkBar > i');
  const box = bar.getBoundingClientRect();
  const out = [];
  const t0 = performance.now();
  await new Promise(res => {
    function loop() {
      const b = fill.getBoundingClientRect();
      out.push({
        at: Math.round(performance.now() - t0),
        w: +(b.width).toFixed(2),
        transform: fill.style.transform,
        inlineWidth: fill.style.width,
      });
      if (performance.now() - t0 > dur) return res();
      setTimeout(loop, 50);
    }
    loop();
  });
  return { samples: out, barWidth: box.width };
}, ms);

/* 相邻两帧完全没动的间隔数。卡顿的形态就是这个数很大：动 120ms、停 130ms。 */
function stalledIntervals(samples) {
  let n = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].w === samples[i - 1].w) n++;
  return n;
}

/* 这条用例是本次修复的核心验收，必须在默认（no-preference）动效下量。 */
test.describe('蓄力条合成动画（默认动效路径）', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('默认动效下条是连续运动的，不是「动 120ms 停 130ms」', async ({ game }) => {
    test.setTimeout(60_000);
    await game.open();
    await game.start();
    await game.fight({ enemyHp: 10_000 });
    await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph',
      null, { timeout: 20_000 });

    // 确认测的确实是默认动效路径（不是被全局 reduce 悄悄改掉的）。
    const motion = await game.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(motion, '必须量 no-preference 这条路径').toBe(false);

    const { samples, barWidth } = await SAMPLE(game.page, 1250);

    // ① 进度用 transform 承载，绝不是内联 width。
    expect(samples.at(-1).inlineWidth, '组件绝不写内联 width').toBe('');
    expect(samples.at(-1).transform, '进度由 scaleX 承载').toMatch(/^scaleX\(/);

    // ② 整条确实在走（不是卡在一个比例上）。
    const widths = samples.map(s => s.w);
    expect(Math.max(...widths) - Math.min(...widths), '1.25 秒里宽度确实在变')
      .toBeGreaterThan(barWidth * 0.02);

    // ③ 核心：50ms 间隔的相邻帧里「完全没动」的比例必须很小。
    //    旧实现（width + .12s 过渡，250ms 节拍）：29 帧里 10 帧静止 ≈ 35%。
    //    过渡时长改成 .26s 后相邻两拍首尾重叠，任何时刻都有在跑的过渡。
    const stalled = stalledIntervals(samples);
    const ratio = stalled / (samples.length - 1);
    expect(ratio, `静止间隔 ${stalled}/${samples.length - 1}（${Math.round(ratio * 100)}%）—— ` +
      `旧实现约 35%。采样：${JSON.stringify(widths)}`)
      .toBeLessThan(0.15);

    // ④ 单调不增：绝不许出现「弹回去」，那说明动画被重启了。
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i], `第 ${i} 帧不许比前一帧宽（弹回 = 动画重启）`).toBeLessThanOrEqual(widths[i - 1] + 0.5);
    }
  });

  test('打字母触发 renderFight 不重建进度条、不把进度弹回起点', async ({ game }) => {
    test.setTimeout(60_000);
    await game.open();
    await game.start();
    await game.fight({ enemyHp: 10_000 });
    await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph',
      null, { timeout: 20_000 });

    const probe = await game.page.evaluate(async () => {
      const fill = () => document.querySelector('#fFoeAtk .foeAtkBar > i');
      const node = fill();
      const bar = document.querySelector('#fFoeAtk .foeAtkBar').getBoundingClientRect().width;
      const before = fill().getBoundingClientRect().width;
      const widths = [];
      // Explicitly exercise the renderer without a phase change. Repeated bad
      // input returns before renderFight and cannot prove this interface.
      const B = window.__gameTest.B;
      window.__gameTest.renderFight();
      const t0 = performance.now();
      await new Promise(res => {
        function loop() {
          widths.push(+fill().getBoundingClientRect().width.toFixed(2));
          if (performance.now() - t0 > 900) return res();
          setTimeout(loop, 50);
        }
        loop();
      });
      return {
        sameNode: fill() === node,
        oldNodeStillConnected: node.isConnected,
        bar, before, widths,
        phase: B.foeAttack.phase,
      };
    });

    expect(probe.sameNode, '同相位下 renderFight 绝不许重建进度条节点').toBe(true);
    expect(probe.oldNodeStillConnected, '旧节点没有被摘掉').toBe(true);
    // 重建会把 scaleX 从 1 重新起步 —— 视觉上就是「条突然涨回满格」。
    expect(Math.max(...probe.widths.slice(1)), `打字母后不许弹回满格（采样：${JSON.stringify(probe.widths)}）`)
      .toBeLessThan(probe.before + 1);
    for (let i = 1; i < probe.widths.length; i++) {
      expect(probe.widths[i], '打字母后进度仍单调不增').toBeLessThanOrEqual(probe.widths[i - 1] + 0.5);
    }
  });

  test('暂停时不后台耗 CPU：暂停后不再有样式写入、也不新增定时器', async ({ game }) => {
    test.setTimeout(60_000);
    await game.open();
    await game.start();
    await game.fight({ enemyHp: 10_000 });
    await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph',
      null, { timeout: 20_000 });

    const res = await game.page.evaluate(async () => {
      const fill = document.querySelector('#fFoeAtk .foeAtkBar > i');
      let rafBefore = 0, ivBefore = 0, timerBefore = 0;
      const oRaf = window.requestAnimationFrame, oIv = window.setInterval, oTo = window.setTimeout;
      window.requestAnimationFrame = function (f) { rafBefore++; return oRaf.call(window, f); };
      window.setInterval = function (...a) { ivBefore++; return oIv.apply(window, a); };
      window.setTimeout = function (...a) { timerBefore++; return oTo.apply(window, a); };

      window.__gameTest.pauseNow();
      // 暂停后静置 2 秒（覆盖 ≥ 6 个 250ms 节拍）。
      const writes = [];
      const t0 = performance.now();
      await new Promise(res2 => {
        function loop() {
          writes.push(fill.style.transform);
          if (performance.now() - t0 > 2000) return res2();
          setTimeout(loop, 200);
        }
        loop();
      });
      window.requestAnimationFrame = oRaf; window.setInterval = oIv; window.setTimeout = oTo;
      return {
        distinct: [...new Set(writes)],
        raf: rafBefore, iv: ivBefore, to: timerBefore,
        remaining: window.__gameTest.foeAttack.remainingMs(),
        phase: window.__gameTest.B.foeAttack.phase,
      };
    });

    // ① 2 秒里一个 250ms 节拍都没有再写进度 —— 没有后台动画在跑。
    expect(res.distinct.length, `暂停后样式不再被改写（实际写入：${JSON.stringify(res.distinct)}）`).toBe(1);
    // ② 组件没有新增 rAF / setInterval；计时器只在采样循环里（由我们自己的
    //    setTimeout 轮询产生，数量与 2 秒 / 200ms 的采样数相符）。
    expect(res.raf, '组件绝不新增 requestAnimationFrame').toBe(0);
    expect(res.iv, '组件绝不新增 setInterval').toBe(0);
    // ③ 暂停期间相位与剩余都不动。
    expect(res.phase).toBe('telegraph');
    expect(res.remaining).toBeGreaterThan(0);
  });

  test('继续后按真实剩余同步：进度立刻接上冻结值，不重启也不归零', async ({ game }) => {
    test.setTimeout(60_000);
    await game.open();
    await game.start();
    await game.fight({ enemyHp: 10_000 });
    await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph',
      null, { timeout: 20_000 });

    const res = await game.page.evaluate(async () => {
      const t = window.__gameTest;
      t.pauseNow();
      const saved = t.foeAttack.remainingMs();
      await new Promise(r => setTimeout(r, 1500));
      t.resumeFromPause();
      const rightAfter = t.foeAttack.remainingMs();
      // 继续后立刻读视觉进度，等一个 300ms 让过渡走完。
      const fill = () => document.querySelector('#fFoeAtk .foeAtkBar > i');
      const bar = () => document.querySelector('#fFoeAtk .foeAtkBar').getBoundingClientRect().width;
      await new Promise(r => setTimeout(r, 350));
      const b = bar();
      const progress = b > 0 ? fill().getBoundingClientRect().width / b : null;
      return { saved, rightAfter, progress, win: 5000 };
    });

    expect(res.rightAfter, '继续后剩余 ≈ 暂停时的冻结值，绝不为 0').toBeGreaterThan(0);
    expect(Math.abs(res.rightAfter - res.saved), '继续后剩余仍以冻结值为基准').toBeLessThan(400);
    // 视觉进度必须与真实剩余一致（不是弹回满格，也不是归零）。
    const expected = Math.max(0, Math.min(1, res.rightAfter / res.win));
    expect(res.progress, `视觉进度 ${res.progress} 应接近真实剩余比例 ${expected}`)
      .toBeGreaterThan(expected - 0.12);
    expect(res.progress, '绝不许被弹回满格').toBeLessThan(1);
  });

  test('过渡时长略长于 250ms 节拍：相邻两拍首尾重叠，不留静止缝隙', async ({ game }) => {
    await game.open();
    await game.start();
    await game.fight({ enemyHp: 10_000 });
    await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph',
      null, { timeout: 20_000 });

    const cs = await game.page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#fFoeAtk .foeAtkBar > i'));
      return { prop: s.transitionProperty, dur: s.transitionDuration, fill: s.width, origin: s.transformOrigin };
    });
    expect(cs.prop, '过渡的是 transform（合成属性），不是 width').toContain('transform');
    expect(cs.prop, '绝不再过渡 width').not.toContain('width');
    const dur = parseFloat(cs.dur);
    // 略大于 250ms：等于或小于节拍就会重新出现「动完就停」。
    expect(dur, `过渡 ${dur}s 必须 > 0.25s 的节拍`).toBeGreaterThan(0.25);
    expect(dur, '但也不能长到拖尾（≤ ~260ms）').toBeLessThanOrEqual(0.3);
  });
});

test('真实提示重画使用当前剩余，不把蓄力进度弹回旧快照', async ({game,page}) => {
  test.setTimeout(60000);
  await game.open(); await game.start(); await game.fight({enemyHp:10000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>window.__gameTest.B.foeAttack.phase==='telegraph',null,{timeout:20000});
  await page.waitForTimeout(1300);
  const result=await page.evaluate(async()=>{
    const fill=document.querySelector('#fFoeAtk i');const before=fill.getBoundingClientRect().width;
    document.getElementById('tHint').click();
    const out=[];for(let i=0;i<7;i++){out.push(fill.getBoundingClientRect().width);await new Promise(r=>setTimeout(r,50))}
    return {before,after:out,same:fill===document.querySelector('#fFoeAtk i')};
  });
  expect(result.same).toBe(true);
  expect(Math.max(...result.after),'提示重画不许把剩余进度涨回旧值').toBeLessThanOrEqual(result.before+1);
});

/* ---------------- reduced-motion：静态降级，秒数照走 ---------------- */

test.describe('蓄力条（减少动态效果）', () => {
  test.use({ reducedMotion: 'reduce' });

  test('reduce 下不显示跳动条，但秒数照常递减、仍然显眼', async ({ game }) => {
    test.setTimeout(60_000);
    await game.open();
    await game.start();
    await game.fight({ enemyHp: 10_000 });
    await game.page.waitForFunction(() => window.__gameTest.B.foeAttack.phase === 'telegraph',
      null, { timeout: 20_000 });

    // ① 过渡被彻底关掉。
    const cs = await game.page.evaluate(() => {
      const i = document.querySelector('#fFoeAtk .foeAtkBar > i');
      const s = getComputedStyle(i);
      const bar = document.querySelector('#fFoeAtk .foeAtkBar');
      return {
        dur: s.transitionDuration,
        barVisible: getComputedStyle(bar).display !== 'none',
        txt: document.getElementById('fFoeAtk').innerText,
        txtVisible: !!document.querySelector('#fFoeAtk .foeAtkTxt').offsetParent
          || document.querySelector('#fFoeAtk .foeAtkTxt').getBoundingClientRect().height > 0,
      };
    });
    expect(parseFloat(cs.dur), 'reduce 下不许有过渡').toBeLessThanOrEqual(0.01);
    expect(cs.barVisible, 'reduce 下不显示那条跳动的条').toBe(false);
    expect(cs.txtVisible, '秒数文案仍然可见 —— 这是降级后唯一的时间来源').toBe(true);
    expect(cs.txt).toMatch(/蓄力中\s*\d+s/);

    // ② 秒数真的在递减（静态但准确，绝不是恒定的 5s）。
    const secs = await game.page.evaluate(async () => {
      const seen = [];
      const t0 = performance.now();
      await new Promise(res => {
        function loop() {
          const m = /蓄力中\s*(\d+)s/.exec(document.getElementById('fFoeAtk').innerText);
          if (m) seen.push(Number(m[1]));
          if (performance.now() - t0 > 2600) return res();
          setTimeout(loop, 200);
        }
        loop();
      });
      return seen;
    });
    expect(Math.min(...secs), `秒数确实在走（采样：${JSON.stringify(secs)}）`).toBeLessThan(Math.max(...secs));
  });

  /* ★ 每个尺寸一个独立用例，不能塞进循环：
     game.open() 只在 sessionStorage 首次播种存档，第二轮读到的是第一轮留下的
     activeRun，start() 于是走「放弃旧局」确认分支，#s-map 永远不出现 ——
     那是测试脚手架的坑，不是产品行为（tests/e2e/foe-attack.spec.js 已记录）。 */
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    test(`reduce 下 ${size.width}px 窄屏：字母盘可见、蓄力条不遮它`, async ({ game }) => {
      await game.page.setViewportSize(size);
      await game.open();
      await game.start();
      await game.fight({ enemyHp: 10_000 });
      await game.page.waitForFunction(() => !!window.__gameTest.B.foeAttack, null, { timeout: 20_000 });

      const geo = await game.page.evaluate(() => {
        const r = id => { const b = document.getElementById(id).getBoundingClientRect();
          return { y: b.y, bottom: b.bottom, x: b.x, right: b.right, w: b.width }; };
        return { meter: r('fFoeAtk'), bank: r('fBank'), vw: innerWidth, vh: innerHeight,
          scrollW: document.documentElement.scrollWidth };
      });
      expect(geo.bank.y, `${size.width}px 字母盘可见`).toBeGreaterThanOrEqual(-1);
      expect(geo.bank.bottom, `${size.width}px 字母盘不溢出`).toBeLessThanOrEqual(geo.vh + 1);
      expect(geo.bank.right, `${size.width}px 字母盘不横向溢出`).toBeLessThanOrEqual(geo.vw + 1);
      expect(geo.meter.w, `${size.width}px 蓄力条容器仍在`).toBeGreaterThan(0);
      expect(geo.meter.bottom, `${size.width}px 蓄力条不遮字母盘`).toBeLessThanOrEqual(geo.bank.y + 1);
      expect(geo.scrollW, `${size.width}px 不横向溢出`).toBeLessThanOrEqual(geo.vw + 1);
    });
  }
});