import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORDS } from '../../src/data/words.js';
import { UNITS } from '../../src/data/units.js';
import { HEROES } from '../../src/data/heroes.js';
import { ITEMS } from '../../src/data/items.js';
import { RELICS } from '../../src/data/relics.js';
import { NODES } from '../../src/data/nodes.js';
import { clamp } from '../../src/domain/math.js';
import { norm, wordGapBefore } from '../../src/domain/text.js';
import { comboRate as calculateComboRate } from '../../src/domain/damage.js';
import { pixelMonsterSVG as foeArtHTML } from '../../src/ui/components/pixel-art.js';

import { rewardScope, renderRewardCard } from '../../src/ui/components/reward-card.js';

const baseline = readFileSync(new URL('../fixtures/legacy.html', import.meta.url), 'utf8');
const script = baseline.match(/<script>([\s\S]*?)<\/script>/)[1];

/* 把 legacy.html 里的原函数原样抽出来，在注入同一批依赖的沙箱里执行。
   这样断言的是「新模块的 DOM 输出 === 旧版真实运行结果」，而不是源码字符串。 */
function legacySource(name) {
  const start = script.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('legacy function not found: ' + name);
  const end = script.indexOf('\n}', start);
  if (end < 0) throw new Error('legacy function not terminated: ' + name);
  return script.slice(start, end + 2);
}
function legacyFn(name, deps = {}) {
  const names = Object.keys(deps);
  // eslint-disable-next-line no-new-func
  return new Function(...names, legacySource(name) + '\nreturn ' + name + ';')(...names.map(n => deps[n]));
}

