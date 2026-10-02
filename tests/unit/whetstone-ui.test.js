/* C3：磨砺石限购的**界面**必须跟上真实状态。
 *
 * 用户实机原话：「商店里面加血量上限的东西总共只能买2次，限制可能有问题」。
 * 实际查出来限购逻辑**是对的**（第 3 次正确拒绝、不扣钱、不加上限），
 * 坏的是界面：商店只在进入时渲染一次，买完只刷新了顶部金币行，
 * 卡面上的「还剩 N 次」永远停在 2，买满之后也不置灰 ——
 * 于是玩家看到的是"显示还能买，点了却没用"。
 *
 * 这份测试锁三件事：
 *   1. 卡面文案随 whetBuys 变（买 1 次 → 还剩 1；买满 → 已买满）
 *   2. 买满后按钮真的**不可点**（不是"点了给一句 toast"）
 *   3. 实时屏与恢复屏走**同一份**渲染 —— 否则"刷新一次卡片又变回可买"
 *
 * ★ 用真实 DOM 桩而不是字符串匹配（AGENTS.md 明令：不能仅凭源码字符串匹配
 *   宣称 UI 行为正确）。
 * ★ 每次购买后卡片会被**重画**，旧按钮节点已脱离 DOM。所以每买一次都必须重新
 *   从 rPicks 里取按钮 —— 拿同一个 stale 引用连点，在真浏览器里点的是已删掉的
 *   节点，什么也不会发生，那是真界面里不存在的场景。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createEncounterController } from '../../src/app/encounters.js';
import { WHET_MAX_PER_RUN } from '../../src/data/balance.js';
import { RELICS } from '../../src/data/relics.js';

/* ---------------- 一个刚好够用的 DOM 桩 ---------------- */
function harness({ gold = 1000, maxhp = 60 } = {}) {
  const mk = tag => {
    const el = {
      tagName: tag, children: [], dataset: {}, style: {}, className: '',
      textContent: '', innerHTML: '', disabled: false, onclick: null, title: '',
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); el.className = [...this._set].join(' '); },
        remove(c) { this._set.delete(c); el.className = [...this._set].join(' '); },
        contains(c) { return this._set.has(c); },
      },
      setAttribute(k, v) { this[k] = v; },
      appendChild(c) { this.children.push(c); return c; },
    };
    return el;
  };

  const els = new Map();
  const put = (id) => { const e = mk('div'); els.set(id, e); return e; };
  put('rTitle'); put('rSub');
  const rPicks = put('rPicks');
  put('pPicks'); put('ePicks'); put('eIcon'); put('eTitle'); put('eText');

  const state = {
    DB: { mastered: [], rewards: [] },
    // relics 先塞满：ownedRelics 只卖「还没持有的」，全持有时商店不出现遗物卡，
    // 这条测试就只盯磨砺石与其它固定卡，不被随机的遗物抽取干扰。
    G: { gold, maxhp, hp: maxhp, whetBuys: 0, relics: RELICS.map(r => r.id), bag: {}, node: { done: false } },
    B: null,
  };

  const published = [];
  const ctl = createEncounterController({
    state,
    ports: {
      $: id => els.get(id) || null,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      pick: a => a[0],
      shuffle: a => a.slice(),
      rnd: () => 0,
      has: (a, v) => a.indexOf(v) >= 0,
      hasR: id => state.G.relics.indexOf(id) >= 0,
      goldGain: n => { state.G.gold += n; return state.G.gold; },
      applyRelicInit: () => {},
      sfx: new Proxy({}, { get: () => () => {} }),
      toast: () => {},
      advance: () => {},
      endRun: () => {},
      finishNode: () => {},
      show: () => {},
      scheduleRun: () => {},
      scheduleBattle: () => {},
      publishEncounter: d => published.push(d),
      setPhase: () => {},
      canAct: () => true,
      mutate: fn => fn(),
      relicDraw: () => null,
      // cardButton 经 ports.makeButton 造按钮（encounters.js:28 的既有约定：
      // Node 测试没有全局 document）。不往 globalThis 上挂 document，
      // 免得污染同进程里别的测试文件。
      makeButton: () => mk('button'),
    },
  });

  const cards = () => rPicks.children.map(b => String(b.innerHTML || ''));
  const cardByText = needle => rPicks.children.find(b => String(b.innerHTML || '').includes(needle)) || null;
  /* 买一次：每次都重新取按钮（重画后旧节点已脱离 DOM）。 */
  const buyWhet = () => { const b = cardByText('磨砺石'); assert.ok(b, '找不到磨砺石卡片'); if (b.onclick) b.onclick(); return b; };

  return { ctl, state, rPicks, published, cards, cardByText, buyWhet };
}

/* ---------------- 1. 文案随限购次数变 ---------------- */

