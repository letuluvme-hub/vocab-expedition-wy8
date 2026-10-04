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

// 遗物档位、末尾追加的预知残卷与以下文案是已登记例外。
// 此次角色/用品平衡只修正护盾符文、学者之书的实际结算说明；
// 身份、名称、图标、顺序仍逐项对照归档。
const LEGACY_RELIC_IDS = ['hint', 'shield', 'combo', 'purse', 'thorn', 'battery',
  'lucky', 'scholar', 'forge', 'ghost', 'greed', 'focus'];
const NEW_RELIC_IDS = ['prophecy'];
const RELIC_COPY_OVERRIDES = {
  shield: '首次获得时增加 15 点护盾（先于生命消耗），之后不重复发放',
  scholar: '每场第二词自动揭示首字母；胜利时有 1/3 概率提供先知卡选项，与聚宝盆组合后必定提供',
  ghost: '每轮远征可免费跳过一次，不计失败（用完后跳过仍需付代价）',
};

test('relic catalog keeps every legacy entry verbatim and only appends the legendary', async () => {
  const { RELICS } = await import('../../src/data/relics.js');
  const old = oldValue('RELICS');
  assert.deepEqual(RELICS.slice(0, old.length).map(r => r.id), LEGACY_RELIC_IDS, '旧遗物的顺序与 id 不变');
  assert.deepEqual(RELICS.slice(old.length).map(r => r.id), NEW_RELIC_IDS, '只允许在末尾追加新遗物');
  for (const o of old) {
    const now = RELICS.filter(r => r.id === o.id)[0];
    assert.equal(now.ic, o.ic, o.id + ' 图标不许变');
    assert.equal(now.n, o.n, o.id + ' 名称不许变');
    assert.equal(now.d, RELIC_COPY_OVERRIDES[o.id] ?? o.d, o.id + ' 图鉴文案需精确符合登记值');
    assert.ok(typeof now.rarity === 'string' && now.rarity.length > 0, o.id + ' 必须标了稀有度');
    assert.equal(now.price, undefined, '定价只能来自 balance 的档位表，不许在遗物对象上重复一份');
  }
});

test('relic catalog differs from legacy only in registered rule descriptions', async () => {
  const { RELICS } = await import('../../src/data/relics.js');
  const old = oldValue('RELICS');
  const legacy = RELICS.slice(0, old.length);
  const drift = legacy.filter((r, i) => JSON.stringify({ ic: r.ic, n: r.n, d: r.d })
    !== JSON.stringify({ ic: old[i].ic, n: old[i].n, d: old[i].d })).map(r => r.id);
  assert.deepEqual(drift, Object.keys(RELIC_COPY_OVERRIDES), '只有已登记的图鉴文案可以变');
  assert.equal(legacy.map(r => r.id).join(), old.map(r => r.id).join(), '顺序与 id 不变');
  assert.match(RELICS.filter(r => r.id === 'ghost')[0].d, /每轮/);
});

// 每个例外精确到字段和值，不能借平衡任务更换名称、图标或增删道具。
const ITEM_OVERRIDES = {
  leech: { d: '主动使用，立即回复 8 生命（每场最多 3 次）', tip: '受伤后再用；满血时不消耗', max: 3 },
  rage: { d: '后 3 个新字母伤害 ×2.5；若包含末字母，大招也加成。使用时清空连击', tip: '留给本词末尾；退格重输不重复触发' },
  freeze: { d: '冻结当前词：免疫拼错与怪物攻击的伤害，自己的伤害减半', tip: '完成当前词后解除；错误仍进入复习' },
  chain: { d: '下一个正确新字母额外 +3 连击、+8% 本场伤害', tip: '先蓄势，再正确拼出一个新字母' },
  reveal: { d: '揭示接下来 2 个字母 —— 但消耗 1 次提示额度', tip: '省下手动点提示的时间，代价是应急预算' },
  purge: { tip: '没有错误标记时不消耗', price: 25 },
  greed: { d: '本场金币奖励 +50%，额外最多 60 金币；每场限用 1 次',
    tip: '额外奖励先封顶，再计算角色与遗物的金币加成', max: 1, price: 75 },
  stone: { d: '获得 16 护盾，每场最多 2 次；护盾保留至后续战斗',
    tip: '护盾最多等于生命上限；满盾时不消耗' },
};