/* ---------------- 轻量 DOM 桩（无需 jsdom）---------------- */
class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.onclick = null;
    this.offsetWidth = 0;
    this.clientWidth = 0;
    this.parentElement = null;
    this._text = '';
    this._html = '';
    this._rect = { left: 0, top: 0, width: 0, height: 0 };
    const props = {};
    // 直接赋值（style.width / style.display / style.left）也必须进快照，
    // 否则「护盾层没有 display:none」这类变异会从断言缝里漏过去。
    const style = {
      setProperty(k, v) { props[k] = String(v); },
      getPropertyValue(k) { return props[k] || ''; },
      set width(v) { props.width = v; },
      get width() { return props.width || ''; },
      set display(v) { props.display = v; },
      get display() { return props.display || ''; },
      set left(v) { props.left = v; },
      get left() { return props.left || ''; },
      set gap(v) { props.gap = v; },
      get gap() { return props.gap || ''; },
      get gridTemplateColumns() { return props.gridTemplateColumns || ''; },
      set gridTemplateColumns(v) { props.gridTemplateColumns = v; },
      set maxWidth(v) { props.maxWidth = v; },
      get maxWidth() { return props.maxWidth || ''; },
      get _props() { return props; },
    };
    this.style = style;
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  insertAdjacentHTML(_pos, html) { this._html += html; }
  appendChild(c) { this.children.push(c); c.parentElement = this; return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getBoundingClientRect() { return this._rect; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function createDocument(ids) {
  const reg = new Map();
  for (const id of ids) reg.set(id, new StubEl('div'));
  return {
    getElementById: id => (reg.has(id) ? reg.get(id) : null),
    createElement: tag => new StubEl(tag),
    querySelectorAll: () => [],
    _reg: reg,
  };
}

function text(el) {
  if (!el) return '';
  return el.children.length ? el.children.map(text).join('') : el._text;
}

function snap(el) {
  if (!el) return 'null';
  const out = [el.tagName];
  if (el.className) out.push('.' + el.className);
  for (const k of Object.keys(el.attrs).sort()) out.push(`[${k}=${el.attrs[k]}]`);
  for (const k of Object.keys(el.dataset).sort()) out.push(`{${k}=${el.dataset[k]}}`);
  const st = el.style ? Object.keys(el.style._props).sort().map(k => `${k}:${el.style._props[k]}`).join(';') : '';
  if (st) out.push('{' + st + '}');
  if (el.disabled) out.push('[disabled]');
  if (el.hidden) out.push('[hidden]');
  if (el.onclick) out.push('[click]');
  if (el._html) out.push('#' + el._html);
  const t = text(el);
  if (t) out.push('=' + JSON.stringify(t));
  for (const c of el.children) out.push('[' + snap(c) + ']');
  return out.join('');
}

function snapDoc(doc, ids) { return ids.map(id => id + '→' + snap(doc.getElementById(id))).join('\n'); }

/* 2026-10-02 的**有意漂移**：怪物与装备图标换成像素美术。
 * 凡是承载图标的位置，旧版是 emoji（走 textContent）、新版是一整段 SVG（走 innerHTML），
 * 两者没有可比性 —— 先归一化再逐元素对照，图标本身在 tests/unit/pixel-art.test.js
 * 与各屏自己的断言里单独核对。不这么做，这几条对照会因为美术换代而永远红。 */
function stripArt(s) {
  return s
    // <span class="ic">…</span>（战斗道具栏、选项卡）
    .replace(/(class="ic">)[\s\S]*?(<\/span>)/g, '$1ART$2')
    // DIV.relic[click]#<svg…></svg>（地图 / 结算页的遗物格，innerHTML）
    .replace(/DIV\.relic(?:\[[^\]]*\])?#[\s\S]*?<\/svg>/g, 'DIV.relic=ART')
    // DIV.relic[click]="🛡️"（旧版的 emoji 形态）
    .replace(/DIV\.relic(?:\[[^\]]*\])?="[^"]*"/g, 'DIV.relic=ART')
    // 容器自身：旧版靠 textContent 累积出 "🛡️💎"，新版 innerHTML 置空后只 append 子元素，
    // 于是父节点一个有文本一个没有。把「紧接在遗物格前面的那段文本」也一并抹掉。
    .replace(/DIV="[^"]*"(\[DIV\.relic=ART)/g, 'DIV$1');
}

function withDocument(doc, fn) {
  const prev = globalThis.document;
  globalThis.document = doc;
  try { return fn(doc); } finally { globalThis.document = prev; }
}
const withDom = (ids, fn) => withDocument(createDocument(ids), fn);

const $for = doc => id => doc.getElementById(id);
const heroById = id => HEROES.filter(h => h.id === id)[0] || HEROES[0];
const HERO_DEFAULT = HEROES[0].id;
const relicById = id => RELICS.filter(r => r.id === id)[0];
const itemById = id => ITEMS.filter(x => x.id === id)[0];
const allWords = u => (u === 0 ? [] : WORDS.filter(x => x.u === u));

/* ============================================================
   hero.js
   ============================================================ */
test('hero.pcHTML reproduces the legacy markup for every hero id', async () => {
  const { pcHTML } = await import('../../src/ui/components/hero.js');
  const old = legacyFn('pcHTML');
  for (const h of HEROES) assert.equal(pcHTML(h.id), old(h.id));
  assert.equal(pcHTML('<img src=x onerror=alert(1)>'), old('<img src=x onerror=alert(1)>'));
});

test('hero.heroStatLines preserves stat formatting and exposes the new hero mechanics', async () => {
  const { heroStatLines } = await import('../../src/ui/components/hero.js');
  const old = legacyFn('heroStatLines');
  for (const h of HEROES) {
    const before = old(h).filter(line => !line.startsWith('答对回血'));
    for (const line of before) assert.ok(heroStatLines(h).includes(line), line);
    assert.ok(heroStatLines(h).length > before.length, h.id + ' 必须有新增能力速览');
  }
  assert.deepEqual(heroStatLines({}), old({}));
});

/* ============================================================
   hp-bar.js
   ============================================================ */
const HP_IDS = ['fMy', 'fMyS', 'fMyT'];
test('hp-bar.paintHpBar paints identical pixels as the legacy function', async () => {
  const { paintHpBar } = await import('../../src/ui/components/hp-bar.js');
  const { hpBarGeom } = await import('../../src/domain/hp.js');
  const cases = [[30, 0, 60], [30, 20, 60], [60, 20, 60], [0, 0, 70], [65, 5, 60], [-3, 2, 60]];
  for (const [hp, sh, max] of cases) {
    const docOld = createDocument(HP_IDS);
    const oldGeom = withDocument(docOld, () =>
      legacyFn('paintHpBar', { $: $for(docOld), hpBarGeom })('fMy', 'fMyS', 'fMyT', hp, sh, max));
    const docMine = createDocument(HP_IDS);
    const myGeom = withDocument(docMine, () => paintHpBar('fMy', 'fMyS', 'fMyT', hp, sh, max));
    // 几何（返回的百分比与容量）在任何情况下都不许漂移 —— 修复只动了显示层。
    assert.deepEqual(myGeom, oldGeom, `geom ${hp}/${sh}/${max}`);
    // 2026-10-02 的**有意漂移**：旧版因为有 g.sh/shield 的字段名错漏，
    // 护盾层永远 display:none、文字永远没有「+N盾」。**没有护盾**的那些用例
    // 走的还是同一条路径，所以仍要求逐像素相同；有护盾的差异由上面那条测试
    // 断言正确行为，不在这里重复。
    if (sh <= 0) {
      assert.equal(snapDoc(docMine, HP_IDS), snapDoc(docOld, HP_IDS), `pixels ${hp}/${sh}/${max}`);
    }
  }
});

/* ★ 2026-10-02 修复：paintHpBar 曾经读 g.sh，而 hpBarGeom 返回的字段叫 shield，
 *   于是 g.sh 恒为 undefined —— 护盾层永远 display:none、血量文字里永远没有「+N盾」。
 *   旧版就是这么写的，抽取阶段照抄了它，并在 tests/e2e/README.md 里登记为
 *   「不能悄悄修掉的旧版事实」。用户明确要求显示护盾值，这里按登记的规程走：
 *   先写断言**正确行为**的失败测试，再改代码，并且两条血条（地图页 / 战斗页）
 *   走的是同一个函数，所以一起验。 */
test('hp-bar.paintHpBar shows the shield layer and the +N盾 suffix', async () => {
  const { paintHpBar } = await import('../../src/ui/components/hp-bar.js');
  const { hpBarGeom } = await import('../../src/domain/hp.js');
  const read = (hp, sh, max) => {
    const doc = createDocument(HP_IDS);
    withDocument(doc, () => paintHpBar('fMy', 'fMyS', 'fMyT', hp, sh, max));
    return {
      display: doc.getElementById('fMyS').style.display,
      txt: doc.getElementById('fMyT').textContent,
      width: doc.getElementById('fMy').style.width,
      shLeft: doc.getElementById('fMyS').style.left,
      shWidth: doc.getElementById('fMyS').style.width,
    };
  };
  // 没有护盾时：护盾层收起，文字只有血量
  assert.deepEqual(read(30, 0, 60), { display: 'none', txt: '30/60', width: '50%', shLeft: '50%', shWidth: '0%' });
  // 有护盾时：护盾层显示出来，并且文字**必须**带上「+N盾」——
  // 玩家要从这里读出「我还能挨多少」，藏在图里而不写数字等于没给。
  assert.deepEqual(read(30, 20, 60), { display: '', txt: '30/60 +20盾', width: '62.5%', shLeft: '37.5%', shWidth: '25%' });
  assert.equal(hpBarGeom(30, 20, 60).shield, 20, 'hpBarGeom 本身返回 shield，不返回 sh');
});

test('hp-bar.paintHpBar 对脏护盾值不生成 NaN，也不显示空护盾层', async () => {
  const { paintHpBar } = await import('../../src/ui/components/hp-bar.js');
  const read = (hp, sh, max) => {
    const doc = createDocument(HP_IDS);
    withDocument(doc, () => paintHpBar('fMy', 'fMyS', 'fMyT', hp, sh, max));
    return { display: doc.getElementById('fMyS').style.display, txt: doc.getElementById('fMyT').textContent };
  };
  for (const bad of [undefined, null, NaN, 'x', {}, -5]) {
    const r = read(30, bad, 60);
    assert.doesNotMatch(r.txt, /NaN|undefined/, '脏护盾值不许渗进文案：' + JSON.stringify(bad));
    assert.equal(r.display, 'none', '认不出的护盾不值一条显示的护盾层：' + JSON.stringify(bad));
  }
  // 负血量/超上限：文字仍要如实报出，且不出现负号
  assert.equal(read(-3, 0, 60).txt, '0/60');
});

test('hp-bar.paintHpBar tolerates missing elements and still returns geometry', async () => {
  const { paintHpBar } = await import('../../src/ui/components/hp-bar.js');
  const { hpBarGeom } = await import('../../src/domain/hp.js');
  assert.deepEqual(withDom([], () => paintHpBar('nope', 'nope2', 'nope3', 10, 5, 20)), hpBarGeom(10, 5, 20));
  assert.deepEqual(hpBarGeom(10, 5, 20), { pct: 60, cap: 25, shield: 5, hpPct: 40, shPct: 20 });
});

/* ============================================================
   phrase-slots.js
   ============================================================ */
function phraseScene(avail, slotW) {
  const sl = new StubEl('div');
  sl._rect = { left: 0, top: 0, width: avail, height: 40 };
  const gapBefore = wordGapBefore('living conditions', norm('living conditions').length);
  for (let i = 0; i < norm('living conditions').length; i++) {
    if (i > 0 && gapBefore[i]) {
      const sep = new StubEl('div');
      sep.className = 'slotsep';
      sep._rect = { width: 6, left: 0, top: 0, height: 10 };
      sl.appendChild(sep);
    }
    const s = new StubEl('div');
    s.className = 'slot';
    s._rect = { width: slotW, left: 0, top: 0, height: 30 };
    sl.appendChild(s);
  }
  return sl;
}

test('phrase-slots.fitPhraseSlots shrinks slot width exactly like legacy', async () => {
  const { fitPhraseSlots } = await import('../../src/ui/components/phrase-slots.js');
  const gapBefore = wordGapBefore('living conditions', norm('living conditions').length);
  const cases = [[278, 27], [315, 27], [640, 27], [100, 27], [278, 5]];
  const prevGCS = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ columnGap: '5px', gap: '5px' });
  try {
    for (const [avail, slotW] of cases) {
      const mine = phraseScene(avail, slotW);
      fitPhraseSlots(mine, gapBefore);
      const old = phraseScene(avail, slotW);
      legacyFn('fitPhraseSlots', { getComputedStyle: globalThis.getComputedStyle })(old, gapBefore);
      assert.equal(snap(mine), snap(old), `avail=${avail} slotW=${slotW}`);
    }
  } finally {
    if (prevGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = prevGCS;
  }
});

