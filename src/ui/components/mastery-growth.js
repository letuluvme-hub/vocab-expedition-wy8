/* 「知识成长」只读展示（主页/远征入口的一小块说明区）。
 *
 * 契约（docs/feature-mastery-growth.md，逐条核对）：
 *  1) **纯只读**。组件拿 getSummary() 返回的摘要画三行字，不写 run / DB / 存储，
 *     也不改传进来的 summary 对象。规则在 domain/mastery-growth.js，这里只画。
 *  2) 容器 id 固定 masteryGrowth、段标题固定「知识成长」：父层接线与 e2e 按 id 定位，
 *     按文本找会同时命中「知识成长带来的 +3」这类说明文案。
 *  3) 一行固定口径：`教材词汇 n/259 · 下轮生命上限 +X（最多+12）`。
 *     259 是词库规模，由摘要的 totalCount 提供，不写死在这里。
 *  4) 差几词说清楚：未封顶写「再学 N 个教材词，下轮生命上限 +X+1」，
 *     封顶后写明「已达上限 +12（封顶）」，不许静默停在 +12 像卡住了。
 *  5) 说明文字**只承诺新开一轮生效**：不补回血、不提高本轮生命上限、
 *     跨单元不再额外增加。这三条是用户最容易误读的地方（"我刚学了 20 词怎么没回血"）。
 *  6) **全部 textContent 落屏**。summary 字段来自存档 / 词库，是用户可写内容，
 *     拼进 innerHTML 就是存储型 XSS。DOM 桩里 innerHTML 的 setter 直接抛异常，
 *     这条契约是被测试强制的，不是靠自觉。
 *  7) 坏 summary（null / 字段缺失）降级成 0 进度，绝不把 NaN / undefined 写上屏。
 *  8) mount 幂等：复用同一个节点，不重建（父层重复调用 renderTitle 时不会堆叠）。
 *     没有宿主元素时安静返回 null，不抛 —— 父层没接线不该弄崩整个主页。
 */
import { GROWTH_MAX_BONUS, ATTACK_GROWTH_MAX } from '../../domain/mastery-growth.js';

export const MASTERY_GROWTH_ID = 'masteryGrowth';
export const MASTERY_GROWTH_TITLE = '知识成长';

/* 文案里的数字：只接受有限非负整数，其余一律当 0。NaN 绝不上屏。 */
function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

const NOTE = '算的是你学会的教材词：远征里整词拼对、预习里不看提示拼对，以前默写掌握的也算。只在新开一轮远征时生效：正在远征中或从存档恢复时不会补回生命，也不会提高本轮生命上限；跨单元不再额外增加。';

export function createMasteryGrowth({ getSummary, document: doc } = {}) {
  const D = doc || (typeof document !== 'undefined' ? document : null);
  let host = null;   // 复用同一个容器

  const el = (tag, cls) => {
    const node = D.createElement(tag);
    node.className = cls;
    return node;
  };

  function build(parent) {
    if (!parent || typeof parent.appendChild !== 'function') return null;
    const box = el('section', 'mgrowth');
    box.id = MASTERY_GROWTH_ID;
    box.appendChild(el('h4', 'mgrowth-h')).textContent = MASTERY_GROWTH_TITLE;
    box.appendChild(el('p', 'mgrowth-count'));
    box.appendChild(el('p', 'mgrowth-next'));
    box.appendChild(el('p', 'mgrowth-attack'));
    box.appendChild(el('p', 'mgrowth-attack-next'));
    box.appendChild(el('p', 'mgrowth-note')).textContent = NOTE;
    parent.appendChild(box);
    return box;
  }

  function mount(parent) {
    host = host && host.parentElement ? host : build(parent);
    return host;
  }

  function paint() {
    if (!host) return null;
    const s = (getSummary && getSummary()) || {};

    const mastered = num(s.masteredCount);
    const total = num(s.totalCount);
    const max = num(s.maxBonusHp) || GROWTH_MAX_BONUS;
    const hp = Math.min(max, num(s.bonusHp));
    const toNext = num(s.toNext);
    const capped = total > 0 && hp >= max;
    const valid = total > 0 && Number.isFinite(s.toNext);

    /* 固定口径一行：分母永远来自词库规模（259），分子是真实教材掌握数。 */
    const line = byClass(host, 'mgrowth-count');
    if (line) line.textContent =
      '教材词汇 ' + mastered + '/' + total + ' · 下轮生命上限 +' + hp + '（最多+' + max + '）';

    /* 差几词：封顶后明确写「已达上限」，未封顶写清下一个台阶。 */
    const next = byClass(host, 'mgrowth-next');
    if (next) {
      next.textContent = !valid
        ? '尚未取得教材成长进度'
        : capped
        ? '已达上限 +' + hp + '（封顶），继续学教材词不再提升生命上限'
        : '再学 ' + toNext + ' 个教材词，下轮生命上限 +' + (hp + 1);
    }
    const attack = Math.min(ATTACK_GROWTH_MAX,num(s.bonusAttackPct));
    byClass(host,'mgrowth-attack').textContent = '下轮攻击 +' + attack + '%（最多+' + ATTACK_GROWTH_MAX + '%）';
    byClass(host,'mgrowth-attack-next').textContent = attack >= ATTACK_GROWTH_MAX ? '攻击成长已封顶，继续学习仍会积累掌握记录' : '每学会 10 个教材词，攻击 +4%；再学会 ' + num(s.attackToNext) + ' 词升级';
    return host;
  }

  return { mount, paint };
}

/* 幂等地找本模块自己的行节点（重复 paint 复用同一批节点，不新建）。 */
function byClass(root, cls) {
  const list = root.querySelectorAll ? root.querySelectorAll('.' + cls) : null;
  if (list) return list[0] || null;
  const kids = root.children || [];
  for (const c of kids) {
    if (c.className && String(c.className).split(/\s+/).indexOf(cls) >= 0) return c;
  }
  return null;
}
