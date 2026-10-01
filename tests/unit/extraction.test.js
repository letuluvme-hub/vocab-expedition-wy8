import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const baseline = readFileSync(new URL('../fixtures/legacy.html', import.meta.url), 'utf8');
const script = baseline.match(/<script>([\s\S]*?)<\/script>/)[1];
function oldValue(name) {
  const start = script.indexOf(`const ${name}=`);
  const end = script.indexOf('\n];', start) + 3;
  return JSON.parse(JSON.stringify(vm.runInNewContext(script.slice(start, end) + `;${name}`)));
}

test('extracted vocabulary preserves all 259 records and their order', async () => {
  const { WORDS } = await import('../../src/data/words.js');
  assert.deepEqual(WORDS, oldValue('WORDS'));
});

test('extracted game catalogs are byte-for-byte equivalent values', async () => {
  for (const [file, name] of [['heroes','HEROES'],['items','ITEMS'],['enemies','ENEMIES'],['units','UNITS']]) {
    const module = await import(`../../src/data/${file}.js`);
    assert.deepEqual(module[name], oldValue(name));
  }
});

// 影分身的图鉴文案是**有意**偏离：旧版写「每场战斗可免费跳过一次」，
// 但免费额度现在是 run 级（一轮远征只有一次）。文案必须与实际口径一致，
// 否则玩家会以为每场战斗都能白嫖一次撤退。
// 偏离面精确到 RELICS 里的 ghost 一条；其余遗物、字段、顺序仍要求逐字相同。
test('relic catalog differs from legacy only in the ghost description', async () => {
  const { RELICS } = await import('../../src/data/relics.js');
  const old = oldValue('RELICS');
  assert.equal(RELICS.length, old.length, '遗物数量不变');
  const drift = RELICS.filter((r, i) => JSON.stringify(r) !== JSON.stringify(old[i])).map(r => r.id);
  assert.deepEqual(drift, ['ghost'], '只有影分身的图鉴文案可以变');
  assert.equal(RELICS.map(r => r.id).join(), old.map(r => r.id).join(), '顺序与 id 不变');
  assert.match(RELICS.filter(r => r.id === 'ghost')[0].d, /每轮/);
});

// Each added sheet has its own UI scope; archived sheets remain unchanged.
const ADDED_CSS = ['./pause.css', './learning-complete.css', './audio-settings.css', './equipment-panel.css', './audio-compatibility.css'];

