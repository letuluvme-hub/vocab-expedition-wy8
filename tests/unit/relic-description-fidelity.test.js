/* C5：遗物「描述」必须与「实现」对得上。
 *
 * 背景（docs/optimization-plan-2026-10.md 的 C5）：这是一个**照着描述做构筑决策**
 * 的 roguelite，所以
 *   · 描述没写的效果 = 玩家评估不了这件遗物（永动电池 / 学者之书 / 专注头环都中过）
 *   · 描述夸大的效果 = 玩家按错误预期选它（学者之书写「额外获得 1 张先知卡」，
 *     实际是 1/3 概率）
 *
 * 为什么这条测试长这样：通用地断言「描述里每个数字都能在代码里找到」是做不到的
 * （描述是自然语言，代码是分支）。所以这里退一步，为**每一处已知的不一致**写一条
 * 具名断言 —— 锁住"描述里提到了这个效果"，而不是锁死描述的措辞。
 *
 * ★ 关键约束：**纯文案**。这个文件一行实现代码都不许改。
 *   若哪天改成「删掉隐藏效果」而不是「补描述」，那三条实现就都得删，
 *   并且这里要改成断言"效果已不存在"——那是另一个决定，不该被这条测试悄悄放过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { RELICS } from '../../src/data/relics.js';
import { relicById } from '../../src/data/lookup.js';

const d = id => relicById(id).d;

/* ---------- 永动电池：每通过一层 +8，且每完成 3 个词 +3 ---------- */

test('永动电池：描述同时写出「每层 +8」与「每 3 词 +3」', () => {
  const text = d('battery');
  assert.match(text, /每通过一层回复 8 点生命/, '层推进的 +8 是描述里原本就有的');
  assert.match(text, /3 个/, '必须提到「每 3 个词」这一档（combat.js 的 wordsDone % 3）');
  assert.match(text, /3 点/, '必须写清这一档回的是 3 点');
});

test('永动电池：两档效果都真的存在（描述不是凭空写的）', () => {
  // ★ 每层 +8 有**两处**实现（层推进是两条路径：新开一段地图与跨段继续）。
  //   断言要盖住两处，只查一处等于给"另一处被删了"留了个洞。
  //   runtime.js:528 用 has(...)、run.js:159 用 indexOf(...)，写法不同所以要分别匹配。
  const runtime = readFileSync(new URL('../../src/app/runtime.js', import.meta.url), 'utf8');
  const run = readFileSync(new URL('../../src/domain/run.js', import.meta.url), 'utf8');
  const combat = readFileSync(new URL('../../src/app/combat.js', import.meta.url), 'utf8');
  assert.match(runtime, /has\(G\.relics,'battery'\)\)\s*G\.hp=Math\.min\(G\.maxhp,G\.hp\+8\)/,
    '每层 +8 的实现（runtime.js 层推进）必须还在');
  assert.match(run, /run\.relics\.indexOf\('battery'\)\s*>=\s*0\)\s*run\.hp\s*=\s*Math\.min\(run\.maxhp,\s*run\.hp\s*\+\s*8\)/,
    '每层 +8 的实现（run.js 跨段继续）必须还在');
  assert.match(combat, /hasR\('battery'\)\s*&&\s*B\.wordsDone\s*%\s*3\s*===\s*0/,
    '每 3 词 +3 的实现（combat.js）必须还在');
});

/* ---------- 学者之书：先知卡是 1/3 概率，且另有揭示首字母 ---------- */

test('学者之书：描述不再把先知卡说成「额外获得」（那是夸大）', () => {
  const text = d('scholar');
  // 曾经的措辞是「战斗胜利额外获得 1 张「先知卡」」—— 读起来像每场必得。
  assert.doesNotMatch(text, /^战斗胜利额外获得/,
    '不能再用「额外获得」这种每场必得的措辞');
  assert.match(text, /有机会/,
    '必须如实说明是概率触发（encounters.js 里是 rnd(3) === 0）');
});

test('学者之书：描述提到「第一个词后揭示首字母」这个隐藏效果', () => {
  const text = d('scholar');
  assert.match(text, /第一个词/);
  assert.match(text, /首字母/);
});

test('学者之书：概率与揭示首字母两处实现都真的还在', () => {
  const encounters = readFileSync(new URL('../../src/app/encounters.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../../src/app/runtime.js', import.meta.url), 'utf8');
  assert.match(encounters, /hasR\('scholar'\)[\s\S]{0,160}rnd\(3\)\s*===\s*0/,
    '先知卡的 1/3 概率实现必须还在 —— 若改成必得，这条要改成断言 rnd 不存在');
  assert.match(runtime, /hasR\('scholar'\)\s*&&\s*B\.wordsDone\s*===\s*1/,
    '第一个词后揭示首字母的实现必须还在');
});

/* ---------- 专注头环：保留一半连击，且每 6 连击 +5% ---------- */

test('专注头环：描述同时写出「保留一半」与「每 6 连击 +5%」', () => {
  const text = d('focus');
  assert.match(text, /保留一半/, '连击保留是描述里原本就有的');
  assert.match(text, /6 连击/, '必须提到「每 6 连击」这一档（combat.js 的 combo % 6）');
  assert.match(text, /\+5%/, '必须写清这一档是 +5% 增伤');
});

test('专注头环：+5% 增伤是单件效果，不是「连击共鸣」组合技', () => {
  // 连击共鸣（连击徽章 + 专注头环）走 relic-rules.js 的 synergyBonuses，是另一条实现。
  // 如果哪天有人把 combo % 6 这行挪进 synergyBonuses，这条会红 —— 那时要重新描述。
  const combat = readFileSync(new URL('../../src/app/combat.js', import.meta.url), 'utf8');
  assert.match(combat, /hasR\('focus'\)\s*&&\s*B\.combo\s*>\s*0\s*&&\s*B\.combo\s*%\s*6\s*===\s*0\s*\)\s*B\.dmgBonus\s*\+=\s*5/,
    '每 6 连击 +5 增伤必须仍是 combat.js 里的**单件**实现');
});

/* ---------- 通用：每件遗物都有描述，且描述不是占位符 ---------- */

test('每件遗物都有非空描述，且没有未替换的模板占位', () => {
  for (const r of RELICS) {
    assert.equal(typeof r.d, 'string', r.id + ' 缺描述');
    assert.ok(r.d.length > 4, r.id + ' 的描述过短：' + r.d);
    assert.doesNotMatch(r.d, /\{|\}|undefined|TODO/, r.id + ' 的描述里有未替换的占位符');
  }
});