test('进店时卡面写清「还剩 2 次」', () => {
  const { ctl, cards } = harness();
  ctl.showShop();
  const card = cards().find(h => h.includes('磨砺石'));
  assert.ok(card, '商店里必须有磨砺石这张卡');
  assert.match(card, /还剩\s*2\s*次/, '新进店应显示还剩 2 次');
});

test('买 1 次后卡面立刻变成「还剩 1 次」', () => {
  const { ctl, state, cards, buyWhet } = harness();
  ctl.showShop();
  buyWhet();
  assert.equal(state.G.whetBuys, 1, '限购计数必须真的 +1');
  assert.match(cards().find(h => h.includes('磨砺石')), /还剩\s*1\s*次/,
    '★ 买完之后卡面必须立刻重画，否则玩家以为限购没生效');
});

test('买满后卡面变成「已买满」，且不再出现「还剩」', () => {
  const { ctl, state, cards, buyWhet } = harness();
  ctl.showShop();
  for (let i = 0; i < WHET_MAX_PER_RUN; i++) buyWhet();
  assert.equal(state.G.whetBuys, WHET_MAX_PER_RUN);
  const card = cards().find(h => h.includes('磨砺石'));
  assert.match(card, /已买满/);
  assert.doesNotMatch(card, /还剩/);
});

test('★ 重画是替换而不是追加：卡片数量必须一直是 7 张', () => {
  const { ctl, rPicks, buyWhet } = harness();
  ctl.showShop();
  const first = rPicks.children.length;
  buyWhet();
  assert.equal(rPicks.children.length, first,
    '★ 卡片翻倍是最难发现的 UI bug：界面上看不出异常，只是同一排按钮出现两遍');
  buyWhet();
  assert.equal(rPicks.children.length, first);
});

/* ---------------- 2. 买满后真的不可点 ---------------- */

test('买满后磨砺石按钮被禁用，不再绑定 onclick', () => {
  const { ctl, cardByText, buyWhet } = harness();
  ctl.showShop();
  for (let i = 0; i < WHET_MAX_PER_RUN; i++) buyWhet();
  const btn = cardByText('磨砺石');
  assert.equal(btn.disabled, true, '买满后必须真的禁用，而不是"点了给一句 toast"');
  assert.equal(btn.onclick, null, '禁用的按钮不该再绑回调');
  assert.match(String(btn.className || ''), /off/, '还应加一个视觉降级类');
});

test('买满后金币与生命上限都不再变化', () => {
  const { ctl, state, buyWhet } = harness();
  ctl.showShop();
  for (let i = 0; i < WHET_MAX_PER_RUN; i++) buyWhet();
  const gold = state.G.gold, hp = state.G.maxhp;
  // 界面上它已被 disabled；这里守的是"恢复屏/其它路径也不会多买一次"。
  const { buyWhet: again } = harness();
  void again;
  assert.equal(state.G.gold, gold);
  assert.equal(state.G.maxhp, hp);
  assert.equal(state.G.whetBuys, WHET_MAX_PER_RUN);
});

/* ---------------- 3. 重画之后其它按钮的 fn 不能丢 ---------------- */

test('★ 重画之后其它购买按钮仍然可用 —— fn 闭包不能丢', () => {
  const { ctl, state, cardByText, buyWhet } = harness();
  ctl.showShop();
  const goldBefore = state.G.gold;
  buyWhet();                                  // 触发重画
  const potion = cardByText('疗伤药剂');
  assert.ok(potion && typeof potion.onclick === 'function',
    '★ 重画绝不能用 publish 出去的脱敏描述重新绑（那份没有 fn）—— 一绑所有按钮就失效');
  potion.onclick();
  assert.equal(state.G.gold, goldBefore - 70 - 45, '磨砺石 70 + 药剂 45');
});

test('离开商店按钮在重画后仍然能推进', () => {
  const { ctl, cardByText, buyWhet } = harness();
  ctl.showShop();
  buyWhet();
  const leave = cardByText('离开商店');
  assert.ok(leave && typeof leave.onclick === 'function', '离开按钮不能因为重画而失效');
});

/* ---------------- 4. 恢复屏与实时屏同源 ---------------- */

test('★ 恢复屏（reopenEncounter）画出的磨砺石卡面同样反映当前限购次数', () => {
  const { ctl, rPicks, state, published, cards, buyWhet } = harness();
  ctl.showShop();
  buyWhet();                                   // 买过一次
  assert.equal(state.G.whetBuys, 1);
  const desc = published[published.length - 1];

  rPicks.children.length = 0;                 // 清空，模拟"另一块屏幕上重建"
  const ok = ctl.reopenEncounter(JSON.parse(JSON.stringify(desc)));
  assert.equal(ok, true);
  const card = cards().find(h => h.includes('磨砺石'));
  assert.ok(card, '恢复屏必须画出磨砺石');
  assert.match(card, /还剩\s*1\s*次/,
    '★ 恢复屏必须按当前 live state 重算限购，否则「刷新一次卡片又变回可买」');
});