test('phrase-slots.fitPhraseSlots is a no-op without getComputedStyle (Node)', async () => {
  const { fitPhraseSlots } = await import('../../src/ui/components/phrase-slots.js');
  const gapBefore = wordGapBefore('living conditions', 18);
  assert.equal(typeof globalThis.getComputedStyle, 'undefined');
  const sl = phraseScene(278, 27);
  const before = snap(sl);
  assert.doesNotThrow(() => fitPhraseSlots(sl, gapBefore));
  assert.equal(snap(sl), before);
});

/* ============================================================
   reward-card.js
   ============================================================ */
test('reward-card.rewardScope matches legacy for every unit and the sentinels', async () => {
  const { rewardScope } = await import('../../src/ui/components/reward-card.js');
  const old = legacyFn('rewardScope', { UNITS });
  for (const u of [1, 2, 3, 4, 5, 6, 0, -1, 7]) assert.equal(rewardScope(u), old(u));
});

const REWARD = { id: 'WR-abc-3-2', unit: 3, heroId: 'scout', accuracy: 87, kills: 14, floor: 9, earnedAt: '2026-10-01T09:30:00.000Z' };
test('reward-card.renderRewardCard keeps the legacy card DOM plus the round-aware lines', async () => {
  const { renderRewardCard } = await import('../../src/ui/components/reward-card.js');
  const mineBox = withDom([], () => { const b = new StubEl('div'); renderRewardCard(b, REWARD); return b; });
  const oldBox = new StubEl('div');
  withDocument(createDocument([]), () => legacyFn('renderRewardCard', { heroById, rewardScope })(oldBox, REWARD));
  // 任务 8 的**有意漂移**：卡上必须分清「轮次 / 本轮完成单元 / 本轮学习范围是否完成」
  // （docs/feature-rounds.md）。REWARD 是旧版形状（没有 roundNumber 等字段），
  // 所以新增三行分别是「旧版记录 · 未记录轮次」+ 两行「未记录完成范围」。
  // ★ 旧卡**没有**这些字段：说「未完成」就是替玩家下一个他没经历过的结论，
  //   unknown ≠ false。有记录的新卡才说得了「未完成」（见 reward-card-round.test.js）。
  const card = mineBox.children[0];
  const added = card.children.filter(c => c.className);
  assert.deepEqual(added.map(c => c.className), ['reward-round', 'reward-done', 'reward-complete']);
  assert.equal(added[0].textContent, '旧版记录 · 未记录轮次');
  assert.equal(added[1].textContent, '本轮完成单元：未记录完成范围');
  assert.equal(added[2].textContent, '本轮完成范围：未记录完成范围');
  // 去掉这三行之后，剩下的 DOM 必须与旧版逐元素一致（其余文案零漂移）。
  const stripped = new StubEl('div');
  const article = new StubEl('article'); article.className = card.className;
  for (const c of card.children) if (!c.className) article.appendChild(c);
  stripped.appendChild(article);
  assert.equal(snap(stripped), snap(oldBox));
});

/* ============================================================
   fight.js 纯布局函数
   ============================================================ */
/* legacy 里 bankRows 依赖的 QWERTY 常量：原样抽出来注入沙箱，
   免得在测试里重写一份「看起来一样」的字母表。 */
const LEGACY_QWERTY = (() => {
  const start = script.indexOf('const QWERTY_ROWS=');
  const end = script.indexOf("return m })();", start) + "return m })();".length;
  // eslint-disable-next-line no-new-func
  return new Function(script.slice(start, end) + '\nreturn { QWERTY_ROWS, QWERTY_POS };')();
})();

test('fight bankCols / bankRows / bankPosOf agree with legacy for both modes', async () => {
  const { bankCols, bankRows, bankPosOf } = await import('../../src/ui/screens/fight.js');
  const oldCols = legacyFn('bankCols');
  for (let n = 1; n <= 24; n++) assert.equal(bankCols(n), oldCols(n), 'cols n=' + n);

  const samples = [
    ['apple', 'abcdefghijklmnopqrstuvwxyz'.slice(0, 12).split('')],
    ['qwerty', ['q', 'w', 'e', 'r', 't', 'y', 'a', 's', 'd', 'f', 'g']],
    ['mixed', ['a', 'z', 'm', 'q', 'p', 'x', 'c', 'v', 'b']],
    ['single', ['k']],
    ['nonalpha', ['1', 'a', 'b']],
  ];
  for (const [name, letters] of samples) {
    for (const kbMode of [false, true]) {
      const DB = { kbMode };
      const B = { letters };
      const deps = { B, DB, bankCols: oldCols, isKbMode: () => !!DB.kbMode, ...LEGACY_QWERTY };
      const oldRows = legacyFn('bankRows', deps);
      const oldPos = legacyFn('bankPosOf', { ...deps, bankRows: oldRows });
      const expected = oldRows();
      assert.deepEqual(bankRows(letters, kbMode), expected, `${name} kb=${kbMode}`);
      for (let i = 0; i < letters.length; i++) {
        assert.deepEqual(bankPosOf(letters, kbMode, i), oldPos(i), `${name} kb=${kbMode} i=${i}`);
      }
      assert.equal(bankPosOf(letters, kbMode, 999), null);
    }
  }
});

/* ============================================================
   fight.js renderFight / renderItems / syncBankBar
   ============================================================ */
const FIGHT_IDS = ['fEn', 'fEnT', 'fMy', 'fMyS', 'fMyT', 'fPc', 'fMyName', 'fAv', 'fName', 'fZh',
  'fCat', 'fTags', 'fSlots', 'fBank', 'tHintN', 'tHint', 'tSkip', 'tFlee', 'fCombo', 'fItems',
  'tBankMode', 'tBankCase', 'tBankModeV', 'tBankCaseV'];

function makeRun() {
  return { unit: 1, hp: 42, maxhp: 60, shield: 20, gold: 120, floor: 5, maxFloor: 5,
    heroId: 'scout', relics: ['shield', 'ghost'], hcombo: 1, bag: { leech: 2, rage: 1 }, att: 9, attOk: 8 };
}
function makeBattle() {
  const letters = ['c', 'o', 'n', 'd', 'i', 't', 'i', 'o', 'n', 's', 'x', 'a'];
  return { word: { w: 'living conditions', z: '生活条件', u: 1, d: 3 }, letters,
    used: letters.map((_, i) => i < 3), bad: letters.map((_, i) => i === 7),
    node: { type: 'elite' }, foe: { n: '词灵', ic: '👾', tint: '#a67dff' }, boss: false, elite: true,
    myHp: 42, enHp: 118, enMax: 200, shield: 20, input: ['c', 'o'], sel: 2,
    hints: 3, hintUsed: 1, hintTotal: 2, combo: 4, maxCombo: 6, dmgBonus: 15,
    rageLeft: 2, usedThisFight: { leech: 1, rage: 3 }, keyEls: null };
}

