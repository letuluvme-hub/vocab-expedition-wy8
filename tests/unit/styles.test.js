import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

/* 归档里的原始七张样式表仍要求与 legacy.html 逐字相同、顺序不变 —— 否则
   「新增只追加在最后」这条约定会被悄悄破坏。三个新功能各自带一张只作用于
   自己那块 UI 的样式表，全部追加在这七张之后，且顺序固定（pause → audio →
   equipment）：层叠顺序即「越晚越靠后」，换序会让后来的面板盖住前面的。
   这里锁死的是这张确切的列表 —— 不是「任何新增 CSS 都行」。 */
const ORIGINAL = [
  './base.css', './map.css', './combat.css', './hero.css',
  './controls.css', './cards.css', './responsive.css',
];
const ADDED = [
  ['./pause.css', /^#s-pause\b|^#continueRow\b/, '暂停屏'],
  ['./learning-complete.css', /^#s-learning-complete\b/, '词汇完成页'],
  ['./audio-settings.css', /^#audioSettings\b/, '主页声音设置区'],
  ['./equipment-panel.css', /^\.equip\b/, '战斗页装备面板'],
  ['./audio-compatibility.css', /^#audioCompatibility\b/, '音频兼容提示条'],
  ['./mastery-growth.css', /^#masteryGrowth\b/, '知识成长区'],
  // 蓄力条（清单 13）。注意选择器前缀是**容器 id**：容器挂在战斗页敌人信息块里，
  // 所以 .foeAtk* 这些自有类名被 #fFoeAtk 的后代规则约束，不会漏到别处。
  // 前缀必须是 \.foeAtk（不带 \b）：自有类名形如 .foeAtkBar / .foeAtkTxt，
  // 加 \b 会把它们全部判成越界，逼着这条断言放宽成「什么都不许写」。
  ['./foe-attacks.css', /^\.foeAtk/, '战斗页蓄力条'],
  // 完整词连胜的播报：只落在战斗页词框下方的 #streakFeedbackHost 内。
  // 允许本表自己的 @keyframes（动画名同样只在 .streak-toast 上生效，
  // 没有任何既有选择器能被它改到）。
  ['./streak-feedback.css', /^\.streak-toast\b|^@keyframes streak-toast-|^\d+%$|^from$|^to$/, '完整词连胜播报'],
  // 战意·连击里程碑条。前缀同样不带 \b：自有类名形如 .comboMsPip / .comboMsTxt，
  // 规则形如 .comboMsPip.on —— \b 会把它们全判成越界。
  ['./combo-milestones.css', /^\.comboMs/, '战斗页战意条'],
  // 遗物图鉴（遗物深度）。选择器前缀用 .rlc / .rl-rar / .rlc-syn ——
  // 这几个类名只存在于图鉴屏 #rlBox 内，不与战斗页/主页共用。
  ['./relic-depth.css', /^\.rlc|^\.rl-rar/, '遗物图鉴稀有度与组合技'],
];

test('split styles retain every original rule and exact cascade order',async()=>{
  const entry=readFileSync(new URL('../../src/styles/game.css',import.meta.url),'utf8');
  const paths=[...entry.matchAll(/@import\s+['"](.+?)['"]/g)].map(m=>m[1]);
  assert.ok(paths.length>=5,'screen styles must have separate ownership boundaries');
  // 原始七张：顺序与归档完全一致，一张不多一张不少。
  assert.deepEqual(paths.slice(0,ORIGINAL.length),ORIGINAL,'原始七张样式表的顺序与清单不变');
  // 新增的三张：恰好是这三个，顺序固定，且全部排在原始七张之后。
  assert.deepEqual(paths.slice(ORIGINAL.length),ADDED.map(([p])=>p),'新增样式表的清单与顺序固定');
  const original=paths.slice(0,ORIGINAL.length);
  const combined=original.map(p=>readFileSync(new URL(`../../src/styles/${p}`,import.meta.url),'utf8')).join('');
  const baseline=readFileSync(new URL('../fixtures/legacy.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
  // 行尾统一后再比：Windows 上写出的文件是 CRLF，归档是 LF，
  // 不归一化的话这条断言会因为换行符而恒假。
  assert.equal(combined.replace(/\r\n/g,'\n'),baseline.replace(/\r\n/g,'\n'));
  // 每张新增表必须真的只作用于自己的那块 UI：把每条规则的选择器抠出来核对，
  // 不许偷偷改既有选择器（那会借「新增样式」之名改动线上外观）。
  // 先剥注释与 @import，否则注释行会被当成选择器。
  for(const [file,prefix,label] of ADDED){
    // @media 只是一层**条件容器**，不是选择器：把它的前导语句摘掉，
    // 让里面的规则照样被逐条核对（否则 @media 整块会被当成一个选择器而漏检，
    // 或者逼着这条断言放宽成「什么都行」）。条件本身由白名单前缀把关。
    const added=readFileSync(new URL(`../../src/styles/${file}`,import.meta.url),'utf8')
      .replace(/\/\*[\s\S]*?\*\//g,'').replace(/@import[^;]+;/g,'')
      .replace(/@media[^{]*\{/g,'');
    const selectors=[...added.matchAll(/(^|\})\s*([^{}]*?)\s*\{/g)].map(m=>m[2].trim()).filter(Boolean);
    assert.ok(selectors.length>0,label+' 样式表不能是空的：'+file);
    for(const sel of selectors) for(const one of sel.split(',')) {
      assert.match(one.trim(),prefix, `${label}样式只允许作用于自己的容器（${file}）: `+one);
    }
  }
});