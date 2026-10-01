import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('split styles retain every original rule and exact cascade order',async()=>{
  const entry=readFileSync(new URL('../../src/styles/game.css',import.meta.url),'utf8');
  const paths=[...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(m=>m[1]);
  assert.ok(paths.length>=5,'screen styles must have separate ownership boundaries');
  const combined=paths.map(p=>readFileSync(new URL(`../../src/styles/${p}`,import.meta.url),'utf8')).join('');
  const original=readFileSync(new URL('../fixtures/legacy.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.equal(combined,original);
});
