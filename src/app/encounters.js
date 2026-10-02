/* 事件 / 营火 / 商店 / 战斗奖励协调器。
 *
 * 与 combat 同样的规矩：只搬流程、不改文案与数值、不改结算顺序；
 * 事件表搬进工厂内部，动作一律读 live state（不缓存 G/B 引用）。
 *
 * 迁移期新增的两道闸门（原版没有，属于修复）：
 *   1) b.rewardTaken —— 战斗奖励只能领一次。此前玩家可以连点三张卡，
 *      一次性把回血 + 遗物 + 道具全拿走（金币/遗物是直接改 G 的，重复领＝白嫖）。
 *   2) run/battle 捕获 —— 事件、营火、商店、奖励面板的按钮回调都记住打开时的
 *      远征与战斗实例；一旦玩家清档/重开/进入下一场，旧按钮的迟到回调直接丢弃。
 *      原版只靠 advance() 的 400ms 时间窗，挡不住已经排进 900/1100ms 队列的回调。
 *   3) canAct —— 每个按钮回调第一行都问一次「现在允许改状态吗」。
 *      暂停屏是一整屏、看起来点不到这些按钮，但玩家完全可以拿着一个**旧的**按钮
 *      引用（暂停前点过、或恢复后 DOM 还在）再 dispatchEvent。之前这些路径直接调
 *      o.fn()，完全绕过了 progress 的闸门 —— 暂停期间点事件选项照样回血、照样领遗物。
 */
import { RELICS } from '../data/relics.js';
import { ITEMS } from '../data/items.js';
import { LEGACY_RELIC_SHOP_PRICE, WHET_MAX_PER_RUN } from '../data/balance.js';
import { relicPrice, relicRarityLabel, pickRelicWeighted, sampleRelicsWeighted,
  activeSynergies } from '../domain/relic-rules.js';
import { pickCardHTML, CAT_LABEL } from '../ui/components/pick-card.js';

