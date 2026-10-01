import { test } from 'node:test';
import assert from 'node:assert/strict';

test('standalone export embeds built assets without network dependencies', async () => {
  const { inlineBuiltPage } = await import('../../scripts/export-single-html.mjs');
  const html = '<html><head><script type="module" crossorigin src="/vocab-expedition-wy8/assets/game.js"></script><link rel="stylesheet" crossorigin href="/vocab-expedition-wy8/assets/game.css"></head><body></body></html>';
  const assets = new Map([['assets/game.js', 'const label="</script>";'], ['assets/game.css','body{color:red}']]);
  const output = inlineBuiltPage(html, path => assets.get(path));
  assert.ok(!output.includes('src="/vocab-expedition-wy8/assets/'));
  assert.ok(!output.includes('href="/vocab-expedition-wy8/assets/'));
  assert.ok(output.includes('<style>body{color:red}</style>'));
  assert.ok(output.includes('<script type="module">'));
  assert.ok(output.includes('const label="<\\/script>";'));
});

test('standalone export rejects unexpected external URLs or asset traversal', async () => {
  const { inlineBuiltPage } = await import('../../scripts/export-single-html.mjs');
  for (const path of ['https://evil.example/game.js','/vocab-expedition-wy8/assets/../../secret.js']) {
    assert.throws(() => inlineBuiltPage(`<script type="module" src="${path}"></script>`, () => ''), /asset/i);
  }
});
