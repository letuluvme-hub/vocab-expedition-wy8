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

/* 安卓 APK 下载入口（index.html 的 #dlAndroid）。
 *
 * 三件事必须同时成立：
 *   1) 站点版**有**这个入口；
 *   2) 单文件版**没有** —— 那是给 file:// 双击打开的，点了也下不到；
 *   3) **链接指向的文件真的存在**，而且确实是个 APK。
 * 只测前两条不够：链接写错文件名照样能过，玩家点下去才发现 404。
 */
test('site build offers the APK download, standalone build does not', () => {
  const site = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8');
  const m = /<a[^>]*id="dlAndroid"[^>]*href="([^"]+)"[^>]*download=/.exec(site);
  assert.ok(m, '站点版必须提供安卓 APK 的下载入口，且带 download 属性');
  const href = m[1];
  assert.ok(!/^https?:|^\//.test(href),
    '必须是相对路径（跟着 Vite 的 base 走），写死域名/绝对路径会在换域名或子路径时失效：' + href);

  // 链接指向的文件必须真的在发布目录里，且是 APK（ZIP 魔数 "PK"）。
  const apk = readFileSync(new URL('../../dist/' + href, import.meta.url));
  assert.ok(apk.length > 100_000, 'APK 体积不合理：' + apk.length + ' bytes');
  assert.equal(apk[0], 0x50, 'APK 应当是 ZIP 容器（首字节 P）');
  assert.equal(apk[1], 0x4b, 'APK 应当是 ZIP 容器（次字节 K）');

  const offline = readFileSync(new URL('../../dist/vocab-expedition-standalone.html', import.meta.url), 'utf8');
  assert.doesNotMatch(offline, /id="dlAndroid"/,
    '单文件版里不许再出现这个入口 —— 它是给 file:// 双击打开用的');
  // 反向确认摘除没有误伤：单文件版本身仍然是页面（脚本与样式都已内联）。
  assert.match(offline, /<script type="module">/, '单文件版应当已内联脚本');
  assert.match(offline, /<style>/, '单文件版应当已内联样式');
});
