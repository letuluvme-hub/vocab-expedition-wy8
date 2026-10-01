import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('build entry preserves the legacy version marker for existing cached clients', () => {
  const html = readFileSync(new URL('../../dist/index.html', import.meta.url),'utf8');
  const expected = JSON.parse(readFileSync(new URL('../../public/version.json', import.meta.url),'utf8')).version;
  const match = /const\s+APP_VERSION\s*=\s*'([0-9][\w.\-]*)'/.exec(html);
  assert.equal(match?.[1], expected);
});

test('production build contains no browser test state mutation probe', () => {
  const html = readFileSync(new URL('../../dist/index.html', import.meta.url),'utf8');
  const path = html.match(/src="\/vocab-expedition-wy8\/([^"\s]+\.js)"/)[1];
  const bundle = readFileSync(new URL(`../../dist/${path}`, import.meta.url),'utf8');
  assert.ok(!bundle.includes('__gameTest'));
  assert.ok(!bundle.includes('__VOCAB_TEST__'));
});