test('item catalog differs from legacy only in the deliberately re-costed entries', async () => {
  const { ITEMS } = await import('../../src/data/items.js');
  const old = oldValue('ITEMS');
  assert.equal(ITEMS.length, old.length, '道具数量不变');
  assert.deepEqual(ITEMS.map(x => x.id).join(), old.map(x => x.id).join(), '顺序与 id 不变');
  const drift = ITEMS.filter((r, i) => JSON.stringify(r) !== JSON.stringify(old[i])).map(r => r.id);
  assert.deepEqual(drift, Object.keys(ITEM_OVERRIDES), '只有显式登记的道具允许偏离归档');
  for (const it of old) {
    assert.deepEqual(ITEMS.find(x => x.id === it.id), { ...it, ...ITEM_OVERRIDES[it.id] },
      it.id + ' 只允许登记过的字段和值发生变化');
  }
  const reveal = ITEMS.filter(x => x.id === 'reveal')[0];
  assert.equal(reveal.max, old.filter(x => x.id === 'reveal')[0].max, '代价只加在效果上，不许顺带改持有上限');
  assert.equal(reveal.price, old.filter(x => x.id === 'reveal')[0].price, '这次不改售价 —— 经济面另行验证');
  assert.match(reveal.d, /提示/, '新文案必须点明代价');
});

const HERO_OVERRIDES = {
  scholar: { d: '每场多 1 次提示，主动提示一次揭示 2 个字母；无错误、无帮助的整词大招 +15%；生命上限 -10。', mod: { hp: -10, hint: 1 } },
  warrior: { d: '生命上限 +15；每拼完一词获得 2 护盾，每场最多 6；有护盾时整词大招 +20%；每场少 1 次提示。', mod: { hp: 15, hint: -1 } },
  scout: { d: '干扰字母 -2（至少保留 2 个）；每场首个整词大招伤害 +50%；生命上限 -5。', mod: { hp: -5, noise: -2 } },
  lucky: { d: '开局多 15 金币，金币收益 +20%；每携带 50 金币整词大招 +5%（最多 +20%）；生命上限 -5，连击加成 -10%。', mod: { hp: -5, gold: 15, combo: 0.9 } },
  healer: { d: '新远征半血起步；每次战斗胜利生命上限 +5，每张地图最多 +30，换图保留成长并重新开放额度。每场开场回复 10 生命，溢出转为最多 4 护盾；基础生命上限 -5。', mod: { hp: -5, regen: 10 } },
  ranger: { d: '未借助提示的新字母答对回 1 生命，每场最多 18；本词出错、主动提示或听音后停止回血。生命上限 -20。', mod: { hp: -20, leech: 1 } },
};
test('hero balance changes only registered descriptions and modifiers; identity and voice stay unchanged', async () => {
  const { HEROES } = await import('../../src/data/heroes.js');
  const old = oldValue('HEROES');
  assert.deepEqual(HEROES.slice(0,6).map(h => h.id), old.map(h => h.id));
  assert.deepEqual(HEROES.slice(6).map(h=>h.id),['berserker','pyromancer','assassin']);
  for (const h of old) assert.deepEqual(HEROES.find(x => x.id === h.id), { ...h, ...HERO_OVERRIDES[h.id] });
});

test('unmodified enemy and unit catalogs are byte-for-byte equivalent values', async () => {
  for (const [file, name] of [['enemies','ENEMIES'],['units','UNITS']]) {
    const module = await import(`../../src/data/${file}.js`);
    assert.deepEqual(module[name], oldValue(name));
  }
});

