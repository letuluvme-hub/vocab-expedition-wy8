import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Inline only Vite-owned, flat hashed assets. Never resolve arbitrary input URLs. */
export function inlineBuiltPage(html, readAsset) {
  const assetPath = url => {
    const match = url.match(/^\/vocab-expedition-wy8\/(assets\/[A-Za-z0-9_.-]+)$/);
    if (!match) throw new Error(`Unsupported asset URL: ${url}`);
    return match[1];
  };
  return html
    // 单文件版里必须摘掉「下载安卓版」入口：单文件是给 file:// 双击打开用的，
    // 那里点 APK 链接没有意义（也下不到），留着只会让人以为点了没反应。
    // 按 **id** 精确摘整行（不靠注释文本匹配 —— 注释会被人改，id 有测试钉住）。
    .replace(/<div class="row">\s*<a[^>]*\bid="dlAndroid"[\s\S]*?<\/a>\s*<\/div>/, '')
    .replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (_, url) => {
      const code = readAsset(assetPath(url));
      if (typeof code !== 'string') throw new Error(`Missing asset: ${url}`);
      return `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`;
    })
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, url) => {
      const css = readAsset(assetPath(url));
      if (typeof css !== 'string') throw new Error(`Missing asset: ${url}`);
      return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve('dist');
  const html = readFileSync(resolve(directory, 'index.html'), 'utf8');
  const output = inlineBuiltPage(html, path => readFileSync(resolve(directory, path), 'utf8'));
  writeFileSync(resolve(directory, 'vocab-expedition-standalone.html'), output);
  console.log(`Standalone HTML: ${Buffer.byteLength(output)} bytes`);
}
