/** Owned delayed work. Epoch checks also suppress callbacks already queued by the browser.
 *
 * 暂停语义：pause() 把在途任务连同**剩余时间**一起冻结（不执行、也不丢弃），
 * resume() 按剩余时间重新挂上。这样「胜利后 900ms 弹奖励面板」这类任务在暂停期间
 * 不会偷偷跑掉，继续时也只补一次 —— 既不丢待办，也不重复结算。
 * 跨刷新无法保留闭包，所以跨刷新的重建由持久化的 phase / 待领奖检查点负责
 * （见 docs/feature-pause.md）。 */
export function createLifecycle({ setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  let runEpoch = 0, battleEpoch = 0;
  let paused = false;
  const pending = new Map();   // timerId -> { callback, battle, due }
  const frozen = [];           // pause 期间扣下的待办

  function schedule(callback, ms, battle) {
    const run = runEpoch, fight = battleEpoch;
    const delay = Math.max(0, ms | 0);
    let id;
    const fire = () => {
      // ★ 已冻结/已取消的任务绝不再入队一次。
      //   clearTimeout 只保证「还没跑就别跑」——已经排进浏览器事件队列的回调照样会来。
      //   pause()/reset*() 会把 job 从 pending 摘掉，所以迟到的 fire 必须丢弃；
      //   否则同一个待办会在 frozen 里出现两次，resume 后回调跑两遍：
      //   结算、发奖、推进层数全部翻倍。
      if (!pending.has(id)) return;
      if (pending.has(id)) pending.delete(id);
      // 暂停期间到点：不执行，留到 resume 按剩余时间补上（只补一次）。
      if (paused) { frozen.push({ callback, battle, remaining: 0, run, fight }); return; }
      if (run !== runEpoch || (battle && fight !== battleEpoch)) return;
      callback();
    };
    id = setTimer(fire, delay);
    pending.set(id, { callback, battle, due: now() + delay, run, fight });
    return id;
  }
  function resetBattle() {
    battleEpoch++;
    for (const [id, job] of pending) if (job.battle) { clearTimer(id); pending.delete(id); }
    // ★ 只清「战斗级」的冻结待办。原来的 frozen.length = 0 会把同一批里
    //   run 级待办（BOSS 结算前 700ms 收尾、战败 800ms 结算）一起吞掉，
    //   于是换一场战斗后那一局再也不会结算，玩家被留在半死不活的局面里。
    for (let i = frozen.length - 1; i >= 0; i--) if (frozen[i].battle) frozen.splice(i, 1);
  }
  function resetRun() {
    runEpoch++; battleEpoch++;
    for (const id of pending.keys()) clearTimer(id);
    pending.clear();
    frozen.length = 0;
    // ★ 新一轮必须回到「可执行」状态：玩家从主页开新局时，上一次暂停留下的
    //   冻结标记会让这一局新排期的任务直接掉进 frozen，再也跑不起来。
    paused = false;
  }
  function pause() {
    if (paused) return;
    paused = true;
    const at = now();
    for (const [id, job] of pending) {
      clearTimer(id);
      pending.delete(id);              // 与 fire() 的守卫配对
      frozen.push({ callback: job.callback, battle: job.battle,
        remaining: Math.max(0, job.due - at), run: job.run, fight: job.fight });
    }
  }
  function resume() {
    if (!paused) return;
    paused = false;
    const held = frozen.splice(0, frozen.length);
    for (const job of held) {
      if (job.run !== runEpoch || (job.battle && job.fight !== battleEpoch)) continue;
      schedule(job.callback, job.remaining, job.battle);
    }
  }
  return {
    scheduleRun: (fn, ms) => schedule(fn, ms, false),
    scheduleBattle: (fn, ms) => schedule(fn, ms, true),
    resetRun, resetBattle, pause, resume,
    isPaused: () => paused,
    pendingCount: () => pending.size + frozen.length,
    frozenCount: () => frozen.length,
  };
}
