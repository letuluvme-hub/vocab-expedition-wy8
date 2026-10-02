/* 像素美术模块的契约测试。
 *
 * 三类容易静默出问题的地方：
 *  1) **网格形状**。渲染器按第一行的长度决定列数，所以一行多写/少写一个字符
 *     既不会抛错也不会警告 —— 只是精灵「说不上哪里不对」。这一批美术初版
 *     就是这么混进去 19 行错位的，所以形状必须是可断言的。
 *  2) **覆盖度**。新加一件装备却忘了画图标，界面上就会出现一个空白格；
 *     这里拿 data 层的真实 id 反向核对。
 *  3) **安全**。怪物名与装备 id 都可能来自存档或自定义词表，
 *     绝不允许被拼进标记里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelArtAudit, pixelMonsterSVG, pixelIconSVG, relicIconKey } from '../../src/ui/components/pixel-art.js';
import { ITEMS } from '../../src/data/items.js';
import { RELICS } from '../../src/data/relics.js';

test('每一张精灵网格都是严格矩形，且不含网格字符之外的杂字', () => {
  const issues = pixelArtAudit();
  assert.deepEqual(issues, [], '网格必须规整，实际：' + JSON.stringify(issues));
});

test('每一件道具和遗物都有对应的像素图标（新加装备时不许漏画）', () => {
  for (const it of ITEMS) {
    assert.ok(pixelIconSVG(it.id), `道具 ${it.id}（${it.n}）缺少像素图标`);
  }
  for (const r of RELICS) {
    const key = relicIconKey(r.id);
    assert.ok(pixelIconSVG(key), `遗物 ${r.id}（${r.n}）缺少像素图标（查表键 ${key}）`);
  }
});

test('道具的 greed（钱币）与遗物的 greed（宝石）不是同一幅图', () => {
  // 两者 id 同名但语义不同，共用一幅图会让「贪婪钱币」和「贪婪之眼」撞脸。
  assert.notEqual(pixelIconSVG('greed'), pixelIconSVG(relicIconKey('greed')));
});

test('认不出的装备 id 返回 null，交给调用方走文本降级', () => {
  for (const bad of ['nope', '', null, undefined, 42, {}, []]) {
    assert.equal(pixelIconSVG(bad), null, JSON.stringify(bad) + ' 不该产出图标');
  }
});

test('图标只由固定表产出：未知 id 绝不回显进标记', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.equal(pixelIconSVG(evil), null, '未知 id 必须直接拒绝，而不是把它画进 SVG');
});

test('怪物名只认固定表，认不出的一律回落默认精灵且不回显输入', () => {
  const evil = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', '', null, undefined, 42, {}];
  for (const n of evil) {
    const svg = pixelMonsterSVG({ n }, true, true);
    assert.doesNotMatch(svg, /<img|onerror|<script|alert\(/, '输入不许出现在标记里：' + JSON.stringify(n));
    assert.match(svg, /aria-label="词灵/, '应当回落成默认精灵');
  }
});

test('像素精灵带硬边渲染标记，否则缩放到 64px 会糊', () => {
  const svg = pixelMonsterSVG({ n: '冰封词灵' }, false, false);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /viewBox="0 0 16 16"/);
});

test('首领与精英的装饰互不重复计数，且首领优先', () => {
  const plain = pixelMonsterSVG({ n: '词灵' }, false, false);
  const boss = pixelMonsterSVG({ n: '词灵' }, true, false);
  const elite = pixelMonsterSVG({ n: '词灵' }, false, true);
  assert.ok(boss.length > plain.length, '首领要多出王冠');
  assert.ok(elite.length > plain.length, '精英要多出标记');
  assert.equal(pixelMonsterSVG({ n: '词灵' }, true, true), boss,
    '同时是首领与精英时只认首领，不叠两层装饰');
});

test('关闭动画时不再输出眨眼图层（静态场景不需要定时动画）', () => {
  const animated = pixelMonsterSVG({ n: '词灵' }, false, false, { anim: true });
  const still = pixelMonsterSVG({ n: '词灵' }, false, false, { anim: false });
  assert.ok(animated.includes('pm-lid'), '带动画时要有眼睑图层');
  assert.ok(!still.includes('pm-lid'), '关掉动画时不该留着眼睑');
  assert.ok(!still.includes('anim'), '关掉动画时不该带 anim 类');
});
