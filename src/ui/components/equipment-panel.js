/* 战斗页「装备与能力」折叠面板：把本局**已持有**的全部装备摊开给玩家看。
 *
 * 契约（这几条是这个模块存在的全部理由，改动时逐条核对）：
 *  1) **纯只读**。面板只是把快照画出来：不补提示次数、不重新施加遗物护盾、
 *     不改 usedThisFight、不动 G.ghostUsed。战斗页的每次 renderFight 都会调它，
 *     任何副作用都会变成「每敲一个字母就重复触发一次」的隐性数值 bug。
 *  2) 角色被动读 **G.heroId**（本局远征选的英雄），不是 DB.hero（主页上次选的）。
 *  3) G.relics 全部列出。以前战斗页只露出前三个，那不是设计，是没人写过完整清单 ——
 *     玩家买了第四件遗物之后根本不知道自己有第四件。
 *  4) 重复遗物合并成「×N」，但**只改计数不改效果**：同一件遗物叠两遍不会多给一次护盾，
 *     所以文案不许出现第二遍。
 *  5) 影分身额度是 run 级（G.ghostUsed），一轮远征只有一次，用掉就写明耗尽。
 *  6) 战斗中护盾在 B.shield 上（本场可能已经被打掉），不在战斗才读 G.shield。
 *  7) 认不出的 id 一律降级成安全的「未知装备」，并且**只经 textContent 落屏**：
 *     存档里的 id 是用户可写字段，拼进 innerHTML 就是一个存储型 XSS。
 *  8) 手机上没有 hover：所有效果文案都必须是展开后直接可见的文本，
 *     不许只挂在 title 上。
 *
 * 与道具栏（#fItems）的分工：#fItems 是**操作**区（点一下就消耗道具），
 * 这里是**只读**清单。两者共用同一份 G.bag / B.usedThisFight，不重复记账。
 */
import { itemByIdOrNull as itemById, relicByIdOrNull as relicById } from '../../data/lookup.js';
import { HERO_DEFAULT, heroById, heroStatLines } from './hero.js';
import { relicRarity, relicRarityLabel, activeSynergies, synergyLabel } from '../../domain/relic-rules.js';
import { pixelIconSVG, relicIconKey } from './pixel-art.js';

// itemById / relicById 来自 src/data/lookup.js（VE-20 统一索引）。
// 这里用的是 **OrNull** 变体：本模块的既有约定是查不到返回 null 而不是 undefined
// （`if (!r)` 两者都成立，但下面的 unknownRelic 会把 null 与 undefined 走成不同分支）。

/* 未知 id 的安全降级：文案里带上原始 id 是有意的 —— 玩家能看出「存档里有个我
   不认识的编号」，但它只是 textContent，永远不会被解析成元素。 */
function unknownRelic(id, count) {
  return {
    id, count, unknown: true, ic: '❔',
    n: '未知装备（' + String(id) + '）',
    d: '来自旧存档或未知版本的效果，无法识别；本面板只展示，不做任何结算。',
  };
}
function unknownItem(id, owned) {
  return {
    id, owned, unknown: true, ic: '❔',
    n: '未知道具（' + String(id) + '）',
    d: '无法识别的道具，无法使用。',
    usedThisFight: 0, max: 0, spent: false,
  };
}

/* ---------------- 纯模型：不碰 DOM，规则全部在这里 ---------------- */
export function equipmentModel(G, B) {
  const run = G || {}, bat = B || null;

  /* 英雄：只认本局的 G.heroId。认不出就回退默认，绝不让 undefined 渗进文案。 */
  const hero = heroById(run.heroId || HERO_DEFAULT);

  /* 遗物：按出现顺序去重并计数（不排序，保留获取顺序更像玩家的记忆）。 */
  const tally = new Map();
  (Array.isArray(run.relics) ? run.relics : []).forEach(id => {
    const key = String(id);
    tally.set(key, (tally.get(key) || 0) + 1);
  });
  const relics = [...tally.entries()].map(([id, count]) => {
    const r = relicById(id);
    // 认不出的 id 走 unknownRelic：它连"稀有度"都不该有 ——
    // 档位是数据表的事实，存档里凭空造出一个「普通」只会骗玩家。
    return r
      ? { id, count, unknown: false, ic: r.ic, n: r.n, d: r.d,
          rarity: relicRarity(r), rarityLabel: relicRarityLabel(r) }
      : unknownRelic(id, count);
  });

  /* 组合技：只看已持有的 id，与存档字段无关（旧存档立刻生效）。
     每条都要能指出「是哪两件凑成的」，否则玩家不知道自己走了哪条路。 */
  const synergies = activeSynergies(run.relics).map(s => ({
    id: s.id, ic: s.ic, n: s.n, d: s.d, label: synergyLabel(s),
    members: s.need.map(mid => {
      const def = relicById(mid);
      return def ? { id: mid, ic: def.ic, n: def.n } : { id: mid, ic: '❔', n: mid };
    }),
  }));

  /* 道具：背包持有数 + 本场已用/上限。held 口径与 #fItems 一致（持有 > 0）。 */
  const used = (bat && bat.usedThisFight) || {};
  const items = Object.keys(run.bag || {})
    .filter(id => (run.bag[id] | 0) > 0)
    .map(id => {
      const it = itemById(id);
      const owned = run.bag[id] | 0;
      if (!it) return unknownItem(id, owned);
      const usedThisFight = used[id] | 0;
      return {
        id, owned, unknown: false, ic: it.ic, n: it.n, d: it.d,
        usedThisFight, max: it.max, spent: usedThisFight >= it.max,
      };
    });

  /* 影分身：额度挂在 run 上（G.ghostUsed），不在 B 上 —— 所以换战斗不会重置。 */
  const ghostOwned = tally.has('ghost');
  const ghost = { owned: ghostOwned, left: ghostOwned && !run.ghostUsed ? 1 : 0 };

  /* 护盾：战斗中是 B.shield（真实剩余，可能已被打掉）；不在战斗才读 G.shield。 */
  const shield = { value: bat ? (bat.shield | 0) : (run.shield | 0), inFight: !!bat };

  return { hero, heroLines: heroStatLines(hero), relics, synergies, items, ghost, shield, count: 1 + relics.length + items.length };
}

