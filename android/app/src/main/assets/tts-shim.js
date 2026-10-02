/* 在 document start 注入：Android WebView 没有 window.speechSynthesis，
   这里用原生 TextToSpeech（window.__androidTTS）补上游戏用到的那个子集。
   必须同步装好 —— 游戏的 src/services/speech.js 在模块初始化时就读
   window.speechSynthesis 决定 supported，晚一步整个语音层就永远是关的。 */
(function () {
  'use strict';

  var bridge = window.__androidTTS;
  if (!bridge || typeof bridge.speak !== 'function') return;
  if (window.__ttsShimInstalled) return;
  window.__ttsShimInstalled = true;

  var NOT_STARTED_MS = 8000;   // 只是防「pending 卡死」的兜底，不是延迟判据
  var AFTER_START_MS = 30000;

  var voices = [];
  var voiceListeners = [];
  var seq = 0;
  var live = {};      // id -> {u: utterance, started: bool}
  var timers = {};    // id -> timeout id

  var synth = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null
  };

  function call(fn, arg) { if (typeof fn === 'function') { try { fn(arg) } catch (e) {} } }
  function num(v, dflt) { var n = Number(v); return isFinite(n) ? n : dflt; }
  function bridgeReady() { try { return bridge.ready() === true } catch (e) { return false } }
  function bridgeDead() { try { return bridge.unavailable() === true } catch (e) { return false } }

  function settle() {
    var any = false, started = false;
    for (var k in live) { any = true; if (live[k].started) started = true; }
    synth.pending = any;
    synth.speaking = started;
  }

  function clearTimer(id) {
    if (timers[id] != null) { clearTimeout(timers[id]); delete timers[id]; }
  }

  function arm(id, ms, kind) {
    clearTimer(id);
    timers[id] = setTimeout(function () {
      delete timers[id];
      if (!live[id]) return;
      if (kind === 'start') finish(id, 'error', 'synthesis-failed');
      else finish(id, 'end');
    }, ms);
  }

  function fireStart(id) {
    var e = live[id];
    if (!e) return;
    e.started = true;
    clearTimer(id);
    arm(id, AFTER_START_MS, 'end');
    settle();
    call(e.u && e.u.onstart, { type: 'start', utterance: e.u, charIndex: 0, elapsedTime: 0 });
  }

  function finish(id, kind, code) {
    var e = live[id];
    if (!e) return;
    delete live[id];
    clearTimer(id);
    settle();
    var u = e.u;
    if (kind === 'end') {
      call(u && u.onend, { type: 'end', utterance: u, charIndex: 0, elapsedTime: 0 });
    } else {
      call(u && u.onerror, { type: 'error', error: code || 'synthesis-failed', utterance: u, charIndex: 0, elapsedTime: 0 });
    }
  }

  function loadVoices() {
    var raw;
    try { raw = bridge.voices(); } catch (e) { return false; }
    if (typeof raw !== 'string' || !raw) return false;
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { return false; }
    if (!arr || !arr.length) return false;
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] || {};
      out.push({
        name: String(v.name || ''),
        lang: String(v.lang || ''),
        voiceURI: String(v.voiceURI || v.name || ''),
        localService: v.localService !== false,
        'default': v.isDefault === true
      });
    }
    voices = out;
    return true;
  }

  function fireVoices() {
    var ev = { type: 'voiceschanged' };
    var ls = voiceListeners.slice();
    for (var i = 0; i < ls.length; i++) call(ls[i], ev);
    call(synth.onvoiceschanged, ev);
  }

  // 原生侧就绪前的轮询：TTS 引擎初始化通常几十毫秒，给足 2s 再判失败。
  function whenReady(cb, tries) {
    if (bridgeReady()) { cb(true); return; }
    if (bridgeDead() || (tries || 0) >= 20) { cb(false); return; }
    setTimeout(function () { whenReady(cb, (tries || 0) + 1); }, 100);
  }

  synth.getVoices = function () { return voices.slice(); };
  synth.addEventListener = function (type, fn) {
    if (type === 'voiceschanged' && typeof fn === 'function') voiceListeners.push(fn);
  };
  synth.removeEventListener = function (type, fn) {
    if (type !== 'voiceschanged') return;
    var i = voiceListeners.indexOf(fn);
    if (i >= 0) voiceListeners.splice(i, 1);
  };
  synth.pause = function () {};
  synth.resume = function () {};

  synth.cancel = function () {
    var entries = [], ids = [];
    for (var k in live) { entries.push(live[k]); ids.push(k); }
    live = {};
    for (var i = 0; i < ids.length; i++) clearTimer(ids[i]);
    settle();
    try { bridge.stop(); } catch (e) {}
    // 浏览器里被取消的一句以 interrupted 收场；游戏严格只把这个词当「不是故障」。
    setTimeout(function () {
      for (var j = 0; j < entries.length; j++) {
        var u = entries[j] && entries[j].u;
        call(u && u.onerror, { type: 'error', error: 'interrupted', utterance: u, charIndex: 0, elapsedTime: 0 });
      }
    }, 0);
  };

  synth.speak = function (u) {
    var id = ++seq;
    var text = (u && u.text != null) ? String(u.text) : '';
    live[id] = { u: u, started: false };
    settle();

    if (!text.replace(/\s+/g, '')) {
      // 空串暖机（speech.js 的 unlock 用）：不必惊动引擎，直接当成念完了。
      setTimeout(function () {
        fireStart(id);
        finish(id, 'end');
      }, 0);
      return;
    }

    arm(id, NOT_STARTED_MS, 'start');
    whenReady(function (ok) {
      if (!live[id]) return;                 // 等引擎的这段时间里被 cancel 了
      if (!ok) { finish(id, 'error', 'synthesis-unavailable'); return; }
      var status = -1;
      try {
        status = bridge.speak(
          id, text,
          String((u && u.lang) || 'en-US'),
          num(u && u.rate, 1),
          num(u && u.pitch, 1),
          num(u && u.volume, 1),
          (u && u.voice && u.voice.name) ? String(u.voice.name) : ''
        );
      } catch (e) { status = -1; }
      if (status !== 0) finish(id, 'error', 'synthesis-failed');
    }, 0);
  };

  window.__androidTTSDispatch = function (kind, id) {
    if (kind === 'voices') {
      if (loadVoices()) fireVoices();
      return;
    }
    if (kind === 'unavailable') return;      // ready()/unavailable() 已经能问到
    if (id == null || !live[id]) return;     // 迟到的原生回调：这一句早就不在册了
    if (kind === 'start') fireStart(id);
    else if (kind === 'end') finish(id, 'end');
    else if (kind === 'interrupted') finish(id, 'error', 'interrupted');
    else finish(id, 'error', 'synthesis-failed');
  };

  function Utt(text) {
    this.text = String(text == null ? '' : text);
    this.lang = 'en-US';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
    this.onpause = null;
    this.onresume = null;
    this.onboundary = null;
    this.onmark = null;
  }

  function define(name, value) {
    try {
      Object.defineProperty(window, name, { value: value, configurable: true, writable: true });
    } catch (e) {
      try { window[name] = value; } catch (e2) {}
    }
  }

  define('speechSynthesis', synth);
  define('SpeechSynthesisUtterance', Utt);

  if (bridgeReady() && loadVoices()) fireVoices();
})();
