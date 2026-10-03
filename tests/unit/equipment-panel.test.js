/* 战斗页「装备与能力」折叠面板的单元回归。
 *
 * 契约（面板必须全部满足）：
 *  1) 纯只读展示：渲染前后 G / B 必须逐字节不变 —— 面板不许补提示次数、
 *     不许重新施加遗物护盾、不许改 usedThisFight。
 *  2) 角色被动读 **G.heroId**（本局选的英雄），不是 DB.hero（主页上次选的）。
 *  3) G.relics 全部列出，不许 slice(3) 截断；重复遗物合并成 ×N，
 *     但绝不凭空多出一个效果。
 *  4) 道具同时显示背包持有数与本场已用/上限；用满显示「已用满」。
 *  5) 影分身额度是 run 级：按 G.ghostUsed 显示本轮剩余次数，用掉显示耗尽。
 *  6) 战斗中显示真实 B.shield（本场可能已被打掉），不在战斗才显示 G.shield。
 *  7) 认不出的 id 渲染成安全的「未知装备」，且只经 textContent 落屏（不注入元素）。
 *  8) 重渲染更新内容但**不强制折叠**玩家刚展开的面板。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEquipmentPanel, equipmentModel } from '../../src/ui/components/equipment-panel.js';

test('hero panel reports saved starting attributes and live per-battle budgets', () => {
  const run = { heroId: 'ranger', maxhp: 62, hm: 0, hnoise: 0, hcombo: 1, hregen: 0, hleech: 1, relics: [], bag: {} };
  const before = structuredClone(run);
  const model = equipmentModel(run, { heroHealed: 12, usedThisFight: {}, shield: 0 });
  assert.match(model.heroLines.join(' · '), /生命上限 62/);
  assert.match(model.heroStatus, /12\/18/);
  assert.deepEqual(run, before);
});

/* ---------------- 轻量 DOM 桩（不需要 jsdom）---------------- */
class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.nextSibling = null;
    this.attrs = {};
    this.className = '';
    this.id = '';
    this.open = false;
    this.disabled = false;
    this._text = '';
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); c.parentElement = this; c.nextSibling = this.children[this.children.indexOf(c) + 1] || null; return c; }
  insertBefore(node, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) return this.appendChild(node);
    this.children.splice(i, 0, node);
    node.parentElement = this;
    this.children.forEach((c, k) => { c.nextSibling = this.children[k + 1] || null; });
    return node;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
}

function createDocument(ids) {
  const reg = new Map();
  for (const id of ids) reg.set(id, new StubEl('div'));
  if (reg.has('fItems')) reg.get('fItems').id = 'fItems';
  return {
    getElementById: id => (reg.has(id) ? reg.get(id) : null),
    createElement: tag => new StubEl(tag),
    _reg: reg,
  };
}

function withDocument(doc, fn) {
  const prev = globalThis.document;
  globalThis.document = doc;
  try { return fn(doc); } finally { globalThis.document = prev; }
}

const mount = doc => withDocument(doc, () => doc.getElementById('fItems').parentElement);

/* 打开战斗页：模拟 index.html 里 #fItems 是 .fmid(#s-fight) 的一个真实子节点 */
function openFight(doc) { doc.getElementById('s-fight').appendChild(doc.getElementById('fItems')); return doc; }

function baseRun(over = {}) {
  return Object.assign({
    heroId: 'scholar', maxhp: 90, shield: 0, gold: 30,
    relics: [], bag: {}, ghostUsed: false,
  }, over);
}
function baseBattle(over = {}) {
  return Object.assign({ shield: 0, hints: 3, usedThisFight: {}, over: false }, over);
}

function panel() {
  return createEquipmentPanel({
    getRun: () => panel._G,
    getBattle: () => panel._B,
    getDB: () => panel._DB || { hero: 'lucky' },
  });
}

/* ---------------- 1) 纯模型层：不碰 DOM 就能验证的规则 ---------------- */

test('model lists every owned relic — never truncated to the first three', () => {
  const m = equipmentModel(baseRun({ relics: ['hint', 'shield', 'combo', 'purse', 'thorn', 'battery'] }));
  assert.equal(m.relics.length, 6, '六件遗物必须全部出现，slice(3) 那种截断是回归');
  assert.deepEqual(m.relics.map(r => r.id), ['hint', 'shield', 'combo', 'purse', 'thorn', 'battery']);
  assert.equal(m.relics[0].n, '提示水晶');
});

