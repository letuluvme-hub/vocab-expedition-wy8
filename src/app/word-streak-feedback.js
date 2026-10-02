/* 完整词连胜的**反馈协调器**（docs/feature-word-streak.md）。
 *
 * 它是「什么时候让低优先级播报插一句话」的闸门，不碰战斗结算、不碰共享 runtime，
 * 也不碰 speech.js / audio.js。所有能力都由父层注入，所以本文件可以脱离游戏
 * 在夹具与单测里完整验证。
 *
 * ★ 最重要的约束：**完整词朗读是最高优先级**。
 *   本模块**从不**调用任何会打断它的接口（不 TTS.stop、不 TTS.speak 抢先、
 *   不 TTS.line 强插）。词正忙（getWordPriorityBusy()===true）时：
 *     - 文字反馈照常立刻给（视觉通道不抢话）；
 *     - 语音只留**一条**「最新」的待播（旧的当场取消），有上限地等
 *       （最多 deferAttempts 次、总共不超过 deferWindowMs）；
 *     - 等不到就**安静丢弃**（reason 'dropped'）—— 绝不排队盖住下一个词，
 *       那会让玩家正在读的单词被半句话打断。
 *   speakAnnouncement 返回 false = 这一路真的没播出来（没装 TTS / 被拒 /
 *   静音），本模块只当「这次没播」，不改任何玩家偏好、不假装成功。
 *
 * 身份与规则全在 domain/word-streak.js：这里只做调度与门控。
 * 存档 / 恢复 / 快照由父层负责：resume() 绝不补播暂停期间丢掉的阶段。
 */
import {
  createWordStreakState, normalizeWordStreakState, recordWordCompletion,
} from '../domain/word-streak.js';

export const FEEDBACK_PRIORITY = 'feedback';
/* 这三个数是**工程取值**，不是真机标定出来的：仓库里没有任何真机可听性测量，
 *   下面的 e2e 用的是记录调用的 speechSynthesis 桩（不合成声音）。
 *   口径如实写清：每次重排等 deferMs，一个待播最多重排 maxDeferrals 次
 *   —— 默认 30 × 120ms = 3.6s 标称小于 5s 窗口，所以**通常先撞上的是重排次数上限**；
 *   5s 窗口是硬上界，专门兜住「回调被事件循环卡顿拖迟到」的那一种（重排次数
 *   还没用完，但墙上时间已经超窗）。两条都在**排下一次之前**检查，谁先到谁生效。
 *   取值理由：完整词朗读通常 >500ms（长词接近 1s），原先 480/900ms 的窗口
 *   容不下「等一句话念完」，会让播报几乎必然超时丢弃；现在这两个界都够等完
 *   当前那句词，又绝不允许排到下一个词后面去盖住它。 */
export const FEEDBACK_DEFER_MS = 120;
export const FEEDBACK_DEFER_WINDOW_MS = 5000;
export const FEEDBACK_MAX_DEFERRALS = 30;

