/* 主页声音设置区：两个互相独立的开关，收在主页下方同一块面板里。
 *
 * ★ 为什么从右上角的浮层搬下来：
 *   旧实现是一个 position:fixed 钉在 window 右上角的按钮，它不属于任何一层界面，
 *   于是窄屏手机上会压住战斗页的敌方血条数字，也会跟着玩家飘到每一页。
 *   现在它住在 #s-title 里的 #audioSettings 容器中 —— 属于主页文档流，
 *   离开主页就整块隐藏（不靠 display 手工切换，也不靠 MutationObserver 兜底）。
 *
 * 契约：只画、只派发回调。
 *   - 音量档位与存档字段（DB.vol / DB.mute）、语音开关（DB.voice）的所有权
 *     全在 runtime；本模块只通过 getter 读当前值、只把动作交回去。
 *   - 不读任何全局（不认 document 之外的状态、不认 DB/G/B），不写 innerHTML，
 *   - 不带任何内联 style（浮动定位是这次要删掉的东西，不能换个地方再来一次）。
 */

/* 音量档位：55% → 30% → 12% → 静音。与旧版完全一致，老存档里的 vol 也落在这条梯子上。 */
export const VOL_STEPS = [.55, .3, .12, 0];

/* 平台没有 speechSynthesis 时，音频那一路仍然完全可用。 */
const NO_SPEECH_NOTE = '当前浏览器不支持语音朗读（不影响游戏）';

/* 把存档里的音量值落到最近的一档；超出范围的夹到两端，绝不返回 undefined。 */
export function nearestVolStep(v) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  let best = 0, gap = Infinity;
  for (let i = 0; i < VOL_STEPS.length; i++) {
    const d = Math.abs(VOL_STEPS[i] - n);
    if (d < gap) { gap = d; best = i; }
  }
  return best;
}

/* 音量行的图标 / 数字 / tooltip。muted 为真时一律显示「静音」，
   哪怕存档里 mute=true 而 vol 还留着旧值（老存档会出现这种组合）。 */
export function volState(vol, muted) {
  const ladder = VOL_STEPS.map(v => (v > 0 ? Math.round(v * 100) + '%' : '静音')).join(' → ');
  if (muted) {
    return { icon: '🔇', text: '静音', title: '音量 静音（点击切换：' + ladder + '）' };
  }
  const pct = Math.round((typeof vol === 'number' ? vol : 0) * 100);
  return {
    icon: pct >= 50 ? '🔊' : '🔉',
    text: pct + '%',
    title: '音量 ' + pct + '%（点击切换：' + ladder + '）',
  };
}

/* 朗读行的图标 / 状态文字 / 说明 / tooltip / 是否禁用。
   supported=false → 禁用 + 一句解释，但绝不隐藏：玩家要知道自己为什么没声音。 */
export function voiceState(supported, on) {
  if (!supported) {
    return { icon: '🔇', text: '不可用', note: NO_SPEECH_NOTE, title: NO_SPEECH_NOTE, disabled: true };
  }
  return on
    ? { icon: '🗣', text: '开启', note: '', title: '单词朗读：开（点击关闭）', disabled: false }
    : { icon: '🔇', text: '已关', note: '', title: '单词朗读：关（点击开启）', disabled: false };
}

const CONTAINER_ID = 'audioSettings';

function el(doc, tag, className, id, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  if (text != null) node.textContent = text;
  return node;
}

/* 一行 = 文字标签 + 按钮 + 当前值。文字标签不能省：
   光看 🔊/🗣 分不出哪个管音效、哪个管朗读。 */
function row(doc, labelText, buttonId, valueId) {
  const row = el(doc, 'div', 'aset-row');
  row.appendChild(el(doc, 'span', 'aset-lbl', null, labelText));
  const btn = el(doc, 'button', 'aset-btn', buttonId);
  btn.setAttribute('type', 'button');
  row.appendChild(btn);
  row.appendChild(el(doc, 'span', 'aset-val', valueId));
  return { row, btn, val: row.children[2] };
}

/* opts:
 *   audio          { vol():number, muted():boolean }        当前音量（只读）
 *   tts            { supported():boolean, on():boolean }     朗读能力与开关（只读）
 *   onVolumeStep   (dir: +1|-1) => void                      前进/后退一档，父层负责落盘
 *   onVoiceToggle  (force?: boolean) => void                 切换朗读；传 true = 直接开
 */
export function createAudioSettings(opts = {}) {
  const { audio, tts, onVolumeStep, onVoiceToggle } = opts;
  const read = (obj, key, fallback) => {
    try {
      if (obj && typeof obj[key] === 'function') return obj[key]();
    } catch (e) { /* 平台能力缺失时静默降级，绝不把异常抛给页面 */ }
    return fallback;
  };

  let refs = null;

  function paint() {
    if (!refs) return refs;
    const v = volState(read(audio, 'vol', 0), !!read(audio, 'muted', false));
    refs.volBtn.textContent = v.icon;
    refs.volBtn.title = v.title;
    refs.volVal.textContent = v.text;

    const s = voiceState(!!read(tts, 'supported', false), !!read(tts, 'on', false));
    refs.voiceBtn.textContent = s.icon;
    refs.voiceBtn.title = s.title;
    refs.voiceBtn.disabled = s.disabled;
    refs.voiceVal.textContent = s.text;
    refs.note.textContent = s.note;
    refs.note.hidden = !s.note;
    return refs;
  }

  function mount(container) {
    const doc = typeof document !== 'undefined' ? document : null;
    const host = container || (doc ? doc.getElementById(CONTAINER_ID) : null);
    // 没有容器（Node 启动、旧版单文件导出、页面结构变了）就安静什么都不做。
    if (!doc || !host) return { root: null, volBtn: null, voiceBtn: null, paint };

    const root = el(doc, 'div', 'aset', CONTAINER_ID + '-root');
    root.appendChild(el(doc, 'div', 'aset-hd', null, '声音设置'));

    const sfx = row(doc, '音效', 'volBtn', 'volVal');
    root.appendChild(sfx.row);
    sfx.btn.onclick = () => { if (onVolumeStep) onVolumeStep(1); };
    sfx.btn.oncontextmenu = e => { if (e && e.preventDefault) e.preventDefault(); if (onVolumeStep) onVolumeStep(-1); };

    const voice = row(doc, '单词朗读', 'voiceBtn', 'voiceVal');
    root.appendChild(voice.row);
    const toggle = force => {
      // 平台没有语音能力时这一行是禁用的：点击/右键都不许改状态，也不许解锁发声。
      if (voice.btn.disabled) return;
      if (onVoiceToggle) onVoiceToggle(force);
    };
    voice.btn.onclick = () => toggle(undefined);
    voice.btn.oncontextmenu = e => { if (e && e.preventDefault) e.preventDefault(); toggle(true); };

    const note = el(doc, 'div', 'aset-note', 'audioNote');
    root.appendChild(note);

    host.appendChild(root);
    refs = { root, volBtn: sfx.btn, volVal: sfx.val, voiceBtn: voice.btn, voiceVal: voice.val, note };
    paint();
    return { ...refs, paint };
  }

  return { mount, paint, VOL_STEPS, nearestVolStep };
}