test('fight.renderFight paints the same DOM as the legacy function', async () => {
  const { createFightScreen, bankRows, bankCols } = await import('../../src/ui/screens/fight.js');
  const { paintHpBar } = await import('../../src/ui/components/hp-bar.js');
  const { fitPhraseSlots } = await import('../../src/ui/components/phrase-slots.js');

  const pressed = [];
  const mine = (DB, doc) => createFightScreen({
    getRun: makeRun, getBattle: makeBattle, getDB: () => DB,
    onPress: i => pressed.push(i), onUseItem: () => {}, paintSayBtn: () => {},
  });

  for (const DB of [{ kbMode: false, kbUpper: false }, { kbMode: true, kbUpper: true }]) {
    const docMine = withDom(FIGHT_IDS, doc => { mine(DB, doc).renderFight(); return doc; });
    const B = makeBattle(), G = makeRun();
    const docOld = createDocument(FIGHT_IDS);
    // 沙箱里的「兄弟函数」全部换成被测模块的同名实现：这样比较的是整个战斗页。
    const helper = mine(DB, docOld);
    const deps = {
      document: docOld, $: $for(docOld), B, G, clamp, norm, wordGapBefore, foeArtHTML,
      paintHpBar, fitPhraseSlots, heroById, HERO_DEFAULT, bankCols,
      bankRows: () => bankRows(B.letters, !!DB.kbMode),
      isKbMode: () => !!DB.kbMode, isKbUpper: () => !!DB.kbUpper,
      hasR: id => G.relics.indexOf(id) >= 0, comboRate: () => calculateComboRate(G),
      syncBankBar: () => helper.syncBankBar(), renderItems: () => helper.renderItems(),
      paintSayBtn: () => {}, innerWidth: 390,
    };
    globalThis.innerWidth = 390;   // 旧版直接读裸全局，Node 里没有 → 给出浏览器等价值
    withDocument(docOld, () => legacyFn('renderFight', deps)());
    delete globalThis.innerWidth;
    // tSkip 是本任务唯一有意偏离旧版的元素（代价文案 + run 级影分身额度），单独比；
    // 其余每个 id 仍要求与旧版真实输出逐字一致。
    // 清单 13 有两处有意偏离旧版：tSkip 的代价文案、#fAv 的放大 inline style。
    // 其余每个 id 仍要求与旧版真实输出逐字一致。
    const COMPARE_IDS = FIGHT_IDS.filter(id => id !== 'tSkip' && id !== 'fAv');
    const normalizeFoeScale = s => s
      .replace(/\{width:\d+px\}/, '')            // 只抹掉放大写进去的尺寸
      .replace(/;?height:\d+px;font-size:\d+px/, '');
    assert.equal(snapDoc(docMine, COMPARE_IDS), snapDoc(docOld, COMPARE_IDS), 'kb=' + DB.kbMode);
    // 偏离面必须精确：抹掉放大后，敌人头像的 SVG 与既有结构必须与旧版逐字相同
    // （形状/特效归既有样式表所有，本任务一个字都不许改）。
    assert.equal(normalizeFoeScale(snap(docMine.getElementById('fAv'))),
      snap(docOld.getElementById('fAv')), 'kb=' + DB.kbMode);
    // 放大上限由数据层钉死：不得超过 FOE_ART_SCALE_MAX 倍基准 --avatar。
    const { FOE_ART_SCALE_MAX } = await import('../../src/data/balance.js');
    const avStyle = docMine.getElementById('fAv').style;
    const scaled = parseFloat(avStyle.width);
    assert.ok(scaled > 0, '怪物确实被放大了（否则上面的抹平就成了假通过）');
    assert.ok(scaled <= 64 * FOE_ART_SCALE_MAX + 1,
      `放大后 ${scaled}px 超过上限 ${FOE_ART_SCALE_MAX} 倍基准 64px`);
    // 偏离面必须精确：只多出「影分身」标签 + 免费撤退小字 + tooltip，属性/尺寸行为不变。
    // 归一化掉新文案后必须与旧版逐字相同（title 是新加的，单独抹平）。
    // 名字不叫 norm：会和模块顶部 import 的 norm(text) 撞车（TDZ）。
    const normalizeSkip = s => s
      .replace('#影分身<small>免费撤退 · 本轮仅剩 1 次</small>', '="影分身"')
      .replace('[title=影分身：本轮远征唯一一次免费撤退，不计失败、不扣生命]', '');
    assert.equal(normalizeSkip(snap(docMine.getElementById('tSkip'))), snap(docOld.getElementById('tSkip')), 'kb=' + DB.kbMode);
    assert.equal(B.keyEls.length, B.letters.length);
    assert.deepEqual(pressed, []);
  }
});

test('fight.renderFight routes key presses through onPress and never mutates sel', async () => {
  const { createFightScreen } = await import('../../src/ui/screens/fight.js');
  const B = makeBattle();
  const pressed = [];
  withDom(FIGHT_IDS, doc => {
    createFightScreen({ getRun: makeRun, getBattle: () => B, getDB: () => ({ kbMode: false, kbUpper: false }),
      onPress: i => pressed.push(i), onUseItem: () => {}, paintSayBtn: () => {} }).renderFight();
    const bank = doc.getElementById('fBank');
    assert.equal(bank.children.length, B.letters.length, 'grid mode flattens every key into the bank');
    bank.children[4].onclick();
    bank.children[9].onclick();
    return null;
  });
  assert.deepEqual(pressed, [4, 9]);
  assert.equal(B.sel, 2, 'the screen must not set B.sel — that is the parent state owner');
});

