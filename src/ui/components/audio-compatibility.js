/* 浏览器音频兼容提示条
 *
 * 什么时候出现：只有**真的观察到放不出声**的时候（被拒绝 / 一直挂起 / 朗读报错），
 * 或者平台压根没有这套 API。UA 是微信**不构成**出现理由 —— 微信里一切正常就不出现。
 *
 * 出现时说什么，三条铁律：
 *  1) 不承诺「这样就一定能听见」。探测只能看到 API 层，真机是否可听要玩家自己确认。
 *  2) 微信里教用户走右上角菜单用系统浏览器打开，**不摆「跳到 Safari」按钮** ——
 *     微信内置浏览器禁止页面自己跳到别的浏览器，那个按钮点了必然没用，纯骗人。
 *  3) 非微信浏览器不说微信那一套（用户看不懂），只说「再点一下 / 检查音量静音」。
 *
 * 契约（与 audio-settings.js 一致）：只画、只派发回调。
 * 不读 DB/G/B、不读 localStorage、不联网、不加载任何录音文件。
 * 不写 innerHTML、不带内联 style —— 这两条都有测试钉死。
 * 关闭交回父层保存可选的一次性事实；本模块不保存、不改玩家偏好。
 * 已关闭的失败说明留在折叠帮助里，用户仍可主动查看。
 */
import { STATUS, CHANNEL } from '../../services/audio-capability.js';

const CONTAINER_ID = 'audioCompatibility';

/* 音效与朗读是**两件独立的事**：音效能放不代表朗读能放，提示也要分开说，
   否则玩家会去调一个根本没坏的开关。 */
const SUBJECT = {
  [CHANNEL.SFX]: { title: '当前浏览器暂未能播放音效', short: '音效' },
  [CHANNEL.SPEECH]: { title: '当前浏览器暂未能朗读单词', short: '朗读' },
  default: { title: '当前浏览器暂未能播放声音', short: '声音' },
};

const BROWSER_OPTIONS = '可尝试用 Chrome、Edge、Safari 或安卓版打开；仍没声音时检查设备音量和系统语音。';
const WECHAT_BODY =
  '不影响练习。点右上角「···」选择「在浏览器打开」。' + BROWSER_OPTIONS;
const PLAIN_BODY =
  '不影响练习。可以再点一下屏幕重试，或检查设备音量／静音开关。' + BROWSER_OPTIONS;
const UNSUPPORTED_BODY =
  '不影响练习。' + BROWSER_OPTIONS;
/* ★ unsupported 在微信里**也**要给出路。原来这一支一个字都不提，
   玩家看到「这个浏览器不支持音效」只会更困惑 —— 而微信里恰恰有明确做法。
   仍然只是文字：内置浏览器禁止页面自己跳出去，摆按钮必然是骗人。 */
const UNSUPPORTED_WECHAT_BODY = WECHAT_BODY;

/* 纯函数：状态 → 要不要显示 / 显示什么。
   拆出来是为了文案能脱离 DOM 单测（微信那句与非微信那句必须分别钉死）。 */
export function compatNoticeText(snap) {
  const s = snap || {};
  const none = { visible: false, dismissible: false, wechat: !!s.wechat, actions: [], title: '', body: '' };
  // unknown / checking 都不显示：还没结论就不要打扰玩家
  if (s.state !== STATUS.BLOCKED && s.state !== STATUS.UNSUPPORTED) return none;

  const subject = SUBJECT[s.channel] || SUBJECT.default;
  if (s.state === STATUS.UNSUPPORTED) {
    const wechatUnsupported = !!s.wechat;
    return {
      visible: true, dismissible: true, wechat: wechatUnsupported,
      title: '这个浏览器不支持' + subject.short,
      body: wechatUnsupported ? UNSUPPORTED_WECHAT_BODY : UNSUPPORTED_BODY,
      actions: [{ id: 'dismiss', label: '知道了' }],
    };
  }
  const wechat = !!s.wechat;
  // 微信里**没有** open-external：内置浏览器不允许页面自己跳出去
  const actions = wechat
    ? [{ id: 'dismiss', label: '知道了' }]
    : [{ id: 'retry', label: '重试' }, { id: 'dismiss', label: '知道了' }];
  return {
    visible: true, dismissible: true, wechat,
    title: subject.title,
    body: wechat ? WECHAT_BODY : PLAIN_BODY,
    actions,
  };
}

function el(doc, tag, className, id, textContent) {
  const n = doc.createElement(tag);
  if (className) n.className = className;
  if (id) n.id = id;
  if (textContent != null) n.textContent = textContent;
  return n;
}

/* opts:
 *   capability  { snapshot(), isDismissed(), dismiss() }  必填（可传 null = 全静默）
 *   document    宿主 document（可注入，便于测试）
 *   onRetry     () => void   玩家点了「重试」—— 真正重试是父层的事：
 *                            必须发生在真实手势里，本模块绝不自己 resume。
 *   getNoticeSeen(channel) => boolean / onNoticeSeen(channel) => void
 *               可选的一次性提示事实端口，存储完全由父层负责。
 */
