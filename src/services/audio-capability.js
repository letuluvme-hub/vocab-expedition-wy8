/* 浏览器音频兼容层：能力探测状态机（音效与朗读各一路，互相独立）
 *
 * 存在理由：微信内置浏览器（iOS / 安卓）经常把 AudioContext 永久挂在 suspended，
 * 或者 speechSynthesis 静默不出声。玩家看到的现象是「一点声音都没有」，
 * 但游戏不报错、无从判断是静音、是关掉了朗读、还是这个浏览器真的放不出来。
 * 这个模块只回答一件事：**音频到底能不能用**，并把答案交给 UI 去提示。
 *
 * 三条硬规则（都有对应测试钉死）：
 *  1) 只有真的观察过才下结论。没观察过 = unknown/checking，绝不写「可用」。
 *  2) UA 是不是微信**不是**失败判据。微信只决定提示文案说什么。
 *  3) 静音 / 关掉朗读是玩家自己的选择，不是故障，也绝不自动替他改回来。
 *     「接口就绪，实际播放仍需设备验证」—— API 模拟成功不代表真机能听见。
 *
 * 纯服务层：不读 DOM、不读 DB/G/B、不读 localStorage、不联网、不加载任何录音。
 * 时间与定时器全部注入，Node 里可以零延迟地跑完整条状态机。
 */

export const STATUS = {
  UNKNOWN: 'unknown',        // 还没试过
  CHECKING: 'checking',      // 试了但没结论（多半还挂着，等下一个真实手势）
  AVAILABLE: 'available',    // 真的观察到在跑 —— 但仍不等于真机可听
  UNSUPPORTED: 'unsupported',// 平台压根没有这套 API
  BLOCKED: 'blocked',        // 有 API，但被拒绝 / 一直挂着 / 朗读报错
};

export const CHANNEL = { SFX: 'sfx', SPEECH: 'speech' };

/* 「可用」时必须一起给出的保守措辞。UI 拿它当副标题，避免把 API 成功说成「能听见」。 */
export const AVAILABLE_CLAIM = '接口已就绪，实际播放仍需设备验证';

const DEFAULT_RESUME_TIMEOUT_MS = 800;

/* 只有这四种情况才允许弹提示（由 UI 负责，本服务只给状态）：
 *   no-api / resume-rejected / resume-timeout / utterance-error / utterance-timeout */
const FAILURE_REASONS = new Set(['no-api', 'resume-rejected', 'resume-timeout', 'utterance-error', 'utterance-timeout']);