export function createEncounterController({ state, ports }) {
  const { $, clamp, pick, shuffle, rnd, has, hasR, goldGain, applyRelicInit, sfx, toast,
    advance, endRun, finishNode, show, scheduleRun, scheduleBattle } = ports;
  // 造按钮的入口：Node 测试没有全局 document，所以走 ports 注入；浏览器里退回 document。
  const makeButton = ports.makeButton || (() => document.createElement('button'));
  // 暂停/恢复接线：把「当前展开的界面」交给 runtime 存进快照。
  const publishEncounter = ports.publishEncounter || null;
  const setPhase = ports.setPhase || null;
  const PHASE_ENCOUNTER = 'encounter', PHASE_ENCOUNTER_DONE = 'encounter-done', PHASE_REWARD = 'reward';
  // 唯一的暂停判据来源。单元测试台不注入时默认放行（老测试没有闸门概念）。
  const canAct = ports.canAct || (() => true);
  /* 受闸门动作的事务边界。runtime 的 mutate 负责「副作用跑完 → 提交一次」，
     这里所有会改状态的按钮回调都必须经过它 —— 否则买药扣钱、领遗物、选营火
     这些副作用只改了内存、从不落盘。Node 测试台不注入时回落成直接调用。 */
  const mutate = ports.mutate || (fn => fn());

  /* 遗物候选池：排除已持有的那几件。
     抽取一律走 relic-rules 的**稀有度加权**（common 62 / rare 30 / legendary 8），
     均匀洗牌会让传说和「+2 次提示」一样常见，档位就只剩一个价格标签。
     rnd 走端口注入：真实运行时用 Math.random，单测才能固定结果。 */
  const relicRnd = ports.relicRnd || Math.random;
  const ownedRelics = G => RELICS.filter(r => !has(G.relics, r.id));
  /* 抽取口。默认按稀有度加权；单测可以用 relicDraw 端口指名要哪一件
     （加权之后「这局一定出某件遗物」本来就不可能断言）。 */
  const drawRelic = ports.relicDraw || (pool => pickRelicWeighted(pool, relicRnd));

  /* 磨砺石（生命上限 +10 并回满）的**唯一**结算入口。商店实时屏与暂停恢复屏
     共用它 —— 两份实现一旦漂移，恢复后就会出现「同一个按钮两套限购」。
     限购计数挂在 run 上（run.whetBuys），跟着快照走：只活在内存里的话，
     「暂停 → 刷新 → 继续」就能把这轮买满之后重新变回 0 次。 */
  function buyWhetstone() {
    const S = state.G;
    const used = S.whetBuys | 0;
    if (used >= WHET_MAX_PER_RUN) {
      return '磨砺石本轮已经买过 ' + WHET_MAX_PER_RUN + ' 次了 —— 一块石头磨不出第二把刀。';
    }
    if (S.gold < 70) return '金币不够。';            // 买不成就不扣钱、不加上限
    S.gold -= 70; S.maxhp += 10; S.hp = S.maxhp; S.whetBuys = used + 1;
    return '你更强了。';
  }

  /* 商店的遗物卡。**价格是卡面的一部分**：卡上写多少就扣多少，两者同源。
     id 里带上价格（shop:relic:<id>:<price>）是为了让暂停恢复对得上号 ——
     恢复路径靠 optionById 用 id 找回动作，id 不含价格时，一次跨版本刷新
     （卡面还是旧价、代码已经是新价）就会对玩家凭空涨价。 */
  function shopRelicOption(r, price) {
    return {
      id: 'shop:relic:' + r.id + ':' + price, cat: 'relic', ic: r.ic,
      t: r.n + ' · ' + price + ' 金币',
      d: relicRarityLabel(r) + ' · ' + r.d,
      fn: () => {
        const S = state.G;
        if (S.gold < price) return '金币不够。';
        S.gold -= price; S.relics.push(r.id); sfx.relic(); applyRelicInit();
        return '你买下了 ' + r.n + '！';
      },
    };
  }
  /* 加稀有度之前的旧卡：id 不带价格、标价固定 80。旧快照里存的就是这个 id，
     恢复时必须仍能映射回来 —— 并且按它**当时显示的** 80 收费。 */
  function legacyShopRelicOption(r) {
    return Object.assign({}, shopRelicOption(r, LEGACY_RELIC_SHOP_PRICE), {
      id: 'shop:relic:' + r.id,
      t: r.n + ' · ' + LEGACY_RELIC_SHOP_PRICE + ' 金币',
    });
  }

  // 当前已展开的描述：只存 id 与展示字段，绝不存闭包或 DOM。
  let currentDesc = null;
  function current() { return currentDesc; }
  function publish(desc) { currentDesc = desc; if (publishEncounter) publishEncounter(desc); }

  /* ================= 恢复路径的展示字段 =================
     快照里的 ic/t/d/tip 来自**存档**，属于不可信输入：直接塞进 innerHTML 就是注入面。
     但展示又必须与玩家暂停前看到的一致（同一批卡、同一句描述）。
     做法：只在恢复路径上把这些字段转义后再交给 pickCardHTML，
     普通新开的事件/商店/奖励路径保持原样（老模板一个字都不动）。 */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ================= 事件 =================
     搬进工厂：选项动作读 live state，返回一句结果文案。
     保留原版逐字文案与数值（含赌局 / 迷路的词灵里那些手写的 return 串）。 */
  const EVENTS = [
    { ic: '🎁', t: '神秘的背包', x: '你捡到一个鼓鼓的背包，主人却不见了。', o: [
      { id: 'pack:open', cat: 'relic', ic: '💎', t: '打开看看', d: '随机获得一个遗物（越稀有越少见）', fn: () => {
        const G = state.G;
        const av = ownedRelics(G);
        if (av.length) {
          const r = drawRelic(av);
          G.relics.push(r.id);
          applyRelicInit();
          sfx.relic();
          return '你找到了 ' + r.ic + ' ' + r.n + '！';
        }
        G.gold = goldGain(40);
        return '包里只有 40 金币，但聊胜于无。';
      } },
      { id: 'pack:leave', cat: 'none', ic: '🚶', t: '不关我事', d: '离开，什么也不发生', fn: () => '你背起包继续赶路。' }
    ] },
    { ic: '⛲', t: '神秘泉水', x: '一股清泉从石缝涌出，水面泛着微微的光。', o: [
      { id: 'spring:drink', cat: 'heal', ic: '💚', t: '喝一口', d: '回复 25 点生命', fn: () => {
        const G = state.G; G.hp = Math.min(G.maxhp, G.hp + 25); return '伤口愈合了。';
      } },
      { id: 'spring:flask', cat: 'boost', ic: '🔮', t: '灌满水壶', d: '获得 2 次免费提示（下一场战斗）', fn: () => {
        const G = state.G; G.nextHint = (G.nextHint || 0) + 2; return '水壶泛着微光，下场战斗会帮你。';
      } },
      { id: 'spring:bottle', cat: 'heal', ic: '🥾', t: '装进瓶子带走', d: '回复 10 点生命', fn: () => {
        const G = state.G; G.hp = Math.min(G.maxhp, G.hp + 10); return '你还是带了点水。';
      } }
    ] },
    { ic: '⚔️', t: '老兵的剑', x: '一位老兵递给你一把剑：「会用吗？」', o: [
      { id: 'sword:learn', cat: 'relic', ic: '🔥', t: '学以致用', d: '获得「连击徽章」，连击加成翻倍', fn: () => {
        state.G.relics.push('combo'); sfx.relic(); return '你的连击从此更锋利。';
      } },
      { id: 'sword:sell', cat: 'event', ic: '💰', t: '卖掉换钱', d: '获得 60 金币', fn: () => {
        const G = state.G; G.gold = goldGain(60); return '你换到了 60 金币。';
      } }
    ] },
    { ic: '📚', t: '遗忘之书', x: '一本书在你面前打开，书页上全是单词，却一个都读不懂。', o: [
      { id: 'book:study', cat: 'relic', ic: '🧠', t: '认真研读', d: '当前战斗下次的拼写正确率提升：回复 20 生命并获得遗物', fn: () => {
        const G = state.G;
        G.hp = Math.min(G.maxhp, G.hp + 20);
        const av = ownedRelics(G);
        if (av.length) {
          const r = drawRelic(av);
          G.relics.push(r.id);
          sfx.relic();
          applyRelicInit();
          return '你读懂了 ' + r.n + ' 的含义。';
        }
        return '你读懂了更多，知识就是力量。';
      } },
      { id: 'book:rest', cat: 'heal', ic: '😴', t: '合上书休息', d: '回复 15 点生命', fn: () => {
        const G = state.G; G.hp = Math.min(G.maxhp, G.hp + 15); return '小憩片刻。';
      } }
    ] },
    { ic: '🎲', t: '命运的赌局', x: '一个蒙面人推来一枚硬币：「猜正反，赢了钱翻倍，输了归我。」', o: [
      { id: 'gamble:bet', cat: 'event', ic: '🪙', t: '押上 40 金币', d: '一半概率翻倍，一半概率全失', fn: () => {
        const S = state.G;
        // ★ 卡面写的是「押上 40 金币」，结算就必须只赌这 40。
        //   原实现先白送 40（goldGain(40)），再把**整个钱袋**翻倍或清零，
        //   并且把翻倍后的总额当成「你获得的」写进文案 —— 玩家押 40，
        //   实际赌的是全部家当，而界面说的是另一回事。
        //   现在：赌注不足不能押；赢 = 这 40 翻倍（净得 40，贪婪之眼照常加成）；
        //   输 = 少掉这 40。文案只报这一局的输赢。
        if (S.gold < 40) return '你连押上的 40 金币都凑不出来。';
        if (Math.random() < .5) {
          const before = S.gold;
          goldGain(40);                        // 加钱与贪婪之眼加成都走同一入口
          return '硬币停在正面！你赢得 ' + (S.gold - before) + ' 金币。';
        }
        S.gold -= 40;
        return '反面。你输掉 40 金币。';
      } },
      { id: 'gamble:skip', cat: 'none', ic: '✋', t: '不赌了', d: '安全离开', fn: () => '你明智地走开了。' }
    ] },
    { ic: '👺', t: '迷路的词灵', x: '一个小词灵缩在墙角，看起来迷路了。', o: [
      { id: 'wisp:candy', cat: 'heal', ic: '🍬', t: '给它一颗糖', d: '花费 20 金币，获得 12 点生命', fn: () => {
        const G = state.G;
        if (G.gold < 20) return '你金币不够。';
        G.gold -= 20; G.hp = Math.min(G.maxhp, G.hp + 12);
        return '它带你找到了一条捷径，你感觉好多了。';
      } },
      { id: 'wisp:teach', cat: 'event', ic: '📖', t: '教它拼写', d: '获得 30 金币的「学费」', fn: () => {
        const G = state.G;
        const g = goldGain(30);
        return '它学会了，血量 +5。'.replace('血量 +5', '') + ' 你获得了 ' + g + ' 金币。';
      } }
    ] }
  ];

  /* 卡片按钮的统一构造：结构化 cat 徽标 + 标题/描述分层，原样沿用旧版 innerHTML。
     每张卡同时带一个**稳定 id**（选项在本次展开中的唯一标识），
     暂停快照靠它记录「已展开哪些卡 / 玩家选了哪张」，
     刷新后据此重建同一屏，而不是重新 roll 一批新卡。 */
  function cardButton(o, opt) {
    const b = makeButton('button');
    b.className = 'pick';
    b.dataset.cat = CAT_LABEL[o.cat] ? o.cat : 'none';   // 供 CSS 上色与测试断言
    b.dataset.opt = o.id || '';
    // ★ 转义只发生在**渲染边界**（这里），opts 本身永远保持原文。
    //   旧实现在 reopenEncounter 里把 esc() 后的串写回 opts，再由 publish() 存进快照，
    //   于是 reopen → publish → reopen 会把 & 再转义一次，界面上出现「&amp;lt;」实体堆叠，
    //   存档里的原文也被污染。untrusted 只由恢复路径传。
    const view = (opt && opt.untrusted)
      ? { cat: o.cat, ic: esc(o.ic), t: esc(o.t), d: esc(o.d), tip: o.tip ? esc(o.tip) : o.tip }
      : o;
    b.innerHTML = pickCardHTML(view);
    return b;
  }

  /* 把一次已展开的界面描述成可持久化的数据：只有 id 与展示字段，
     没有闭包、没有 DOM 引用。刷新后靠它把同一屏原样重建。 */
  function describe(kind, options, extra) {
    return Object.assign({
      kind,
      options: options.map(o => ({ id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d, tip: o.tip, leave: !!o.leave })),
    }, extra || {});
  }

  /* 事件：只生效一次；延迟推进前先确认还是同一次远征、同一个节点。 */
  function showEvent() {
    const e = pick(EVENTS);
    $('eIcon').textContent = e.ic;
    $('eTitle').textContent = e.t;
    $('eText').textContent = e.x;
    const box = $('ePicks');
    box.innerHTML = ''; box._kids = []; box._used = false;
    const run = state.G, node = run && run.node;
    e.o.forEach(o => {
      const b = cardButton(o);
      b.onclick = () => {
        if (!canAct()) return;
        if (state.G !== run) return;                   // 远征已被换掉：旧按钮失效
        mutate(() => {
          if (box._used) return;                        // 双击保护：只生效一次
          box._used = true;
          const msg = o.fn();
          toast(msg || '');
          if (state.G.hp <= 0) { endRun(false); return; }
          // 相位切到「已选定、待推进」：副作用已生效，快照只记 chosenId，
          // 刷新后据此推进一次，绝不重跑 o.fn()。
          if (setPhase) setPhase(PHASE_ENCOUNTER_DONE);
          if (publishEncounter) publishEncounter(Object.assign({}, current(), { chosenId: o.id }));
          scheduleRun(() => {
            if (state.G !== run) return;
            if (node) node.done = true;
            advance();
          }, 1100);
        });
      };
      box.appendChild(b);
    });
    if (publishEncounter) publishEncounter(describe('event', e.o, { node, title: e.t, icon: e.ic, text: e.x }));
    if (setPhase) setPhase(PHASE_ENCOUNTER);
    show('s-event');
  }

  /* 营火：只能选一项；延迟推进同样带 run/node 守卫。 */
  function showRest() {
    $('rTitle').textContent = '营火 🔥';
    $('rSub').textContent = '只能选择一项';
    const G = state.G;
    const rbox = $('rPicks');
    rbox.innerHTML = ''; rbox._kids = []; rbox._used = false;
    const healAmt = hasR('forge') ? 20 : 12;
    const av = ownedRelics(G);
    const opts = [
      { id: 'rest:heal', cat: 'heal', ic: '💚', t: '休息', d: '回复 ' + healAmt + ' 点生命', fn: () => {
        const R = state.G; R.hp = Math.min(R.maxhp, R.hp + healAmt); return '你睡了个好觉。';
      } },
      { id: 'rest:map', cat: 'event', ic: '🧭', t: '研究地图', d: '回复 6 点生命并获得 40 金币', fn: () => {
        const R = state.G;
        R.hp = Math.min(R.maxhp, R.hp + 6);
        R.gold = goldGain(40);
        return '你规划了路线，还捡到了钱。';
      } }
    ];
    if (av.length) {
      const r = drawRelic(av);
      opts.push({ id: 'rest:relic:' + r.id, cat: 'relic', ic: r.ic, t: '冥想 · ' + r.n,
          d: relicRarityLabel(r) + ' · ' + r.d, fn: () => {
        const R = state.G;
        R.relics.push(r.id);
        sfx.relic();
        applyRelicInit();
        return '你获得了 ' + r.n + '！';
      } });
    }
    const run = state.G, node = run && run.node;
    opts.forEach(o => {
      const b = cardButton(o);
      b.onclick = () => {
        if (!canAct()) return;
        if (state.G !== run) return;
        mutate(() => {
          if (rbox._used) return;
          rbox._used = true;
          toast(o.fn() || '');
          if (setPhase) setPhase(PHASE_ENCOUNTER_DONE);
          if (publishEncounter) publishEncounter(Object.assign({}, current(), { chosenId: o.id }));
          scheduleRun(() => {
            if (state.G !== run) return;
            if (node) node.done = true;
            advance();
          }, 900);
        });
      };
      $('rPicks').appendChild(b);
    });
    publish(describe('rest', opts, { node }));
    if (setPhase) setPhase(PHASE_ENCOUNTER);
    show('s-rest');
  }

  /* 商店：购买可重复点，「离开」才推进。
   * 原版这里曾经用整盒共用的 _used 做双击保护，导致买过任何东西之后连「离开」都点不动 —— 整局死锁。
   * 现在每按钮一层 260ms 冷却（只防手滑连点），advance() 自己的时间窗负责去重推进。 */
  const CLICK_CD_MS = 260;
  /* 商店顶部的「你的金币」行。★ 买完东西必须重新写一次：原实现只在**进入**商店时
     写一遍，于是玩家点了卡片、钱真的扣了，界面上那个数字纹丝不动 —— 看起来像没扣款，
     也看不出自己还剩多少钱买东西。恢复路径（reopenEncounter）本来就会重写这一行，
     实时路径漏了，两边的口径必须一致。 */
  function refreshShopGold() {
    const el = $('rSub');
    if (el) el.textContent = '你的金币：' + ((state.G && state.G.gold) | 0) + ' 枚 —— 用金币强化自己';
  }
  function showShop() {
    const G = state.G;
    $('rTitle').textContent = '商店 🛒';
    refreshShopGold();
    const sbox = $('rPicks');
    sbox.innerHTML = '';
    const opts = [
      { id: 'shop:potion', cat: 'heal', ic: '💚', t: '疗伤药剂 · 45 金币', d: '回复 35 点生命', fn: () => {
        const S = state.G;
        if (S.gold < 45) return '金币不够。';
        S.gold -= 45; S.hp = Math.min(S.maxhp, S.hp + 35); return '伤口愈合了。';
      } },
      { id: 'shop:scroll', cat: 'boost', ic: '🔮', t: '提示卷轴 · 40 金币', d: '下一场战斗 +3 次提示', fn: () => {
        const S = state.G;
        if (S.gold < 40) return '金币不够。';
        S.gold -= 40; S.shopHints = (S.shopHints || 0) + 3; return '卷轴收入行囊。';
      } },
      { id: 'shop:whet', cat: 'boost', ic: '💪', t: '磨砺石 · 70 金币',
        d: '生命上限 +10 并回满（本轮限 ' + WHET_MAX_PER_RUN + ' 次，还剩 '
          + Math.max(0, WHET_MAX_PER_RUN - (G.whetBuys | 0)) + ' 次）', fn: buyWhetstone }
    ];
    const av = ownedRelics(G);
    if (av.length) {
      const r = drawRelic(av);
      opts.push(shopRelicOption(r, relicPrice(r)));
    }
    // 卖道具：只卖玩家还没拿满的
    const shopItems = shuffle(ITEMS.filter(it => (G.bag[it.id] | 0) < it.max)).slice(0, 3);
    shopItems.forEach(it => {
      opts.push({ id: 'shop:item:' + it.id, cat: 'item', ic: it.ic, t: it.n + ' ×3 · ' + it.price + ' 金币', d: it.d, tip: it.tip, fn: () => {
        const S = state.G;
        if (S.gold < it.price) return '金币不够。';
        S.gold -= it.price; S.bag[it.id] = (S.bag[it.id] | 0) + 3;
        sfx.coin();
        return '获得 ' + it.n + ' ×3！';
      } });
    });
    opts.push({ id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买', leave: true, fn: () => '你空手离开了。' });
    const run = state.G, node = run && run.node;
    const now = () => Date.now();
    opts.forEach(o => {
      const b = cardButton(o);
      b.onclick = () => {
        if (!canAct()) return;
        if (state.G !== run) return;                   // 旧商店界面不得操作新远征
        mutate(() => {
          if (o.leave) {
            if (node) node.done = true;
            // ★ chosenId 必须在 setPhase(ENCOUNTER_DONE) **之前**发布。
            //   advance 有 400ms 双击去重窗口（快速 advance→shop→leave 正好落在这里），
            //   locked 时相位停在 encounter-done；此刻若描述里没有 chosenId，
            //   codec 的 needChoice 判据会把这份快照判成 invalid —— 刷新后整局丢失。
            if (publishEncounter) publishEncounter(Object.assign({}, current(), { chosenId: o.id }));
            if (setPhase) setPhase(PHASE_ENCOUNTER_DONE);
            advance();
            return;
          }
          const t = now();
          if (b._at && t - b._at < CLICK_CD_MS) return;   // 仅防手滑连点扣两次金币
          b._at = t;
          const m = o.fn();
          if (m) toast(m);
          // 买东西不推进层数：相位仍是 encounter，快照里带着「已扣钱」的 G 落盘。
          // 刷新后回到同一屏商店，钱已经扣过，不会免费重买。
          if (publishEncounter) publishEncounter(current());
          refreshShopGold();          // ★ 付完钱让顶部那个数字跟着变，否则看不出扣了多少
        });
      };
      sbox.appendChild(b);
    });
    publish(describe('shop', opts, { node, gold: G.gold }));
    if (setPhase) setPhase(PHASE_ENCOUNTER);
    show('s-rest');
  }

  /* ================= 战斗奖励 =================
     gold = 本场结算金币（文案用），unfinished = 没拼完的词（可为 null）。
     ★ b.rewardTaken 闸门：整块奖励面板只能兑现一次。原版 opts.forEach 直接 b.onclick=o.fn，
       连点三张卡就能同时拿走回血 + 遗物 + 道具。 */
  /* ★ roll 与 show 分离：winFight 那一刻就把候选卡 roll 出来并存进快照，
     展示只是延迟 900ms 把它们画出来。这样「在 900ms 里暂停/刷新」恢复时
     用的仍是同一批卡（不会重新 roll 出别的遗物），而且快照里已经带着卡面。 */
  function rollBattleRewards(gold, unfinished) {
    const B = state.B, G = state.G;
    if (!B || !G) return null;
    const opts = [];
    if (!B.boss) {
      const heal = Math.round(12 + B.enMax * 0.12);
      // 回血要作用在 B.myHp 上，否则会被 finishNode 的结转覆盖
      opts.push({ cat: 'heal', ic: '💚', t: '恢复生命', d: '回复 ' + heal + ' 点生命', id: 'reward:heal', fn: () => {
        const S = state.G, b = state.B;
        b.myHp = Math.min(S.maxhp, b.myHp + heal);
        finishNode();
      } });
    }
    if (hasR('scholar') && (activeSynergies(G.relics).some(s => s.id === 'alchemist') || rnd(3) === 0)) {
      opts.push({ cat: 'boost', ic: '🃏', t: '先知卡', d: '下一场战斗开始时，自动揭示一个字母', id: 'reward:seer', fn: () => {
        state.G.nextHint = true;
        finishNode();
      } });
    }
    const availRel = ownedRelics(G);
    if (availRel.length) {
      // 加权不重复抽样：同一批候选里，传说出现的概率远低于普通，
      // 而均匀洗牌会让它和「+2 次提示」一样常见。
      sampleRelicsWeighted(availRel, 3, relicRnd).forEach(r => opts.push({
        cat: 'relic', ic: r.ic, t: r.n, d: relicRarityLabel(r) + ' · ' + r.d, id: 'reward:relic:' + r.id, fn: () => {
        const S = state.G;
        S.relics.push(r.id);
        sfx.relic();
        toast('获得遗物：' + r.n);
        applyRelicInit();
        finishNode();
      } }));
    }
    // 战斗胜利掉落道具（精英/BOSS 必掉，普通战斗 35% 概率）
    if (B.elite || B.boss || Math.random() < 0.35) {
      const drop = shuffle(ITEMS.filter(it => (G.bag[it.id] | 0) < it.max))[0];
      if (drop) {
        const n = B.boss ? 3 : (B.elite ? 2 : 1);
        opts.push({ cat: 'item', ic: drop.ic, t: drop.n + ' ×' + n, d: drop.d, tip: drop.tip, id: 'reward:item:' + drop.id, fn: () => {
          const S = state.G;
          S.bag[drop.id] = (S.bag[drop.id] | 0) + n;
          sfx.coin();
          toast('🎒 获得 ' + drop.n + ' ×' + n);
          finishNode();
        } });
      }
    }
    if (!opts.length) opts.push({ cat: 'none', ic: '✅', t: '继续前进', d: '没有更多奖励了', id: 'reward:next', fn: finishNode });
    // ★ roll 完立刻发布检查点。胜利后到展示之间有 900ms，玩家完全可能在这段
    //   空窗里暂停或杀掉页面 —— 没有这份描述，reward 相位的快照会因为「缺
    //   encounter」被判为损坏，刷新后反而进不去这一局。
    publish(describe('reward', opts, { gold, unfinished, node: B.node }));
    if (setPhase) setPhase(PHASE_REWARD);
    return { opts, gold, unfinished, boss: !!B.boss, elite: !!B.elite, node: B.node };
  }

  /* 把已经 roll 好的一批卡画出来：这一步不再有任何随机。 */
  function showRolledRewards(rolled) {
    if (!rolled) return false;
    const B = state.B, G = state.G;
    if (!B || !G) return false;
    if (B.rewardTaken) return false;                    // 只能领一次
    const acc = clamp(Math.round(G.attOk / Math.max(1, G.att) * 100), 0, 100);
    const { opts, gold, unfinished } = rolled;
    show('s-pick');
    $('pTitle').textContent = rolled.boss ? '🎉 击败词汇之王！' : rolled.elite ? '☠️ 精英击破！' : '⚔️ 战斗胜利！';
    $('pSub').textContent = '击杀 ' + B.foe.ic + ' ' + B.foe.n + ' · 正确率 ' + acc + '% · 最高连击 ' + B.maxCombo +
      ' · 获得 ' + gold + ' 金币' + (unfinished ? ' · ⚠️「' + unfinished + '」没拼完，不算学会' : '');
    const picks = $('pPicks');
    picks.innerHTML = '';
    // 兑现闸门：先确认还是同一场战斗、还没领过奖，再改状态。
    const take = o => {
      if (!canAct()) return false;
      if (state.B !== B || state.G !== G) return false;   // 战斗已经换掉：旧按钮失效
      if (B.rewardTaken) return false;                     // 重复领奖无效
      // 领奖的副作用（回血/遗物/道具/结转/推进）与快照必须同一次提交。
      return mutate(() => {
        B.rewardTaken = true;
        o.fn();
        return true;
      });
    };
    opts.forEach(o => {
      const b = cardButton(o);
      b.onclick = () => take(o);
      picks.appendChild(b);
    });
    const skip = $('pSkip');
    skip.style.display = opts.length > 1 ? '' : 'none';
    skip.onclick = () => {
      if (!canAct()) return;
      if (opts.length) take(opts[0]); else mutate(() => { B.rewardTaken = true; finishNode(); });
    };
    // 相位切到「待领奖」：金币在 winFight 时已入账，这里只把「还剩这些卡可领」记下来。
    // 刷新后靠这份描述重建同一批卡 —— 不重新 roll，玩家也刷不出额外遗物。
    publish(describe('reward', opts, { gold, unfinished, node: rolled.node }));
    if (setPhase) setPhase(PHASE_REWARD);
    return true;
  }
  /* 兼容旧调用：现 roll 再画。真实路径走 winFight 的 roll + 延迟 show。 */
  function showBattleRewards(gold, unfinished) {
    return showRolledRewards(rollBattleRewards(gold, unfinished));
  }

  /* ---------- 暂停恢复：按快照里的描述重建同一屏 ----------
   * desc 只含 id 与展示字段，所以这里必须把 id 映射回**原来的选项对象**
   * （含它的 fn），才能在恢复后继续正常生效。
   * 映射不上的 id 一律跳过：宁可少一张卡，也不得凭空执行未知动作。 */
  function optionById(kind, desc, id) {
    let table = null;
    if (kind === 'event') {
      const e = EVENTS.filter(x => x.t === (desc && desc.title))[0];
      table = e ? e.o : null;
    } else if (kind === 'rest') {
      const G = state.G;
      const healAmt = hasR('forge') ? 20 : 12;
      table = [
        { id: 'rest:heal', cat: 'heal', ic: '💚', t: '休息', d: '回复 ' + healAmt + ' 点生命', fn: () => {
          const R = state.G; R.hp = Math.min(R.maxhp, R.hp + healAmt); return '你睡了个好觉。';
        } },
        { id: 'rest:map', cat: 'event', ic: '🧭', t: '研究地图', d: '回复 6 点生命并获得 40 金币', fn: () => {
          const R = state.G; R.hp = Math.min(R.maxhp, R.hp + 6); R.gold = goldGain(40);
          return '你规划了路线，还捡到了钱。';
        } },
      ];
      // 营火同理：冥想卡按 id 全量铺开，快照里那张才能原样恢复。
            for (const r of RELICS) table.push({ id: 'rest:relic:' + r.id, cat: 'relic', ic: r.ic,
              t: '冥想 · ' + r.n, d: relicRarityLabel(r) + ' · ' + r.d, fn: () => {
                const R = state.G; R.relics.push(r.id); sfx.relic(); applyRelicInit();
                return '你获得了 ' + r.n + '！';
              } });
    } else if (kind === 'shop') {
      const G = state.G;
      table = [
        { id: 'shop:potion', cat: 'heal', ic: '💚', t: '疗伤药剂 · 45 金币', d: '回复 35 点生命', fn: () => {
          const S = state.G; if (S.gold < 45) return '金币不够。';
          S.gold -= 45; S.hp = Math.min(S.maxhp, S.hp + 35); return '伤口愈合了。';
        } },
        { id: 'shop:scroll', cat: 'boost', ic: '🔮', t: '提示卷轴 · 40 金币', d: '下一场战斗 +3 次提示', fn: () => {
          const S = state.G; if (S.gold < 40) return '金币不够。';
          S.gold -= 40; S.shopHints = (S.shopHints || 0) + 3; return '卷轴收入行囊。';
        } },
        { id: 'shop:whet', cat: 'boost', ic: '💪', t: '磨砺石 · 70 金币',
          d: '生命上限 +10 并回满（本轮限 ' + WHET_MAX_PER_RUN + ' 次，还剩 '
            + Math.max(0, WHET_MAX_PER_RUN - (G.whetBuys | 0)) + ' 次）', fn: buyWhetstone },
      ];
      // 遗物/道具候选表按 id 全量铺开（而不是重新 pick 一个）：
            // 快照里记的是**当时那一张**，重新 pick 会得到别的 id，
            // 于是那张卡在恢复后凭空消失 —— 玩家会以为货变了。
            // 商店遗物铺**两条** id：新格式（id 里带卡面价）与旧格式（无价格，
            //   固定 80）。后者是加稀有度之前的老存档，缺了它就等于老快照整屏丢失。
            for (const r of RELICS) {
              table.push(shopRelicOption(r, relicPrice(r)));
              table.push(legacyShopRelicOption(r));
            }
      for (const it of ITEMS) table.push({
        id: 'shop:item:' + it.id, cat: 'item', ic: it.ic, t: it.n + ' ×3 · ' + it.price + ' 金币',
        d: it.d, tip: it.tip, fn: () => {
          const S = state.G; if (S.gold < it.price) return '金币不够。';
          S.gold -= it.price; S.bag[it.id] = (S.bag[it.id] | 0) + 3; sfx.coin();
          return '获得 ' + it.n + ' ×3！';
        } });
      table.push({ id: 'shop:leave', cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买', leave: true,
        fn: () => '你空手离开了。' });
    } else if (kind === 'reward') {
      const B = state.B, G = state.G;
      if (!B || !G) return null;
      const heal = Math.round(12 + B.enMax * 0.12);
      table = [{ id: 'reward:heal', cat: 'heal', ic: '💚', t: '恢复生命', d: '回复 ' + heal + ' 点生命', fn: () => {
        const S = state.G, b = state.B; b.myHp = Math.min(S.maxhp, b.myHp + heal); finishNode();
      } }];
      table.push({ id: 'reward:seer', cat: 'boost', ic: '🃏', t: '先知卡',
        d: '下一场战斗开始时，自动揭示一个字母', fn: () => { state.G.nextHint = true; finishNode(); } });
      for (const r of RELICS) table.push({ id: 'reward:relic:' + r.id, cat: 'relic', ic: r.ic, t: r.n,
        d: relicRarityLabel(r) + ' · ' + r.d, fn: () => {
        const S = state.G; S.relics.push(r.id); sfx.relic(); toast('获得遗物：' + r.n);
        applyRelicInit(); finishNode();
      } });
      for (const it of ITEMS) table.push({ id: 'reward:item:' + it.id, cat: 'item', ic: it.ic,
        t: it.n + ' ×' + (B.boss ? 3 : B.elite ? 2 : 1), d: it.d, tip: it.tip, fn: () => {
          const S = state.G, n = B.boss ? 3 : (B.elite ? 2 : 1);
          S.bag[it.id] = (S.bag[it.id] | 0) + n; sfx.coin(); toast('🎒 获得 ' + it.n + ' ×' + n);
          finishNode();
        } });
      table.push({ id: 'reward:next', cat: 'none', ic: '✅', t: '继续前进', d: '没有更多奖励了', fn: finishNode });
    }
    if (!table) return null;
    return table.filter(o => o.id === id)[0] || null;
  }

  // 恢复用：把快照描述里的每张卡换成带 fn 的真实选项，再画回原界面。
  function reopenEncounter(desc) {
    if (!desc || !Array.isArray(desc.options)) return false;
    const opts = [];
    let unmapped = 0;
    for (const o of desc.options) {
      const real = optionById(desc.kind, desc, o.id);
      // ★ 展示字段用快照里的**原文**（玩家暂停前看到的那一版），转义只发生在
      //   cardButton 的渲染边界（{untrusted:true}）。opts 保持原文，publish() 存回
      //   快照的也是原文 —— 否则 reopen → publish → reopen 会把 & 再转义一次。
      //   动作则用真实选项的 fn：快照只决定「显示成什么样」，永远不决定「做什么」。
      if (!real) { unmapped++; continue; }
      opts.push(Object.assign({}, real, {
        cat: o.cat, ic: o.ic, t: o.t, d: o.d,
        tip: o.tip, leave: !!o.leave,
      }));
    }
    // 一张都映射不上：既不能把玩家留在点不动的界面上，也不能一声不响丢回地图。
    if (!opts.length) {
      toast('这张事件卡无法恢复，请回到地图重新选择');
      return false;
    }
    if (unmapped) toast('有 ' + unmapped + ' 张卡无法恢复，已跳过');

    const node = desc.node || (state.G && state.G.node);
    const run = state.G;
    if (desc.kind === 'event') {
      $('eIcon').textContent = desc.icon || '';
      $('eTitle').textContent = desc.title || '';
      $('eText').textContent = desc.text || '';
      const box = $('ePicks');
      box.innerHTML = ''; box._kids = [];
      // ★ 已有 chosenId 说明这个选项的副作用已经生效过：必须重新置为「已用」。
      //   否则恢复后玩家能再点一次营火/事件，把回血、遗物、金币再拿一遍。
      box._used = !!desc.chosenId;
      opts.forEach(o => {
        const b = cardButton(o, { untrusted: true });
        b.onclick = () => {
          if (!canAct()) return;
          if (state.G !== run || box._used) return;
          mutate(() => {
            box._used = true;
            toast(o.fn() || '');
            if (state.G.hp <= 0) { endRun(false); return; }
            if (setPhase) setPhase(PHASE_ENCOUNTER_DONE);
            if (publishEncounter) publishEncounter(Object.assign({}, desc, { chosenId: o.id }));
            scheduleRun(() => { if (state.G !== run) return; if (node) node.done = true; advance(); }, 1100);
          });
        };
        box.appendChild(b);
      });
      publish(Object.assign({}, desc, { options: opts.map(o => ({ id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d, tip: o.tip })) }));
      show('s-event');
      return true;
    }
    if (desc.kind === 'rest' || desc.kind === 'shop') {
      const G = state.G;
      $('rTitle').textContent = desc.kind === 'shop' ? '商店 🛒' : '营火 🔥';
      $('rSub').textContent = desc.kind === 'shop' ? ('你的金币：' + G.gold + ' 枚 —— 用金币强化自己') : '只能选择一项';
      const sbox = $('rPicks');
      sbox.innerHTML = ''; sbox._kids = [];
      sbox._used = !!desc.chosenId && desc.kind !== 'shop';
      opts.forEach(o => {
        const b = cardButton(o, { untrusted: true });
        b.onclick = () => {
          if (!canAct()) return;
          if (state.G !== run) return;
          mutate(() => {
            if (o.leave) {
              if (node) node.done = true;
              // 与真实商店同序：chosenId 先发布，再切 encounter-done，再推进。
              if (publishEncounter) publishEncounter(Object.assign({}, current(), { chosenId: o.id }));
              if (setPhase) setPhase(PHASE_ENCOUNTER_DONE);
              advance();
              return;
            }
            if (desc.kind !== 'shop') {
              if (sbox._used) return;
              sbox._used = true;
            }
            const t = Date.now();
            if (b._at && t - b._at < CLICK_CD_MS) return;
            b._at = t;
            const m = o.fn();
            if (m) toast(m);
            if (desc.kind === 'shop' && publishEncounter) publishEncounter(current());
            else {
              if (setPhase) setPhase(PHASE_ENCOUNTER_DONE);
              if (publishEncounter) publishEncounter(Object.assign({}, current(), { chosenId: o.id }));
              scheduleRun(() => { if (state.G !== run) return; if (node) node.done = true; advance(); },
                desc.kind === 'shop' ? 0 : 900);
            }
          });
        };
        sbox.appendChild(b);
      });
      publish(Object.assign({}, desc, { options: opts.map(o => ({ id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d, tip: o.tip, leave: !!o.leave })) }));
      if (setPhase) setPhase(PHASE_ENCOUNTER);
      show('s-rest');
      return true;
    }
    if (desc.kind === 'reward') {
      const B = state.B, G = state.G;
      if (!B || !G) return false;
      const acc = clamp(Math.round(G.attOk / Math.max(1, G.att) * 100), 0, 100);
      show('s-pick');
      $('pTitle').textContent = B.boss ? '🎉 击败词汇之王！' : B.elite ? '☠️ 精英击破！' : '⚔️ 战斗胜利！';
      $('pSub').textContent = '击杀 ' + B.foe.ic + ' ' + B.foe.n + ' · 正确率 ' + acc + '% · 最高连击 ' + B.maxCombo +
        ' · 获得 ' + desc.gold + ' 金币' + (desc.unfinished ? ' · ⚠️「' + desc.unfinished + '」没拼完，不算学会' : '');
      const picks = $('pPicks');
      picks.innerHTML = '';
      const take = o => {
        if (!canAct()) return false;
        if (state.B !== B || state.G !== G) return false;
        if (B.rewardTaken) return false;
        return mutate(() => {
          B.rewardTaken = true;
          o.fn();
          return true;
        });
      };
      opts.forEach(o => { const b = cardButton(o, { untrusted: true }); b.onclick = () => take(o); picks.appendChild(b); });
      const skip = $('pSkip');
      skip.style.display = opts.length > 1 ? '' : 'none';
      skip.onclick = () => {
        if (!canAct()) return;
        if (opts.length) take(opts[0]); else mutate(() => { B.rewardTaken = true; finishNode(); });
      };
      publish(Object.assign({}, desc, { options: opts.map(o => ({ id: o.id, cat: o.cat, ic: o.ic, t: o.t, d: o.d, tip: o.tip })) }));
      if (setPhase) setPhase(PHASE_REWARD);
      return true;
    }
    return false;
  }

  return { showEvent, showRest, showShop, showBattleRewards, rollBattleRewards, showRolledRewards,
    reopenEncounter, currentEncounter: current };
}