export function createAudioCompatibility(opts = {}) {
  const { capability, document: docIn, onRetry, getNoticeSeen, onNoticeSeen } = opts;
  const doc = docIn || (typeof document !== 'undefined' ? document : null);
  let refs = null;

  function readState() {
    // 能力对象坏掉不许连累页面：读不到就当作「没什么要提示的」
    try {
      if (!capability || typeof capability.snapshot !== 'function') return null;
      return capability.snapshot();
    } catch (e) { return null; }
  }
  function isDismissed(channel) {
    try { if (typeof getNoticeSeen === 'function' && getNoticeSeen(channel) === true) return true; }
    catch (e) { /* unavailable storage leaves a working in-memory fallback */ }
    try { return !!(capability && typeof capability.isDismissed === 'function' && capability.isDismissed(channel)); }
    catch (e) { return false; }
  }

  function failureStates() {
    const main = readState();
    const states = main ? [main] : [];
    if (main && capability && typeof capability.channelSnapshot === 'function') {
      for (const channel of [CHANNEL.SPEECH, CHANNEL.SFX]) {
        try {
          const state = capability.channelSnapshot(channel);
          if (state && !states.some(s => s.channel === channel)) states.push(state);
        } catch (e) { /* an optional port failure must not break the page */ }
      }
    }
    return states.filter(s => compatNoticeText(s).visible);
  }

  function paint() {
    if (!refs) return refs;
    const failures = failureStates();
    const snap = failures.find(s => !isDismissed(s.channel)) || failures[0];
    const view = compatNoticeText(snap);
    const show = view.visible && !isDismissed(snap.channel);
    refs.root.hidden = !show;
    const voluntaryWechatHelp = !!readState()?.wechat;
    refs.help.hidden = failures.length === 0 && !voluntaryWechatHelp;
    // Keep the user's open/closed choice. Repainting status must never reopen
    // the advice they already acknowledged or close help they are reading.
    while (refs.helpBody.firstChild) refs.helpBody.removeChild(refs.helpBody.firstChild);
    for (const failure of failures) {
      const advice = compatNoticeText(failure);
      refs.helpBody.appendChild(el(doc, 'div', 'acomp-help-text', null, advice.title + '。' + advice.body));
    }
    if (failures.length === 0 && voluntaryWechatHelp) {
      refs.helpBody.appendChild(el(doc, 'div', 'acomp-help-text', null,
        '如果没有听见读音：' + WECHAT_BODY));
    }
    if (!show) return refs;
    refs.title.textContent = view.title;
    refs.body.textContent = view.body;
    // 重建动作按钮：按当前状态给不同的按钮集合（微信态没有「重试」）。
    // ★ 必须用 removeChild 逐个摘，不能写 children.length = 0 ——
    //   children 是**实时只读**的 HTMLCollection，模块是 ES module（严格模式），
    //   赋值会直接抛 TypeError，整段 paint 就断在那里。
    const actionsKey = snap.channel + ':' + view.actions.map(a => a.id).join(',');
    if (refs.actionsKey === actionsKey) return refs;
    refs.actionsKey = actionsKey;
    while (refs.acts.firstChild) refs.acts.removeChild(refs.acts.firstChild);
    for (const a of view.actions) {
      const b = el(doc, 'button', 'acomp-btn', 'acomp-' + a.id, a.label);
      b.setAttribute('type', 'button');
      b.onclick = () => {
        if (a.id === 'dismiss') {
          try { if (capability && typeof capability.dismiss === 'function') capability.dismiss(snap.channel); } catch (e) {}
          try { if (typeof onNoticeSeen === 'function') onNoticeSeen(snap.channel); } catch (e) {}
          paint();
        } else if (a.id === 'retry') {
          // 重试必须由父层在真实手势里做，这里只派发
          if (onRetry) { try { onRetry(); } catch (e) {} }
        }
      };
      refs.acts.appendChild(b);
    }
    return refs;
  }

  function mount(container) {
    const host = container || (doc ? doc.getElementById(CONTAINER_ID) : null);
    if (!doc || !host) return { root: null, paint };

    const root = el(doc, 'div', 'acomp', CONTAINER_ID + '-root');
    root.hidden = true;
    const title = el(doc, 'div', 'acomp-title', 'audioCompatTitle');
    const body = el(doc, 'div', 'acomp-body', 'audioCompatBody');
    const acts = el(doc, 'div', 'acomp-acts', 'audioCompatActions');
    root.appendChild(title);
    root.appendChild(body);
    root.appendChild(acts);
    host.appendChild(root);
    const help = el(doc, 'details', 'acomp-help', CONTAINER_ID + '-help');
    help.hidden = true;
    help.open = false;
    help.appendChild(el(doc, 'summary', null, null, '声音使用帮助'));
    const helpBody = el(doc, 'div', 'acomp-help-body');
    help.appendChild(helpBody);
    host.appendChild(help);
    refs = { root, title, body, acts, help, helpBody, actionsKey: null };
    paint();
    return { root, title, body, acts, paint };
  }

  return { mount, paint };
}
