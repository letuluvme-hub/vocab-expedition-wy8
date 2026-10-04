import { test, expect } from '@playwright/test';

// Only platform APIs are replaced. Runtime, settings, save transactions and
// actual fight inputs are the production application. This is not a device
// audibility test, nor evidence that WeChat on iOS/Android can synthesize sound.
const platform = ({ mode, voice, wechat, rejectSfx }) => {
  window.__VOCAB_TEST__ = true;
  if (wechat) Object.defineProperty(navigator, 'userAgent', { configurable: true,
    value: 'Mozilla/5.0 (Linux; Android 15) MicroMessenger/8.0.50' });
  if (!sessionStorage.getItem('__wechat_voice_seeded')) {
    localStorage.setItem('wy8a_rogue_v1', JSON.stringify({ runs: 0, wins: 0,
      mastered: [], best: 0, custom: [], voice, mute: !rejectSfx, vol: rejectSfx ? .55 : 0,
      unknownFuture: { keep: ['original'] }, audioNoticeSeen: { unknownFuture: 7 } }));
    sessionStorage.setItem('__wechat_voice_seeded', '1');
  }
  if (mode === 'missing') {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: undefined });
  } else {
    class Utt { constructor(text) { this.text = String(text); } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: Utt });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speaking: false, pending: false, paused: false,
      getVoices: () => [], addEventListener() {}, cancel() {}, resume() {},
      speak(u) {
        if (!String(u.text).trim()) return; // original silent gesture priming
        if (mode === 'silent') return;
        setTimeout(() => {
          if (mode === 'error') u.onerror?.({ target: u, error: 'not-allowed' });
          else { u.onstart?.({ target: u }); setTimeout(() => u.onend?.({ target: u }), 20); }
        }, 0);
      },
    } });
  }
  if (rejectSfx) {
    const Native = window.AudioContext || window.webkitAudioContext;
    const Wrapped = function (...args) {
      const context = new Native(...args);
      context.resume = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      Object.defineProperty(context, 'state', { configurable: true, get: () => 'suspended' });
      return context;
    };
    Wrapped.prototype = Native.prototype;
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: Wrapped });
  }
};

async function open(page, options = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(platform, { mode: 'error', voice: true, wechat: true, rejectSfx: false, ...options });
  await page.goto('/vocab-expedition-wy8/');
  await expect(page.locator('#s-title')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__gameTest)).toBe(true);
  return errors;
}

async function listenInFight(page) {
  await page.locator('#units .unit[data-unit="1"]').click();
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const node = t.G.avail.find(n => n.type === 'battle') || t.G.avail[0];
    node.type = 'battle';
    t.enterNode(node);
    t.B.enHp = t.B.enMax = 10_000;
  });
  await expect(page.locator('#s-fight')).toBeVisible();
  await page.locator('#tSay').click();
}

const home = async page => {
  await page.locator('#tPause').click();
  await page.locator('#pzHome').click();
  await expect(page.locator('#s-title')).toBeVisible();
};
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('wy8a_rogue_v1')));

test.beforeEach(({}, info) => test.skip(info.project.metadata.target === 'legacy', 'New persistent compatibility help is absent from legacy'));

