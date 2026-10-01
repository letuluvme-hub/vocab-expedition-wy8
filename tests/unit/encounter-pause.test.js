/* 事件 / 营火 / 商店 / 奖励的**暂停闸门**与**恢复保真**。
 *
 * 这里守的是三条独立的修复，每条都曾经是真 bug：
 *  1) 按钮回调第一行必须问 canAct。以前它们直接调 o.fn()，玩家拿着暂停前的
 *     按钮引用再 dispatchEvent 一次，就能在暂停期间回血、领遗物、扣钱买货。
 *  2) 恢复路径不得重置 _used。否则「已经选过并回过血」的营火，恢复后还能再点一次。
 *  3) 恢复路径的展示字段来自存档（不可信），必须转义后再进 innerHTML；
 *     同时选项 ID 映射失败要**说出来**，而不是静默把玩家丢回地图。
 *
 * 与 controllers.test.js 的区别：那边守「正常流程的数值与顺序」，这里守
 * 「暂停 / 恢复这条非常规路径上的闸门与保真」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncounterController } from '../../src/app/encounters.js';
import { createRun } from '../../src/domain/run.js';
import { encodeSnapshot, decodeSnapshot } from '../../src/domain/run-snapshot.js';

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = []; this.dataset = {}; this.className = ''; this._text = ''; this._html = '';
    this.style = {}; this.hidden = false; this.onclick = null; this.title = '';
  }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  classList = { add() {}, remove() {} };
}
const IDS = ['eIcon', 'eTitle', 'eText', 'ePicks', 'rTitle', 'rSub', 'rPicks', 'pTitle', 'pSub', 'pPicks', 'pSkip'];
function harness({ canAct = () => true, advanceLocked = false, mutate = null } = {}) {
  const ids = new Map(IDS.map(id => [id, new El('div')]));
  const $ = id => ids.get(id) || null;
  ids.set('pSkip', new El('button'));
  const log = [];
  const G = {
    unit: 1, hp: 40, maxhp: 70, gold: 100, relics: [], bag: {}, floor: 1,
    att: 4, attOk: 3, node: { type: 'rest', done: false, links: [] },
  };
  const B = {
    foe: { n: 'slime', ic: '👾', tint: '#fff' }, boss: false, elite: false, enMax: 200,
    myHp: 40, combo: 3, maxCombo: 3, rewardTaken: false, usedThisFight: {},
  };
  const state = { G, B };
  const jobs = [];
  let phase = 'map', desc = null, advances = 0, ends = 0, finishes = 0;
  const ctrl = createEncounterController({
    state,
    ports: {
      $, clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      pick: a => a[0], shuffle: a => a.slice(), rnd: () => 0,
      has: (a, v) => a.indexOf(v) >= 0,
      hasR: () => false,
      goldGain: n => { G.gold += n; return n },
      applyRelicInit: () => log.push(['relicInit']),
      sfx: { relic() {}, coin() {} },
      toast: m => log.push(['toast', m]),
      advance: () => {
        advances++; log.push(['advance']);
        // advanceLocked 模拟 400ms 双击去重窗口：advance 不改相位（真实 runtime 的 'locked'）。
        if (advanceLocked) return;
        phase = 'map';
      },
      endRun: () => { ends++; log.push(['endRun']) },
      finishNode: () => { finishes++; log.push(['finishNode']) },
      show: id => log.push(['show', id]),
      scheduleRun: (fn, ms) => jobs.push({ fn, ms, run: true }),
      scheduleBattle: (fn, ms) => jobs.push({ fn, ms, run: false }),
      publishEncounter: d => { desc = d; log.push(['publish', d && d.chosenId || null]) },
      setPhase: p => { phase = p; log.push(['phase', p]) },
      canAct,
      // 事务包装：缺失时控制器必须自己回落成「直接调用」。
      mutate: mutate || undefined,
      makeButton: tag => new El(tag || 'button'),
    },
  });
  return { ctrl, G, B, ids, log, jobs, ids$ : $,
    phase: () => phase, desc: () => desc, advances: () => advances,
    ends: () => ends, finishes: () => finishes,
    runJobs: () => jobs.filter(j => j.run) };
}

/* ---------------- 1. 闸门：暂停期间旧按钮也不许生效 ---------------- */