test('duplicate relics collapse to ×N without inventing a second effect', () => {
  const m = equipmentModel(baseRun({ relics: ['shield', 'shield', 'shield'] }));
  assert.equal(m.relics.length, 1, '重复遗物必须合并成一行');
  assert.equal(m.relics[0].count, 3);
  assert.equal(m.relics[0].d, '首次获得时增加 15 点护盾（先于生命消耗），之后不重复发放', '合并只改计数，不改效果文案');
  assert.equal((m.relics[0].d.match(/护盾/g) || []).length, 1, '效果只能出现一次');
});

test('unknown relic id degrades to a safe unknown entry', () => {
  const m = equipmentModel(baseRun({ relics: ['__nope__'] }));
  assert.equal(m.relics[0].unknown, true);
  assert.match(m.relics[0].n, /^未知装备/);
  assert.ok(m.relics[0].n.includes('__nope__'), '原始 id 要留在文案里，玩家才认得出是存档里的哪一条');
  assert.match(m.relics[0].d, /无法识别|未知/);
});

test('model exposes hero passive from G.heroId, not DB.hero', () => {
  const G = baseRun({ heroId: 'ranger' });
  const H = equipmentModel(G).hero;
  assert.equal(H.id, 'ranger', '本局英雄必须来自 G.heroId');
  assert.equal(H.n, '游侠');
});

test('model reports bag quantity plus this-fight usage cap', () => {
  const G = baseRun({ bag: { leech: 4, stone: 1 } });
  const B = baseBattle({ usedThisFight: { leech: 6 } });
  const m = equipmentModel(G, B);
  const leech = m.items.find(i => i.id === 'leech');
  assert.equal(leech.owned, 4);
  assert.equal(leech.usedThisFight, 6);
  assert.equal(leech.max, 3);
  assert.equal(leech.spent, true, '旧档已用 6 次也超过新版 3 次上限');
  assert.equal(m.items.find(i => i.id === 'stone').spent, false);
});

test('ghost quota is run-level: one left, or exhausted after G.ghostUsed', () => {
  assert.deepEqual(equipmentModel(baseRun({ relics: ['ghost'] })).ghost, { owned: true, left: 1 });
  const spent = equipmentModel(baseRun({ relics: ['ghost'], ghostUsed: true })).ghost;
  assert.deepEqual(spent, { owned: true, left: 0 });
  assert.deepEqual(equipmentModel(baseRun()).ghost, { owned: false, left: 0 });
});

test('shield shows the real in-fight B.shield, and G.shield outside battle', () => {
  const G = baseRun({ shield: 15 });
  assert.deepEqual(equipmentModel(G, baseBattle({ shield: 4 })).shield, { value: 4, inFight: true },
    '战斗中必须读 B.shield —— 本场已经掉到 4 就不能还显示开局的 15');
  assert.deepEqual(equipmentModel(G, null).shield, { value: 15, inFight: false });
});

test('model count is the number of owned entries shown in the title', () => {
  const m = equipmentModel(baseRun({ relics: ['hint', 'hint'], bag: { rage: 2 } }));
  assert.equal(m.count, 1 /*英雄*/ + 1 /*去重后的遗物*/ + 1 /*道具*/);
});

/* ---------------- 2) 渲染层：DOM 形状与只读性 ---------------- */

test('render mounts <details id=fEquipment> right after #fItems', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  panel._G = baseRun({ relics: ['hint'] });
  panel._B = baseBattle();
  withDocument(doc, () => {
    const el = panel().renderEquipmentPanel();
    assert.equal(el.tagName, 'DETAILS');
    assert.equal(el.id, 'fEquipment');
    assert.equal(el.parentElement, doc.getElementById('s-fight'));
    // 位置：紧跟在道具栏之后，不能插到词卡或字母盘中间
    const kids = doc.getElementById('s-fight').children;
    assert.equal(kids[kids.indexOf(doc.getElementById('fItems')) + 1], el);
  });
});

test('summary is the compact title 装备与能力 · N', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  panel._G = baseRun({ relics: ['hint', 'combo'], bag: { rage: 3 } });
  panel._B = baseBattle();
  withDocument(doc, () => {
    const el = panel().renderEquipmentPanel();
    assert.equal(el.children[0].tagName, 'SUMMARY');
    assert.equal(el.children[0].textContent, '装备与能力 · 4');   // 英雄+2遗物+1道具
  });
});