// Each added sheet has its own UI scope; archived sheets remain unchanged.
const ADDED_CSS = ['./pause.css', './learning-complete.css', './audio-settings.css', './equipment-panel.css', './audio-compatibility.css', './mastery-growth.css', './foe-attacks.css', './streak-feedback.css', './combo-milestones.css', './relic-depth.css', './pixel-art.css', './keyboard-tip.css', './foe-avatar.css', './android-download.css', './word-choice.css', './home-cta.css', './keyboard-shortcuts.css', './device-controls.css', './hero-roster.css', './battle-stage.css', './book-picker.css', './battle-details.css'];
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
  // 蓄力条容器（清单 13）：纯新增（归档里没有对应物），挂在战斗页敌人信息块里。
  // 连同上面的注释整块挖掉 —— 注释也是本次新增，留在骨架里会让「逐字相同」恒假。
  /        <!-- 蓄力条（清单 13）：[\s\S]*?<div class="foeAtk" id="fFoeAtk" hidden><\/div>\n/,
  // 战意·连击里程碑条容器：纯新增（归档里没有对应物），挂在战斗页词卡里 #fCombo 下方。
  // 连同上面的注释整块挖掉 —— 注释也是本次新增，留在骨架里会让「逐字相同」恒假。
  /    <!-- 战意·连击里程碑（docs\/feature-combo-milestones\.md）：[\s\S]*?<div class="comboMs" id="fComboMs"><\/div>\n/,
  // 选词出招的候选卡容器：纯新增，挂在战斗词卡顶部 #fZh 之前。连同注释整块挖掉。
  /    <!-- 选词出招（docs\/feature-word-choice\.md）：[\s\S]*?<div id="fOffer" hidden><\/div>\n/,
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

// 主页「知识成长」只读区（docs/feature-mastery-growth.md）：归档里没有这一段，
// 新版在 #audioSettings 之后**纯新增**一个空容器 <div id="masteryGrowthHost"></div>
// （里面的盒子由 mastery-growth.js 建，带自己的 id=masteryGrowth）。
// 这是「新增」而非「替换」，所以归一化方式是整段删掉；连注释一起删，
// 保证剩下的骨架与归档逐字相同。
const MG_ONLY_NEW = /  <!-- 知识成长：[\s\S]*?<div id="masteryGrowthHost"><\/div>\n/;
const stripMasteryHost = html => {
  const out = html.replace(MG_ONLY_NEW, '');
  assert.notEqual(out, html, '新版必须真的包含知识成长容器（否则归一化会假通过）');
  return out;
};

// 首次进入的一次性键盘提示容器：纯新增（归档里没有对应物），整段删掉再比。
// 同样带 notEqual 守卫 —— 归一化一旦静默失配，「骨架一致」就成了永远为真的假通过。
const KTIP_ONLY_NEW = /<!-- 首次进入的一次性提示[\s\S]*?<div id="keyboardTipHost"><\/div>\s*/;
const stripKeyboardTipHost = html => {
  const out = html.replace(/\r\n/g, '\n').replace(KTIP_ONLY_NEW, '');
  assert.notEqual(out, html.replace(/\r\n/g, '\n'), '新版必须真的包含键盘提示容器（否则归一化会假通过）');
  return out;
};

// 安卓 APK 下载入口：纯新增（归档里没有对应物），整段删掉再比。
// 同样带 notEqual 守卫 —— 归一化一旦静默失配，「骨架一致」就成了永远为真的假通过。
const ANDROID_ROW_ONLY_NEW = /<!-- 安卓版 APK 下载[\s\S]*?<a[^>]*id="dlAndroid"[\s\S]*?<\/a>\s*<\/div>\s*/;
const stripAndroidDownload = html => {
  const out = html.replace(/\r\n/g, '\n').replace(ANDROID_ROW_ONLY_NEW, '');
  assert.notEqual(out, html.replace(/\r\n/g, '\n'), '新版必须真的包含安卓下载入口（否则归一化会假通过）');
  return out;
};

