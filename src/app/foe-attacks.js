/* 蓄力自主攻击的应用层协调器（docs/product-backlog.md 清单 13）。
 *
 * 只做三件事：排期、把相位事实挂到 battle 上、把相位翻译成端口调用。
 * 规则本身全在 domain/foe-attack.js —— 这里不重写一份相位表。
 *
 * ── 为什么不用 setInterval ────────────────────────────────────────────
 * 定时器**全部**走 lifecycle.scheduleBattle：它带 battle epoch 归属、暂停冻结与
 * 剩余时间续跑。自己 new setInterval 的话，暂停、换战斗、战败三件事全都拦不住它 ——
 * 玩家暂停三秒回来凭空挨两下，比没有这个功能更糟。
 * 而且排期方式是**一次性**的（相位走一步、排下一步），不是固定间隔：
 * 固定间隔遇上后台标签页节流会一次性补跑，chain 式排期每次只走一步，
 * 天然不会「攒够伤害一次性打完」。
 *
 * ── 伤害为什么不走 hurtPlayer ────────────────────────────────────────
 * hurtPlayer 是「玩家答错」的惩罚路径：它记错词、把词踢进复习队列、从 mastered
 * 里删掉、还要消耗幸运草/首领首击减半。自主攻击是**怪自己在打玩家**，
 * 走那条路径等于凭空把一个没答错的词判成错词 —— 直接破坏学习主线。
 * 所以这里只有一个独立端口 foeAttackHit(amount)，由 app/runtime 接到
 * 「护盾 → 生命 → 判负」那条纯血量路径。
 *
 * ── 自主攻击的伤害与相位推进是**同一次事务** ─────────────────────────
 * 旧实现先 commitPhase(attack) → 再 commitPhase(recover) → 最后才调
 * foeAttackHit，于是快照里出现过一帧「怪已经收招、但玩家一滴血都没掉」。
 * 那份存档刷新回来会永久少一次伤害（血量与相位对不上，且没有任何地方会自愈）。
 * 现在 step() 走 applyPhase(next, { publish:false }) 排期、结算伤害，
 * 最后只 publish 一次 —— 落盘那一刻「这一轮已完成」与「血已经扣了」必然同时为真。
 *
 * ── 暂停冻结与继续重定位 ────────────────────────────────────────────
 * pause() 采**暂停那一刻**的剩余时间，resume() 只把 dueAt 重定位到
 * now + savedRemaining，不重排 lifecycle 已冻结的同页队列、不新增任务。
 * 少这一步的话，同页暂停 30 秒再继续：dueAt 早已过期，captureFact 立刻算成 0，
 * 一次刷新就凭空挨一下（这正是 probes 里的 captureFact 0）。
 *
 * ── 蓄力条 250ms 刷新节拍 ───────────────────────────────────────────
 * 蓄力期间蓄力条必须**看得见时间在走**，否则玩家面对一个静止的「5s」。
 * 节拍同样走 lifecycle.scheduleBattle（一次性 chain，不是 setInterval）：
 * 暂停被冻结、换战斗被 epoch 作废、战败后自然停。每 tick 只 paint 蓄力条
 * （paintAttack 端口），**不落盘、不推进相位、不整屏 renderFight** ——
 * 整屏重渲染会重建字母盘，玩家点字母点到一半按钮被换掉。
 */
import {
  FOE_PHASE, foeAttackKind, foeAttackProfile, createFoeAttackFact,
  phaseMs, advanceFoeAttack, interruptFoeAttack, encodeFoeAttack, decodeFoeAttack,
} from '../domain/foe-attack.js';
/* 逐轮难度（清单 10）。本控制器只负责「把**本轮**档案应用一次」：
 * 规则本身全在 domain/round-difficulty.js，这里不重写任何曲线。 */
import { scaleFoeAttackProfile } from '../domain/round-difficulty.js';

// UI 刷新节拍：4Hz。够看见秒数在走，又不至于每秒四次重排。
export const FOE_UI_TICK_MS = 250;

