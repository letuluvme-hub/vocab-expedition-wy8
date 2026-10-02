/* 按 id 查数据表的**唯一**索引。
 *
 * 背景（VE-20）：`.filter(x => x.id === id)[0]` 这种写法在本项目里曾经有 **7 个副本**
 * —— runtime.js ×2、fight.js、map.js、over.js、equipment-panel.js ×2、relic-rules.js、
 * hero.js。数据量小，线性扫描的性能从来不是问题；问题是**同一份查找逻辑有 7 份拷贝**：
 * 改一处忘另一处不会报错，只会静默地让某一个界面少显示一个遗物。
 *
 * 本模块只做一件事：把三张静态表各建一次 Map，并把「查不到时返回什么」的语义
 * **逐个调用点原样保留**（这一点很重要，见下面三个函数的注释）：
 *   - heroById     —— 认不出一律回退 HEROES[0]，绝不把 undefined 渗进数值计算
 *   - relicById    —— 返回 undefined，调用方自己判空（"没有这个遗物就不要画"）
 *   - itemById     —— 返回 undefined，同上
 * 另有一个 relicByIdOrNull 给需要 null 而非 undefined 的调用点（equipment-panel）。
 *
 * 分层理由（AGENTS.md）：src/data/** 是「数据」，本文件同样是纯数据派生 ——
 * 无 DOM、无状态、无存档、无随机。它读的三张表都是模块级常量，所以这三个 Map
 * 在整个进程生命周期内恒定，可以放心缓存。
 *
 * 重复 id 的处理：与旧的 `.filter(...)[0]` 语义一致 —— **第一条赢**。
 * 这里用 `if (!m.has(id))` 显式表达，而不是无脑覆盖（后者会悄悄改变语义）。
 */
import { HEROES } from './heroes.js';
import { ITEMS } from './items.js';
import { RELICS } from './relics.js';

function indexById(list) {
  const m = new Map();
  for (const entry of (Array.isArray(list) ? list : [])) {
    if (!entry || typeof entry.id !== 'string') continue;   // 脏条目不污染索引
    if (!m.has(entry.id)) m.set(entry.id, entry);            // 第一条赢（同旧语义）
  }
  return m;
}

/* 三张表都是模块级常量，所以这三个 Map 在整个进程生命周期内恒定，可以放心缓存。
 * （这里刻意**不用** Object.freeze：它冻结的是自有属性，拦不住 Map.set 的内部槽，
 *  写上去反而会让人误以为索引不可变。要防误用就靠下面第一条赢的约定 + 单测。） */
export const HERO_BY_ID = indexById(HEROES);
export const ITEM_BY_ID = indexById(ITEMS);
export const RELIC_BY_ID = indexById(RELICS);

/** 角色：认不出的 id（旧存档 / 未来新增角色）一律回退第一位。永不返回 undefined。 */
export const heroById = id => HERO_BY_ID.get(id) || HEROES[0];

/** 遗物 / 道具：认不出返回 undefined —— 调用点惯例是 `if (!r) return;`，即"跳过"。 */
export const relicById = id => RELIC_BY_ID.get(id);
export const itemById = id => ITEM_BY_ID.get(id);

/** equipment-panel 那一支的既有约定：查不到返回 null 而不是 undefined。 */
export const relicByIdOrNull = id => RELIC_BY_ID.get(id) || null;
export const itemByIdOrNull = id => ITEM_BY_ID.get(id) || null;
