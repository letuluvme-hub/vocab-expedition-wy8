import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

/* 两张后续功能**唯一**新增的样式表，各自只作用于自己那一块屏：
     ./pause.css            → #s-pause / #continueRow
     ./learning-complete.css → #s-learning-complete
   原始七张样式表仍要求与归档版本逐字相同、顺序不变 ——
   否则「新增只追加在最后」这条约定会被悄悄破坏。
   每张新增表声明它**允许**触碰的选择器前缀：那张表里出现别的前缀就是越界。 */
const ADDED = [
  { path: './pause.css',            scope: /^(#s-pause|#continueRow)\b/, label: 'pause' },
  { path: './learning-complete.css', scope: /^#s-learning-complete\b/,      label: 'learning-complete' },
];
const OWNED = ADDED.map(a => a.path);

test('split styles retain every original rule and exact cascade order',async()=>{
  const entry=readFileSync(new URL('../../src/styles/game.css',import.meta.url),'utf8');
  const paths=[...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(m=>m[1]);
  assert.ok(paths.length>=5,'screen styles must have separate ownership boundaries');
  // 新增样式必须按声明顺序追加在最后：它靠层叠顺序追加，不能插到既有规则中间。
  assert.deepEqual(paths.slice(-ADDED.length), OWNED,'新增样式必须按声明顺序追加在最后');
  const original=paths.filter(p=>!OWNED.includes(p));
  const combined=original.map(p=>readFileSync(new URL(`../../src/styles/${p}`,import.meta.url),'utf8')).join('');
  const baseline=readFileSync(new URL('../fixtures/legacy.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  // 行尾统一后再比：Windows 上写出的文件是 CRLF，归档是 LF，
  // 不归一化的话这条断言会因为换行符而恒假。
  assert.equal(combined.replace(/\r\n/g,'\n'),baseline.replace(/\r\n/g,'\n'));
  // 每张新增表都必须真的只作用于自己那一块屏：把每条规则的选择器抠出来核对，
  // 不许偷偷改既有选择器（那会借「新增样式」之名改动线上外观）。
  // 先剥注释与 @import，否则注释行会被当成选择器。
  for(const a of ADDED){
    const added=readFileSync(new URL(`../../src/styles/${a.path}`,import.meta.url),'utf8')
      .replace(/\/\*[\s\S]*?\*\//g,'').replace(/@import[^;]+;/g,'');
    const selectors=[...added.matchAll(/(^|\})\s*([^{}]*?)\s*\{/g)].map(m=>m[2].trim()).filter(Boolean);
    assert.ok(selectors.length>0,a.label+' 样式表不能是空的');
    for(const sel of selectors) for(const one of sel.split(',')) {
      assert.match(one.trim(),a.scope, a.label+' 样式越界，只允许作用于 '+a.scope+': '+one);
    }
  }
});