test('暂停期间事件选项：旧按钮再点一次不改任何状态', () => {
  let allowed = true;
  const h = harness({ canAct: () => allowed });
  h.ctrl.showEvent();
  const before = JSON.stringify({ hp: h.G.hp, gold: h.G.gold, relics: h.G.relics });
  const btn = h.ids.get('ePicks').children[0];

  allowed = false;                       // 暂停中
  btn.onclick();
  assert.equal(JSON.stringify({ hp: h.G.hp, gold: h.G.gold, relics: h.G.relics }), before,
    '暂停期间点事件选项不许回血、不许给金币、不许给遗物');
  assert.equal(h.ends(), 0);

  allowed = true;
  btn.onclick();                         // 继续后同一个按钮恢复正常
  assert.notEqual(JSON.stringify({ hp: h.G.hp, gold: h.G.gold, relics: h.G.relics }), before,
    '继续后同一个按钮必须照常生效');
});

test('暂停期间营火/商店/奖励的按钮同样被挡住', () => {
  let allowed = true;
  const h = harness({ canAct: () => allowed });
  h.ctrl.showRest();
  h.ctrl.showShop();
  h.ctrl.showBattleRewards(30, null);

  const goldBefore = h.G.gold;
  const healBefore = h.G.hp;
  allowed = false;
  for (const box of ['rPicks', 'pPicks']) {
    for (const c of h.ids.get(box).children) c.onclick();
  }
  h.ids.get('pSkip').onclick();
  assert.equal(h.G.gold, goldBefore, '商店购买不许扣钱');
  assert.equal(h.G.hp, healBefore, '奖励回血不许生效');
  assert.equal(h.finishes(), 0, '不许借暂停推进层数');
});

/* ---------------- 2. 恢复保真：_used 不许被重置 ---------------- */

test('恢复一个「已选过」的营火：卡还在，但不能再点第二次', () => {
  const h = harness();
  h.G.hp = 30;
  h.ctrl.showRest();
  const healed = (() => { h.ids.get('rPicks').children[0].onclick(); return h.G.hp })();
  assert.ok(healed > 30, '第一次点确实回血了');

  // 恢复路径：描述里带着 chosenId（快照就是这样存的）
  const desc = { kind: 'rest', chosenId: 'rest:heal', node: h.G.node,
    options: [{ id: 'rest:heal', cat: 'heal', ic: '💚', t: '休息', d: '回复 12 点生命' }] };
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  const hpBefore = h.G.hp;
  h.ids.get('rPicks').children[0].onclick();
  assert.equal(h.G.hp, hpBefore, '已选过的营火不许再回一次血');
  assert.equal(h.advances(), 0, '恢复后的第二次点击不许再排一次推进');
  assert.equal(h.runJobs().length, 1, '只有第一次选择排的那一个推进待办');
});

