/* VE-12 的回归防护：两份 ADDED 清单曾经各写一份，加样式表只登记一处时
 * 「与 legacy 逐字节相同」那条比对会**恒假**，而报错是一整屏 CSS 文本，
 * 根本看不出真实原因。
 *
 * 这条测试守住"现在只有一份清单"这个事实：两边必须从同一个模块导入，
 * 且导入的确实是 game.css 里真实存在的全部新增表（不多、不少、不漏）。
 * 漏登记是这套机制唯一会静默出错的方式 —— 多登记会立刻报错，漏登记会恒假。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ORIGINAL_CSS, ADDED, ADDED_CSS } from './css-manifest.js';

const entry = readFileSync(new URL('../../src/styles/game.css', import.meta.url), 'utf8');
const imports = [...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(m => m[1]);

test('game.css 的导入顺序 = 冻结七张 + 新增清单，两段都不多不少', () => {
  assert.deepEqual(imports.slice(0, ORIGINAL_CSS.length), ORIGINAL_CSS,
    '冻结七张的顺序与清单一致');
  assert.deepEqual(imports.slice(ORIGINAL_CSS.length), ADDED.map(([p]) => p),
    '新增表必须恰好是 ADDED 登记的那些，且顺序固定（顺序即层叠顺序）');
});

test('ADDED_CSS 与 ADDED 是同一份清单的两个视图', () => {
  assert.deepEqual(ADDED_CSS, ADDED.map(([p]) => p),
    '★ 两条派生路径必须一致；不一致就说明有人只改了其中一处');
});

test('两个消费方都从 css-manifest 导入，而不是各留一份字面量', async () => {
  const styles = readFileSync(new URL('./styles.test.js', import.meta.url), 'utf8');
  const extraction = readFileSync(new URL('./extraction.test.js', import.meta.url), 'utf8');
  for (const [name, src] of [['styles.test.js', styles], ['extraction.test.js', extraction]]) {
    assert.match(src, /from '\.\/css-manifest\.js'/,
      name + ' 必须从 css-manifest 导入清单');
    // 不许再有独立的 ADDED 字面量数组
    assert.doesNotMatch(src, /const ADDED\s*=\s*\[/, name + ' 里还有一份 ADDED 字面量');
    assert.doesNotMatch(src, /const ADDED_CSS\s*=\s*\[/, name + ' 里还有一份 ADDED_CSS 字面量');
  }
});

test('清单里每张表都真实存在，且前缀与标签都填了', () => {
  for (const [file, prefix, label] of ADDED) {
    const path = new URL('../../src/styles/' + file.replace('./', ''), import.meta.url);
    assert.doesNotThrow(() => readFileSync(path, 'utf8'), file + ' 在清单里但文件不存在');
    assert.ok(prefix instanceof RegExp, file + ' 缺选择器前缀（否则等于放弃作用域检查）');
    assert.ok(typeof label === 'string' && label.length > 0, file + ' 缺中文标签');
  }
});

test('新增表的路径不许与冻结七张重叠', () => {
  const overlap = ADDED_CSS.filter(p => ORIGINAL_CSS.includes(p));
  assert.deepEqual(overlap, [], '冻结表不能同时出现在新增清单里');
});