export function createFoeAttackController({
  state, lifecycle, now = Date.now,
  foeAttackHit, commit, renderFight, toast,
  frozen = false,          // 词汇完成 / 奖励 / 结算屏：怪不再主动攻击
  mutate,                  // 最外层事务边界（runtime 的 mutate）：伤害链上的重入由它收口
  paintAttack,             // UI 节拍专用端口：只 paint 蓄力条，不整屏渲染
}) {
  // runtime 的 state 是**取值函数**（createProgressController 用同一个形态）：
  // 有的装配给 getBattle()，有的只暴露 B 这个取值器。两种都要认 ——
  // 只认一种会让 start() 静默拿到 null，战斗里从头到尾没有蓄力事实，
  // 而且不报任何错（最难查的那一类）。
  const getB = () => (state && typeof state.getBattle === 'function' ? state.getBattle()
    : (state ? state.B : null));
  // 逐轮难度事实只在本局读一次（本run 派生时就冻结了，见 runtime.newRun）：
  // 缺键的旧存档按基线（倍率全 1），绝不按当前 DB.runs 重算。
  const getG = () => (state && typeof state.getRun === 'function' ? state.getRun()
    : (state ? state.G : null));
  const difficulty = () => { const G = getG(); return G ? G.difficulty : undefined; };
  // ★ 本场战斗用哪一档：**起手时算一次**（base × 本局难度），之后不因换词重算。
  //   未缩放的档案仍然取自 domain/foe-attack.js 的 foeAttackProfile —— 单一来源。
  const profile = () => scaleFoeAttackProfile(foeAttackProfile(foeAttackKind(getB() || {})), difficulty());
  // 本场战斗的档位在 start() 时定死一次，中途不重算：
  // 否则一个中途改 boss 标记的旧档会把正在进行的蓄力按另一档重排。
  let cfg = scaleFoeAttackProfile(foeAttackProfile('normal'), difficulty());
  let dueAt = 0;            // 绝对到期时刻：**只在内存里**，绝不落盘
  // 暂停时冻结的剩余时间。pause() 采、resume() 用；null = 没暂停。
  // ★ 用自己的 pausedRemaining 而不是靠 frozenNow() 临时判断：
  //   frozen 是个通用开关（奖励屏/结算屏也会为真），拿它当「暂停了」会在
  //   非暂停场景把 due-now 冻结住，恢复后蓄力凭空不动。
  let pausedRemaining = null;
  // UI 节拍的排期代号：stop/start/换战斗时 +1，让在途的那次自我作废。
  let tickGeneration = 0;
  let ticking = false;
  // 排期代号：每次重新排期 +1。
  // ★ 为什么需要它：打断 / stop 会把相位换成另一个时长，但**已经排出去的那次
  //   定时器还在浏览器队列里**。没有代号的话，旧的那次照样到点触发 step()，
  //   于是 recover 之后又凭空跳一步 —— 相位被推进两次、怪提前出手。
  //   这里不新增 lifecycle API（跨模块的取消语义属于整合者），而是用代号
  //   在回调入口自我作废：迟到的旧回调发现自己过期就直接返回。
  let generation = 0;

  /* frozen 允许传布尔或函数：暂停/回主页/换相位这些是**运行期**才知道的，
     装配时求值一次只会得到当时的快照（通常是 false），于是怪会继续打人。
     ★ 这里必须显式调用 —— `!frozen` 对函数恒为 false，会把 live() 整个判死，
       结果是「一次都排不出去」：战斗里从头到尾没有蓄力推进，而且不报错。 */
  const frozenNow = () => (typeof frozen === 'function' ? !!frozen() : !!frozen);
  const live = () => {
    const B = getB();
    // over / finished / 没有战斗 / frozen 相位：怪一律不再主动出手。
    // ★ defeated 也要算「不活」：stop() 只把相位转 defeated，不动 B.over
    //   （B.over 由战斗结算自己管）。漏这一条的话，停手之后 UI 节拍与相位链
    //   仍会按 live() 判定继续跑 —— 战斗结束了蓄力条还在一秒一秒地倒数。
    return !!B && !B.over && !B.finished && !frozenNow()
      && !(B.foeAttack && B.foeAttack.phase === FOE_PHASE.DEFEATED);
  };

  /* 把当前事实写回 battle，并按该相位排下一步。
   * ★ publish=false 时**只做内部状态**：写 B.foeAttack、算 dueAt、排下一次定时器，
   *   但既不 commit 也不 renderFight。这条口存在的唯一理由就是让
   *   「推进相位」与「结算伤害」能在同一次发布里完成 —— 中间态一律不许外泄。 */
  function applyPhase(next, { publish = true } = {}) {
    const B = getB();
    if (!B) return false;
    B.foeAttack = next;
    const ms = phaseMs(next.phase, cfg);
    dueAt = now() + ms;
    if (publish) publishPhase();
    // ms === 0 的相位（defeated / 瞬间 attack）不排期：attack 的伤害在这一步已结算。
    if (ms > 0 && live()) {
      const mine = ++generation;
      lifecycle.scheduleBattle(() => { if (mine !== generation) return; step(); }, ms);
    } else {
      // 不排期时也让旧回调作废，否则上一次排的那次会替我们走一步。
      generation++;
    }
    syncTick();
    return true;
  }

  /* 一次相位发布的收口：提交快照 + 整屏重渲染。
   * 节奏由**相位**决定，不是由定时器 storm 决定：一次攻击只发布一次。 */
  function publishPhase() {
    if (commit) commit();
    if (renderFight) renderFight();
  }

  /* 定时器到点：先判活，再走一步。 */
  function step() {
    if (!live()) return;
    // 整个「推进 → 伤害 → 发布」包在一次事务里：致死一击会在 foeAttackHit 里
    // 重入 loseFight → stop()/markEnding()，没有事务边界的话中途就会写出一份
    // 「战斗已结束却还挂在 battle 相位」的非法快照。
    if (mutate) mutate(stepOnce); else stepOnce();
  }

  function stepOnce() {
    const B = getB();
    const cur = B.foeAttack || createFoeAttackFact(foeAttackKind(B));
    const r = advanceFoeAttack(cur, cfg);
    if (!r.event) { applyPhase(r.fact); return; }
    // attack 是**瞬间**相位（phaseMs = 0）：它只是「这一下已经打出去了」这个
    // 内部凭据，绝不单独发布 —— 否则会落下一份「已出手但没掉血」的存档。
    // 紧接着推进到 recover 并排下一次，两步都不发布。
    applyPhase(r.fact, { publish: false });
    const after = advanceFoeAttack(r.fact, cfg).fact;
    applyPhase(after, { publish: false });
    // 寒冰护符：这一下不掉血，但相位照旧推进（不许变成无限暂停）。
    if (B.freezeWord) {
      if (toast) toast('❄️ 冰冻中：怪的攻击被挡下');
    } else {
      foeAttackHit(r.event.damage);
    }
    // ★ 唯一的发布点：此刻 B.foeAttack 已是 recover、cycle 已 +1，
    //   而护盾/生命已经是伤害之后的值 —— 三者在同一份快照里必然自洽。
    publishPhase();
  }

  /* ---------------- UI 刷新节拍（只 paint，绝不落盘） ---------------- */

  /* 按当前事实算「现在还剩多少」：暂停时用冻结值，其余用 due - now。 */
  function remainingNow() {
    const B = getB();
    if (!B || !B.foeAttack) return 0;
    if (pausedRemaining !== null) return pausedRemaining;
    if (!dueAt) return B.foeAttack.remainingMs;
    return Math.max(0, Math.min(B.foeAttack.remainingMs, Math.round(dueAt - now())));
  }

  function paintTick() {
    const B = getB();
    if (!B || !B.foeAttack || !live()) return;
    if (!paintAttack) return;
    // 传**派生**事实而不是就地改 B.foeAttack：可视化节拍绝不改内存事实，
    // 更不落盘 —— 存档里的 remainingMs 仍由 captureFact 在提交那一刻算。
    paintAttack(Object.assign({}, B.foeAttack, { remainingMs: remainingNow() }),
      cfg ? { telegraphMs: cfg.telegraphMs, damage: cfg.damage } : null);
  }

  function tick() {
    if (!ticking) return;
    // 冻结期间这一次回调即使侥幸进来（浏览器队列里排着的旧回调）也什么都不做、
    // 更不续排：冻结的节拍由 lifecycle.resume() 把**原来那一次**挂回来。
    if (pausedRemaining !== null) return;
    if (!live()) { stopTick(); return; }
    paintTick();
    if (!ticking) return;
    const mine = tickGeneration;
    lifecycle.scheduleBattle(() => { if (mine !== tickGeneration || !ticking) return; tick(); },
      FOE_UI_TICK_MS);
  }

  /* 节拍只在「真的有人在看」时存在：没有 paintAttack 端口就一个都不排。 */
  function syncTick() {
    if (!paintAttack) return;
    if (live() && pausedRemaining === null) startTick();
    else stopTick();
  }

  function startTick() {
    if (ticking) return;
    ticking = true;
    const mine = ++tickGeneration;
    lifecycle.scheduleBattle(() => { if (mine !== tickGeneration || !ticking) return; tick(); },
      FOE_UI_TICK_MS);
  }

  /* 停节拍并让在途回调作废：排出去的 setTimeout 还在浏览器队列里，
     但代号一变它进来就返回，不会再排下一次（不泄漏）。 */
  function stopTick() {
    if (!ticking) return;
    ticking = false;
    tickGeneration++;
  }

  /* 新一场战斗：按当前 boss/elite 档位起一个干净的 idle。
   * 固定配置在这里**应用一次**，之后不因换词、换战斗而重排。 */
  function start() {
    // lifecycle.resetBattle cancels the prior cadence, so its local flag must
    // not suppress the new battle's first UI task.
    stopTick();
    cfg = profile();
    const B = getB();
    if (!B) return false;
    pausedRemaining = null;
    // ★ 起始剩余时间必须是**缩放后**的 idle 窗口，而不是 createFoeAttackFact 里
    //   那份未缩放的 base：事实（remainingMs）、UI 蓄力条与真实排期必须三者同源，
    //   否则第 2 轮起「盘上写的剩余」与「真倒计时」就会差一截。
    B.foeAttack = Object.assign({}, createFoeAttackFact(foeAttackKind(B)), { remainingMs: cfg.idleMs });
    // start 本身不提交：调用点（startFight）外面还有一次事务提交，
    // 在这里再写一次只是重复写盘。
    if (renderFight) renderFight();
    dueAt = now() + cfg.idleMs;
    // start() 也走同一套代号：新一场战斗必须让上一场排出去的回调作废。
    generation++;
    const mine = generation;
    if (live()) lifecycle.scheduleBattle(() => { if (mine !== generation) return; step(); }, cfg.idleMs);
    syncTick();
    return true;
  }

  /* 有效字母尝试（正确或错误都算）→ 尝试打断。
   * 返回是否真的打断了。已用/已试过的字母根本走不到这里
   * （战斗层在调用前就 return 了），所以「乱按同一个错字母」不会永远安全。 */
  function notifyLetterAttempted() {
    const B = getB();
    if (!B || !live()) return false;
    const cut = interruptFoeAttack(B.foeAttack || createFoeAttackFact(foeAttackKind(B)), cfg);
    if (!cut) return false;
    applyPhase(cut);
    if (toast) toast('⚡ 打断蓄力！怪进入收招');
    return true;
  }

  /* ---------------- 暂停 / 继续 ---------------- */

  /* 暂停冻结蓄力：**必须在 lifecycle.pause() 之前**调。
   * 采的是这一刻真实的剩余时间（due - now），不是相位刚切上去时的整个窗口。
   * 只记在内存里，绝不落盘 —— 落盘的是 captureFact 在同一刻算出的那份事实。 */
  function pause() {
    if (pausedRemaining !== null) return false;
    const B = getB();
    if (!B || !B.foeAttack) return false;
    pausedRemaining = remainingNow();
    // ★ 刻意**不**停节拍：在途的那次由 lifecycle.pause() 冻结、resume() 原样挂回。
    //   这里若 stopTick()，resume() 就得重排一次新节拍 —— 于是同页队列里
    //   多出一个任务（实测 3 个），而契约要求 resume 不新增任何排期。
    //   冻结期间这一次回调进不来（lifecycle 已冻结），pause 判空再兜一层。
    return true;
  }

  /* 继续：只把 dueAt 重定位到「现在 + 冻结时的剩余」。
   * ★ 绝不重排队列：lifecycle.resume() 已经把冻结的任务按剩余时间挂回去了，
   *   这里再排一次就是同一个相位挂两个回调 —— 相位会被推进两次、凭空多挨一下。
   *   也绝不新增任何任务。 */
  function resume() {
    if (pausedRemaining === null) return false;
    const left = pausedRemaining;
    pausedRemaining = null;
    if (left > 0) dueAt = now() + left;
    syncTick();
    return true;
  }

  /* 战斗结束 / 结算 / 离开战斗屏：相位转 defeated（吸收态）并提交一次。
   * 之后任何迟到的定时回调都只会命中 step() 开头的 live() 判空。 */
  function stop() {
    const B = getB();
    if (!B || !B.foeAttack || B.foeAttack.phase === FOE_PHASE.DEFEATED) return false;
    applyPhase(Object.assign({}, B.foeAttack, {
      phase: FOE_PHASE.DEFEATED, remainingMs: 0, interrupted: false,
    }));
    return true;
  }

  /* 采集「当前事实」：把绝对到期时刻换算成**剩余毫秒**再给 codec。
   * 存档里只有一个时间量（remainingMs），所以刷新后能精确重建，
   * 既不补打过去的那一下，也不会凭空提前。 */
  function captureFact() {
    const B = getB();
    if (!B || !B.foeAttack) return undefined;
    const base = B.foeAttack.remainingMs;
    // 已结束的是既成事实，原样带走。
    if (B.foeAttack.phase === FOE_PHASE.DEFEATED || !dueAt) return Object.assign({}, B.foeAttack);
    // ★ 已暂停时**绝不重算**：dueAt 是绝对时刻，暂停期间墙钟继续走，
    //   再按 due-now 扣就等于凭空扣掉整段暂停时长（30 秒暂停 = 蓄力直接归零，
    //   刷新回来凭空白挨一下）。这里带走 pause() 采下的那份剩余。
    if (pausedRemaining !== null) {
      return Object.assign({}, B.foeAttack, { remainingMs: pausedRemaining });
    }
    // 非暂停的 frozen 相位（奖励屏/结算屏）：那里不会结算伤害，如实带走当前事实。
    if (frozenNow()) return Object.assign({}, B.foeAttack);
    const left = Math.max(0, Math.min(base, Math.round(dueAt - now())));
    return Object.assign({}, B.foeAttack, { remainingMs: left });
  }

  /* 跨刷新重建：只认合法事实。脏值/缺失 → 干净的 idle（绝不默认立刻攻击）。 */
  function restore(raw) {
    const B = getB();
    if (!B) return false;
    pausedRemaining = null;
    const fact = decodeFoeAttack(raw);
    if (!fact) {
      // cfg 必须**先**算出来：干净 idle 的剩余时间是缩放后的 cfg.idleMs。
      cfg = profile();
      B.foeAttack = Object.assign({}, createFoeAttackFact(foeAttackKind(B)), { remainingMs: cfg.idleMs });
      dueAt = now() + cfg.idleMs;
      generation++;
      const mine = generation;
      if (live()) lifecycle.scheduleBattle(() => { if (mine !== generation) return; step(); }, cfg.idleMs);
      syncTick();
      return false;
    }
    cfg = profile();          // 档位仍以当前 battle 的 boss/elite 为准
    B.foeAttack = fact;
    // attack 相位是「瞬间」：它本身没有下一次排期，所以恢复时直接推进到 recover，
    // 避免把一个 0 毫秒的相位原样挂上、什么都不发生。
    if (fact.phase === FOE_PHASE.ATTACK) {
      applyPhase(advanceFoeAttack(fact, cfg).fact);
      return true;
    }
    if (fact.phase === FOE_PHASE.DEFEATED) { dueAt = 0; generation++; stopTick(); return true; }
    dueAt = now() + fact.remainingMs;
    if (live() && fact.remainingMs > 0) {
      generation++;
      const mine = generation;
      lifecycle.scheduleBattle(() => { if (mine !== generation) return; step(); }, fact.remainingMs);
    } else if (fact.remainingMs === 0) step();      // 恰好到点：只走一步，不补打
    syncTick();
    return true;
  }

  return {
    start, stop, restore, captureFact, notifyLetterAttempted, pause, resume,
    isTelegraphing: () => { const B = getB(); return !!B && B.foeAttack && B.foeAttack.phase === FOE_PHASE.TELEGRAPH; },
    phase: () => { const B = getB(); return B && B.foeAttack ? B.foeAttack.phase : null; },
    // 供 UI 画蓄力条：总窗口来自当前档位，不是猜的。
    window: () => (cfg ? { telegraphMs: cfg.telegraphMs, damage: cfg.damage } : null),
    // UI 节拍用：此刻真实的剩余毫秒（暂停时是冻结值）。只读，不改任何状态。
    remainingMs: () => remainingNow(),
    isPaused: () => pausedRemaining !== null,
  };
}

export { FOE_PHASE, encodeFoeAttack };