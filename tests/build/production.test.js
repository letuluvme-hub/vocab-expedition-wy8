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

/* 离线单文件版下载入口（index.html 的 #dlOffline）。
 *
 * 两件事必须同时成立，缺一不可：
 *   1) 站点版**有**这个入口 —— 否则玩家没有下载离线版的路径；
 *   2) 单文件版**没有** —— 它自己就是那个文件，file:// 下没有兄弟文件可下。
 * 只测其中一个都不够：把链接整个删掉能过 (2)，忘了摘能过 (1)。
 */
test('site build offers the offline download, standalone build does not', () => {
  const site = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
  assert.match(site, /<a[^>]*id="dlOffline"[^>]*href="vocab-expedition-standalone\.html"[^>]*download=/,
    '站点版必须提供离线单文件版的下载入口，且带 download 属性');
  const offline = readFileSync(new URL('../../dist/vocab-expedition-standalone.html', import.meta.url), 'utf8');
  assert.doesNotMatch(offline, /id="dlOffline"/,
    '单文件版里不许再出现这个入口 —— 它自己就是那个文件');
  // 反向确认摘除没有误伤：单文件版本身仍然是页面（脚本与样式都已内联）。
  assert.match(offline, /<script type="module">/, '单文件版应当已内联脚本');
  assert.match(offline, /<style>/, '单文件版应当已内联样式');
});
