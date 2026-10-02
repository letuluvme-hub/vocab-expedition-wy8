/* 暂停 / 保存 / 恢复的应用层协调器。
 *
 * 它是「谁能改状态」的唯一闸门，也是快照的采集点：
 *   - 所有会改状态的入口（输入字母、道具、提示、跳过、逃跑、退格、地图节点、
 *     事件选项、领奖、推进、结算）都必须先问闸门；暂停期间一律原样返回 false。
 *     这不是 CSS 遮罩：状态一个字节都不动，继续后原样可玩。
 *   - 快照与学习 DB 由 store.commit(db, envelope) **同一次** save 落盘，
 *     所以「金币已发、快照还没记」的窗口不存在，刷新后不会二次发奖。
 *   - 恢复不是新建：不调 createRun、不 registerRunStart(+1)、不 applyRelicInit，
 *     不重复记掌握、不重发奖励。跨刷新的待办靠持久化 phase 重建检查点，
 *     而不是重跑丢失的闭包回调。
 *
 * 「暂停中返回主页」也归这里管：离开战斗界面 ≠ 放弃远征。返回主页只把这一局
 * **留在内存里继续暂停**，快照照旧留着；只有「放弃这次远征」才真的丢掉。
 *
 * 本模块不碰 DOM（界面由 runtime 接线），只通过注入的 api 与 state 协作。
 */
import { encodeSnapshot, PHASE } from '../domain/run-snapshot.js';
import { isPoolComplete } from '../domain/word-selection.js';

/* 失败原因必须说人话，而且不能张冠李戴：
 *   unavailable —— 这台设备根本没有存储（隐私模式 / 被 CSP 挡）
 *   failed      —— 写入被拒（配额满等）
 *   invalid     —— **当前状态**自己解不开（快照形状与 codec 不符），不是空间问题
 *   version     —— 当前状态来自更新版本的 codec，同样不是空间问题
 * 把后两者说成「存储空间可能已满」会把玩家引到完全错误的排查方向
 * （去清缓存 / 换设备），而真正的原因是这一局的状态本身存不下去。 */
const SAVE_MESSAGES = {
  unavailable: '这台设备无法保存进度（可能是隐私模式或浏览器限制），本次进度只在这一页有效',
  failed: '进度没存上（存储空间可能已满），本次进度只在这一页有效',
  invalid: '当前状态无法保存（进度内容不符合存档格式），本次进度只在这一页有效',
  version: '当前状态无法保存（进度来自更新版本的游戏），本次进度只在这一页有效',
};
const saveMessage = reason => SAVE_MESSAGES[reason] || SAVE_MESSAGES.failed;
const CLEAR_FAILED = '结算结果没能写进本机存档（存储可能已满），刷新后这次结算会消失';
const NO_BATTLE_PHASES = new Set([PHASE.MAP, PHASE.ENCOUNTER, PHASE.ENCOUNTER_DONE]);
// 词汇完成检查点带着战斗（真实未打完的血量），所以不在 NO_BATTLE_PHASES 里。
const LEARNING_COMPLETE = PHASE.LEARNING_COMPLETE || 'learning-complete';
// 结算相位（已打完、只差一次收尾）。编解码由 domain 定义，这里兜一个同名常量，
// 免得两处各写一份字面量、日后改一处忘了另一处。
const ENDING = PHASE.ENDING || 'ending';
// 这一局已经结算：run.result 是布尔值。此后一律拒绝再写快照 ——
// 否则刷新会把「已经打完」的一局复活成死局（结算屏上一片血，却还能接着打）。
const runFinished = run => !!run && typeof run.result === 'boolean';

