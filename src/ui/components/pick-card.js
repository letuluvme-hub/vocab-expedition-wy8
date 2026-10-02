/* 统一的奖励卡渲染：战斗奖励 / 事件 / 商店 / 营火 共用同一份徽标与分层文案。
 * 纯函数，不读任何战斗/远征状态，也不碰 DOM。 */
import { pixelIconSVG, relicIconKey } from './pixel-art.js';

export const CAT_LABEL = {relic:'遗物', item:'道具', heal:'恢复', boost:'增益', event:'事件', none:'无'};

/* 从卡片 id 里认出它讲的是哪件装备，取像素图标。
 *
 * 只认这几种**我们自己拼出来的** id 形状：
 *   shop:item:<id> / shop:relic:<id> / shop:relic:<id>:<price>
 *   reward:item:<id> / reward:relic:<id> / rest:relic:<id>
 * 认不出就返回 null —— 调用方回落到数据层自带的 emoji。
 * ★ 绝不把 id 本身写进返回值：这里的输出会经 innerHTML 上屏，
 *   而 id 可能来自存档（reopenEncounter 的恢复路径）。 */
function iconForOption(o) {
  const id = typeof o.id === 'string' ? o.id : '';
  const m = id.match(/^(?:shop|reward|rest):(item|relic):([^:]+)/);
  if (!m) return null;
  return pixelIconSVG(m[1] === 'relic' ? relicIconKey(m[2]) : m[2]);
}

export function pickCardHTML(o){
  const cat = CAT_LABEL[o.cat] ? o.cat : 'none';
  // 认得出装备时用像素图标；否则**逐字节保持**原来的「emoji + 空格」写法
  // （那是模块化重构期就钉住的基线，改它会让归档对照测试失去意义）。
  const px = iconForOption(o);
  const head = px ? '<span class="ic">' + px + '</span>' + o.t
    : (o.ic ? o.ic + ' ' : '') + o.t;
  return '<i class="ctag" data-cat="'+cat+'">'+CAT_LABEL[cat]+'</i>'
    + '<b>' + head + '</b>'
    + '<span>'+o.d+'</span>'
    + (o.tip ? '<span class="ctip">'+o.tip+'</span>' : '');
}
