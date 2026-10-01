/* 统一的奖励卡渲染：战斗奖励 / 事件 / 商店 / 营火 共用同一份徽标与分层文案。
 * 纯函数，不读任何战斗/远征状态，也不碰 DOM。 */
export const CAT_LABEL = {relic:'遗物', item:'道具', heal:'恢复', boost:'增益', event:'事件', none:'无'};

export function pickCardHTML(o){
  const cat = CAT_LABEL[o.cat] ? o.cat : 'none';
  return '<i class="ctag" data-cat="'+cat+'">'+CAT_LABEL[cat]+'</i>'
    + '<b>'+(o.ic ? o.ic+' ' : '')+o.t+'</b>'
    + '<span>'+o.d+'</span>'
    + (o.tip ? '<span class="ctip">'+o.tip+'</span>' : '');
}