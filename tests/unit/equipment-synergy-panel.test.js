/* 装备面板上的**稀有度与组合技**可见性。
 *
 * 组合技如果只活在代码里，玩家永远不知道自己凑出了什么 —— 面板是这套系统
 * 唯一的常驻展示位。这里守三条：
 *  1) 每件遗物标出稀有度（认不出的 id 不许伪造一个档位出来）；
 *  2) 凑齐的组合技单独成行，写明是哪两件凑成的；
 *  3) 面板依然纯只读 —— 计算组合技不许顺手加护盾、补提示。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEquipmentPanel, equipmentModel } from '../../src/ui/components/equipment-panel.js';
import { RELICS } from '../../src/data/relics.js';
import { RELIC_RARITY, RELIC_RARITY_ORDER } from '../../src/data/balance.js';
import { SYNERGIES } from '../../src/domain/relic-rules.js';

class StubEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.parentElement = null; this.nextSibling = null;
    this.attrs = {}; this.className = ''; this.id = ''; this.open = false;
    this._text = '';
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); c.parentElement = this; this._children_sync(); return c; }
  _children_sync() { this.children.forEach((c, k) => { c.nextSibling = this.children[k + 1] || null; }); }
  insertBefore(node, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) return this.appendChild(node);
    this.children.splice(i, 0, node); node.parentElement = this; this._children_sync();
    return node;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
}
function createDocument(ids) {
  const reg = new Map();
  for (const id of ids) reg.set(id, new StubEl('div'));
  reg.get('fItems').id = 'fItems';
  return { getElementById: id => (reg.has(id) ? reg.get(id) : null), createElement: t => new StubEl(t) };
}
function withDocument(doc, fn) {
  const prev = globalThis.document;
  globalThis.document = doc;
  try { return fn(doc); } finally { globalThis.document = prev; }
}
const openFight = doc => { doc.getElementById('s-fight').appendChild(doc.getElementById('fItems')); return doc; };
const baseRun = (over = {}) => Object.assign(
  { heroId: 'scholar', maxhp: 90, shield: 0, gold: 30, relics: [], bag: {}, ghostUsed: false }, over);

let panel;
function panelFor(G, B) {
  panel = createEquipmentPanel({ getRun: () => G, getBattle: () => B || null });
  return panel;
}

/* ---------------- 模型层 ---------------- */

test('每件已知遗物都带上自己的稀有度标签', () => {
  const m = equipmentModel(baseRun({ relics: RELICS.map(r => r.id) }));
  assert.equal(m.relics.length, RELICS.length);
  for (const row of m.relics) {
    const def = RELICS.filter(r => r.id === row.id)[0];
    assert.equal(row.rarity, def.rarity, row.id + ' 的稀有度必须跟着数据表');
    assert.equal(row.rarityLabel, RELIC_RARITY[def.rarity].label);
    assert.ok(RELIC_RARITY_ORDER.includes(row.rarity));
  }
});

test('认不出的遗物 id 不许被编造出稀有度', () => {
  const m = equipmentModel(baseRun({ relics: ['__nope__'] }));
  assert.equal(m.relics[0].unknown, true);
  assert.ok(!m.relics[0].rarity, '未知装备没有档位可言');
  assert.ok(!m.relics[0].rarityLabel);
});

test('凑齐的组合技出现在模型里，并写明成员', () => {
  const pair = SYNERGIES[0].need;
  const m = equipmentModel(baseRun({ relics: pair }));
  assert.equal(m.synergies.length, 1);
  assert.equal(m.synergies[0].id, SYNERGIES[0].id);
  assert.deepEqual(m.synergies[0].members.map(x => x.id).sort(), pair.slice().sort());
  for (const mem of m.synergies[0].members) assert.ok(mem.n && mem.ic, '成员必须有名字和图标');
});

test('没凑齐就没有组合技，空档案也不报错', () => {
  assert.deepEqual(equipmentModel(baseRun()).synergies, []);
  assert.deepEqual(equipmentModel(baseRun({ relics: [SYNERGIES[0].need[0]] })).synergies, []);
});

/* ---------------- 渲染层 ---------------- */

test('稀有度写在遗物行上，玩家一眼能分出普通 / 稀有 / 传说', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  const G = baseRun({ relics: RELICS.filter(r => r.rarity !== 'common').map(r => r.id) });
  withDocument(doc, () => {
    const txt = panelFor(G).renderEquipmentPanel().textContent;
    for (const key of ['rare', 'legendary']) {
      assert.ok(txt.includes(RELIC_RARITY[key].label), '面板必须出现「' + RELIC_RARITY[key].label + '」');
    }
  });
});

test('组合技在面板上单独成行，效果文案直接可见（不靠 hover）', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  const G = baseRun({ relics: SYNERGIES[0].need });
  withDocument(doc, () => {
    const el = panelFor(G).renderEquipmentPanel();
    const txt = el.textContent;
    assert.ok(txt.includes(SYNERGIES[0].n), '组合技名字必须可见：' + txt);
    assert.ok(txt.includes(SYNERGIES[0].d), '组合技效果必须直接可见：' + txt);
    const titles = [];
    (function walk(n) { if (n.attrs.title) titles.push(n.attrs.title); (n.children || []).forEach(walk); })(el);
    assert.equal(titles.length, 0, '组合技不许只挂在 title 上（手机没有 hover）');
  });
});

test('没凑齐组合技时不显示任何组合技行', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  const G = baseRun({ relics: [SYNERGIES[0].need[0]] });
  withDocument(doc, () => {
    assert.ok(!panelFor(G).renderEquipmentPanel().textContent.includes(SYNERGIES[0].n));
  });
});

test('计算组合技是纯只读的：面板渲染前后 G 一字不差', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  const G = baseRun({ relics: ['shield', 'thorn', 'combo', 'focus'], shield: 0 });
  const before = JSON.stringify(G);
  withDocument(doc, () => {
    const p = panelFor(G);
    p.renderEquipmentPanel();
    p.renderEquipmentPanel();
  });
  assert.equal(JSON.stringify(G), before, '算组合技不许顺手发护盾 / 补生命');
});

test('面板渲染对空档案、坏数据、恶意 id 都不抛异常', () => {
  const doc = openFight(createDocument(['fItems', 's-fight']));
  for (const relics of [[], ['__nope__'], ['<img src=x onerror=1>'], ['shield', 'shield', 'thorn']]) {
    withDocument(doc, () => {
      const el = panelFor(baseRun({ relics })).renderEquipmentPanel();
      assert.ok(el, '任何输入都必须渲染出面板');
      const tags = [];
      (function walk(n) { tags.push(n.tagName); (n.children || []).forEach(walk); })(el);
      assert.ok(!tags.includes('IMG'), '恶意 id 绝不能变成真实元素');
    });
  }
});