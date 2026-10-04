/* 音频兼容提示条在**真实游戏页面**上的端到端验收
 *
 * 与 audio-compatibility.spec.js 的区别：那条跑在独立夹具上，只证明模块本身
 * 能画能点；这条跑在**真正的游戏主页**上（runtime.js 真的建了兼容层、真的注进
 * audio/speech、真的把提示条挂在 #audioCompatibility 里），点的是真的按钮，
 * 走的是真的存档字段（DB.mute / DB.voice）。
 *
 * ★ 只模拟浏览器 API，不模拟游戏逻辑：
 *   - AudioContext 缺失 / resume 被拒：用 addInitScript 换掉平台 API；
 *   - speechSynthesis 报错：注入一个会真的回调 onerror 的桩 utterance。
 *   DOM、onclick、状态机、存档、战斗流程全部是应用自己的，一行没改。
 *
 * ★ 重要且不夸大：这些场景证明的是「API 失败时提示条接得上、且不影响练词」。
 *   它们**不能**证明微信 iOS / 安卓真机能出声 —— 浏览器自动化替换不了真机试听，
 *   也伪造不出微信内置浏览器的自动播放策略。真机仍需人工验证。
 */
import { test, expect } from '@playwright/test';
import { STORAGE_KEY } from './game-harness.js';

test.beforeEach(({},testInfo)=>{ test.skip(testInfo.project.metadata.target==='legacy','Compatibility fallback is a new feature absent from the archived legacy application'); });
const ROOT = '#audioCompatibility-root';
/* 存档基线：seed 写进去的字段 ∪ 应用自己会补的合法字段。
   判据是「没有超出这份基线的新字段」—— 硬编码一份完整清单太脆（存档结构会随
   别的功能演进），这里要证明的只是「兼容层一个字都没写进存档」。 */
const SEED_KEYS = [
  'runs', 'wins', 'mastered', 'best', 'custom', 'mute', 'vol', 'voice',   // seed
  'rewards', 'kbMode', 'kbUpper', 'unitProgress',                          // 应用自己补的
  'dictationMastered', 'reviewQueue', // additive storage migration, not the notice
  'reviewSchedule', 'wordExposure', 'dailyReports', // dated daily learning, not the notice
  'dailyCollection', // partner/checkin migration, not the notice
  'heroStats', // role unlock migration, not the notice
  'keyboardTipSeen',   // 主页一次性键盘提示看没看过（2026-10-02），由 initializeDB 补
];

/* 平台能力降级：只改浏览器 API，游戏自己什么都不动。
 *   noAudio   —— 平台压根没有 AudioContext（老 WebView / 隐私模式）
 *   rejectSfx  —— 有 API，但 resume() 被自动播放策略拒绝
 *   speechMode —— speech 桩在 speak() 之后怎么收场：
 *                 'error'  → onerror({error:'network'})（真故障，必须提示）
 *                 'cancel' → onerror({error:'canceled'})（**不是**故障，不许提示） */
const initScript = ({ saved, speechMode }) => {
  window.__VOCAB_TEST__ = true;
  let state = 0x51a7 >>> 0;
  Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  localStorage.setItem('wy8a_rogue_v1', JSON.stringify(saved));

  if (window.__AUDIO_E2E_NO_AUDIO__) {
    // 「平台没有这套 API」：两个构造器名都拿掉，和真机上一样。
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
  }
  if (window.__AUDIO_E2E_REJECT_SFX__) {
    // 有构造器，但 resume() 永远被拒 —— 这才是「微信里放不出声」的真实形态。
    // ★ 绝不能顺手调原生 resume()：真 Chrome 在真实手势里其实**会**成功，
    //   那样就永远测不到拒绝分支（实测：ac 变成 running，提示条不出现）。
    // ★ 必须用 defineProperty：`window.AudioContext` 在 Chrome 上是
    //   Window 原型上的**只读访问器**，直接赋值会被静默丢弃（非严格模式不报错），
    //   桩根本没装上，测的还是原生实现。
    // ★ 只拦 resume() 还不够：Playwright 的点击是**可信手势**，Chrome 会在内部
    //   把上下文直接恢复成 running（实测 ac.state === 'running'），于是服务层
    //   看到的是「跑起来了」，永远到不了失败分支。所以 state 也必须一并钉住 ——
    //   这正是微信内置浏览器那种「API 存在、resume 不给力、状态一直挂在
    //   suspended」的形态。state 是原型上的只读访问器，用实例级 defineProperty 遮住。
    const Native = window.AudioContext || window.webkitAudioContext;
    const Wrapped = function (...args) {
      const ctx = new Native(...args);
      ctx.resume = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      Object.defineProperty(ctx, 'state', { configurable: true, get: () => 'suspended' });
      return ctx;
    };
    Wrapped.prototype = Native.prototype;
    Object.defineProperty(window, 'AudioContext', { configurable: true, writable: true, value: Wrapped });
  }
  if (speechMode) {
    // 朗读桩：真的走 SpeechSynthesisUtterance 形状，并真的回调 onerror。
    // ★ canceled 是「我们自己 cancel() 了」，不是故障 —— 服务层必须认出来。
    // ★ 同样必须 defineProperty：window.speechSynthesis 是只读访问器，
    //   直接赋值会被静默丢弃 —— 桩装不上，测到的还是真 Chrome（无音频设备 → 真报错），
    //   于是「canceled 不该提示」这条会被真故障掩盖掉。
    const Utt = class {
      constructor(text) { this.text = String(text); this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; }
    };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: Utt });
    const synth = {
      speaking: false, pending: false, paused: false,
      getVoices: () => [],
      addEventListener() {}, removeEventListener() {},
      cancel() {},
      resume() {},
      speak(u) {
        setTimeout(() => {
          if (!u) return;
          if (speechMode === 'error' && u.onerror) u.onerror({ error: 'network' });
          else if (speechMode === 'cancel' && u.onerror) u.onerror({ error: 'canceled' });
          else if (u.onstart) u.onstart({});
        }, 0);
      },
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: synth });
  }
};

