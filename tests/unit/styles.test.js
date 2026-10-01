import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

/* 暂停屏样式（pause.css）是本功能**唯一**新增的样式文件，只作用于 #s-pause /
   #continueRow。原始七张样式表仍要求与归档版本逐字相同、顺序不变 ——
   否则「新增只追加在最后」这条约定会被悄悄破坏。 */
const OWNED = './pause.css';

test('split styles retain every original rule and exact cascade order',async()=>{
  const entry=readFileSync(new URL('../../src/styles/game.css',import.meta.url),'utf8');
  const paths=[...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(m=>m[1]);
  assert.ok(paths.length>=5,'screen styles must have separate ownership boundaries');
  // 新增样式必须排在最后：它靠层叠顺序追加，不能插到既有规则中间。
  assert.equal(paths[paths.length-1],OWNED,'pause 样式必须追加在最后');
  const original=paths.filter(p=>p!==OWNED);
  const combined=original.map(p=>readFileSync(new URL(`../../src/styles/${p}`,import.meta.url),'utf8')).join('');
  const baseline=readFileSync(new URL('../fixtures/legacy.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  // 行尾统一后再比：Windows 上写出的文件是 CRLF，归档是 LF，
  // 不归一化的话这条断言会因为换行符而恒假。
  assert.equal(combined.replace(/\r\n/g,'\n'),baseline.replace(/\r\n/g,'\n'));
  // 新增的那份必须真的只作用于暂停屏：把每条规则的选择器抠出来核对，
  // 不许偷偷改既有选择器（那会借「新增样式」之名改动线上外观）。
  // 先剥注释与 @import，否则注释行会被当成选择器。
  const added=readFileSync(new URL(`../../src/styles/${OWNED}`,import.meta.url),'utf8')
    .replace(/\/\*[\s\S]*?\*\//g,'').replace(/@import[^;]+;/g,'');
  const selectors=[...added.matchAll(/(^|\})\s*([^{}]*?)\s*\{/g)].map(m=>m[2].trim()).filter(Boolean);
  assert.ok(selectors.length>0,'pause 样式表不能是空的');
  for(const sel of selectors) for(const one of sel.split(',')) {
    assert.match(one.trim(),/^#s-pause\b|^#continueRow\b/, '暂停样式只允许作用于 #s-pause / #continueRow: '+one);
  }
});
