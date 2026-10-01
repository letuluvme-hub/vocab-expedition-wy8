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
 */
import { RELICS } from '../data/relics.js';
import { ITEMS } from '../data/items.js';
import { pickCardHTML, CAT_LABEL } from '../ui/components/pick-card.js';

export function createEncounterController({ state, ports }) {
  const { $, clamp, pick, shuffle, rnd, has, hasR, goldGain, applyRelicInit, sfx, toast,
    advance, endRun, finishNode, show, scheduleRun, scheduleBattle } = ports;
  // 造按钮的入口：Node 测试没有全局 document，所以走 ports 注入；浏览器里退回 document。
  const makeButton = ports.makeButton || (() => document.createElement('button'));

  /* ================= 事件 =================
     搬进工厂：选项动作读 live state，返回一句结果文案。
     保留原版逐字文案与数值（含赌局 / 迷路的词灵里那些手写的 return 串）。 */
  const EVENTS = [
    { ic: '🎁', t: '神秘的背包', x: '你捡到一个鼓鼓的背包，主人却不见了。', o: [
      { cat: 'relic', ic: '💎', t: '打开看看', d: '随机获得一个遗物', fn: () => {
        const G = state.G;
        const av = RELICS.filter(r => !has(G.relics, r.id));
        if (av.length) {
          const r = pick(av);
          G.relics.push(r.id);
          applyRelicInit();
          sfx.relic();
          return '你找到了 ' + r.ic + ' ' + r.n + '！';
        }
        G.gold = goldGain(40);
        return '包里只有 40 金币，但聊胜于无。';
      } },
      { cat: 'none', ic: '🚶', t: '不关我事', d: '离开，什么也不发生', fn: () => '你背起包继续赶路。' }
    ] },
    { ic: '⛲', t: '神秘泉水', x: '一股清泉从石缝涌出，水面泛着微微的光。', o: [
      { cat: 'heal', ic: '💚', t: '喝一口', d: '回复 25 点生命', fn: () => {
        const G = state.G; G.hp = Math.min(G.maxhp, G.hp + 25); return '伤口愈合了。';
      } },
      { cat: 'boost', ic: '🔮', t: '灌满水壶', d: '获得 2 次免费提示（下一场战斗）', fn: () => {
        const G = state.G; G.nextHint = (G.nextHint || 0) + 2; return '水壶泛着微光，下场战斗会帮你。';
      } },
      { cat: 'heal', ic: '🥾', t: '装进瓶子带走', d: '回复 10 点生命', fn: () => {
        const G = state.G; G.hp = Math.min(G.maxhp, G.hp + 10); return '你还是带了点水。';
      } }
    ] },
    { ic: '⚔️', t: '老兵的剑', x: '一位老兵递给你一把剑：「会用吗？」', o: [
      { cat: 'relic', ic: '🔥', t: '学以致用', d: '获得「连击徽章」，连击加成翻倍', fn: () => {
        state.G.relics.push('combo'); sfx.relic(); return '你的连击从此更锋利。';
      } },
      { cat: 'event', ic: '💰', t: '卖掉换钱', d: '获得 60 金币', fn: () => {
        const G = state.G; G.gold = goldGain(60); return '你换到了 60 金币。';
      } }
    ] },
    { ic: '📚', t: '遗忘之书', x: '一本书在你面前打开，书页上全是单词，却一个都读不懂。', o: [
      { cat: 'relic', ic: '🧠', t: '认真研读', d: '当前战斗下次的拼写正确率提升：回复 20 生命并获得遗物', fn: () => {
        const G = state.G;
        G.hp = Math.min(G.maxhp, G.hp + 20);
        const av = RELICS.filter(r => !has(G.relics, r.id));
        if (av.length) {
          const r = pick(av);
          G.relics.push(r.id);
          sfx.relic();
          applyRelicInit();
          return '你读懂了 ' + r.n + ' 的含义。';
        }
        return '你读懂了更多，知识就是力量。';
      } },
      { cat: 'heal', ic: '😴', t: '合上书休息', d: '回复 15 点生命', fn: () => {
        const G = state.G; G.hp = Math.min(G.maxhp, G.hp + 15); return '小憩片刻。';
      } }
    ] },
    { ic: '🎲', t: '命运的赌局', x: '一个蒙面人推来一枚硬币：「猜正反，赢了钱翻倍，输了归我。」', o: [
      { cat: 'event', ic: '🪙', t: '押上 40 金币', d: '一半概率翻倍，一半概率全失', fn: () => {
        const G = state.G;
        G.gold = goldGain(40);
        if (Math.random() < .5) { const w = G.gold; G.gold = w * 2; return '硬币停在正面！你获得了 ' + G.gold + ' 金币。'; }
        G.gold = 0;
        return '反面。你的金币全没了。';
      } },
      { cat: 'none', ic: '✋', t: '不赌了', d: '安全离开', fn: () => '你明智地走开了。' }
    ] },
    { ic: '👺', t: '迷路的词灵', x: '一个小词灵缩在墙角，看起来迷路了。', o: [
      { cat: 'heal', ic: '🍬', t: '给它一颗糖', d: '花费 20 金币，获得 12 点生命', fn: () => {
        const G = state.G;
        if (G.gold < 20) return '你金币不够。';
        G.gold -= 20; G.hp = Math.min(G.maxhp, G.hp + 12);
        return '它带你找到了一条捷径，你感觉好多了。';
      } },
      { cat: 'event', ic: '📖', t: '教它拼写', d: '获得 30 金币的「学费」', fn: () => {
        const G = state.G;
        const g = goldGain(30);
        return '它学会了，血量 +5。'.replace('血量 +5', '') + ' 你获得了 ' + g + ' 金币。';
      } }
    ] }
  ];

  /* 卡片按钮的统一构造：结构化 cat 徽标 + 标题/描述分层，原样沿用旧版 innerHTML。 */
  function cardButton(o) {
    const b = makeButton('button');
    b.className = 'pick';
    b.dataset.cat = CAT_LABEL[o.cat] ? o.cat : 'none';   // 供 CSS 上色与测试断言
    b.innerHTML = pickCardHTML(o);
    return b;
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
        if (state.G !== run) return;                   // 远征已被换掉：旧按钮失效
        if (box._used) return;                          // 双击保护：只生效一次
        box._used = true;
        const msg = o.fn();
        toast(msg || '');
        if (state.G.hp <= 0) { endRun(false); return; }
        scheduleRun(() => {
          if (state.G !== run) return;
          if (node) node.done = true;
          advance();
        }, 1100);
      };
      box.appendChild(b);
    });
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
    const av = RELICS.filter(r => !has(G.relics, r.id));
    const opts = [
      { cat: 'heal', ic: '💚', t: '休息', d: '回复 ' + healAmt + ' 点生命', fn: () => {
        const R = state.G; R.hp = Math.min(R.maxhp, R.hp + healAmt); return '你睡了个好觉。';
      } },
      { cat: 'event', ic: '🧭', t: '研究地图', d: '回复 6 点生命并获得 40 金币', fn: () => {
        const R = state.G;
        R.hp = Math.min(R.maxhp, R.hp + 6);
        R.gold = goldGain(40);
        return '你规划了路线，还捡到了钱。';
      } }
    ];
    if (av.length) {
      const r = pick(av);
      opts.push({ cat: 'relic', ic: r.ic, t: '冥想 · ' + r.n, d: r.d, fn: () => {
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
        if (state.G !== run) return;
        if (rbox._used) return;
        rbox._used = true;
        toast(o.fn() || '');
        scheduleRun(() => {
          if (state.G !== run) return;
          if (node) node.done = true;
          advance();
        }, 900);
      };
      $('rPicks').appendChild(b);
    });
    show('s-rest');
  }

  /* 商店：购买可重复点，「离开」才推进。
   * 原版这里曾经用整盒共用的 _used 做双击保护，导致买过任何东西之后连「离开」都点不动 —— 整局死锁。
   * 现在每按钮一层 260ms 冷却（只防手滑连点），advance() 自己的时间窗负责去重推进。 */
  const CLICK_CD_MS = 260;
  function showShop() {
    const G = state.G;
    $('rTitle').textContent = '商店 🛒';
    $('rSub').textContent = '你的金币：' + G.gold + ' 枚 —— 用金币强化自己';
    const sbox = $('rPicks');
    sbox.innerHTML = '';
    const opts = [
      { cat: 'heal', ic: '💚', t: '疗伤药剂 · 45 金币', d: '回复 35 点生命', fn: () => {
        const S = state.G;
        if (S.gold < 45) return '金币不够。';
        S.gold -= 45; S.hp = Math.min(S.maxhp, S.hp + 35); return '伤口愈合了。';
      } },
      { cat: 'boost', ic: '🔮', t: '提示卷轴 · 40 金币', d: '下一场战斗 +3 次提示', fn: () => {
        const S = state.G;
        if (S.gold < 40) return '金币不够。';
        S.gold -= 40; S.shopHints = (S.shopHints || 0) + 3; return '卷轴收入行囊。';
      } },
      { cat: 'boost', ic: '💪', t: '磨砺石 · 70 金币', d: '生命上限 +10 并回满', fn: () => {
        const S = state.G;
        if (S.gold < 70) return '金币不够。';
        S.gold -= 70; S.maxhp += 10; S.hp = S.maxhp; return '你更强了。';
      } }
    ];
    const av = RELICS.filter(r => !has(G.relics, r.id));
    if (av.length) {
      const r = pick(av);
      opts.push({ cat: 'relic', ic: r.ic, t: r.n + ' · 80 金币', d: r.d, fn: () => {
        const S = state.G;
        if (S.gold < 80) return '金币不够。';
        S.gold -= 80; S.relics.push(r.id); sfx.relic(); applyRelicInit(); return '你买下了 ' + r.n + '！';
      } });
    }
    // 卖道具：只卖玩家还没拿满的
    const shopItems = shuffle(ITEMS.filter(it => (G.bag[it.id] | 0) < it.max)).slice(0, 3);
    shopItems.forEach(it => {
      opts.push({ cat: 'item', ic: it.ic, t: it.n + ' ×3 · ' + it.price + ' 金币', d: it.d, tip: it.tip, fn: () => {
        const S = state.G;
        if (S.gold < it.price) return '金币不够。';
        S.gold -= it.price; S.bag[it.id] = (S.bag[it.id] | 0) + 3;
        sfx.coin();
        return '获得 ' + it.n + ' ×3！';
      } });
    });
    opts.push({ cat: 'none', ic: '🚪', t: '离开商店', d: '什么都不买', leave: true, fn: () => '你空手离开了。' });
    const run = state.G, node = run && run.node;
    const now = () => Date.now();
    opts.forEach(o => {
      const b = cardButton(o);
      b.onclick = () => {
        if (state.G !== run) return;                   // 旧商店界面不得操作新远征
        if (o.leave) { if (node) node.done = true; advance(); return; }
        const t = now();
        if (b._at && t - b._at < CLICK_CD_MS) return;   // 仅防手滑连点扣两次金币
        b._at = t;
        const m = o.fn();
        if (m) toast(m);
      };
      sbox.appendChild(b);
    });
    show('s-rest');
  }

  /* ================= 战斗奖励 =================
     gold = 本场结算金币（文案用），unfinished = 没拼完的词（可为 null）。
     ★ b.rewardTaken 闸门：整块奖励面板只能兑现一次。原版 opts.forEach 直接 b.onclick=o.fn，
       连点三张卡就能同时拿走回血 + 遗物 + 道具。 */
  function showBattleRewards(gold, unfinished) {
    const B = state.B, G = state.G;
    if (!B || !G) return false;
    if (B.rewardTaken) return false;                    // 只能领一次
    const acc = clamp(Math.round(G.attOk / Math.max(1, G.att) * 100), 0, 100);
    show('s-pick');
    $('pTitle').textContent = B.boss ? '🎉 击败词汇之王！' : B.elite ? '☠️ 精英击破！' : '⚔️ 战斗胜利！';
    $('pSub').textContent = '击杀 ' + B.foe.ic + ' ' + B.foe.n + ' · 正确率 ' + acc + '% · 最高连击 ' + B.maxCombo +
      ' · 获得 ' + gold + ' 金币' + (unfinished ? ' · ⚠️「' + unfinished + '」没拼完，不算学会' : '');
    const picks = $('pPicks');
    picks.innerHTML = '';
    const opts = [];
    if (!B.boss) {
      const heal = Math.round(12 + B.enMax * 0.12);
      // 回血要作用在 B.myHp 上，否则会被 finishNode 的结转覆盖
      opts.push({ cat: 'heal', ic: '💚', t: '恢复生命', d: '回复 ' + heal + ' 点生命', fn: () => {
        const S = state.G, b = state.B;
        b.myHp = Math.min(S.maxhp, b.myHp + heal);
        finishNode();
      } });
    }
    if (hasR('scholar') && rnd(3) === 0) {
      opts.push({ cat: 'boost', ic: '🃏', t: '先知卡', d: '下一场战斗开始时，自动揭示一个字母', fn: () => {
        state.G.nextHint = true;
        finishNode();
      } });
    }
    const availRel = RELICS.filter(r => !has(G.relics, r.id));
    if (availRel.length) {
      shuffle(availRel).slice(0, 3).forEach(r => opts.push({ cat: 'relic', ic: r.ic, t: r.n, d: r.d, fn: () => {
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
        opts.push({ cat: 'item', ic: drop.ic, t: drop.n + ' ×' + n, d: drop.d, tip: drop.tip, fn: () => {
          const S = state.G;
          S.bag[drop.id] = (S.bag[drop.id] | 0) + n;
          sfx.coin();
          toast('🎒 获得 ' + drop.n + ' ×' + n);
          finishNode();
        } });
      }
    }
    if (!opts.length) opts.push({ cat: 'none', ic: '✅', t: '继续前进', d: '没有更多奖励了', fn: finishNode });

    // 兑现闸门：先确认还是同一场战斗、还没领过奖，再改状态。
    const take = o => {
      if (state.B !== B || state.G !== G) return false;   // 战斗已经换掉：旧按钮失效
      if (B.rewardTaken) return false;                     // 重复领奖无效
      B.rewardTaken = true;
      o.fn();
      return true;
    };
    opts.forEach(o => {
      const b = cardButton(o);
      b.onclick = () => take(o);
      picks.appendChild(b);
    });
    const skip = $('pSkip');
    skip.style.display = opts.length > 1 ? '' : 'none';
    skip.onclick = () => { if (opts.length) take(opts[0]); else { B.rewardTaken = true; finishNode(); } };
    return true;
  }

  return { showEvent, showRest, showShop, showBattleRewards };
}