test('fight.renderFight labels the skip button by the run-level ghost charge, states the 50 HP cost, and marks flee by gold', async () => {
  const { createFightScreen } = await import('../../src/ui/screens/fight.js');
  const { SKIP_HP_COST } = await import('../../src/data/balance.js');
  const ids = FIGHT_IDS;
  const run = makeRun();
  const paint = (mut) => {
    const r = { ...run, ...mut };
    const B = makeBattle();
    return withDom(ids, doc => {
      createFightScreen({ getRun: () => r, getBattle: () => B, getDB: () => ({}),
        onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {} }).renderFight();
      return {
        skip: doc.getElementById('tSkip')._html,
        title: doc.getElementById('tSkip').title,
        flee: doc.getElementById('tFlee').disabled,
        hint: doc.getElementById('tHint').disabled,
        hintN: doc.getElementById('tHintN').textContent,
      };
    });
  };
  // 额度是 run 级：可用时必须点明「本轮」与剩余次数
  const free = '影分身<small>免费撤退 · 本轮仅剩 1 次</small>';
  const costly = '跳过<small>损失 ' + SKIP_HP_COST + ' 生命</small>';
  assert.deepEqual(paint({ relics: ['shield', 'ghost'] }),
    { skip: free, title: '影分身：本轮远征唯一一次免费撤退，不计失败、不扣生命', flee: false, hint: false, hintN: '3 次' });
  // 普通跳过必须点明固定代价，不能再写「不掉血」
  assert.deepEqual(paint({ relics: ['shield'] }),
    { skip: costly, title: '撤退：损失 ' + SKIP_HP_COST + ' 点生命（生命不足即战败）', flee: false, hint: false, hintN: '3 次' });
  assert.notEqual(costly.includes('不掉血'), true, '代价文案不得声称不掉血');
  // ★ 本轮已用完 → 按钮回到「跳过（付 50）」，tooltip 说明影分身已用完。
  //   判据是 run 上的 ghostUsed；战斗对象上根本没有 ghost 字段。
  const usedGhost = withDom(ids, doc => {
    const B = makeBattle();
    assert.ok(!('ghostUsed' in B), '战斗对象不携带 ghost 状态');
    createFightScreen({ getRun: () => ({ ...run, relics: ['ghost'], ghostUsed: true }), getBattle: () => B,
      getDB: () => ({}), onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {} }).renderFight();
    return { html: doc.getElementById('tSkip')._html, title: doc.getElementById('tSkip').title };
  });
  assert.equal(usedGhost.html, costly);
  assert.match(usedGhost.title, /已用完/);
  assert.match(usedGhost.title, new RegExp(String(SKIP_HP_COST)), 'tooltip 要写明用完后的实际代价');
  // 重复拿到影分身也不得把按钮显示成免费
  assert.deepEqual(paint({ relics: ['ghost', 'ghost'], ghostUsed: true }),
    { skip: costly, title: '影分身本轮已用完：撤退需要损失 ' + SKIP_HP_COST + ' 点生命', flee: false, hint: false, hintN: '3 次' },
    '重复持有不恢复额度');
  assert.deepEqual(paint({ relics: ['shield'], gold: 9 }),
    { skip: costly, title: '撤退：损失 ' + SKIP_HP_COST + ' 点生命（生命不足即战败）', flee: true, hint: false, hintN: '3 次' }, '金币不足 10 禁逃跑');
  assert.deepEqual(paint({ relics: ['shield'], gold: 10 }),
    { skip: costly, title: '撤退：损失 ' + SKIP_HP_COST + ' 点生命（生命不足即战败）', flee: false, hint: false, hintN: '3 次' }, '刚好 10 金币仍可逃跑');
});