async function open(page, { saved, noAudio = false, rejectSfx = false, speechMode = null } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ noAudio, rejectSfx }) => {
    window.__AUDIO_E2E_NO_AUDIO__ = noAudio;
    window.__AUDIO_E2E_REJECT_SFX__ = rejectSfx;
  }, { noAudio, rejectSfx });
  await page.addInitScript(initScript, {
    saved: { runs: 0, wins: 0, mastered: [], best: 0, custom: [], ...saved },
    speechMode,
  });
  await page.goto('/vocab-expedition-wy8/');
  await expect(page.locator('#s-title')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!window.__gameTest)).toBe(true);
  return errors;
}

/* 真的进一场战斗：复用地图上**真实存在**的节点（不是造假的对象），
 * 词取自本局词池 —— 与 game-harness 的 fight() 同一口径。
 * 战斗流程、伤害、掌握判定全部由应用自己跑，这里只负责「进得去战斗」。 */
async function enterFight(page) {
  await page.locator('#units .unit[data-unit="1"]').click();
  await page.locator('#startRun').click();
  await expect(page.locator('#s-map')).toBeVisible();
  await page.evaluate(() => {
    const t = window.__gameTest;
    const entry = (t.G.pool || [])[0];
    const node = t.G.avail.find(n => n.type === 'battle') || t.G.avail[0];
    node.type = 'battle';
    t.enterNode(node);
    t.B.word = entry;
    const l = t.drawLetters(entry);
    Object.assign(t.B, {
      letters: l.letters, used: l.used,
      bad: l.letters.map(() => false), input: [], enHp: 10_000, enMax: 10_000,
    });
    t.renderFight();
  });
  await expect(page.locator('#s-fight')).toBeVisible();
}

/* 回主页看提示条：它住在主页声音设置区下面，战斗屏上本来就看不到。 */
const toHome = page => page.evaluate(() => window.__gameTest.show('s-title'));

