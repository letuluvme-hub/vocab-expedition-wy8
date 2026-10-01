import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const baseline = readFileSync(new URL('../fixtures/legacy.html', import.meta.url), 'utf8');
const script = baseline.match(/<script>([\s\S]*?)<\/script>/)[1];
function oldValue(name) {
  const start = script.indexOf(`const ${name}=`);
  const end = script.indexOf('\n];', start) + 3;
  return JSON.parse(JSON.stringify(vm.runInNewContext(script.slice(start, end) + `;${name}`)));
}

test('extracted vocabulary preserves all 259 records and their order', async () => {
  const { WORDS } = await import('../../src/data/words.js');
  assert.deepEqual(WORDS, oldValue('WORDS'));
});

test('extracted game catalogs are byte-for-byte equivalent values', async () => {
  for (const [file, name] of [['heroes','HEROES'],['items','ITEMS'],['relics','RELICS'],['enemies','ENEMIES'],['units','UNITS']]) {
    const module = await import(`../../src/data/${file}.js`);
    assert.deepEqual(module[name], oldValue(name));
  }
});

test('CSS extraction preserves cascade order and every original rule', () => {
  const expected = baseline.match(/<style>([\s\S]*?)<\/style>/)[1];
  const entry = readFileSync(new URL('../../src/styles/game.css', import.meta.url), 'utf8');
  const imports = [...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(match=>match[1]);
  const actual = imports.length ? imports.map(path=>readFileSync(new URL(`../../src/styles/${path}`,import.meta.url),'utf8')).join('') : entry;
  assert.equal(actual, expected);
});

// 本任务唯一有意偏离归档骨架的地方：跳过按钮的小字。旧版写「不掉血」，
// 而实际代价是固定 50 点生命（低血时直接战败）—— 文案必须点明代价。
// 偏离面精确到这一段文本，其余骨架仍要求逐字相同。
const SKIP_COPY_DIFF = /(<button class="tool" id="tSkip">跳过<small>)[^<]*(<\/small><\/button>)/;

test('page skeleton preserves approved character parts and all existing controls', () => {
  const strip = html => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script(?: [^>]*)?>[\s\S]*?<\/script>/, '').replace(/<link rel="stylesheet" href="\/src\/styles\/game.css">/, '').replace(/\s+/g,' ').trim();
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.equal(strip(html.replace(SKIP_COPY_DIFF, '$1跳过代价$2')),
    strip(baseline.replace(SKIP_COPY_DIFF, '$1跳过代价$2')));
  // 骨架其他部分仍然逐字相同：把跳过按钮整段挖掉后必须完全对齐
  assert.equal(strip(html.replace(SKIP_COPY_DIFF, '')), strip(baseline.replace(SKIP_COPY_DIFF, '')));
  // 并且当前文案确实点明了 50 点生命
  assert.match(html, /id="tSkip">跳过<small>损失 50 生命<\/small>/);
  assert.match(html, /<script type="module" src="\/src\/main.js"><\/script>/);
});

test('monster artwork matches original trusted SVG and rejects injected names', async () => {
  const { foeArtHTML } = await import('../../src/ui/components/monster-art.js');
  const end = script.indexOf('// ============================================================');
  const original = vm.runInNewContext(script.slice(0,end) + ';foeArtHTML');
  for (const n of ['词灵','语素蛛','石化词素','歧义章鱼','拼写幽灵','单复数蝎','冰封词灵','词形旋风','词汇之王','<img src=x onerror=alert(1)>']) {
    for (const boss of [false,true]) for (const elite of [false,true]) assert.equal(foeArtHTML({n},boss,elite), original({n},boss,elite));
  }
});