export function createWordStreakFeedback({
  getState, setState,
  speakAnnouncement, onAnnounce,
  cancelSchedule, schedule, now = () => Date.now(),
  isPaused, isBattleLive, getWordPriorityBusy, getScopeToken,
  deferMs = FEEDBACK_DEFER_MS,
  deferWindowMs = FEEDBACK_DEFER_WINDOW_MS,
  maxDeferrals = FEEDBACK_MAX_DEFERRALS,
} = {}) {
  /* 可选的注入点缺省成「什么都不做」：父层还没接上语音/UI 时玩法照旧。 */
  const read = () => normalizeWordStreakState(typeof getState === 'function' ? getState() : null);
  const write = s => { if (typeof setState === 'function') setState(s); return s; };
  const live = () => !(typeof isBattleLive === 'function' && isBattleLive() === false);
  const wordBusy = () => !!(typeof getWordPriorityBusy === 'function' && getWordPriorityBusy() === true);
  const clock = () => (typeof now === 'function' ? Number(now()) : Date.now());
  const put = (fn, ms) => (typeof schedule === 'function' ? schedule(fn, ms) : setTimeout(fn, ms));
  /* 取消：注入的 cancelSchedule 优先；没注入时用 clearTimeout —— 否则默认
     setTimeout 排出去的待播会变成悬挂的定时器（泄漏 + 迟到的旧阶段）。 */
  const drop = handle => {
    if (handle == null) return;
    try {
      if (typeof cancelSchedule === 'function') cancelSchedule(handle);
      else clearTimeout(handle);
    } catch (e) { /* 取消失败不该影响玩法 */ }
  };
  /* 暂停 = 外部注入的暂停 **或** 本模块自己的 pause()。后者让 pause() 在
     单元测试/夹具里也真的有效（父层通常还会提供 isPaused，两者取或）。 */
  const paused = () => internalPaused || !!(typeof isPaused === 'function' && isPaused() === true);
  /* 作用域令牌（可选注入）：父层给出「当前作用域对象」（runtime 里是战斗对象 B）。
     延迟播报真的要说出口之前，必须确认作用域**还是当初那一个** —— 快速推进到
     新战斗时 B 会被整个换掉，旧战斗的里程碑绝不许补播进新战斗的语音通道。
     没注入就退化成不校验（单一作用域的用法没有这个风险）。 */
  const scopeOf = () => (typeof getScopeToken === 'function' ? getScopeToken() : undefined);
  const scopeOk = tok => (typeof getScopeToken !== 'function') || scopeOf() === tok;

  let pending = null;   // { handle, token, count, bornAt } —— 永远只有一条
  let tokenSeq = 0;
  let internalPaused = false;   // pause() 自己设的冻结标志
  let disposed = false;

  /* 作废在途待播：取消定时器 + 递增 token，让已经排出去的回调（真机上
     cancel 未必赶得上的那一只）回来时发现自己过期，直接什么都不做。 */
  function invalidatePending() {
    if (pending) { drop(pending.handle); pending = null; }
    tokenSeq++;
  }

  /* ★ 只清「**自己那条**」待播（按 token 认领）。
     两条不同的早退路径必须用不同的清理口径：
       - 作用域/窗口/战斗状态这类**自己走到终点的**早退：这条待播就此作废，
         必须清掉，否则 pendingCount 会永远停在 1 —— 队列里其实早就空了，
         而那条回调也已经跑过、不会再回来。这正是父复现的残留。
       - **过期 token**（pause/newRun/dispose/新事实已经作废过它）：绝不许碰
         现在的 pending —— 那时 pending 可能已经是**另一条**新的待播了，
         清掉它等于让一条合法的新里程碑永远播不出来。 */
  function clearOwnPending(myToken) {
    if (pending && pending.token === myToken) { drop(pending.handle); pending = null; }
  }

  /* 真要出声的那一刻。返回 'spoken' | 'skipped' | 'deferred'。
     ★ 这里只调注入进来的 speakAnnouncement（约定签名 {text,priority,...}），
       它自己负责「当前被词占用就返回 false、不要 cancel 词」。
       父层将来可以在这里换成 speech 的排队接口，本模块不用改。 */
  function deliver(ann, myToken, bornAt, scope) {
    /* 过期 token：pause/newRun/dispose/新事实早已作废这一条。此刻 pending 可能
       已经是**另一条**新的待播，绝不许碰它 —— 直接什么都不做就返回。 */
    if (disposed || myToken !== tokenSeq || paused()) return 'skipped';
    /* 作用域换了（快速推进到新战斗）→ 这一条属于上一场战斗，丢弃。
       同样只清自己那条，绝不牵连新的 pending。 */
    if (!scopeOk(scope)) { clearOwnPending(myToken); return 'skipped'; }
    /* 窗口是待播的**寿命上界**，在每次尝试出声前都重新核对：
       事件循环卡顿时排出去的回调可能迟到十几秒，回来时它已经过期，
       不能因为「词这会儿空着」就把一个陈旧的阶段喊出来。 */
    if (bornAt != null && clock() - bornAt > deferWindowMs) {
      clearOwnPending(myToken);
      return 'skipped';
    }
    /* 战斗不在了（地图/标题/败局/领完奖/结算）→ 丢弃并清干净。 */
    if (!live()) { clearOwnPending(myToken); return 'skipped'; }
    if (typeof speakAnnouncement !== 'function') { clearOwnPending(myToken); return 'skipped'; }
    /* 词还在念：绝不在这里插话，也不 cancel —— 排一条新的等下一拍。 */
    if (wordBusy()) {
      /* bornAt 是在**第一次**尝试出声时定下的，整条递归链共用它。
         每次重排都重新 clock() 会让 clock()-bornAt 恒为 0，deferWindowMs
         形同虚设（待播可以无限续命）。 */
      const born = bornAt != null ? bornAt : clock();
      const deferrals = (pending && pending.count > 0) ? pending.count : 0;
      const waited = clock() - born;
      /* 窗口从「第一次想播」起算，且必须在**排下一次之前**就检查：
         deferMs > deferWindowMs 时第一拍就该丢弃。 */
      if (deferrals >= maxDeferrals || waited > deferWindowMs) {
        clearOwnPending(myToken);
        return 'skipped';   // 等不到就丢弃，绝不堆队列
      }
      const handle = put(() => {
        /* 迟到的回调：token 不匹配 = 已被 pause/newRun/dispose 作废。
           事件循环卡顿时它可能晚于窗口，回来时重算 waited 后自行丢弃。 */
        if (disposed || myToken !== tokenSeq) return;
        deliver(ann, myToken, born, scope);
      }, deferMs);
      pending = { handle, token: myToken, count: deferrals + 1, bornAt: born, scope };
      return 'deferred';
    }
    let ok = false;
    try { ok = speakAnnouncement({ text: ann.label, priority: FEEDBACK_PRIORITY, count: ann.count, stage: ann.stage }) === true; }
    catch (e) { ok = false; }   // 没语音能力 / 被浏览器拒：静默，不影响玩法
    clearOwnPending(myToken);
    return ok ? 'spoken' : 'skipped';
  }

  /* 一个共同的入口：complete 与 mistake 都走它（暂停冻结 + 状态闸门 + 待播作废）。 */
  function record(event, isMistake) {
    if (disposed) return { ok: false, reason: 'disposed', state: read(), announcement: null, spoken: false };
    if (paused()) return { ok: false, reason: 'paused', state: read(), announcement: null, spoken: false };
    const before = read();
    const result = recordWordCompletion(before, isMistake ? { ...(event || {}), correct: false, complete: true } : event);
    const after = write(result.state);
    /* 任何**被接受的新事实**都让在途待播过期：打错了、长了新阶段、
       或者已经饱和（saturated 也有新的 lastEventId，旧阶段同样过期）。
       duplicate / incomplete / not-correct / no-event-id 什么都没发生，
       不许它们动在途的待播。 */
    if (result.reason === 'mistake' || result.reason === 'grown' || result.reason === 'saturated') {
      invalidatePending();
    }
    return { ok: true, reason: result.reason, state: after, announcement: result.announcement, spoken: false };
  }

  /* 完整词完成。事件形状由父层注入：{eventId, complete:true, correct:true}。
     字母级事件请不要调这里 —— 域规则也会挡（complete!==true 不增长）。 */
  function complete(event) {
    const r = record(event, false);
    if (!r.ok || !r.announcement) return r;
    /* 文字先走：视觉通道不抢话，也不依赖有没有语音能力。 */
    if (typeof onAnnounce === 'function') { try { onAnnounce(r.announcement); } catch (e) { /* UI 画不出来也不影响计数 */ } }
    if (!live()) { return { ...r, spoken: false, speech: 'skipped' }; }
    /* 作用域令牌在**事件发生的这一刻**取：整条延迟链共用它，于是「这条播报
       属于哪一场战斗」这件事在排队的瞬间就定死了。 */
    const outcome = deliver(r.announcement, tokenSeq, undefined, scopeOf());
    return { ...r, spoken: outcome === 'spoken', speech: outcome };
  }

  /* 打错（错字母 / 错词）：打断连胜。 */
  function mistake(event) {
    return record(event, true);
  }

  /* 暂停：作废待播（那一句是暂停前的事），状态一个字节都不动。
     同时置上自己的冻结标志 —— 只靠外部 isPaused 的话，本模块的
     pause() 在没有父层配合时等于没暂停。 */
  function pause() {
    internalPaused = true;
    invalidatePending();
    return read();
  }

  /* 继续：解冻。**不补播**暂停期间丢掉的阶段，也不重播任何东西。 */
  function resume() {
    internalPaused = false;
    return read();
  }

  /* 新一轮：连胜清零。dispose 之后是 no-op（模块已卸下，谁也不该再改它）。 */
  function newRun() {
    if (disposed) return read();
    /* 新一轮必须**解冻**：上一局如果是暂停中结束的（放弃 / 结算 / 清档），
       internalPaused 还立着，玩家开新局后第一词会被判 paused 而不计数。 */
    internalPaused = false;
    invalidatePending();
    return write(createWordStreakState());
  }

  /* 卸载：幂等，之后所有入口都是 no-op，不再出声、不再改状态。 */
  function dispose() {
    if (disposed) return;
    invalidatePending();
    disposed = true;
  }

  return {
    complete, mistake, pause, resume, newRun, dispose,
    isPaused: paused,
    pendingCount: () => (pending ? pending.count : 0),
  };
}