/* ---------------- 渲染：只读快照 → DOM ---------------- */
export function createEquipmentPanel({ getRun, getBattle }) {
  let host = null;   // 复用同一个 <details>：重建会把玩家刚展开的面板收起来

  function build() {
    const anchor = document.getElementById('fItems');
    if (!anchor || !anchor.parentElement) return null;   // 不在战斗页就安静退出
    const el = document.createElement('details');
    el.id = 'fEquipment';
    el.className = 'equip';
    el.appendChild(document.createElement('summary'));
    el.appendChild(document.createElement('div'));        // body
    anchor.parentElement.insertBefore(el, anchor.nextSibling);
    host = el;
    return el;
  }

  /* 一行 = 一个 div，行内分「图标 / 标题 / 效果」。
   *
   * ★ 安全边界：标题与效果**永远**走 textContent（认不出的 id 会被原样写进标题，
   *   那正是契约 7 要挡住的东西）。只有 `icon` 走 innerHTML，而它的唯一来源是
   *   pixelArt 的固定表 —— 认不出的 id 那边返回 null，这里就根本不追加图标元素。 */
  function line(body, cls, head, text, icon) {
    const row = document.createElement('div');
    row.className = 'eq-row ' + (cls || '');
    if (icon) {
      const ic = document.createElement('span');
      ic.className = 'eq-ic';
      ic.innerHTML = icon;
      row.appendChild(ic);
    }
    const h = document.createElement('span');
    h.className = 'eq-h';
    h.textContent = head;
    const d = document.createElement('span');
    d.className = 'eq-d';
    d.textContent = text;
    row.appendChild(h); row.appendChild(d);
    body.appendChild(row);
  }

  function renderEquipmentPanel() {
    const el = host && host.parentElement ? host : build();
    if (!el) return null;
    const m = equipmentModel(getRun(), getBattle());

    el.children[0].className = 'eq-sum';
    el.children[0].textContent = '装备与能力 · ' + m.count;
    const body = el.children[1];
    body.className = 'eq-body';
    body.textContent = '';

    /* 角色被动 */
    const hs = m.heroLines.length ? ' · ' + m.heroLines.join(' · ') : '';
    line(body, 'eq-hero', m.hero.n + ' · ' + m.hero.tag, m.hero.d + hs);

    /* 护盾：战斗中与地图上是两个来源，文案要写清楚现在看的是哪一个 */
    line(body, 'eq-shield', '当前护盾', m.shield.value + ' 点' + (m.shield.inFight ? '（本场实时剩余）' : '（未进入战斗）'));

    /* 遗物 */
    if (!m.relics.length) {
      line(body, 'eq-empty', '遗物', '尚无遗物 —— 事件与精英战会掉落');
    } else {
      m.relics.forEach(r => line(body, 'eq-relic' + (r.unknown ? ' eq-unknown' : ''),
        // 认不出的 id 继续把 ❔ 写在标题里（textContent），并**不给图标** —— 契约 7。
        (r.unknown ? r.ic + ' ' : '') + r.n + (r.count > 1 ? ' ×' + r.count : ''),
        (r.rarityLabel ? '【' + r.rarityLabel + '】' : '') + r.d,
        r.unknown ? null : pixelIconSVG(relicIconKey(r.id))));
    }

    /* 组合技：只在真的凑齐时出现，写明是哪两件凑成的 —— 这是整套系统
       唯一的常驻展示位，藏起来就等于没有。纯只读：不补护盾、不发提示。 */
    m.synergies.forEach(s => {
      line(body, 'eq-synergy', s.ic + ' ' + s.n,
        s.members.map(m2 => m2.n).join(' + ') + ' → ' + s.d);
    });

    /* 影分身额度（只在本局持有该遗物时才有意义） */
    if (m.ghost.owned) {
      line(body, m.ghost.left ? 'eq-ghost' : 'eq-ghost eq-spent', '影分身额度',
        m.ghost.left ? '本轮剩余 1 次（免费撤退）' : '本轮已耗尽（跳过需付代价）');
    }

    /* 道具：持有数 + 本场已用/上限 */
    if (!m.items.length) {
      line(body, 'eq-empty', '道具', '背包是空的 —— 商店和精英战会掉落道具');
    } else {
      m.items.forEach(i => line(body, 'eq-item' + (i.unknown ? ' eq-unknown' : '') + (i.spent ? ' eq-spent' : ''),
        (i.unknown ? i.ic + ' ' : '') + i.n + ' ×' + i.owned,
        i.d + ' · 本场已用 ' + i.usedThisFight + '/' + i.max + (i.spent ? ' · 已用满' : ''),
        i.unknown ? null : pixelIconSVG(i.id)));
    }

    return el;
  }

  return { renderEquipmentPanel };
}