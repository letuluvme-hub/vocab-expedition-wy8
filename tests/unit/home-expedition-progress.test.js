import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';
import { unlockProgress } from '../../src/domain/campaign.js';
import { createTitleScreen } from '../../src/ui/screens/title.js';

class Element {
  constructor() { this.children = []; this.attrs = {}; this.dataset = {}; this._text = ''; this._html = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('')
    : this._text || this._html.replace(/<[^>]*>/g, ''); }
  set innerHTML(value) { this._html = String(value); this._text = ''; this.children = []; }
  get innerHTML() { return this._html; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
}
function render(extra = {}) {
  const db = { hero: 'scholar', runs: 0, wins: 0, mastered: [], dictationMastered: [],
    best: 0, rewards: [], custom: [], unitProgress: {}, ...extra };
  const before = structuredClone(db);
  const ids = ['heroes', 'heroDesc', 'units', 'sRun', 'sWin', 'sExpedition', 'sMaster',
    'sFloor', 'rewardSummary', 'rewardCards'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const wordsFor = unit => unit === 0 ? db.custom : WORDS.filter(word => word.u === unit);
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: id => elements.get(id) || null, createElement: () => new Element() };
  try {
    createTitleScreen({ getDB: () => db, getUnit: () => 1, allWords: wordsFor,
      getCampaign: () => unlockProgress({ units: [1, 2, 3, 4, 5, 6, 0], wordsFor,
        dictationMastered: db.dictationMastered, unitProgress: db.unitProgress }),
      onHero() {}, onUnit() {} }).renderTitle();
  } finally { globalThis.document = oldDocument; }
  assert.deepEqual(db, before, 'home rendering must not change any save field');
  return { stat: id => elements.get(id).textContent,
    unit: n => elements.get('units').children.find(child => child.attrs['data-unit'] === String(n)) };
}

test('home expedition count intersects all 259 textbook entries, deduplicates identities and stays read-only', () => {
  const first = WORDS[0].w, last = WORDS.at(-1).w;
  const saved = Object.freeze([first, ' ' + first.toUpperCase() + ' ', last, 'custom-only-token']);
  const view = render({ mastered: saved, futureField: { keep: true } });
  assert.equal(view.stat('sExpedition'), '2');
  // 2026-10 预习模式起「学会单词」统一口径：远征整词拼对也算学会。
  assert.equal(view.stat('sMaster'), '2', 'learned count uses the same textbook intersection');
});

test('home expedition intersection preserves phrase spaces and punctuation', () => {
  const phrase = WORDS.find(word => /[ -]/.test(word.w));
  assert.ok(phrase);
  const view = render({ mastered: [phrase.w.replace(/[^a-z]/gi, '')] });
  const genuinelyMatching = WORDS.some(word => word.w.trim().toLowerCase() === phrase.w.replace(/[^a-z]/gi, '').toLowerCase());
  assert.equal(view.stat('sExpedition'), genuinelyMatching ? '1' : '0');
});

test('partial learned progress replaces not-started while unit locks stay unchanged', () => {
  const one = WORDS.find(word => word.u === 1).w;
  const view = render({ mastered: [one, one.toUpperCase()] });
  assert.match(view.unit(1).textContent, /学会 1\/45/);
  assert.doesNotMatch(view.unit(1).textContent, /未开始|已掌握|已通关/);
  assert.equal(view.unit(2).disabled, true);
  assert.equal(view.unit(2).onclick, null);
});

test('unit cards count learned words across expedition and old dictation records once', () => {
  const first = WORDS.find(word => word.u === 1).w;
  const second = WORDS.find(word => word.u === 1 && word.w !== first).w;
  const view = render({ mastered: [first], dictationMastered: [first, second] });
  assert.match(view.unit(1).textContent, /学会 2\/45/);
  assert.equal(view.stat('sExpedition'), '1');
  assert.equal(view.stat('sMaster'), '2');
});

test('custom-only expedition records stay visible on their own card but never inflate the textbook stat', () => {
  const view = render({ custom: [{ w: 'outside-book-word', z: '自定义' }], mastered: ['outside-book-word'] });
  assert.equal(view.stat('sExpedition'), '0');
  assert.match(view.unit(0).textContent, /学会 1\/1/);
  assert.equal(view.unit(2).disabled, true);
});

test('missing or invalid old expedition lists show zero and retain untouched formal records', () => {
  for (const mastered of [undefined, null, {}, [null, 2, '', 'outside-book-word']]) {
    const view = render({ mastered, dictationMastered: [WORDS[0].w] });
    assert.equal(view.stat('sExpedition'), '0');
    assert.equal(view.stat('sMaster'), '1');
  }
});
