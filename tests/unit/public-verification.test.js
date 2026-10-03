import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyPublishedFiles } from '../../scripts/verify-public-checks.mjs';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vocab-public-'));
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  const files = new Map([
    ['version.json', Buffer.from('{"version":"release-test"}\n')],
    ['index.html', Buffer.from('<script src="assets/game.js"></script>')],
    ['assets/game.js', Buffer.from('console.log("release");')],
    ['game.apk', Buffer.from([0x50,0x4b,0,0xff])],
  ]);
  mkdirSync(path.join(directory, 'assets'));
  for (const [name, bytes] of files) writeFileSync(path.join(directory,name), bytes);
  const requested=[];
  const request={get:async url=>{
    const parsed=new URL(url);
    assert.equal(parsed.origin, 'https://letuluvme-hub.github.io');
    assert.match(parsed.pathname, /^\/vocab-expedition-wy8\//);
    assert.ok(parsed.searchParams.has('verify'));
    const name=parsed.pathname.slice('/vocab-expedition-wy8/'.length);requested.push(name);
    const bytes=files.get(name);
    return {ok:()=>bytes!==undefined,status:()=>bytes===undefined?404:200,body:async()=>bytes};
  }};
  return {directory,files,request,requested,url:'https://letuluvme-hub.github.io/vocab-expedition-wy8/',expectedVersion:'release-test'};
}

test('public verification checks every built file including binary download by bytes and SHA-256', async t=>{
  const f=fixture(t), result=await verifyPublishedFiles(f);
  assert.equal(result.version,'release-test');assert.equal(result.files.length,4);
  assert.deepEqual([...f.requested].sort(),[...f.files.keys()].sort());
  for(const row of result.files){const bytes=f.files.get(row.path);assert.equal(row.bytes,bytes.length);assert.equal(row.sha256,createHash('sha256').update(bytes).digest('hex'));}
});

test('a same-length changed public asset fails verification', async t=>{
  const f=fixture(t);f.files.set('assets/game.js',Buffer.from('console.log("RELEASE");'));
  await assert.rejects(verifyPublishedFiles(f),/assets\/game\.js.*differs/);
});

test('a missing public download fails verification instead of declaring publication', async t=>{
  const f=fixture(t);f.files.delete('game.apk');
  await assert.rejects(verifyPublishedFiles(f),/game\.apk.*404/);
});

test('verification refuses a dist built for another release version', async t=>{
  const f=fixture(t);f.expectedVersion='another-release';
  await assert.rejects(verifyPublishedFiles(f),/version.*release-test.*another-release/);
  assert.equal(f.requested.length,0);
});
