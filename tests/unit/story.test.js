/* 背景故事数据：每个角色都有档案、漫画里引用的角色和怪物都存在、台词里引用的课本词真的在词库里。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HEROES } from '../../src/data/heroes.js';
import { ENEMIES, BOSS } from '../../src/data/enemies.js';
import { WORDS } from '../../src/data/words.js';
import { WORDS_WY8B } from '../../src/data/words-wy8b.js';
import { COMICS, HERO_LORE, FOE_LORE, STORY_INTRO } from '../../src/data/story.js';

const SCENES = ['classroom', 'library', 'realm', 'throne', 'map', 'gate'];
const names = Object.values(HERO_LORE).map(l => l.name);

test('九位远征者都有完整档案，名字不重复', () => {
  assert.deepEqual(Object.keys(HERO_LORE).sort(), HEROES.map(h => h.id).sort());
  for (const [id, l] of Object.entries(HERO_LORE)) {
    for (const k of ['name', 'role', 'tagline', 'story', 'why', 'motto', 'meme']) assert.ok(l[k] && l[k].length, id + '.' + k);
  }
  assert.equal(new Set(names).size, names.length);
});

test('漫画格子里的场景、角色、怪物、说话人都对得上', () => {
  const foes = new Set(ENEMIES.map(e => e.n));
  const speakers = new Set([...names, '墨芽', 'narr', BOSS.n, ...ENEMIES.map(e => e.n)]);
  for (const strip of COMICS) {
    assert.ok(strip.panels.length >= 3 && strip.panels.length <= 6, strip.id);
    for (const p of strip.panels) {
      assert.ok(SCENES.includes(p.scene), p.scene);
      assert.ok(p.cast.length >= 1 && p.cast.length <= 3);
      for (const c of p.cast) {
        if (c.hero) assert.ok(HERO_LORE[c.hero], c.hero);
        if (c.foe) assert.ok(foes.has(c.foe), c.foe);
      }
      for (const l of p.lines) assert.ok(speakers.has(l.who), '未知说话人 ' + l.who);
    }
  }
});

test('每只怪物和首领都有图鉴', () => {
  for (const f of [...ENEMIES, BOSS]) assert.ok(FOE_LORE[f.n], f.n);
});

test('故事里点名的课本词真的在词库里，数量与词库一致', () => {
  const all = new Set([...WORDS, ...WORDS_WY8B].map(w => w.w));
  for (const w of ['unbelievable', 'disappointed', 'responsibility']) assert.ok(all.has(w), w);
  const text = [...STORY_INTRO, ...COMICS.flatMap(s => s.panels.flatMap(p => p.lines.map(l => l.text)))].join('');
  assert.ok(text.includes(String(WORDS.length)), '八上词数');
  assert.ok(text.includes(String(WORDS_WY8B.length)), '八下词数');
});