test('missing speech API explains the browser route immediately, closes once and retains help after refresh', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const errors = await open(page, { mode: 'missing' });
  await expect(page.locator('#audioCompatibility-root')).toBeVisible();
  await expect(page.locator('#audioCompatibility-root')).toContainText('不支持朗读');
  await expect(page.locator('#audioCompatibility-root')).toContainText('Chrome');
  await expect(page.locator('#audioCompatibility-root')).toContainText('右上角');
  await page.locator('#audioCompatibility-root').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('missing-voice-320.png') });
  await page.locator('#acomp-dismiss').click();
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  const first = await saved(page);
  expect(first.audioNoticeSeen).toEqual({ unknownFuture: 7, speech: true });
  expect(first.unknownFuture).toEqual({ keep: ['original'] });
  expect(first.voice).toBe(true);
  await page.reload();
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  await expect(page.locator('#audioCompatibility-help')).toBeVisible();
  await page.locator('#audioCompatibility-help summary').click();
  await expect(page.locator('#audioCompatibility-help')).toContainText('Safari');
  await page.screenshot({ path: info.outputPath('dismissed-help-320.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('a player who chose no voice gets only the ordinary unsupported state and no unsolicited prompt', async ({ page }) => {
  const errors = await open(page, { mode: 'missing', voice: false });
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  await expect(page.locator('#voiceVal')).toHaveText('不可用');
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  expect((await saved(page)).audioNoticeSeen).toEqual({ unknownFuture: 7 });
  expect(errors).toEqual([]);
});

test('actual speech rejection is visible once, persists through refresh and never changes the voice preference', async ({ page }) => {
  const errors = await open(page);
  await listenInFight(page);
  await expect.poll(() => page.evaluate(() => window.__gameTest.TTS.cap.channelState('speech'))).toBe('blocked');
  await home(page);
  await expect(page.locator('#voiceVal')).toHaveText('暂不可用');
  await expect(page.locator('#audioCompatibility-root')).toContainText('朗读');
  const paused = await saved(page);
  await page.locator('#acomp-dismiss').click();
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  const acknowledged = await saved(page);
  expect(acknowledged.activeRun.run).toEqual(paused.activeRun.run);
  expect(acknowledged.activeRun.battle).toEqual(paused.activeRun.battle);
  await page.reload();
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  // A new real rejection must be acknowledged in the status/help, but cannot
  // turn the already-dismissed browser advice back into a repeated prompt.
  await page.locator('#continueRun').click();
  await expect(page.locator('#s-fight')).toBeVisible();
  await page.locator('#tSay').click();
  await expect.poll(() => page.evaluate(() => window.__gameTest.TTS.cap.channelState('speech'))).toBe('blocked');
  await home(page);
  await expect(page.locator('#voiceVal')).toHaveText('暂不可用');
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  await expect(page.locator('#audioCompatibility-help')).toBeVisible();
  const state = await saved(page);
  expect(state.voice).toBe(true);
  expect(state.audioNoticeSeen.speech).toBe(true);
  expect(state.unknownFuture).toEqual({ keep: ['original'] });
  expect(errors).toEqual([]);
});

test('silent utterances time out and explain browser alternatives without stopping real input', async ({ page }) => {
  const errors = await open(page, { mode: 'silent' });
  await listenInFight(page);
  await expect.poll(() => page.evaluate(() => window.__gameTest.TTS.cap.channelState('speech')), { timeout: 12_000 }).toBe('blocked');
  const need = await page.evaluate(() => window.__gameTest.B.word.w.replace(/[^a-z]/ig, '')[0].toLowerCase());
  await page.keyboard.press(need);
  expect(await page.evaluate(() => window.__gameTest.B.input.length)).toBe(1);
  await home(page);
  await expect(page.locator('#audioCompatibility-root')).toContainText('浏览器打开');
  expect(errors).toEqual([]);
});

test('WeChat with successful speech has no failure prompt and sound-effect failure never changes its voice status', async ({ page }) => {
  const errors = await open(page, { mode: 'ok', rejectSfx: true });
  await listenInFight(page);
  await expect.poll(() => page.evaluate(() => window.__gameTest.TTS.cap.channelState('speech'))).toBe('available');
  await home(page);
  await expect(page.locator('#voiceVal')).toHaveText('开启');
  await expect(page.locator('#audioCompatibility-root')).toContainText('音效');
  await expect(page.locator('#audioCompatibility-root')).not.toContainText('不支持朗读');
  await page.locator('#acomp-dismiss').click();
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  expect((await saved(page)).audioNoticeSeen).toEqual({ unknownFuture: 7, sfx: true });
  expect(errors).toEqual([]);
});

test('WeChat user-agent alone never produces a warning when the real speech interface succeeds', async ({ page }) => {
  const errors = await open(page, { mode: 'ok' });
  await listenInFight(page);
  await expect.poll(() => page.evaluate(() => window.__gameTest.TTS.cap.channelState('speech'))).toBe('available');
  await home(page);
  await expect(page.locator('#audioCompatibility-root')).toBeHidden();
  await expect(page.locator('#voiceVal')).toHaveText('开启');
  await expect(page.locator('#audioCompatibility-help')).toBeVisible();
  expect(await page.locator('#audioCompatibility-help').evaluate(n => n.open)).toBe(false);
  await page.locator('#audioCompatibility-help summary').click();
  await expect(page.locator('#audioCompatibility-help')).toContainText('如果没有听见读音');
  await expect(page.locator('#audioCompatibility-help')).not.toContainText('不支持朗读');
  expect((await saved(page)).audioNoticeSeen).toEqual({ unknownFuture: 7 });
  expect(errors).toEqual([]);
});