export function createProgressController({ state, api, store, now = Date.now }) {
  let paused = false;
  let atTitle = false;          // 暂停中返回了主页：这一局还活着，只是留在内存里
  let pauseMeta = null;         // 暂停时记下的界面与来源
  let audioSuspended = false;
  let confirmFn = api.confirm || (() => true);
  let restoredUnit = null;

  const getRun = () => (state.getRun ? state.getRun() : state.G);
  const getBattle = () => (state.getBattle ? state.getBattle() : state.B);
  const getDB = () => (state.getDB ? state.getDB() : state.DB);
  const phase = () => api.getPhase();
  // 每个会改状态的动作包一层：动作返回时副作用已全部落地，此刻提交一次。
  const mutating = fn => (api.mutate ? api.mutate(fn) : fn());

  /* ---------------- 闸门 ---------------- */
  const blocked = () => paused;
  const gate = () => !paused;

  /* ---------------- 快照 ---------------- */
  function currentEnvelope() {
    const run = getRun();
    if (runFinished(run)) return null;
    if (!run || !Array.isArray(run.rows) || !run.rows.length) return null;
    // ★ 蓄力剩余时间必须在**采集这一刻**换算（due - now），而不是留着上一次
    //   相位切换时写下的旧数字。少这一行的话，存档里的蓄力时间会随快照频率漂移：
    //   刚进战斗存一次、10 秒后再存一次，两份存档的 remainingMs 完全一样。
    if (api.captureFoeAttack) api.captureFoeAttack();
    const p = phase();
    // 结算相位只带「赢了还是输了」+ 那一场战斗：不重新开奖，也不带事件卡。
    if (p === ENDING) {
      return encodeSnapshot({ phase: p, run,
        outcome: (api.getOutcome ? api.getOutcome() : false) === true,
        battle: getBattle(), encounter: null }, { now: now() });
    }
    return encodeSnapshot({
      phase: p,
      run,
      battle: NO_BATTLE_PHASES.has(p) ? null : getBattle(),
      encounter: api.getEncounter ? api.getEncounter() : null,
    }, { now: now() });
  }

  function save() {
    const envelope = currentEnvelope();
    if (!envelope) return { ok: false, reason: 'none' };
    return store.commit(getDB(), envelope);
  }
  /* 学习记录与快照的**同一个**提交点。运行时的 saveDB() 只标脏，
     每个完成状态的动作末尾走这里，所以「学会的词已存、快照还停在上一帧」不存在。 */
  function checkpoint() { return save(); }

  /* ---------------- 暂停 / 继续 ---------------- */
  function pause({ fromReload = false } = {}) {
    const run = getRun();
    if (!run) return { saved: false, reason: 'none', message: null };
    if (runFinished(run)) return { saved: false, reason: 'finished', message: null };
    // ★ 蓄力冻结**先于** lifecycle.pause()：controller 要在 live() 还成立、
    //   due-now 还是真实剩余的那一刻把剩余时间采下来。顺序反了的话
    //   lifecycle 已冻结、frozen() 转真，采到的就只是「本相位的整个窗口」，
    //   暂停 30 秒再继续时蓄力会凭空多出 30 秒。
    if (api.pauseFoeAttack) api.pauseFoeAttack();
    // 再冻结延迟任务，最后才采集快照：顺序反了会存进一个「即将执行」的状态。
    api.lifecycle.pause();
    const result = save();
    paused = true;
    atTitle = false;
    pauseMeta = { screen: api.screen(), fromReload };
    try { if (api.TTS && api.TTS.stop) api.TTS.stop(); } catch (e) { /* 无语音能力时静默 */ }
    // 暂停就挂起音频：即使之前没挂过（首次暂停）也该挂，避免后台继续出声。
    if (!audioSuspended) suspendAudio();
    if (!result.ok && result.reason !== 'none') api.toast(saveMessage(result.reason));
    return {
      saved: result.ok, reason: result.ok ? null : result.reason,
      message: result.ok ? null : saveMessage(result.reason),
    };
  }

  function resume() {
    if (!paused) return false;
    paused = false;
    atTitle = false;
    pauseMeta = null;
    // lifecycle 先把冻结的任务按剩余时间挂回去，controller 再只重定位 dueAt
    // （绝不重排队列 —— 同一个相位挂两个回调会凭空多挨一下）。
    api.lifecycle.resume();
    if (api.resumeFoeAttack) api.resumeFoeAttack();
    // AudioContext 只在手势里恢复：这个 resume() 正是玩家点「继续」的路径。
    if (audioSuspended) resumeAudio();
    return true;
  }

  function suspendAudio() {
    try {
      if (api.audio && typeof api.audio.suspend === 'function') { api.audio.suspend(); audioSuspended = true; }
    } catch (e) { audioSuspended = false; }
  }
  function resumeAudio() {
    try {
      if (api.audio && typeof api.audio.resume === 'function') api.audio.resume();
    } catch (e) { /* 缺 API 时静默 */ }
    audioSuspended = false;
  }

  /* 暂停中「返回主页」：保留这一局，也保留内存里的暂停态。
   * ★ 绝不能 resume —— resume 会把在途回调重新挂上，玩家待在主页时那一局
   *   就会自己往前走（推进层数、结算），回来时局面已经变了。
   * ★ 也绝不能清 run：这台设备可能根本没有存储，内存里这一份就是**唯一**那一份，
   *   清掉等于把整局直接丢掉。 */
  function returnToTitle() {
    const run = getRun();
    if (!run || runFinished(run)) return false;
    if (!paused) {
      // 返回主页也是一次暂停：蓄力同样冻结（契约与 pause() 完全一致）。
      if (api.pauseFoeAttack) api.pauseFoeAttack();
      api.lifecycle.pause();
      save();
      paused = true;
      pauseMeta = { screen: api.screen(), fromReload: false };
      if (!audioSuspended) suspendAudio();
      try { if (api.TTS && api.TTS.stop) api.TTS.stop(); } catch (e) { /* 静默 */ }
    }
    atTitle = true;
    return true;
  }

  /* ---------------- 恢复 ---------------- */
  // 恢复后重建界面：战斗回战斗页、待领奖回奖励页、已选定的只补一次「推进」。
  function rebuildFromPhase(snapshot) {
    const run = snapshot.run;
    api.setRun(run);
    api.setBattle(snapshot.battle);
    restoredUnit = run.unit;

    // ★ 结算相位优先于一切判定：这一局已经打完，只补「生成纪念卡并显示结算」这一次。
    //   绝不重跑 finishNode（battle.finished 早为真，重跑也只会拿到 'ignored'），
    //   也绝不 registerRunWin —— 通关数在 finishBattleNode 那一刻就已经记过了。
    if (snapshot.phase === ENDING) {
      api.setPhase(ENDING);
      api.setEncounter(null);
      endRunNow(snapshot.outcome === true);
      return;
    }
    if (snapshot.phase === LEARNING_COMPLETE) {
      // 本单元词汇已全部完成，但战斗还没打完。
      // ★ 恢复只重建这个检查点屏：绝不重发奖励、绝不重新抽词、绝不重算 counts。
      //   battle 原样带回（怪物还剩多少血是必须如实说出的事实），但战斗屏不再显示。
      // ★ 存档是外部输入：run.done 其实没答完时**不许**显示「已全部完成」——
      //   那会让玩家凭空多出一个假检查点。fail closed 回到真实相位。
      if (!isPoolComplete(run)) {
        api.setPhase(PHASE.BATTLE);
        api.setEncounter(null);
        api.show('s-fight');
        api.renderFight();
        return;
      }
      api.setPhase(LEARNING_COMPLETE);
      api.setEncounter(null);
      if (api.showLearningComplete) api.showLearningComplete();
      else { api.show('s-learning-complete'); if (api.renderLearningComplete) api.renderLearningComplete(); }
      return;
    }
    if (snapshot.phase === PHASE.BATTLE) {
      api.setPhase(PHASE.BATTLE);
      api.setEncounter(null);
      // 蓄力状态重建（清单 13）：按快照里的 remainingMs 精确重建，
      // 不补打刷新期间已经过去的那一下。缺失（旧快照）→ 干净的 idle 窗口。
      if (api.restoreFoeAttack) api.restoreFoeAttack(snapshot.battle ? snapshot.battle.foeAttack : undefined);
      api.show('s-fight');
      api.renderFight();
      return;
    }
    if (snapshot.phase === PHASE.REWARD) {
      // 同理：奖励卡必须按快照重建，不重新 roll —— 否则能反复刷遗物。
      api.setPhase(PHASE.REWARD);
      api.setEncounter(snapshot.encounter);
      const ok = api.reopenEncounter ? api.reopenEncounter(snapshot.encounter) : false;
      if (!ok) {
        api.setPhase(PHASE.MAP);
        api.setEncounter(null);
        api.show('s-map');
        api.renderMap();
      }
      return;
    }
    if (snapshot.phase === PHASE.ENCOUNTER) {
      // 光 show() 是不够的：事件/营火/商店的卡片必须按快照里的描述重建，
      // 否则会重新 roll 一批新卡（玩家能白嫖遗物、能换一批货）。
      api.setPhase(PHASE.ENCOUNTER);
      api.setEncounter(snapshot.encounter);
      const ok = api.reopenEncounter ? api.reopenEncounter(snapshot.encounter) : false;
      if (!ok) {                       // 映射不上一张卡也不能把玩家丢在空白页
        api.setPhase(PHASE.MAP);
        api.setEncounter(null);
        api.show('s-map');
        api.renderMap();
      }
      return;
    }
    if (snapshot.phase === PHASE.ENCOUNTER_DONE) {
      // 副作用（回血/给遗物/买东西）在暂停前已经生效：这里只补「推进到下一层」
      // 这一个待办，绝不重跑选项函数。
      api.setPhase(PHASE.ENCOUNTER_DONE);
      api.setEncounter(snapshot.encounter);
      if (snapshot.encounter && snapshot.encounter.node) snapshot.encounter.node.done = true;
      api.advance();
      return;
    }
    api.setPhase(PHASE.MAP);
    api.setEncounter(null);
    api.show('s-map');
    api.renderMap();
  }

  /* 同页继续：从主页点「继续远征」时，优先把内存里这一局原样恢复。
   * 走重建路径会按快照重新画界面、重新排期，而冻结中的旧队列还在 ——
   * 同一个待办就会跑两遍。所以这里只解除暂停、把玩家放回他离开的那一屏。 */
  function resumeHeldRun() {
    const from = pauseMeta ? pauseMeta.screen : null;
    resume();
    api.restoreScreen(from);
    return { ok: true, phase: phase(), unit: getRun() ? getRun().unit : null, source: 'memory' };
  }

  function continueRun() {
    // 同页：这一局还在内存里且是暂停态 → 原样恢复，不重建队列。
    if (paused && getRun() && !runFinished(getRun())) {
      if (store.peek().ok) {
        resumeHeldRun();
        checkpoint();     // 有存储：把恢复后的事实落盘，再刷新也不会退回旧相位
        return { ok: true, phase: phase(), unit: getRun().unit, source: 'memory' };
      }
      // 没有存储也不该把唯一那一份丢掉：同页照样能继续，只是不谎称已保存。
      return resumeHeldRun();
    }
    const found = store.peek();          // 内部已解码并 fail closed，不抛错
    if (!found.ok) {
      return {
        ok: false, reason: found.reason,
        message: found.reason === 'none' ? '没有可以继续的远征'
          : found.reason === 'version' ? '这份进度来自更新版本的游戏，无法恢复'
            : '这份进度已损坏，无法恢复',
      };
    }
    const run = getRun();
    if (run && !paused) return { ok: false, reason: 'busy', message: '当前已经有一次远征在进行' };
    rebuildFromPhase(found.value);
    // 恢复后立刻落盘：把「已恢复」这个事实写进快照，这样再恢复一次不会重复任何
    // 副作用，中途又刷新也不会退回旧相位。
    save();
    return { ok: true, phase: found.value.phase, unit: found.value.run.unit, source: 'snapshot' };
  }

  /* ---------------- 放弃 / 清档 ---------------- */
  function abandonRun() {
    api.lifecycle.resetRun();
    try { if (api.TTS && api.TTS.stop) api.TTS.stop(); } catch (e) { /* 静默 */ }
    const cleared = store.clear(getDB());
    api.clearRun();
    paused = false;
    atTitle = false;
    pauseMeta = null;
    // 存不下就不能声称丢干净了：否则玩家刷新后发现那一局还在。
    if (!cleared.ok) api.toast('没能删除存档里的远征进度（存储可能已满），刷新后它可能还在');
    return cleared.ok;
  }

  /* 真正结束一轮：先结算（只改内存里的 DB），再**一次**提交「清快照 + 新 totals/纪念卡」。
     分两次写、或先清后结算，都会留下「奖励已发、快照还在」的窗口 ——
     刷新后那一局会被再结算一次，纪念卡、通关数、金币全部翻倍。 */
  function endRunNow(win) {
    const run = getRun();
    if (!run) return false;
    if (runFinished(run)) return false;        // 绝不重复结算
    api.lifecycle.resetRun();                  // 清掉冻结待办：结算后不得再被 resume 复活
    paused = false;
    atTitle = false;
    pauseMeta = null;
    api.settleRun(win);                        // 改 DB / 显示结算屏（不落盘）
    const cleared = store.clear(getDB());      // ← 同一次写入：新 totals + 无快照
    if (!cleared.ok) api.toast(CLEAR_FAILED);
    return cleared.ok;
  }

  function resetProgress() {
    const cleared = store.clear(getDB());
    api.clearRun();
    paused = false;
    atTitle = false;
    pauseMeta = null;
    if (!cleared.ok) api.toast(CLEAR_FAILED);
    return cleared.ok;
  }
  function discardSnapshot() { return store.clear(getDB()); }
  function peekSnapshot() { return store.peek(); }

  /* ---------------- 受闸门保护的入口 ---------------- */
  /* 每个入口都包在 mutating() 里：动作返回时它的副作用（wordsDone / 战斗血量 /
     领奖结果 / 相位）已经全部落地，此刻提交一次，原子且不会读到中间态。
     暂停时每一个都返回 false，且绝不碰状态。 */
  const pressLetter = i => (gate() ? mutating(() => api.pressLetter(i)) : false);
  const typeLetter = ch => (gate() ? mutating(() => api.typeLetter(ch)) : false);
  const undoLetter = () => (gate() ? mutating(() => api.undoLetter()) : false);
  const useItem = id => (gate() ? mutating(() => api.useItem(id)) : false);
  const requestHint = () => (gate() ? mutating(() => api.requestHint()) : false);
  const skipFight = () => (gate() ? mutating(() => api.skipFight()) : false);
  const fleeFight = () => (gate() ? mutating(() => api.fleeFight()) : false);
  const enterNode = n => (gate() ? mutating(() => api.enterNode(n)) : false);
  const chooseEncounter = id => (gate() ? mutating(() => api.chooseEncounter(id)) : false);
  const takeReward = id => (gate() ? mutating(() => api.takeReward(id)) : false);
  const advance = () => (gate() ? mutating(() => api.advance()) : false);
  const endRun = win => (gate() ? endRunNow(win) : false);
  /* 单元解锁主线的两个动作（docs/feature-campaign.md）。和所有改状态的入口一样
   * 走闸门 + 事务：暂停期间无效；跑完立即提交（解锁事实与快照同一次写入）。 */
  const nextUnit = () => (gate() ? mutating(() => api.nextUnit()) : false);
  const continueUnit = () => (gate() ? mutating(() => api.continueUnit()) : false);

  /* ---------------- 主页入口 ---------------- */
  function titleState() {
    // 同页暂停中的远征：内存里就有，优先报「可以继续」，哪怕这台设备根本存不了。
    if (atTitle && getRun() && !runFinished(getRun())) {
      const held = getRun();
      return {
        hasSnapshot: true, continueLabel: '继续远征', reason: null, hasUnusableSnapshot: false,
        unit: held.unit, heroId: held.heroId, floor: held.floor, savedAt: null, heldInMemory: true,
      };
    }
    const found = store.peek();
    if (!found.ok) {
      // 存档里**有**一份 activeRun 但解不开（损坏 / 版本不支持）：
      // 入口必须仍然可见，否则玩家永远没法通过界面丢弃它 —— 只能手改存档。
      const raw = (() => { try { const db = store.rawDB(); return !!(db && db.activeRun); } catch (e) { return false; } })();
      return {
        hasSnapshot: false, continueLabel: null, reason: found.reason, unit: null,
        // 有坏快照：主页照样显示入口，点下去会说明原因并询问是否丢弃。
        hasUnusableSnapshot: raw, unusableReason: found.reason,
      };
    }
    return {
      hasSnapshot: true, continueLabel: '继续远征', reason: null,
      hasUnusableSnapshot: false, heldInMemory: false,
      unit: found.value.run.unit, heroId: found.value.run.heroId,
      floor: found.value.run.floor, savedAt: found.value.savedAt,
    };
  }

  // 存在旧快照时新开一轮必须先确认放弃：玩家不该被无声覆盖。
  function startRunFromUi() {
    const run = getRun();
    const heldPaused = !!run && paused && !runFinished(run);
    if (run && !heldPaused && !runFinished(run)) return false;   // 活着的远征：连点仍挡住
    const found = store.peek();
    const hasOld = found.ok || found.reason === 'invalid' || found.reason === 'version';
    if (heldPaused || hasOld) {
      if (!confirmFn('已经有一场没结束的远征，开始新远征会放弃它。确定继续吗？')) return false;
      abandonRun();          // 内存里那一局 + 存档里那份快照，一起清掉
    }
    const started = api.newRun();
    // 新一轮开局立刻存一次：这样玩家开局就杀掉标签页，主页也会看到「继续远征」，
    // 而不是必须先进一场战斗才有快照。
    if (started) checkpoint();
    return started;
  }

  /* ---------------- 后台 / 前台 ---------------- */
  function onHidden() {
    const run = getRun();
    if (!run) return false;               // 主页没有可保存的远征
    if (paused) return false;              // 已暂停过，不重复存
    if (runFinished(run)) return false;    // 已经结算：切后台不许把这一局复活
    pause({ fromReload: true });
    return true;
  }
  // 回前台**不自动继续**：必须玩家点「继续」，避免刷新后直接面对敌人或语音。
  // AudioContext 也不在这里恢复 —— 浏览器要求手势，交给 resume()。
  function onVisible() { return true; }
  function onPageHide() { return onHidden(); }

  return {
    blocked, gate, isPaused: () => paused, isFinished: () => runFinished(getRun()),
    atTitle: () => atTitle,
    pause, resume, returnToTitle, save, checkpoint, continueRun,
    abandonRun, endRun, resetProgress, discardSnapshot, peekSnapshot,
    pressLetter, typeLetter, undoLetter, useItem, requestHint, skipFight, fleeFight,
    enterNode, chooseEncounter, takeReward, advance, nextUnit, continueUnit,
    titleState, startRunFromUi,
    onHidden, onVisible, onPageHide,
    setConfirm: fn => { confirmFn = fn; },
    pendingEncounter: () => (api.getEncounter ? api.getEncounter() : null),
    pauseMeta: () => pauseMeta,
    restoredUnit: () => restoredUnit,
  };
}