test.describe('audio compatibility notice wired into the real game page', () => {
  test('a player who wants no sound at all is never shown a notice', async ({ page }) => {
    // 偏好优先于一切：玩家自己静音 + 关掉朗读，就算平台两套 API 都没有也不提示。
    const errors = await open(page, {
      saved: { mute: true, vol: 0, voice: false }, noAudio: true, speechMode: 'error',
    });
    await page.mouse.click(20, 20);            // 真实手势：触发两个 unlock
    await page.waitForTimeout(300);
    // 根节点始终存在（容器必须真的被画进主页），显不显示由 hidden 决定
    await expect(page.locator('#audioCompatibility')).toHaveCount(1);
    await expect(page.locator(ROOT)).toBeHidden();
    await expect(page.locator('#audioCompatTitle')).toHaveText('');

    // 静音 / 关朗读也不影响正常开局
    await page.locator('#units .unit[data-unit="1"]').click();
    await page.locator('#startRun').click();
    await expect(page.locator('#s-map')).toBeVisible();
    expect(errors, 'No uncaught errors').toEqual([]);
  });

  test('a wanted sound with no AudioContext shows a dismissible notice and practice still works', async ({ page }) => {
    // 玩家要声音（不静音），但平台压根没有 AudioContext → unsupported
    const errors = await open(page, { saved: { mute: false, vol: 0.55, voice: false }, noAudio: true });
    await page.locator('#volBtn').click();     // 真实点击：触发 audioUnlock
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    await expect(root).toContainText('音效');
    // 只解释「不支持」，绝不承诺「这样就一定能听见」，也绝不提微信（非微信环境）
    await expect(root).not.toContainText('微信');
    // no-api 时不给「重试」：没有 API，重试多少次都不会有声音
    await expect(page.locator('#acomp-retry')).toHaveCount(0);
    await page.locator('#acomp-dismiss').click();
    await expect(root).toBeHidden();

    // ★ 关键：提示只是提示，练词完全不受影响 —— 真的进战斗、真的拼一个字母
    await enterFight(page);
    // ★ 必须点**当前该填的那个字母**（答案的首字母），不是字母盘上的第一个：
    //   字母盘混着干扰字母，而且 DOM 顺序与 B.letters 下标顺序并不相同
    //   （键盘布局按 QWERTY 分行）。点错字母本来就不进 input —— 那是判定，不是故障。
    const need = await page.evaluate(() => window.__gameTest.B.word.w[0].toLowerCase());
    await page.locator('#fBank .key:not(.out)').filter({ hasText: new RegExp(`^${need}$`, 'i') }).first().click();
    await expect.poll(() => page.evaluate(() => window.__gameTest.B.input.length)).toBe(1);
    expect(errors, 'No uncaught errors').toEqual([]);
  });

  test('a rejected resume is reported on the home panel, and dismissing hides it', async ({ page }) => {
    // 有 AudioContext，但 resume 被自动播放策略拒 → blocked
    const errors = await open(page, { saved: { mute: false, vol: 0.55, voice: false }, rejectSfx: true });
    await page.locator('#volBtn').click();
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    await expect(root).toContainText('当前浏览器暂未能播放音效');
    // blocked（不是 no-api）才给「重试」：重试必须发生在真实手势里
    await expect(page.locator('#acomp-retry')).toBeVisible();
    await page.locator('#acomp-dismiss').click();
    await expect(root).toBeHidden();
    expect(errors, 'No uncaught errors').toEqual([]);
  });

  test('a real utterance error in a real fight is reported, then withdrawn when the voice is turned off', async ({ page }) => {
    // 朗读开着 + 朗读桩真的报错 → 战斗中「听读音」触发 utterance-error
    const errors = await open(page, { saved: { mute: false, vol: 0.55, voice: true }, speechMode: 'error' });
    await enterFight(page);
    await page.locator('#tSay').click();        // 真的点「听读音」
    await toHome(page);
    const root = page.locator(ROOT);
    await expect(root).toBeVisible();
    // 朗读这一路坏了，标题必须说「朗读」，不能赖到音效头上
    await expect(root).toContainText('朗读');

    // 玩家自己关掉朗读 → 提示立刻撤掉（偏好不是故障，绝不继续打扰）
    await page.locator('#voiceBtn').click();
    await expect(root).toBeHidden();
    expect(errors, 'No uncaught errors').toEqual([]);
  });

  test('an utterance we cancelled ourselves is not reported as a failure', async ({ page }) => {
    // canceled / interrupted 是「我们自己叫停」：报成故障会让玩家正常操作却被反复弹窗
    const errors = await open(page, { saved: { mute: false, vol: 0.55, voice: true }, speechMode: 'cancel' });
    await enterFight(page);
    await page.locator('#tSay').click();
    await page.waitForTimeout(200);
    await toHome(page);
    await expect(page.locator(ROOT)).toBeHidden();
    expect(errors, 'No uncaught errors').toEqual([]);
  });

  test('the home page starts clean and never overflows on a 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const errors = await open(page, { saved: { mute: false, vol: 0.55, voice: true }, rejectSfx: true });
    await page.locator('#volBtn').click();
    // 提示条出现时也不能把窄屏撑出横向滚动条
    await expect(page.locator(ROOT)).toBeVisible();
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      const n = document.querySelector('#audioCompatibility-root');
      return {
        doc: de.scrollWidth - de.clientWidth,
        bar: n ? Math.round(n.getBoundingClientRect().right) - Math.round(de.clientWidth) : 0,
      };
    });
    expect(overflow.doc, '320px 下不许出现横向溢出').toBeLessThanOrEqual(0);
    expect(overflow.bar, '提示条不许越过视口右缘').toBeLessThanOrEqual(0);
    expect(errors, 'No uncaught errors').toEqual([]);
  });

  test('the notice carries no inline style and never writes to the save file', async ({ page }) => {
    const errors = await open(page, { saved: { mute: false, vol: 0.55, voice: false }, noAudio: true });
    await page.locator('#volBtn').click();
    await expect(page.locator(ROOT)).toBeVisible();
    const inline = await page.evaluate(sel => {
      const n = document.querySelector(sel);
      return n ? n.getAttribute('style') || '' : 'missing';
    }, ROOT);
    expect(inline, '不许带内联 style').toBe('');
    // 兼容层是纯内存态：提示条不许往存档里写任何**新**字段，也不许改玩家偏好。
    // 判据是「相对打开时只增不减」—— 硬编码一份完整字段清单太脆：
    // 存档结构会随别的功能演进，而这里要证明的只是「提示条一个字都没写进去」。
    const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), STORAGE_KEY);
    expect(Object.keys(saved).filter(k => !SEED_KEYS.includes(k)),
      '兼容层不许往存档里加任何字段').toEqual([]);
    expect(saved.mute, '静音状态不许被提示条改掉').toBe(false);
    expect(saved.voice, '朗读开关不许被提示条改掉').toBe(false);
    expect(errors, 'No uncaught errors').toEqual([]);
  });
});