export function createAudioCapability(opts = {}) {
  const {
    environment = globalThis,
    onStatus = null,               // (snapshot) => void；只在状态真的变化时叫
    resumeTimeoutMs = DEFAULT_RESUME_TIMEOUT_MS,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = id => clearTimeout(id),
  } = opts;

  /* 两路分开记：音效能放不等于朗读能放，反之亦然。
     合并时取「最需要注意」的那一路：blocked > unsupported > checking > unknown > available。 */
  const ch = {
    [CHANNEL.SFX]: freshChannel(),
    [CHANNEL.SPEECH]: freshChannel(),
  };
  function freshChannel() {
    /* enabled = 玩家是不是**想要**这一路声音（朗读开关 / 音效音量）。
       关着的时候这一路不写任何结论：偏好不是故障（硬规则 3）。 */
    return { state: STATUS.UNKNOWN, reason: null, error: null, at: 0, observing: false, enabled: true };
  }
  /* ★ 两路各挂各的超时定时器（不再共用一个槽位）。
     原来只有单个 pendingResume，于是**朗读那一路的任何一次收尾**（成功、关掉朗读、
     没 API、报错）都会顺手清掉音效那路的挂起超时 —— 音效还挂在 suspended 上却永远
     停在 checking，玩家点多少下都等不到「浏览器放不出音效」。
     key 化之后每个 API 只撤自己那一路，dispose 才把两路一起收干净。 */
  const pendingResume = new Map();
  let last = null;                 // 上一次对外发布的快照（去重）
  let dismissed = false;           // 本次会话内玩家关掉了提示
  let wechat = false;
  try {
    const ua = String((environment && environment.navigator && environment.navigator.userAgent) || '');
    wechat = /micromessenger/i.test(ua);
  } catch (e) { /* 拿不到 UA 当普通浏览器，不许因此判失败 */ }

  /* 合并两路时只看「已经拿到的最强信号」：失败永远压过成功。
     unknown 必须排在 available 之下 —— 还没试过的一路，不该把已经跑通的一路盖成未知。 */
  const RANK = { blocked: 5, unsupported: 4, checking: 3, available: 2, unknown: 1 };

  function merged() {
    let worst = null;
    for (const key of [CHANNEL.SFX, CHANNEL.SPEECH]) {
      const s = ch[key];
      if (!worst || (RANK[s.state] || 0) > (RANK[worst.state] || 0)) worst = { ...s, channel: key };
    }
    if (!worst) return { state: STATUS.UNKNOWN, channel: null, reason: null, error: null, at: 0 };
    // 两路都还没试过：对外说「未知」，但不假装知道是哪一路出的问题
    if (worst.state === STATUS.UNKNOWN) return { state: STATUS.UNKNOWN, channel: null, reason: null, error: null, at: 0 };
    return worst;
  }

  function snapshot() {
    const m = merged();
    const s = {
      state: m.state,
      channel: m.channel,
      reason: m.reason,
      error: m.error || null,
      at: m.at || 0,
      wechat,
      // 显式声明静音与朗读开关是玩家偏好，永远不是故障
      muted: false,
      requiresUserAction: m.state === STATUS.BLOCKED || m.state === STATUS.UNSUPPORTED,
      claim: m.state === STATUS.AVAILABLE ? AVAILABLE_CLAIM : null,
    };
    return s;
  }

  function publish() {
    const s = snapshot();
    // 状态没变就不打扰 UI（音色异步到货、重复手势都会走到这里）
    if (last && last.state === s.state && last.channel === s.channel && last.reason === s.reason) return s;
    last = s;
    if (onStatus) { try { onStatus(s); } catch (e) { /* 回调坏了不许连累探测 */ } }
    return s;
  }

  /* key = 通道：只撤**这一路**挂着的超时定时器，另一路的完全不受影响。
     传 null 只在 dispose 时用（两路一起收）。 */
  function clearResumeWatch(key) {
    if (key == null) {
      for (const id of Array.from(pendingResume.values())) { try { clearTimer(id); } catch (e) {} }
      pendingResume.clear();
      return;
    }
    const id = pendingResume.get(key);
    if (id === undefined) return;
    pendingResume.delete(key);
    try { clearTimer(id); } catch (e) {}
  }

  function setChannel(key, state, reason, error) {
    const c = ch[key];
    if (!c) return null;
    c.state = state;
    c.reason = state === STATUS.AVAILABLE || state === STATUS.UNKNOWN ? null : (reason || null);
    c.error = error || null;
    c.at = Date.now();
    return publish();
  }

  /* ---- 玩家偏好闸门（父层契约：cap.setEnabled(channel, bool)） ----
     父层把朗读开关 / 音效音量接过来：关着的一路**不写任何状态**。
     ★ 这是「偏好 ≠ 故障」的落点：静音时 unlock() 照样可以暖机（那是为玩家好），
       但绝不会因此报 unsupported/blocked 去打扰他。
     ★ 关掉时顺带**撤掉**这一路已经挂着的失败提示：玩家自己选择不听了，
       继续弹「浏览器放不出声」既吵又会误导他以为是游戏坏了。
       撤掉 ≠ 认定可用（状态回到 unknown），只是这一路不再需要提示。
     ★ 已经 available 的一路**保持** available：那是真的观察到过，不该被偏好抹掉。 */
  function setEnabled(key, on) {
    const c = ch[key];
    if (!c) return null;
    c.enabled = on !== false;
    if (c.enabled) return snapshot();
    c.observing = false;
    clearResumeWatch(key);   // ★ 只撤自己这一路：另一路的挂起超时与本路无关
    if (c.state !== STATUS.AVAILABLE && c.state !== STATUS.UNKNOWN) {
      c.state = STATUS.UNKNOWN; c.reason = null; c.error = null; c.at = Date.now();
      return publish();
    }
    return snapshot();
  }
  function isEnabled(key) { const c = ch[key]; return c ? c.enabled : false; }

  /* 语义化别名：父层按「关掉朗读 / 重新打开朗读」调用，读起来更清楚。
     行为与 setEnabled 逐字一致，避免两套语义漂移。 */
  function disableChannel(key) { return setEnabled(key, false); }
  function enableChannel(key) { return setEnabled(key, true); }

  /* ---- 探测入口（由音频服务在真实手势里调用） ----
     ★ 每个入口都先问 enabled：这一路被玩家关着/静音时，
       探测可以照跑（暖机），但**不许写状态** —— 偏好不是故障。 */
  function beginProbe(key) {
    if (!ch[key]) return null;
    const c = ch[key];
    if (!c.enabled) return snapshot();
    if (c.state === STATUS.AVAILABLE) return snapshot();   // 已经在跑，不必再查
    c.observing = true;
    /* ★ 已经有失败结论的一路，重试期间**保持原状态**，不许降级成 checking。
     *   checking 意味着「还没结论」，UI 于是把提示条藏掉 —— 而玩家点「知道了」
     *   的那一下 pointerdown 本身就会触发 beginProbe：提示条在 click 落地前
     *   被自己藏起来，click 落在空气上，提示条随后又弹回来，永远关不掉。
     *   「还没试过」才需要 checking；「试过了、坏了」在重试期间依然是事实，
     *   只有真的跑通（resolveProbe/observeOk → available）才撤掉提示。 */
    if (c.state === STATUS.BLOCKED || c.state === STATUS.UNSUPPORTED) return snapshot();
    return setChannel(key, STATUS.CHECKING, null);
  }

  /* ctx: { state:'running'|'suspended'|'closed' } 或 null（建不出来） */
  function resolveProbe(key, ctx) {
    const c = ch[key];
    if (!c) return null;
    c.observing = false;
    if (!c.enabled) return snapshot();
    if (!ctx) return setChannel(key, STATUS.UNSUPPORTED, 'no-api');
    if (ctx.state === 'running') { clearResumeWatch(key); return setChannel(key, STATUS.AVAILABLE, null); }
    // 还挂着：先别下结论，起一个超时看看到底能不能起来
    clearResumeWatch(key);
    c.observing = true;
    // 同 beginProbe：已经有失败结论的一路，重试期间保持原状态（提示条不许在
    // 用户点「知道了」的 click 落地之前自己藏掉）。超时兜底照旧挂上 ——
    // 这一次探测的结论仍可能覆盖旧结论（真的跑通就该撤掉提示）。
    if (c.state !== STATUS.BLOCKED && c.state !== STATUS.UNSUPPORTED) {
      setChannel(key, STATUS.CHECKING, null);
    }
    pendingResume.set(key, setTimer(() => {
      pendingResume.delete(key);
      const t = ch[key];
      if (t && t.observing && t.enabled) setChannel(key, STATUS.BLOCKED, 'resume-timeout');
    }, resumeTimeoutMs));
    return snapshot();
  }

  function rejectProbe(key, error) {
    const c = ch[key];
    if (!c) return null;
    c.observing = false;
    clearResumeWatch(key);   // ★ 只撤自己这一路：另一路的挂起超时与本路无关
    if (!c.enabled) return snapshot();
    return setChannel(key, STATUS.BLOCKED, 'resume-rejected', String(error == null ? '' : error));
  }

  function noCapability(key) {
    const c = ch[key];
    if (!c) return null;
    c.observing = false;
    clearResumeWatch(key);   // ★ 只撤自己这一路：另一路的挂起超时与本路无关
    if (!c.enabled) return snapshot();
    return setChannel(key, STATUS.UNSUPPORTED, 'no-api');
  }

  /* 朗读这一路独有的失败：speak 抛错 / utterance onerror / 迟迟不出声。
     音效那边不适用，所以单独一个入口。 */
  function reportUtteranceFailure(key, reason, error) {
    const c = ch[key];
    if (!c) return null;
    c.observing = false;
    clearResumeWatch(key);   // ★ 只撤自己这一路：另一路的挂起超时与本路无关
    if (!c.enabled) return snapshot();
    const r = FAILURE_REASONS.has(reason) ? reason : 'utterance-error';
    return setChannel(key, STATUS.BLOCKED, r, error == null ? null : String(error));
  }

  function observeOk(key) {
    const c = ch[key];
    if (!c) return null;
    c.observing = false;
    clearResumeWatch(key);   // ★ 只撤自己这一路：另一路的挂起超时与本路无关
    if (!c.enabled) return snapshot();
    return setChannel(key, STATUS.AVAILABLE, null);
  }

  /* 提示只在本会话内可关；不写存档、不改任何偏好。 */
  function dismiss() { dismissed = true; return snapshot(); }
  function isDismissed() { return dismissed; }
  function resetDismiss() { dismissed = false; return snapshot(); }

  /* 玩家下一次真实手势到来时可以重试；提示被关掉也不影响重试。 */
  function canRetry() { return ch[CHANNEL.SFX].observing || ch[CHANNEL.SPEECH].observing; }

  function channelState(key) { return ch[key] ? ch[key].state : null; }

  function dispose() { clearResumeWatch(null); }

  return {
    beginProbe, resolveProbe, rejectProbe, noCapability,
    reportUtteranceFailure, observeOk,
    /* 父层偏好契约：把「玩家要不要这一路声音」告诉兼容层 */
    setEnabled, isEnabled, disableChannel, enableChannel,
    snapshot, channelState, dismiss, isDismissed, resetDismiss, canRetry, dispose,
    AVAILABLE_CLAIM,
  };
}
