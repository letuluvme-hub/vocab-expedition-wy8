/* 远征者形象（纯 CSS，无图片/无 emoji）。
 * 标题页卡片与战斗页 #fPcI 共用同一份部件顺序 —— 改这里必须同时核对 index.html。
 * 纯字符串函数，不依赖 DOM、不改状态。
 */
import { HEROES } from '../../data/heroes.js';

export function pcHTML(id) {
  return '<div class="pc" data-h="' + id + '"><div class="pci">' +
    '<i class="pc-shadow"></i><i class="pc-cape"></i><i class="pc-torso"></i>' +
    '<i class="pc-hairb"></i><i class="pc-sash"></i><i class="pc-arm"></i>' +
    '<i class="pc-hand"></i><i class="pc-prop"></i><i class="pc-head"></i>' +
    '<i class="pc-blush"></i><i class="pc-eye pc-eyeL"></i><i class="pc-eye pc-eyeR"></i>' +
    '<i class="pc-lid"></i><i class="pc-mouth"></i><i class="pc-hair"></i>' +
    '<i class="pc-hairt"></i><i class="pc-gear"></i>' +
  '</div></div>';
}

// 卡片上的数值速览：把 mod 翻成「生命 -10 / 提示 +1」这种一眼能懂的短标签
export function heroStatLines(H) {
  const M = H.mod || {}, out = [];
  if (M.hp)      out.push('生命 ' + (M.hp > 0 ? '+' : '') + M.hp);
  if (M.hint)    out.push('提示 ' + (M.hint > 0 ? '+' : '') + M.hint);
  if (M.noise)   out.push('干扰字母 ' + (M.noise > 0 ? '+' : '') + M.noise);
  if (M.shield)  out.push('护盾 +' + M.shield);
  if (M.gold)    out.push('金币 +' + M.gold);
  if (M.regen)   out.push('开场回血 +' + M.regen);
  if (M.leech)   out.push('答对回血 +' + M.leech);
  if (M.combo)   out.push('连击加成 ' + (M.combo * 100 - 100).toFixed(0) + '%');
  return out;
}

/* 兼容老存档 / 未来新增角色：认不出的 id 一律回退第一位，绝不让 undefined 渗进数值计算。
 *
 * VE-20：按 id 查表曾有 7 个 `.filter(x => x.id === id)[0]` 副本（这里、runtime.js ×2、
 * fight.js、map.js、over.js、equipment-panel.js ×2、relic-rules.js）。数据量小，线性扫描
 * 从来不是问题；问题是同一份查找逻辑有 7 份拷贝，改一处忘另一处只会静默地让某个界面
 * 少显示一个道具。实现现已统一住在 src/data/lookup.js，这里只做**再导出**，
 * 好让 UI 层继续从「角色形象」这个模块取它，不必知道索引住在哪一层。 */
export const HERO_DEFAULT = HEROES[0].id;
export { heroById } from '../../data/lookup.js';