test('fight.renderFight sizes keyboard keys to the container in kb mode', async () => {
  const { createFightScreen } = await import('../../src/ui/screens/fight.js');
  const kwid = (clientW, letters) => withDom(FIGHT_IDS, doc => {
    doc.getElementById('fBank').clientWidth = clientW;
    const B = { ...makeBattle(), letters, used: letters.map(() => false), bad: letters.map(() => false) };
    createFightScreen({ getRun: makeRun, getBattle: () => B, getDB: () => ({ kbMode: true, kbUpper: false }),
      onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {} }).renderFight();
    const bank = doc.getElementById('fBank');
    return {
      kw: bank.style.getPropertyValue('--kbw'),
      cols: bank.style.gridTemplateColumns,
      maxW: bank.style.maxWidth,
      rows: bank.children.map(r => r.className + ':' + r.children.length).join(','),
    };
  });
  // 320px 窄屏 + 满行 qwerty：floor((320−9×7)/10)=25px，夹住不溢出
  const narrow = kwid(320, ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p']);
  assert.equal(narrow.kw, '25px');
  assert.equal(narrow.cols, '', '键盘模式必须清掉 gridTemplateColumns');
  assert.equal(narrow.maxW, '');
  assert.equal(narrow.rows, 'kbrow r0:10');
  // 宽屏：键宽封顶 52px，不无限拉大
  assert.equal(kwid(1200, ['q', 'w']).kw, '52px');
  // 字母盘模式：走 gridTemplateColumns + maxWidth，不受 --kbw 影响
  // makeBattle() 是 12 个字母 → bankCols(12)=4 列 → maxWidth = 4×66 = 264px
  const grid = withDom(FIGHT_IDS, doc => {
    doc.getElementById('fBank').clientWidth = 320;
    createFightScreen({ getRun: makeRun, getBattle: makeBattle, getDB: () => ({ kbMode: false, kbUpper: false }),
      onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {} }).renderFight();
    const bank = doc.getElementById('fBank');
    return { kw: bank.style.getPropertyValue('--kbw'), cols: bank.style.gridTemplateColumns, maxW: bank.style.maxWidth };
  });
  assert.deepEqual(grid, { kw: '', cols: 'repeat(4,minmax(0,1fr))', maxW: '264px' });
});

test('fight.renderItems shows only held items and hands clicks to onUseItem', async () => {
  const { createFightScreen } = await import('../../src/ui/screens/fight.js');
  const used = [];
  const build = run => createFightScreen({ getRun: () => run, getBattle: makeBattle,
    getDB: () => ({}), onPress: () => {}, onUseItem: id => used.push(id), paintSayBtn: () => {} });

  const docMine = withDom(FIGHT_IDS, doc => { build(makeRun()).renderItems(); return doc; });
  const docOld = createDocument(FIGHT_IDS);
  withDocument(docOld, () =>
    legacyFn('renderItems', { $: $for(docOld), G: makeRun(), B: makeBattle(), itemById, useItem: () => {} })());
  // 图标归一化后再比（见 stripArt）；下面单独断言像素图标确实画出来了。
  assert.equal(stripArt(snapDoc(docMine, ['fItems'])), stripArt(snapDoc(docOld, ['fItems'])));
  assert.match(snap(docMine.getElementById('fItems').children[0]),
    /<svg[^>]*class="pxicon"/, '道具格应当画像素图标');
  docOld.getElementById('fItems').children[0].onclick();
  docMine.getElementById('fItems').children[0].onclick();
  assert.deepEqual(used, ['leech']);

  const empty = withDom(FIGHT_IDS, doc => {
    const run = makeRun(); run.bag = {};
    build(run).renderItems();
    return doc.getElementById('fItems')._html;
  });
  assert.match(empty, /背包是空的/);
});

test('fight.syncBankBar mirrors legacy button state and repaints the say button', async () => {
  const { createFightScreen } = await import('../../src/ui/screens/fight.js');
  const ids = ['tBankMode', 'tBankCase', 'tBankModeV', 'tBankCaseV'];
  let said = 0;
  for (const DB of [{ kbMode: true, kbUpper: false }, { kbMode: false, kbUpper: true }]) {
    const mineDoc = withDom(ids, doc => {
      createFightScreen({ getRun: makeRun, getBattle: makeBattle, getDB: () => DB,
        onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => { said++; } }).syncBankBar();
      return doc;
    });
    const old = createDocument(ids);
    legacyFn('syncBankBar', { $: $for(old), isKbMode: () => !!DB.kbMode, isKbUpper: () => !!DB.kbUpper, paintSayBtn: () => { said++; } })();
    assert.equal(snapDoc(mineDoc, ids), snapDoc(old, ids));
  }
  assert.equal(said, 4);
});

test('fight render never echoes the target word in the info bar (nospoiler)', async () => {
  const { createFightScreen } = await import('../../src/ui/screens/fight.js');
  const B = makeBattle();
  withDom(FIGHT_IDS, doc => {
    createFightScreen({ getRun: makeRun, getBattle: () => B, getDB: () => ({}),
      onPress: () => {}, onUseItem: () => {}, paintSayBtn: () => {} }).renderFight();
    const cat = doc.getElementById('fCat').textContent;
    assert.equal(cat, 'Unit 1 · 16 字符 · 词组 · 困难');
    assert.ok(!/living/i.test(cat));
    assert.ok(!/living/i.test(doc.getElementById('fZh').textContent));
    // 槽位必须照实画出字母（渲染层允许看见，唯一禁回显的是信息栏）
    const slots = doc.getElementById('fSlots').children.filter(c => c.className.split(' ').includes('slot'));
    assert.equal(slots.length, norm(B.word.w).length);
    assert.equal(slots[0].textContent, 'c');
    assert.equal(slots[8].textContent, '');
    return null;
  });
});

/* ============================================================
   map.js
   ============================================================ */
const MAP_IDS = ['map', 'mFloor', 'mGold', 'mHp', 'mHpS', 'mHpT', 'mRelics', 'mTip'];

function makeMapRun(rows) {
  return { hp: 30, shield: 20, maxhp: 60, gold: 120, floor: 3, maxFloor: 3,
    relics: ['shield', 'greed'], avail: rows[1].slice(0, 1), node: rows[1][1] || null, availSig: '', rows };
}
function threeRowMap() {
  const mk = (type, x, row, links) => ({ type, x, row, done: row === 0, links });
  const r0 = [mk('battle', 0.1667, 0, []), mk('battle', 0.5, 0, []), mk('rest', 0.8333, 0, [])];
  const r1 = [mk('battle', 0.25, 1, []), mk('elite', 0.75, 1, [])];
  const r2 = [mk('boss', 0.5, 2, [])];
  r0[0].links = [r1[0]]; r0[1].links = [r1[0], r1[1]]; r0[2].links = [r1[1]];
  r1[0].links = [r2[0]]; r1[1].links = [r2[0]];
  return [r0, r1, r2];
}

test('map.mapMetrics computes the legacy geometry for several container widths', async () => {
  const { createMapScreen } = await import('../../src/ui/screens/map.js');
  const { paintHpBar } = await import('../../src/ui/components/hp-bar.js');
  const rows = threeRowMap();
  const pick = m => ({ W: m.W, ROWS: m.ROWS, H: m.H, d: m.d, padBot: m.padBot, yOf: m.yOf });
  for (const w of [320, 390, 640, 1200]) {
    const run = makeMapRun(rows);
    const mine = withDom(MAP_IDS, doc => { doc.getElementById('map').clientWidth = w;
      return pick(createMapScreen({ getRun: () => run, onEnter: () => {}, onToast: () => {}, onNodeSound: () => {} }).mapMetrics()); });
    const doc2 = createDocument(MAP_IDS);
    doc2.getElementById('map').clientWidth = w;
    const old = legacyFn('mapMetrics', { $: $for(doc2), G: run, clamp,
      MAP_V_GAP: 12, MAP_D_BASE: 56, MAP_D_BOSS: 70, MAP_D_MIN: 34 })();
    assert.deepEqual(mine, pick(old), 'width=' + w);
  }
});

test('map.renderMap paints the same DOM as legacy and routes clicks to callbacks', async () => {
  const { createMapScreen } = await import('../../src/ui/screens/map.js');
  const { paintHpBar } = await import('../../src/ui/components/hp-bar.js');
  const enters = [], toasts = [], sounds = [];
  const rows = threeRowMap();
  const run = makeMapRun(rows);
  const mineDoc = withDom(MAP_IDS, doc => {
    doc.getElementById('map').clientWidth = 390;
    createMapScreen({ getRun: () => run, onEnter: n => enters.push(n),
      onToast: m => toasts.push(m), onNodeSound: () => sounds.push(1) }).renderMap();
    return doc;
  });
  const runOld = makeMapRun(threeRowMap());
  const docOld = createDocument(MAP_IDS);
  docOld.getElementById('map').clientWidth = 390;
  // 沙箱里的 mapMetrics 换成被测实现：比较的是整个地图页，而不是重复实现的几何。
  const helper = createMapScreen({ getRun: () => runOld, onEnter: () => {}, onToast: () => {}, onNodeSound: () => {} });
  withDocument(docOld, () => legacyFn('renderMap', { $: $for(docOld), document: docOld, G: runOld, NODES, clamp,
    MAP_D_BOSS: 70, mapMetrics: () => helper.mapMetrics(), paintHpBar, relicById,
    enterNode: () => {}, toast: () => {}, sfx: { node: () => {} } })());
  // 遗物格换成像素图标，先归一化再逐元素对照（见 stripArt）。
  // 未来路线的连线提亮（docs/feature-word-choice.md 第三节）是有意漂移：只归一化非活跃线的
  // 颜色 / 线宽 / 透明度三项，其余 DOM 仍要求逐字一致。
  const DIM_NEW = 'stroke="#c7d2fe" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="4 5" opacity="0.42"';
  const DIM_OLD = 'stroke="#ffffff22" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="4 5" opacity="0.34"';
  const mineSnap = snapDoc(mineDoc, MAP_IDS);
  assert.ok(mineSnap.includes(DIM_NEW), '非活跃路线必须使用提亮后的样式');
  assert.equal(stripArt(mineSnap.split(DIM_NEW).join(DIM_OLD)), stripArt(snapDoc(docOld, MAP_IDS)));
  assert.match(snap(mineDoc.getElementById('mRelics').children[0]),
    /<svg[^>]*class="pxicon"/, '地图遗物格应当画像素图标');
  assert.deepEqual(sounds, [1], 'node breath sound fires once per avail-set change');
  assert.deepEqual(run.availSig, runOld.availSig);

  const nodes = mineDoc.getElementById('map').children.filter(c => c.className.indexOf('node') === 0);
  assert.equal(nodes.length, 6);
  assert.equal(nodes[0].className, 'node done lock', '已完成且不可再点：node 存在时未点亮节点一律 lock');
  assert.equal(nodes[3].className, 'node pick', 'the single available node is pickable');
  assert.equal(nodes[4].className, 'node lock');
  nodes[3].onclick();
  assert.equal(enters.length, 1);
  assert.equal(enters[0], rows[1][0]);
  const relics = mineDoc.getElementById('mRelics').children;
  assert.equal(relics.length, 2);
  relics[0].onclick();
  assert.deepEqual(toasts, ['护盾符文：首次获得时增加 15 点护盾（先于生命消耗），之后不重复发放']);
});

test('map.renderMap stays silent when the available set did not change', async () => {
  const { createMapScreen } = await import('../../src/ui/screens/map.js');
  let sounds = 0;
  withDom(MAP_IDS, doc => {
    doc.getElementById('map').clientWidth = 390;
    const run = makeMapRun(threeRowMap());
    const s = createMapScreen({ getRun: () => run, onEnter: () => {}, onToast: () => {}, onNodeSound: () => { sounds++; } });
    s.renderMap();
    s.renderMap();
    assert.equal(run.availSig, '0.25,undefined', 'legacy signature quirk is preserved verbatim');
    return null;
  });
  assert.equal(sounds, 1);
});

/* ============================================================
   title.js
   ============================================================ */
const TITLE_IDS = ['heroes', 'heroDesc', 'units', 'sRun', 'sWin', 'sMaster', 'sFloor',
  'rewardSummary', 'rewardCards'];

test('title screen preserves legacy controls while separating matching expedition and formal progress', async () => {
  const { createTitleScreen } = await import('../../src/ui/screens/title.js');
  const { renderRewardCard } = await import('../../src/ui/components/reward-card.js');
  const DB = { hero: 'ranger', mastered: ['book', 'pen', 'inborn'], dictationMastered: ['book', 'pen', 'inborn'], runs: 7, wins: 2, best: 9, rewards: [REWARD] };
  const heroPicks = [], unitPicks = [];

  const mineDoc = withDom(TITLE_IDS, doc => {
    createTitleScreen({ getDB: () => DB, getUnit: () => 3, allWords,
      onHero: id => heroPicks.push(id), onUnit: n => unitPicks.push(n) }).renderTitle();
    return doc;
  });

  const docOld = createDocument(TITLE_IDS);
  const helper = createTitleScreen({ getDB: () => DB, getUnit: () => 3, allWords, onHero: () => {}, onUnit: () => {} });
  withDocument(docOld, () => legacyFn('renderTitle', { $: $for(docOld), document: docOld, UNITS, HEROES, DB, allWords,
    curUnit: 3, renderHeroes: () => helper.renderHeroes(), renderRewardCard })());
  // 有意漂移：data-unit 和两份学习进度。这里只归一化本例中两者相等的那一行；
  // 新文案另作精确断言，class、选择回调、收藏和其他文字仍对照真实归档。
  const progressToLegacy = html => html.replace(/<em>远征 (\d+)\/(\d+) · 默写 \1\/\2<\/em>/g,
    '<em>已掌握 $1/$2</em>');
  const unitSnap = doc => snapDoc(doc, TITLE_IDS.filter(id => id !== 'units'))
    + '\nunits-text:' + doc.getElementById('units').children.map(u => progressToLegacy(u._html)).join('|')
    + '\nunits-class:' + doc.getElementById('units').children.map(u => u.className).join('|');
  assert.equal(unitSnap(mineDoc), unitSnap(docOld));

  const heroes = mineDoc.getElementById('heroes').children;
  assert.equal(heroes.length, 6);
  assert.equal(heroes[5].className, 'hcard sel');
  assert.equal(heroes[5].attrs['aria-pressed'], 'true');
  assert.equal(heroes[0].attrs['aria-pressed'], 'false');
  assert.equal(mineDoc.getElementById('heroDesc')._html, '<b>游侠</b> · <i>一击脱离</i><br>未借助提示的新字母答对回 1 生命，每场最多 18；本词出错、主动提示或听音后停止回血。生命上限 -20。');

  const units = mineDoc.getElementById('units').children;
  assert.equal(units.length, 7);
  assert.equal(units[0].className, 'unit');
  assert.equal(units[2].className, 'unit sel');
  assert.equal(units[2]._html, '<b>Unit 3 成长与发现</b><span>29 词</span><em>远征 1/29 · 默写 1/29</em>');
  assert.equal(units[6]._html, '<b>我的词表</b><span>0 词（空）</span>');
  // 任务 7：每个单元按钮都带 data-unit（脚本按它定位，不按文本）
  assert.deepEqual(units.map(u => u.attrs['data-unit']), ['1', '2', '3', '4', '5', '6', '0']);

  withDocument(mineDoc, () => {
    heroes[0].onclick();
    units[4].onclick();
  });
  assert.deepEqual(heroPicks, ['scholar']);
  assert.deepEqual(unitPicks, [5]);

  assert.equal(mineDoc.getElementById('rewardCards').children.length, 1);
  assert.equal(mineDoc.getElementById('rewardSummary').textContent, '通关纪念卡 · 1 张（点击查看）');
});

test('title screen lists reward cards newest-first', async () => {
  const { createTitleScreen } = await import('../../src/ui/screens/title.js');
  const older = { ...REWARD, id: 'WR-old', earnedAt: '2026-09-01T09:00:00.000Z' };
  const newer = { ...REWARD, id: 'WR-new', earnedAt: '2026-10-30T09:00:00.000Z' };
  const DB = { hero: 'scholar', mastered: [], runs: 1, wins: 1, best: 9, rewards: [older, newer] };
  const doc = withDom(TITLE_IDS, d => {
    createTitleScreen({ getDB: () => DB, getUnit: () => 1, allWords, onHero: () => {}, onUnit: () => {} }).renderTitle();
    return d;
  });
  const cards = doc.getElementById('rewardCards').children;
  assert.equal(cards.length, 2);
  assert.equal(doc.getElementById('rewardSummary').textContent, '通关纪念卡 · 2 张（点击查看）');
  // 最新一张排在最上面（存档是追加序，展示要倒序）
  assert.match(text(cards[0]), /卡片 WR-new/);
  assert.match(text(cards[1]), /卡片 WR-old/);
  assert.equal(DB.rewards.length, 2, 'renderTitle 不许重排或改写存档数组');
});

test('title screen shows the empty reward note and keeps unknown heroes on the fallback', async () => {
  const { createTitleScreen } = await import('../../src/ui/screens/title.js');
  const DB = { hero: 'ghost-hero', mastered: [], runs: 0, wins: 0, best: 0, rewards: [] };
  const doc = withDom(TITLE_IDS, d => {
    createTitleScreen({ getDB: () => DB, getUnit: () => 1, allWords,
      onHero: () => {}, onUnit: () => {} }).renderTitle();
    return d;
  });
  const cards = doc.getElementById('rewardCards');
  assert.equal(cards.children.length, 1);
  assert.equal(cards.children[0].className, 'note');
  assert.equal(cards.children[0].textContent, '击败最终 BOSS 后，纪念卡会收藏在这里。');
  assert.equal(doc.getElementById('heroes').children[0].className, 'hcard sel');
});

/* ============================================================
   over.js
   ============================================================ */
const OVER_IDS = ['oReward', 'oAgain', 'oNext', 'oIcon', 'oTitle', 'oText', 'oFloor', 'oKill', 'oAcc', 'oRelics'];

test('over.renderOver draws the win screen with the current run reward', async () => {
  const { renderOver } = await import('../../src/ui/screens/over.js');
  const run = { unit: 6, maxhp: 75, hp: 75, maxFloor: 9, kills: 21, att: 40, attOk: 36,
    relics: ['shield', 'combo'], result: undefined,
    reward: { id: 'WR-z-9-1', unit: 6, heroId: 'scholar', accuracy: 90, kills: 21, floor: 9, earnedAt: '2026-10-01T10:00:00.000Z' } };
  const db = { best: 4, wins: 0, runs: 9, mastered: ['a'], rewards: [], custom: [] };
  const shown = [];
  const titled = [];
  const doc = withDom(OVER_IDS, d => {
    renderOver({ run, db, win: true, onTitle: () => titled.push(1), show: id => shown.push(id) });
    return d;
  });
  assert.deepEqual(shown, ['s-over']);
  assert.deepEqual(titled, [1], 'the parent repaints the title screen, renderOver only draws');

  // 关键对照：把 legacy.endRun 放进沙箱跑一遍（预置 G.reward 让它跳过建卡分支），
  // 逐个元素比对 —— 证明 renderOver 画出来的东西和旧版一模一样。
  const docOld = createDocument(OVER_IDS);
  const G_old = structuredClone(run), DB_old = structuredClone(db);
  withDocument(docOld, () => legacyFn('endRun', { $: $for(docOld), document: docOld, DB: DB_old, G: G_old,
    clamp, UNITS, rewardScope, renderRewardCard, relicById,
    show: () => {}, renderTitle: () => {}, saveDB: () => {} })(true));
  // 任务 8 的**有意漂移**：结算正文现在带轮次（docs/feature-rounds.md）。
  // 先摘掉这一段再逐元素比对，其余文案零漂移；轮次本身另外断言。
  const stripRound = s => s.replace(/（第 \d+ 轮）/g, '').replace(/（旧版记录 · 未记录轮次）/g, '');
  // 2026-10-02 的**有意漂移**：遗物格从 emoji 换成像素图标。
  // 那一格整段排除在对照之外（旧版是 "🛡️"，新版是一整段 SVG，没有可比性），
  // 图标本身在下面单独断言 —— 否则这条对照会因为美术换代而永远红。
  const stripRelicArt = s => s.replace(/oRelics→[^\n]*/, 'oRelics→<art>');
  // 用户移除了成功结算的重开按钮与复习提示；其余结算内容继续逐元素对照。
  const SAME_OVER_IDS = OVER_IDS.filter(id => id !== 'oAgain');
  const removeReviewCopy = value => value.replace('可复习本单元或返回选择单元。', '可以返回主页选择单元。');
  assert.equal(stripRelicArt(stripRound(snapDoc(doc, SAME_OVER_IDS))),
    removeReviewCopy(stripRelicArt(snapDoc(docOld, SAME_OVER_IDS))));
  // 遗物格确实换成了像素图标，而且每个都带着 hover 说明。
  const relicCells = doc.getElementById('oRelics').children;
  assert.equal(relicCells.length, 2);
  assert.match(snap(relicCells[0]), /<svg[^>]*class="pxicon"/, '遗物格应当画像素图标');
  assert.equal(relicCells[0].title, '护盾符文');
  assert.equal(relicCells[1].title, '连击徽章');
  assert.match(doc.getElementById('oText').textContent, /远征成功|词汇之王/);
  assert.match(doc.getElementById('oText').textContent, /旧版记录 · 未记录轮次/, '旧 run 没有轮次事实就说旧版记录');

  assert.equal(doc.getElementById('oIcon').textContent, '🏆');
  assert.equal(doc.getElementById('oTitle').textContent, '远征成功！');
  assert.equal(doc.getElementById('oFloor').textContent, '9');
  assert.equal(doc.getElementById('oKill').textContent, '21');
  assert.equal(doc.getElementById('oAcc').textContent, '90%');
  assert.equal(doc.getElementById('oAgain').textContent, '');
  assert.equal(doc.getElementById('oAgain').hidden, true);
  assert.equal(doc.getElementById('oAgain').onclick, null);
  assert.doesNotMatch(doc.getElementById('oText').textContent, /复习本单元/);
  // 任务 7 的**有意漂移**：旧版在胜利屏上无条件预告「继续 Unit N+1」，那正是
  // 「打完 BOSS 就算掌握了这个单元」的谎话。现在没有 campaign 视图就没有解锁依据，
  // 于是这里退回本单元的诚实入口（真实运行期 runtime 一定传 campaign）。
  // 没有 campaign 视图 → 没有解锁依据 → 退回旧行为：不预告下一个单元。
  assert.equal(doc.getElementById('oNext').hidden, true);
  assert.equal(doc.getElementById('oReward').hidden, false);
  assert.match(snap(doc.getElementById('oReward').children[0]), /词王征服者 · 通关纪念卡/);
  assert.match(text(doc.getElementById('oReward')), /Unit 6 外星来客 · 学者/);
  assert.match(doc.getElementById('oRelics').children[0].title, /护盾符文/);

  // 结算记录归父层：renderOver 不许写 DB，也不许写 run.result
  assert.deepEqual(db, { best: 4, wins: 0, runs: 9, mastered: ['a'], rewards: [], custom: [] });
  assert.equal(run.result, undefined);
});

test('over.renderOver draws the loss screen, hides the reward box and offers the next unit', async () => {
  const { renderOver } = await import('../../src/ui/screens/over.js');
  const run = { unit: 3, maxhp: 60, hp: 0, floor: 4, maxFloor: 4, kills: 5, att: 10, attOk: 4,
    relics: [], reward: null };
  const shown = [];
  const doc = withDom(OVER_IDS, d => {
    renderOver({ run, db: {}, win: false, onTitle: () => {}, show: id => shown.push(id) });
    return d;
  });
  assert.deepEqual(shown, ['s-over']);

  const docOld = createDocument(OVER_IDS);
  withDocument(docOld, () => legacyFn('endRun', { $: $for(docOld), document: docOld, DB: {}, G: structuredClone(run),
    clamp, UNITS, rewardScope, renderRewardCard, relicById,
    show: () => {}, renderTitle: () => {}, saveDB: () => {} })(false));
  // oNext 是任务 7 的有意漂移（战败一律无继续入口），逐元素比对时排除它。
  const LOSS_IDS = OVER_IDS.filter(id => id !== 'oNext');
  assert.equal(snapDoc(doc, LOSS_IDS), snapDoc(docOld, LOSS_IDS), 'loss screen matches legacy endRun');

  assert.equal(doc.getElementById('oIcon').textContent, '💀');
  assert.equal(doc.getElementById('oTitle').textContent, '远征结束');
  assert.equal(doc.getElementById('oText').textContent, '你倒在了第 4 层。那些还没记住的词，还在等着你。');
  assert.equal(doc.getElementById('oAcc').textContent, '40%');
  assert.equal(doc.getElementById('oAgain').textContent, '再来一次');
  assert.equal(doc.getElementById('oNext').hidden, true);
  assert.equal(doc.getElementById('oReward').hidden, true);
  assert.equal(doc.getElementById('oReward').children.length, 0);
  assert.equal(doc.getElementById('oRelics')._html, '<span style="font-size:12px;color:var(--dim)">这次没有获得遗物</span>');

  const mid = withDom(OVER_IDS, d => {
    const r2 = { unit: 3, maxhp: 60, hp: 0, floor: 9, maxFloor: 9, kills: 5, att: 10, attOk: 4, relics: [],
      reward: { id: 'W2', unit: 3, heroId: 'lucky', accuracy: 40, kills: 5, floor: 9, earnedAt: '2026-10-01T10:00:00.000Z' } };
    renderOver({ run: r2, db: {}, win: true, onTitle: () => {}, show: () => {} });
    return d;
  });
  // 同样没有 campaign 视图 → 同样不预告下一个单元（口径一致，不是巧合）。
  assert.equal(mid.getElementById('oNext').hidden, true);
});