test('恢复商店：仍可重复购买（chosenId 不该把它锁死）', () => {
  const h = harness();
  h.G.gold = 200;
  h.ctrl.showShop();
  const desc = { kind: 'shop', gold: 200, node: h.G.node,
    options: [{ id: 'shop:potion', cat: 'heal', ic: '💚', t: '疗伤药剂 · 45 金币', d: '回复 35 点生命' },
      { id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买', leave: true }] };
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  const hpBefore = h.G.hp;
  const btn = h.ids.get('rPicks').children[0];
  btn._at = 0;                              // 绕过 260ms 手滑冷却
  btn.onclick();
  assert.ok(h.G.hp > hpBefore, '刷新后仍可正常购买');
  assert.equal(h.G.gold, 155);
});

test('恢复事件：标题、正文与全部卡片都保留，且可选择', () => {
  const h = harness();
  const desc = { kind: 'event', title: '神秘的背包', icon: '🎁', text: '你捡到一个鼓鼓的背包。',
    node: h.G.node, options: [
      { id: 'pack:open', cat: 'relic', ic: '💎', t: '打开看看', d: '随机获得一个遗物' },
      { id: 'pack:leave', cat: 'none', ic: '🚶', t: '不关我事', d: '离开，什么也不发生' }] };
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  assert.equal(h.ids.get('eTitle').textContent, '神秘的背包');
  assert.equal(h.ids.get('eText').textContent, '你捡到一个鼓鼓的背包。');
  assert.equal(h.ids.get('ePicks').children.length, 2, '两张卡都必须回来');
  assert.equal(h.ids.get('ePicks').children[1].dataset.opt, 'pack:leave', '顺序与 id 都不变');
});

/* ---------------- 3. 恢复路径的展示字段是不可信输入 ---------------- */

test('恢复路径转义存档里的展示字段：标签不会变成真 DOM', () => {
  const h = harness();
  const evil = '<img src=x onerror=alert(1)>';
  const desc = { kind: 'rest', node: h.G.node,
    options: [{ id: 'rest:heal', cat: 'heal', ic: evil, t: evil, d: evil }] };
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  const card = h.ids.get('rPicks').children[0];
  assert.ok(!card.innerHTML.includes('<img'), '快照里的标签必须被转义，不能变成真元素');
  assert.ok(card.innerHTML.includes('&lt;img'), '但展示给玩家的文字仍是它本身');
});

test('选项 ID 映射不上：明说，不静默把玩家丢回地图', () => {
  const h = harness();
  const desc = { kind: 'rest', node: h.G.node, options: [{ id: 'rest:不存在', cat: 'heal', ic: '💚', t: 'x', d: 'y' }] };
  assert.equal(h.ctrl.reopenEncounter(desc), false);
  assert.equal(h.log.some(e => e[0] === 'toast' && /无法恢复/.test(e[1])), true,
    '必须告诉玩家发生了什么，而不是一声不响');
});

test('部分选项映射不上：仍然画出能用的卡，并说明跳过了几张', () => {
  const h = harness();
  const desc = { kind: 'rest', node: h.G.node, options: [
    { id: 'rest:heal', cat: 'heal', ic: '💚', t: '休息', d: '回复 12 点生命' },
    { id: 'rest:未来选项', cat: 'relic', ic: '💎', t: 'x', d: 'y' }] };
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  assert.equal(h.ids.get('rPicks').children.length, 1);
  assert.equal(h.log.some(e => e[0] === 'toast' && /跳过/.test(e[1])), true);
});

/* ---------------- 4. roll 与 show 分离：900ms 延迟里不重新 roll ---------------- */

test('rollBattleRewards 只随机一次，且立刻把检查点发布成快照', () => {
  const h = harness();
  h.G.relics = ['shield', 'battery', 'focus', 'scholar'];
  const rolled = h.ctrl.rollBattleRewards(42, null);
  const ids = rolled.opts.map(o => o.id);
  assert.ok(ids.length > 0);
  // ★ roll 完就必须发布：胜利到展示之间有 900ms，玩家完全可能在这段空窗里暂停
  //   或杀掉页面。没有这份描述，reward 相位的快照会因「缺 encounter」被判损坏。
  assert.notEqual(h.desc(), null, 'roll 完必须立刻发布检查点');
  assert.equal(h.desc().options.map(o => o.id).join('|'), ids.join('|'));
  assert.equal(h.desc().gold, 42);
  assert.equal(h.phase(), 'reward');

  // show 只是把这同一批卡画出来：不引入第二次随机
  assert.equal(h.ctrl.showRolledRewards(rolled), true);
  assert.equal(h.ids.get('pPicks').children.map(c => c.dataset.opt).join('|'), ids.join('|'));
  assert.equal(h.desc().options.map(o => o.id).join('|'), ids.join('|'),
    '发布的快照描述始终就是这批卡');
  assert.equal(h.desc().gold, 42);
});

test('已领过奖的战斗不允许再次展开（rewardTaken 闸门在恢复路径上同样有效）', () => {
  const h = harness();
  const rolled = h.ctrl.rollBattleRewards(10, null);
  assert.equal(h.ctrl.showRolledRewards(rolled), true);
  h.B.rewardTaken = true;
  assert.equal(h.ctrl.showRolledRewards(rolled), false, '同一场战斗的奖励只能领一次');
});

test('canAct 缺省时放行（老测试台没有闸门概念，行为不变）', () => {
  const h = harness();                      // canAct 未注入
  h.ctrl.showRest();
  const before = h.G.hp;
  h.ids.get('rPicks').children[0].onclick();
  assert.ok(h.G.hp > before, '没有注入 canAct 时照常可玩');
});

/* ---------------- 5. 商店「离开」也必须是一个可持久化的检查点 ----------------
 * 旧实现里 leave 分支只做 setPhase(ENCOUNTER_DONE) + advance()，**从不**发布
 * chosenId。于是：advance 被 400ms 双击窗口挡回 'locked'（快速 advance→shop→leave
 * 就是这个时序）时，相位停在 encounter-done 而描述里没有 chosenId ——
 * codec 的 needChoice 判据会把这份快照判为 invalid，玩家刷新后这一局直接没了。 */

const shopLeave = h => h.ids.get('rPicks').children.find(c => c.dataset.opt === 'shop:leave');

test('商店离开：先发布 chosenId，再切 encounter-done 相位', () => {
  const h = harness();
  h.G.gold = 200;
  h.ctrl.showShop();
  h.log.length = 0;
  shopLeave(h).onclick();
  const pub = h.log.findIndex(e => e[0] === 'publish');
  const ph = h.log.findIndex(e => e[0] === 'phase' && e[1] === 'encounter-done');
  assert.ok(pub >= 0, '离开商店必须发布一次检查点');
  assert.ok(ph >= 0, '离开商店必须切到 encounter-done');
  assert.ok(pub < ph, 'chosenId 必须在切相位**之前**发布：否则中途快照是非法的');
  assert.equal(h.desc().chosenId, 'shop:leave');
});

test('advance 被 400ms 窗口挡住时，离开商店留下的快照仍然合法可恢复', () => {
  const h = harness({ advanceLocked: true });   // advance 返回 'locked'，相位不动
  h.G.gold = 200;
  h.ctrl.showShop();
  shopLeave(h).onclick();
  assert.equal(h.advances(), 1);
  assert.equal(h.phase(), 'encounter-done', 'locked 时相位仍停在 encounter-done');
  assert.equal(h.desc().chosenId, 'shop:leave', '描述里必须带 chosenId');

  // 真编解码：这份描述必须解得开，否则玩家刷新后进不去这一局
  const run = createRun(1, { id: 'scholar', mod: {} }, [{ w: 'litre', u: 1, d: 1, z: '升' }]);
  run.node = run.rows[0][0];
  const env = encodeSnapshot({ phase: 'encounter-done', run, battle: null, encounter: h.desc() });
  const out = decodeSnapshot(JSON.parse(JSON.stringify(env)));
  assert.equal(out.ok, true, 'encounter-done 相位缺 chosenId 会被判损坏：' + out.reason);
  assert.equal(out.value.encounter.chosenId, 'shop:leave');
});

test('恢复出来的商店再点「离开」：也发布 chosenId，且只推进一次', () => {
  const h = harness();
  h.G.gold = 200;
  h.ctrl.showShop();
  const desc = h.desc();
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  h.log.length = 0;
  shopLeave(h).onclick();
  assert.equal(h.desc().chosenId, 'shop:leave', '恢复路径的离开也必须有检查点');
  assert.equal(h.advances(), 1, '离开只推进一次');
});

/* ---------------- 6. 事件/商店/奖励的按钮副作用必须在同一事务里提交 ----------------
 * 旧实现里按钮回调直接调 o.fn()：runtime 的 mutate 事务完全看不到它，
 * 于是「买药扣钱」「领遗物」这类副作用只改了内存、从不落盘。 */

test('mutate 缺省时按钮仍能生效（Node 测试台没有事务包装）', () => {
  const h = harness();
  h.G.gold = 200;
  h.ctrl.showShop();
  const potion = h.ids.get('rPicks').children.find(c => c.dataset.opt === 'shop:potion');
  potion._at = 0;
  potion.onclick();
  assert.equal(h.G.gold, 155, '没有注入 mutate 时行为不变');
});

for (const [label, setup, pick, expectFn] of [
  ['商店购买', 'showShop', 'shop:potion', h => assert.equal(h.G.gold, 155)],
  ['营火选择', 'showRest', null, h => assert.ok(h.G.hp > 20)],
]) {
  test(`${label}：按钮回调跑在 mutate 事务里（提交点在副作用之后）`, () => {
    const seen = [];
    let inside = 0;
    const h = harness({ mutate: fn => { inside++; const out = fn(); seen.push(JSON.stringify({ hp: h.G.hp, gold: h.G.gold })); return out } });
    h.G.hp = 40;
    h.G.gold = 200;
    if (label === '营火选择') h.G.hp = 20;
    h.ctrl[setup]();
    const btn = pick
      ? h.ids.get('rPicks').children.find(c => c.dataset.opt === pick)
      : h.ids.get('rPicks').children[0];
    btn._at = 0;
    btn.onclick();
    assert.ok(inside > 0, `${label} 必须经过 ports.mutate 事务`);
    expectFn(h);
    assert.equal(seen.length, inside, '每次事务都要在副作用落地后收尾一次');
  });
}

test('奖励卡领取同样在事务里：结算与快照由同一次提交收尾', () => {
  let inside = 0;
  const h = harness({ mutate: fn => { inside++; return fn() } });
  h.ctrl.showBattleRewards(30, null);
  h.ids.get('pPicks').children[0].onclick();
  assert.ok(inside > 0, '领奖必须经过事务包装');
  assert.equal(h.finishes(), 1);
});

/* ---------------- 7. 恢复文本不得重复转义 ----------------
 * 旧实现把 esc() 后的字符串**写回** opts，再由 publish() 把这份已转义的描述
 * 存进快照。于是 reopen → publish → reopen 会把 & 再转义一次，界面上出现
 * 「&amp;lt;」这种实体堆叠，存档里的原文也被污染。 */

test('reopen 两次：卡面文本不被二次转义，存档描述仍是原文', () => {
  const h = harness();
  const raw = 'A & B <b>x</b>';
  const desc = { kind: 'rest', node: h.G.node,
    options: [{ id: 'rest:heal', cat: 'heal', ic: '💚', t: raw, d: '回复 12 点生命' }] };
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  const first = h.ids.get('rPicks').children[0].innerHTML;
  assert.ok(first.includes('&amp;') && first.includes('&lt;b&gt;'),
    '渲染层必须转义，但只转义一次：' + first);
  assert.equal(h.desc().options[0].t, raw, '★ 发布/存档的必须是原文，不能是转义后的串');

  // 再恢复一次（这正是「刷新两次」的路径）
  assert.equal(h.ctrl.reopenEncounter(h.desc()), true);
  const second = h.ids.get('rPicks').children[0].innerHTML;
  assert.equal(second, first, '第二次恢复的卡面必须与第一次逐字相同（无 &amp;amp; 叠加）');
  assert.equal(h.desc().options[0].t, raw);
});

test('恢复路径：快照里的标签仍然不会变成真 DOM（与 3 号用例互补）', () => {
  const h = harness();
  const evil = '<img src=x onerror=alert(1)>';
  const desc = { kind: 'rest', node: h.G.node,
    options: [{ id: 'rest:heal', cat: 'heal', ic: evil, t: evil, d: evil }] };
  assert.equal(h.ctrl.reopenEncounter(desc), true);
  const card = h.ids.get('rPicks').children[0];
  assert.ok(!card.innerHTML.includes('<img'), '快照里的标签必须被转义，不能变成真元素');
  // 原文仍可再次安全渲染
  assert.equal(h.desc().options[0].t, evil);
});