// 战斗页的完整词连胜播报宿主（docs/feature-word-streak.md）：归档里没有这一段，
// 新版在 #fCombo 之后**纯新增**一个空容器 <div id="streakFeedbackHost"></div>
//（里面的 toast 由 streak-announcement.js 建，带自己的 id=streakAnnouncement）。
// 它是「新增」而非「替换」→ 归一化方式是整段删掉（连注释一起删），
// 剩下的战斗页骨架仍要求与归档逐字相同。notEqual 保证这条不是静默空操作。
const STREAK_HOST_ONLY_NEW = /    <!-- 完整词连胜的播报宿主[\s\S]*?<div id="streakFeedbackHost"><\/div>\n/;
const stripStreakHost = html => {
  const lf = html.replace(/\r\n/g, '\n');
  const out = lf.replace(STREAK_HOST_ONLY_NEW, '');
  assert.notEqual(out, lf, '新版必须真的包含连胜播报容器（否则归一化会假通过）');
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

// P0-2 的明确展示变化：新增远征统计，正式默写统计只改标签。
// 精确归一化后仍逐字核对归档骨架，不能借此隐藏其他控件差异。
const backToLegacyHomeProgress = html => {
  const lf = html.replace(/\r\n/g, '\n');
  const expedition = /      <div><b id="sExpedition" style="color:var\(--acc2\)">0<\/b><i>远征拼对<\/i><\/div>\n/;
  const formal = /(<b id="sMaster" style="color:var\(--ok\)">0<\/b><i>)默写掌握(<\/i>)/;
  assert.match(lf, expedition, '新增远征统计必须真实存在');
  assert.match(lf, formal, '既有掌握统计必须明确是默写掌握');
  return lf.replace(expedition, '').replace(formal, '$1已掌握$2');
};

// The battle stage now remains above the word/equipment scroller. Normalize
// only that explicit move before comparing all retained controls with the archive.
const backToLegacyBattleStage = html => {
  const opening = '  <div id="fBattleStage" aria-label="双方战况">\n';
  const end = '  </div><!-- /#fBattleStage -->\n';
  assert.equal(html.split(opening).length, 2, 'exactly one persistent stage');
  assert.equal(html.split(end).length, 2, 'stage has its own closing boundary');
  const start = html.indexOf('  <div class="vsrow">', html.indexOf(opening));
  const finish = html.indexOf(end, start);
  const row = html.slice(start, finish);
  assert.match(row, /id="fAv"/);assert.match(row, /id="fPc"/);
  assert.doesNotMatch(row, /id="fTags"/);
  let out = html.slice(0, start) + html.slice(finish);
  out = out.replace(opening, '').replace(end, '').replace('  <div class="fmid">\n', '  <div class="fmid">\n' + row);
  const tags = '    <div class="tagsm" id="fTags"></div>\n';
  assert.equal(out.split(tags).length, 2, 'mechanism tags remain exactly once');
  return out.replace(tags, '').replace('        <div class="fname" id="fName">词灵</div>\n', '        <div class="fname" id="fName">词灵</div>\n    ' + tags);
};

test('page skeleton preserves approved character parts and all existing controls', () => {
  const strip = html => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script(?: [^>]*)?>[\s\S]*?<\/script>/, '').replace(/<link rel="stylesheet" href="\/src\/styles\/game.css">/, '').replace(/\s+/g,' ').trim();
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const comparable = backToLegacyBattleStage(backToLegacyHomeProgress(html))
    .replace(/  <div class="book-picker" id="textbookPicker"><\/div>\r?\n/,'')
    // 主站页脚是已授权新增；其余主页结构仍逐字比较。
    .replace(/  <footer class="note" style="margin-top:20px;text-align:center"><a id="mainSiteLink" href="https:\/\/fangtuo.top" style="color:var\(--acc2\)">返回方拓主站 · fangtuo.top<\/a><\/footer>\r?\n/,'')
    .replace('<span class="desktopHelp">','').replace('方向键不做任何事。</span>','方向键不做任何事。')
    .replace('QWERTY / 字母序</b>（字母序按 A–Z 排）','键盘布局</b>（按电脑 QWERTY 排）')
    .replace('A–Z 字母序 ↔ 标准 QWERTY 键盘三行','乱序网格 ↔ 标准 QWERTY 键盘三行')
    .replace('布局<b id="tBankModeV">字母序</b>','键盘布局<b id="tBankModeV">关</b>')
    .replace(/  <div id="fHintShared" aria-live="polite">听读音 \/ 提示共用：剩余 3 次<\/div>\r?\n/,'');
  // 两边都要走 stripPause：暂停新增是本任务允许的唯一偏离，其余必须逐字相同。
  // 主页声音设置区是同位置的替换：把新版容器还原成归档的 .volrow 段再比。
  // 知识成长容器是纯新增：整段删掉再比（见 stripMasteryHost）。
  assert.equal(strip(stripPause(stripAndroidDownload(stripKeyboardTipHost(stripStreakHost(stripMasteryHost(backToLegacyVolrow(comparable))))).replace(SKIP_COPY_DIFF, '$1跳过代价$2'))),
    strip(stripPause(baseline).replace(SKIP_COPY_DIFF, '$1跳过代价$2')));
  // 去掉跳过文案的归一化后，仍然必须完全对齐
  assert.equal(strip(stripPause(stripAndroidDownload(stripKeyboardTipHost(stripStreakHost(stripMasteryHost(backToLegacyVolrow(comparable))))).replace(SKIP_COPY_DIFF, ''))),
    strip(stripPause(baseline).replace(SKIP_COPY_DIFF, '')));
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
  // 知识成长区同理：容器必须落在主页 #s-title 内（否则战斗页也会显示这段说明），
  // 且宿主 id 不得与组件自建的 id=masteryGrowth 重复（重复 id 会让 getElementById 指错）。
  assert.match(titleScreen, /<div id="masteryGrowthHost"><\/div>/, '知识成长容器必须落在主页 #s-title 内');
  // 键盘提示容器同样必须落在主页 #s-title 内（否则战斗页也会弹出这条一次性说明），
  // 且宿主 id 不得与组件自建的 id=keyboardTip 重复。
  assert.match(titleScreen, /<div id="keyboardTipHost"><\/div>/, '键盘提示容器必须落在主页 #s-title 内');
  // 安卓下载入口同理：必须在主页内，且 href 是**相对路径**（跟着 Vite 的 base 走，
  // 写死 /vocab-expedition-wy8/ 会在换域名或子路径时失效），并带 download 属性。
  assert.match(titleScreen, /<a[^>]*id="dlAndroid"[^>]*href="vocab-expedition-1\.0\.0\.apk"[^>]*download=/,
    '安卓下载入口必须落在主页 #s-title 内、用相对路径、且带 download 属性');
  assert.equal((html.match(/id="keyboardTip"/g) || []).length, 0,
    'HTML 里不得预置 id=keyboardTip：那个 id 属于组件自建的盒子，预置会造成重复 id');
  assert.equal((html.match(/id="masteryGrowth"/g) || []).length, 0,
    'HTML 里不得预置 id=masteryGrowth：那个 id 属于组件自建的盒子，预置会造成重复 id');
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
  // 蓄力条容器（清单 13）必须真的在战斗页里，且宿主 id 不得与组件自建的重复。
  // 这条必须命中 —— 否则上面 PAUSE_ONLY_NEW 里那条剥离会变成静默空操作，
  // 「骨架与归档逐字相同」就成了永远为真的假通过。
  // ★ 结束锚点必须是 s-fight 之后的**下一个** screen：文档里 s-map 排在 s-fight
  //   之前，用它切片会得到空串，让这条断言对不存在的容器也「通过」。
  const fightStart = html.indexOf('<div class="screen" id="s-fight">');
  const fightScreenHtml = html.slice(fightStart,
    html.indexOf('<div class="screen"', fightStart + 10));
  assert.match(fightScreenHtml, /<div class="foeAtk" id="fFoeAtk" hidden><\/div>/,
    '蓄力条容器必须落在战斗页 #s-fight 内');
  // 旧的敌人头像节点不许被改动：形状与特效归既有样式表所有。
  assert.match(fightScreenHtml, /<div class="avatar" id="fAv">/,
    '敌人头像节点的结构必须保持原样（放大只走 inline style）');
  assert.doesNotMatch(html, /id="s-learning-complete">[\s\S]*?(解锁下一单元|下一单元已)/,
    '检查点屏不许承诺解锁下一单元');
});