test('every owned effect lands as visible text, never hover-only tooltip', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  panel._G = baseRun({ heroId: 'scout', relics: ['purse', 'ghost'], bag: { purge: 2 } });
  panel._B = baseBattle({ usedThisFight: { purge: 3 } });
  withDocument(doc, () => {
    const el = panel().renderEquipmentPanel();
    const txt = el.textContent;
    for (const want of ['探险家', '聚宝盆', '每场战斗胜利额外获得 25 金币', '影分身',
      '扫除术', '清除所有已标记的错误字母', '本场已用 3/3', '已用满', '本轮剩余 1 次']) {
      assert.ok(txt.includes(want), '效果文案必须直接可见（tap 能看），缺: ' + want);
    }
    // 不许把关键信息只塞进 title —— 手机上没有 hover
    const titles = [];
    (function walk(n) { if (n.attrs.title) titles.push(n.attrs.title); (n.children || []).forEach(walk); })(el);
    assert.equal(titles.length, 0, '面板不许依赖 hover tooltip：' + titles.join(' | '));
  });
});

test('hostile relic id is rendered as text, never as markup', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  panel._G = baseRun({ relics: ['<img src=x onerror="window.__pwned=1">'] });
  panel._B = baseBattle();
  withDocument(doc, () => {
    const el = panel().renderEquipmentPanel();
    assert.ok(el.textContent.includes('未知装备'));
    // 只经 textContent：没有任何 IMG 元素被创建
    const tags = [];
    (function walk(n) { tags.push(n.tagName); (n.children || []).forEach(walk); })(el);
    assert.ok(!tags.includes('IMG'), '恶意 id 绝不能变成真实元素');
    assert.ok(el.textContent.includes('<img'), '但原始 id 仍应作为纯文本可见，便于玩家识别存档问题');
  });
});

test('re-render updates content but never force-collapses what the player just opened', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  panel._G = baseRun({ relics: ['hint'] });
  panel._B = baseBattle();
  withDocument(doc, () => {
    const p = panel();
    const el = p.renderEquipmentPanel();
    el.open = true;                                   // 玩家展开了
    panel._G = baseRun({ relics: ['hint', 'combo', 'purse'] });
    const el2 = p.renderEquipmentPanel();
    assert.equal(el2, el, '必须是同一个元素复用，不是重建');
    assert.equal(el2.open, true, '重渲染（战斗每敲一个字母都会跑）不许把面板收起来');
    assert.equal(el2.children[0].textContent, '装备与能力 · 4', '但内容必须跟着状态更新');
  });
});

test('panel render mutates neither G nor B', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  const G = baseRun({ relics: ['hint', 'shield', 'ghost'], bag: { leech: 2 }, shield: 15 });
  const B = baseBattle({ shield: 6, hints: 3, usedThisFight: { leech: 1 } });
  const before = JSON.stringify({ G, B });
  panel._G = G; panel._B = B;
  withDocument(doc, () => {
    panel().renderEquipmentPanel();
    panel().renderEquipmentPanel();
  });
  assert.equal(JSON.stringify({ G, B }), before,
    '面板只读：补提示/重加护盾/改 usedThisFight 都是被禁止的副作用');
});

test('exhausted ghost is labelled as such, and shows no free quota', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  panel._G = baseRun({ relics: ['ghost'], ghostUsed: true });
  panel._B = baseBattle();
  withDocument(doc, () => {
    const txt = panel().renderEquipmentPanel().textContent;
    assert.ok(txt.includes('影分身额度本轮已耗尽（跳过需付代价）'), txt);
    assert.ok(!txt.includes('本轮剩余'), txt);
  });
});

test('panel renders with an empty run instead of throwing', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  panel._G = baseRun();
  panel._B = baseBattle();
  withDocument(doc, () => {
    const el = panel().renderEquipmentPanel();
    assert.equal(el.children[0].textContent, '装备与能力 · 1');   // 只有英雄
    assert.ok(el.textContent.includes('尚无遗物'));
    assert.ok(el.textContent.includes('背包是空的'));
  });
});

test('panel silently skips itself when #fItems is not on the page', () => {
  const doc = createDocument([]);
  panel._G = baseRun({ relics: ['hint'] });
  panel._B = baseBattle();
  withDocument(doc, () => {
    assert.equal(panel().renderEquipmentPanel(), null);
  });
});