test('CSS extraction preserves cascade order and every original rule', () => {
  const expected = baseline.match(/<style>([\s\S]*?)<\/style>/)[1];
  const entry = readFileSync(new URL('../../src/styles/game.css', import.meta.url), 'utf8');
  const imports = [...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(match=>match[1]);
  const actual = imports.filter(p=>!ADDED_CSS.includes(p))
    .map(path=>readFileSync(new URL(`../../src/styles/${path}`,import.meta.url),'utf8')).join('');
  assert.equal(actual.replace(/\r\n/g,'\n'), expected.replace(/\r\n/g,'\n'));
  assert.deepEqual(imports.slice(-ADDED_CSS.length), ADDED_CSS, '新增样式表的清单与顺序固定，且追加在最后');
});

// 本任务唯一有意偏离归档骨架的地方：跳过按钮的小字。旧版写「不掉血」，
// 而实际代价是固定 50 点生命（低血时直接战败）—— 文案必须点明代价。
// 偏离面精确到这一段文本，其余骨架仍要求逐字相同。
const SKIP_COPY_DIFF = /(<button class="tool" id="tSkip">跳过<small>)[^<]*(<\/small><\/button>)/;

// 暂停/保存功能是本任务唯一有意改动骨架的地方：新增 s-pause 屏幕、
// 地图与战斗的「暂停」按钮、标题页的「继续远征」入口。
// 挖掉这三处新增后，骨架必须与归档版本逐字相同 —— 角色部件与既有控件不许动。
// 暂停屏整块：锚定在 s-pause 起点与下一个 screen 起点之间，
// 这样不依赖内部 div 层数，将来加内容也不会让这条断言悄悄失效。
const PAUSE_SCREEN = /<div class="screen" id="s-pause">[\s\S]*?(?=<div class="screen" id="s-import">)/;
// 「本单元词汇已全部完成」检查点屏：纯新增（归档里没有对应物），整段挖掉。
// 锚点从 s-learning-complete 到下一个 screen 起点，将来加内容也不会静默失效。
const LEARNING_SCREEN = /<div class="screen" id="s-learning-complete">[\s\S]*?(?=<div class="screen" id="s-import">)/;
// 纯新增（归档里没有对应物）→ 整段挖掉。
const PAUSE_ONLY_NEW = [
  PAUSE_SCREEN,
  LEARNING_SCREEN,
  /<div class="row" id="continueRow" hidden><button class="btn" id="continueRun">继续远征<\/button><\/div>\n/,
  /<button class="tool" id="tPause">暂停<small>保存进度<\/small><\/button>\n/,
  // 音频兼容提示条容器：纯新增（归档里没有对应物），挂在主页声音设置区之后。
  // 连同它上面的说明注释一起整块挖掉 —— 注释也是这次新增的，留在骨架里就会
  // 让「与归档逐字相同」这条断言恒假。挖掉后其余部分仍要求逐字相同：
  // 提示条不许借机改动既有控件。
  /  <!-- 音频兼容提示条：[\s\S]*?<div id="audioCompatibility"><\/div>\n/,
];
// 包裹了既有控件的改动 → 还原成归档里的原始写法（放弃远征按钮被包进了一行 .row）。
const PAUSE_BACK_TO_LEGACY = [
  [/<div class="row" style="margin-top:8px">\s*<button class="btn g" id="mPause">暂停并保存<\/button>\s*(<button class="btn g" id="mQuit">放弃远征<\/button>)\s*<\/div>\n/,
    '<button class="btn g" id="mQuit" style="margin-top:8px">放弃远征</button>\n'],
];
const stripPause = html => {
  // index.html 在 Windows 上是 CRLF：先把行尾统一成 \n，正则才不会静默失配
  // （静默失配会让「骨架一致」这条断言变成永远为真的假通过）。
  let out = html.replace(/\r\n/g, '\n');
  for (const re of PAUSE_ONLY_NEW) out = out.replace(re, '');
  for (const [re, to] of PAUSE_BACK_TO_LEGACY) out = out.replace(re, to);
  return out;
};

// 主页声音设置区：归档里是写在 HTML 里的 .volrow（音量一行），现在是
// <div id="audioSettings"></div> 空容器，按钮由 audio-settings.js 画进去
// （音效与朗读两个独立开关）。这是**同一位置**的替换，不是整段新增，
// 所以归一化必须把新版容器原样还原成归档里的那一段（含注释，注释位置
// 也不许挪），骨架其余部分仍要求逐字相同。
const LEGACY_VOLROW = /<!-- 音量控制：[\s\S]*?<div class="volrow">[\s\S]*?<\/div>\n/;
const NEW_AUDIO_BLOCK = /<!-- 声音设置：[\s\S]*?<div id="audioSettings"><\/div>\n/;
const backToLegacyVolrow = html => {
  // index.html 在 Windows 上是 CRLF：先归一化行尾，否则段尾的 \n 匹配不上
  // （静默失配会让下面那条 notEqual 变成误报）。归档段也一并归一化。
  const legacy = baseline.replace(/\r\n/g,'\n').match(LEGACY_VOLROW);
  assert.ok(legacy, '归档里必须仍然找得到原来的 .volrow 段（否则归一化会假通过）');
  const out = html.replace(/\r\n/g,'\n').replace(NEW_AUDIO_BLOCK, legacy[0]);
  assert.notEqual(out, html, '新版必须真的包含被替换的声音设置段（否则归一化会假通过）');
  return out;
};

test('page skeleton preserves approved character parts and all existing controls', () => {
  const strip = html => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script(?: [^>]*)?>[\s\S]*?<\/script>/, '').replace(/<link rel="stylesheet" href="\/src\/styles\/game.css">/, '').replace(/\s+/g,' ').trim();
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  // 两边都要走 stripPause：暂停新增是本任务允许的唯一偏离，其余必须逐字相同。
  // 主页声音设置区是同位置的替换：把新版容器还原成归档的 .volrow 段再比。
  assert.equal(strip(stripPause(backToLegacyVolrow(html)).replace(SKIP_COPY_DIFF, '$1跳过代价$2')),
    strip(stripPause(baseline).replace(SKIP_COPY_DIFF, '$1跳过代价$2')));
  // 去掉跳过文案的归一化后，仍然必须完全对齐
  assert.equal(strip(stripPause(backToLegacyVolrow(html)).replace(SKIP_COPY_DIFF, '')), strip(stripPause(baseline).replace(SKIP_COPY_DIFF, '')));
  // 并且当前文案确实点明了 50 点生命
  assert.match(html, /id="tSkip">跳过<small>损失 50 生命<\/small>/);
  assert.match(html, /<script type="module" src="\/src\/main.js"><\/script>/);
  // 声音设置：容器必须在标题页内（不能是 body 上的浮动层），旧的 .volrow 必须已经不存在。
  const titleScreen = html.slice(html.indexOf('id="s-title"'), html.indexOf('<div class="screen" id="s-map"'));
  assert.match(titleScreen, /<div id="audioSettings"><\/div>/, '声音设置容器必须落在主页 #s-title 内');
  // 兼容提示条：容器同样必须在主页内、且在声音设置区之后（提示条是设置的补充说明）。
  // 这条必须真的命中 —— 否则上面 PAUSE_ONLY_NEW 里那条剥离会变成静默的空操作，
  // 「骨架一致」就成了永远为真的假通过。
  assert.match(titleScreen, /<div id="audioSettings"><\/div>\s*<!--[\s\S]*?-->\s*<div id="audioCompatibility"><\/div>/,
    '兼容提示条容器必须紧跟在主页声音设置区之后');
  assert.doesNotMatch(html, /class="volrow"|id="volBtn"|id="volVal"|id="voiceBtn"/, '旧的浮动音量/语音控件必须从 HTML 里移除');
  // 暂停入口必须真的在页面上（否则上面的对齐会因为「都不存在」而假通过）
  assert.match(html, /id="mPause">暂停并保存/);
  assert.match(html, /id="tPause">暂停/);
  assert.match(html, /id="continueRun">继续远征/);
  assert.match(html, /id="s-pause"/);
  // 词汇完成检查点必须真的在页面上，且按钮文案与契约一致
  // （否则上面那两条对齐会因为「都不存在」而假通过）
  assert.match(html, /id="s-learning-complete"/);
  assert.match(html, /id="lcBtnHome">保存并返回主页/);
  assert.match(html, /id="lcBtnQuit">结束本轮学习/);
  assert.doesNotMatch(html, /id="s-learning-complete">[\s\S]*?(解锁下一单元|下一单元已)/,
    '检查点屏不许承诺解锁下一单元');
});

test('monster artwork matches original trusted SVG and rejects injected names', async () => {
  const { foeArtHTML } = await import('../../src/ui/components/monster-art.js');
  const end = script.indexOf('// ============================================================');
  const original = vm.runInNewContext(script.slice(0,end) + ';foeArtHTML');
  for (const n of ['词灵','语素蛛','石化词素','歧义章鱼','拼写幽灵','单复数蝎','冰封词灵','词形旋风','词汇之王','<img src=x onerror=alert(1)>']) {
    for (const boss of [false,true]) for (const elite of [false,true]) assert.equal(foeArtHTML({n},boss,elite), original({n},boss,elite));
  }
});