test('monster artwork is pixel art and rejects injected names', async () => {
  const { pixelMonsterSVG } = await import('../../src/ui/components/pixel-art.js');
  // ★ 这一条原本断言「与旧版手绘 SVG 逐字节相同」——那是模块化重构期的基线契约。
  //   2026-10-02 用户明确要求把怪物改成像素风，所以基线本身变了：现在钉的是
  //   像素精灵的形状契约与**安全契约**，不再是和旧素材的同一性。
  const NAMES = ['词灵','语素蛛','石化词素','歧义章鱼','拼写幽灵','单复数蝎','冰封词灵','词形旋风','词汇之王'];
  for (const n of NAMES) {
    const svg = pixelMonsterSVG({ n }, false, false);
    assert.match(svg, /viewBox="0 0 16 16"/, n + ' 应当是 16×16 像素网格');
    assert.match(svg, /<rect /, n + ' 必须真的画出格子');
    assert.match(svg, /shape-rendering="crispEdges"/, n + ' 必须保持硬边，否则缩放会糊');
    assert.ok(svg.includes(n), n + ' 的可访问名应当带上怪物名');
  }
  // 九个名字必须画出九种不同的精灵 —— 退化成一个默认图就失去分层的意义。
  const shapes = new Set(NAMES.map(n => pixelMonsterSVG({ n }, false, false)));
  assert.equal(shapes.size, NAMES.length, '每种怪物必须有独一无二的精灵');

  // 首领与精英装饰只在对应标记下出现。
  assert.ok(pixelMonsterSVG({ n: '词灵' }, true, false).length
    > pixelMonsterSVG({ n: '词灵' }, false, false).length, '首领要戴王冠');
  assert.match(pixelMonsterSVG({ n: '词灵' }, false, false), /aria-label="词灵"/);
  assert.match(pixelMonsterSVG({ n: '词灵' }, true, false), /aria-label="词灵首领"/);
  assert.match(pixelMonsterSVG({ n: '词灵' }, false, true), /aria-label="词灵精英"/);
});

test('monster artwork never echoes an untrusted name', async () => {
  const { pixelMonsterSVG } = await import('../../src/ui/components/pixel-art.js');
  // 名称只允许取固定表的键；认不出的一律回落默认精灵，**绝不**把输入拼进标记。
  const EVIL = '<img src=x onerror=alert(1)>';
  for (const foe of [{ n: EVIL }, { n: '"><script>alert(1)</script>' }, { n: '' }, {}, null]) {
    const svg = pixelMonsterSVG(foe, true, true);
    assert.doesNotMatch(svg, /<img|onerror|<script|alert\(/, '注入的怪物名不许出现在标记里');
    assert.match(svg, /aria-label="词灵/, '认不出的名字回落成默认精灵');
  }
});
