import { test } from 'node:test';
import assert from 'node:assert/strict';

test('version check reads a small sibling manifest and announces only a changed version', async () => {
  const { checkVersion } = await import('../../src/services/version.js');
  let request;
  const announced=[];
  const result = await checkVersion({current:'2026.10.01-e',pageUrl:'https://example.com/vocab-expedition-wy8/?v=old#map',now:()=>123,fetcher:async (...args)=>{request=args;return {ok:true,json:async()=>({version:'2026.10.02-a'})}},announce:version=>{announced.push(version);return true}});
  assert.equal(result,true);
  assert.equal(request[0],'https://example.com/vocab-expedition-wy8/version.json?_v=123');
  assert.deepEqual(request[1],{cache:'no-store',credentials:'same-origin'});
  assert.deepEqual(announced,['2026.10.02-a']);
});

test('version checks never block gameplay on missing APIs, offline, malformed JSON, same version or file URLs', async () => {
  const { checkVersion } = await import('../../src/services/version.js');
  const base={current:'2026.10.01-e',pageUrl:'https://example.com/game/index.html',announce:()=>{throw new Error('must not announce')}};
  for (const fetcher of [undefined,async()=>{throw new Error('offline')},async()=>({ok:false}),async()=>({ok:true,json:async()=>({version:'2026.10.01-e'})}),async()=>({ok:true,json:async()=>({version:'<script>'})})]) {
    assert.equal(await checkVersion({...base,fetcher}),false);
  }
  assert.equal(await checkVersion({...base,pageUrl:'file:///game.html',fetcher:()=>{throw new Error('must not fetch')}}),false);
});
