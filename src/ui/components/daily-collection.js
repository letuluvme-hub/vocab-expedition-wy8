import { PARTNER_STAGES } from '../../domain/daily-collection.js';
import { BOOKS, DEFAULT_BOOK_ID, bookById, bookUnits } from '../../data/books.js';

// Original seed-and-ink companion, drawn from rectangles rather than game art.
export function partnerArt(doc,stage,accessory) {
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 64 64');svg.setAttribute('role','img');svg.setAttribute('aria-label',`原创伙伴墨芽 · ${PARTNER_STAGES[stage].name}`);
  const title=doc.createElementNS(ns,'title');title.textContent='墨芽：从墨水种子长出的星叶伙伴';svg.append(title);
  function rect(x,y,w,h,color,parent=svg){const r=doc.createElementNS(ns,'rect');for(const [k,v] of Object.entries({x,y,width:w,height:h,fill:color}))r.setAttribute(k,String(v));parent.append(r);}
  rect(12,54,40,4,'#102238');rect(20,50,8,4,'#52d2bf');rect(36,50,8,4,'#52d2bf');
  for(const [x,y,w,h] of [[20,24,24,4],[16,28,32,4],[12,32,40,12],[16,44,32,4],[20,48,24,4]])rect(x,y,w,h,'#183c49');
  rect(20,28,24,4,'#91ead2');rect(16,32,32,12,'#67d7c3');rect(20,44,24,4,'#4dbbab');
  rect(20,32,4,8,'#172b46');rect(40,32,4,8,'#172b46');rect(20,32,2,3,'#f2fff9');rect(40,32,2,3,'#f2fff9');
  rect(28,40,8,4,'#f1d6ba');rect(16,40,4,3,'#e79bb0');rect(44,40,4,3,'#e79bb0');
  rect(28,20,4,8,'#64c68e');rect(24,16,8,4,'#84dfab');
  if(stage>=1){rect(16,12,12,4,'#70cd9a');rect(20,16,8,4,'#56ad82');rect(32,8,12,4,'#8be3a6');rect(32,12,8,8,'#65bc8d');}
  if(stage>=2){rect(8,24,8,4,'#85dcaa');rect(4,28,12,4,'#5cbd94');rect(48,20,8,4,'#9adfbb');rect(48,24,12,4,'#78cfa9');}
  if(stage>=3){rect(4,8,4,4,'#ffe8a6');rect(52,40,4,4,'#ffe8a6');rect(8,44,4,4,'#ffe8a6');}
  if(stage>=4){rect(44,4,4,4,'#c0a9ee');rect(48,8,4,4,'#c0a9ee');rect(52,12,4,4,'#c0a9ee');}
  if(stage>=5){rect(24,4,4,4,'#ffe0a0');rect(28,0,4,12,'#ffe0a0');rect(32,4,4,4,'#ffe0a0');}
  if(accessory){const group=doc.createElementNS(ns,'g');group.dataset.accessory=accessory;svg.append(group);
    if(accessory==='leaf-ribbon'){rect(16,18,8,4,'#f3b0c8',group);rect(12,14,4,12,'#dc83aa',group);rect(24,14,4,12,'#dc83aa',group);}
    if(accessory==='sky-scarf'){rect(16,44,32,4,'#8daff3',group);rect(36,48,8,8,'#638ddd',group);}
    if(accessory==='star-pin'){rect(44,36,8,4,'#ffd788',group);rect(46,32,4,12,'#ffd788',group);}
  }
  return svg;
}

export function createDailyCollectionView({host,atlasHost=host,getView,getCards,getBook=()=>DEFAULT_BOOK_ID,onEquip,onMakeup,getSaved=()=>null,document:doc=globalThis.document}={}) {
  const el=(tag,text,id,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(id)node.id=id;if(cls)node.className=cls;return node;};
  const button=(text,id,action)=>{const b=el('button',text,id);b.type='button';b.onclick=action;return b;};
  const root=el('section',undefined,undefined,'daily-collection');host.append(root);
  const atlasRoot=el('section',undefined,'homeAtlas','daily-collection home-atlas');atlasHost.append(atlasRoot);
  let expanded=false,unit=1,bookId=DEFAULT_BOOK_ID,bookChosen=false,date=null,makeupMessage='';
  function paint() {
    const view=getView();date=view.checkin.date;root.replaceChildren();paintAtlas(view);
    const partner=el('div',undefined,undefined,'daily-partner');
    const art=el('div',undefined,'dailyPartner','daily-partner-art');art.append(partnerArt(doc,view.partner.stage,view.equipped.partner));
    const facts=el('div',undefined,undefined,'daily-partner-facts');facts.append(el('h3',`我的伙伴 · ${view.partner.name}`),el('p',`${view.partner.stageName} · 已学会 ${view.partner.count} 词`),
      el('p',view.partner.nextName?`到「${view.partner.nextName}」还差 ${view.partner.remaining} 词`:'所有成长形态已收集','dailyPartnerProgress'));
    partner.append(art,facts);root.append(partner,el('p',`已收集形态：${view.partner.unlockedStages.map(i=>PARTNER_STAGES[i].name).join('、')}`,undefined,'daily-collection-note'));
    if(getSaved()===false)root.append(el('p','外观／补签未保存；当前效果保留，刷新会丢失。','dailyCollectionSaveWarning','daily-collection-warning'));
    if(view.cosmetics.length){
      const wardrobe=el('div',undefined,undefined,'daily-wardrobe');wardrobe.append(el('h4','外观收藏'));
      for(const type of ['partner','frame']){
        const owned=view.cosmetics.filter(c=>c.type===type);if(!owned.length)continue;
        const label=el('label',type==='partner'?'伙伴装饰':'词卡边框');const select=el('select',undefined,type==='partner'?'dailyAccessory':'dailyCardFrame');label.htmlFor=select.id;
        const none=el('option','原样');none.value='none';select.append(none);
        for(const item of owned){const option=el('option',item.name);option.value=item.id;select.append(option);}
        select.value=view.equipped[type]||'none';select.onchange=()=>onEquip(select.value,type);wardrobe.append(label,select);
      }
      root.append(wardrobe);
    }
    const checkin=el('div',undefined,undefined,'daily-checkin');
    checkin.append(el('p',`${view.checkin.date} · 连续 ${view.checkin.streak} 天 · ${view.checkin.checkedToday?'今日已打卡':'今日练习后结束即可打卡'}`,'dailyCheckin'));
    checkin.append(el('p',view.checkin.makeupUsed?'本周补签已使用':'每周可补签 1 次（周一开始）；只补最近 7 天的漏签日',undefined,'daily-collection-note'));
    if(view.checkin.candidates.length){
      const label=el('label','补签日期');const select=el('select',undefined,'dailyMakeupDate');label.htmlFor=select.id;
      for(const date of view.checkin.candidates){const option=el('option',date);option.value=date;select.append(option);}
      checkin.append(label,select,button('补签这一天','dailyMakeup',()=>{const result=onMakeup(select.value);makeupMessage=result.ok?`已补签 ${result.date}；学习记录照实保留`:result.reason;paint();}));
    }
    const status=el('p',makeupMessage,'dailyMakeupStatus','daily-collection-note');status.setAttribute('role','status');checkin.append(status);root.append(checkin);
  }
  function paintAtlas(view) {
    if(!bookChosen)bookId=bookById(getBook()).id;
    if(!bookUnits(bookId).some(item=>item.n===unit))unit=bookUnits(bookId).find(item=>item.n>0)?.n??0;
    atlasRoot.replaceChildren(el('h2','单词图鉴',undefined,'home-atlas-heading'));
    const toggle=button(expanded?'收起单词图鉴':'打开单词图鉴','dailyAtlasToggle',()=>{expanded=!expanded;paintAtlas(getView());});toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-controls','dailyAtlas');atlasRoot.append(toggle);
    if(expanded){
      const atlas=el('div',undefined,'dailyAtlas','daily-atlas');
      const bookLabel=el('label','教材册');const bookSelect=el('select',undefined,'dailyAtlasBook');bookLabel.htmlFor=bookSelect.id;
      for(const book of BOOKS){const option=el('option',book.label);option.value=book.id;bookSelect.append(option);}
      bookSelect.value=bookId;bookSelect.onchange=()=>{
        bookId=bookById(bookSelect.value).id;bookChosen=true;
        if(!bookUnits(bookId).some(item=>item.n===unit))unit=bookUnits(bookId).find(item=>item.n>0)?.n??0;
        paintAtlas(getView());
      };atlas.append(bookLabel,bookSelect);
      const label=el('label','按单元浏览');const select=el('select',undefined,'dailyAtlasUnit');label.htmlFor=select.id;
      for(const item of bookUnits(bookId)){const option=el('option',item.n?(item.t||`Unit ${item.n}`):'自定义收藏');option.value=String(item.n);select.append(option);}
      select.value=String(unit);select.onchange=()=>{unit=Number(select.value);paintAtlas(getView());};atlas.append(label,select);
      const cards=getCards(unit,bookId);atlas.append(el('p',`已收集 ${cards.filter(c=>c.level>0).length} / ${cards.length} · 学会了 ${cards.filter(c=>c.level>=3).length} · 复习稳固 ${cards.filter(c=>c.level===4).length}`,'dailyAtlasProgress','daily-collection-note'));
      const grid=el('div',undefined,'dailyAtlasCards','daily-atlas-grid');
      for(const card of cards){const item=el('article',undefined,undefined,`daily-card level-${card.level}`);item.dataset.word=card.key;if(view.equipped.frame)item.dataset.frame=view.equipped.frame;
        item.append(el('strong',card.word.w),el('p',card.word.z),el('span',card.label,undefined,'daily-card-level'));grid.append(item);}
      if(!cards.length)grid.append(el('p','开始练习后，见过的自定义词会留在这里。'));atlas.append(grid);atlasRoot.append(atlas);
    }
  }
  function paintCompletion(host,session) {
    if(!host||session?.phase!=='completed')return;
    const previous=host.querySelector('.daily-collection');previous?.remove();
    const view=getView(),gift=view.gift,box=el('div',undefined,undefined,'daily-collection');host.append(box);
    // A reward earned earlier today remains a single date fact; no second draw.
    if(!gift?.cosmetic){box.append(el('p','今日外观：有真实练习并结束后获得，每天一次。','dailyGift'));return;}
    box.append(el('h3',`今日外观 · ${gift.cosmetic.name}${gift.repeated?'（已拥有，今日相遇）':''}`,'dailyGift'),el('p','纯外观收藏；每天一次。',undefined,'daily-collection-note'));
    const preview=el('div',undefined,undefined,'daily-gift-preview');
    if(gift.cosmetic.type==='partner')preview.append(partnerArt(doc,view.partner.stage,gift.cosmetic.id));
    else{const card=el('article',undefined,undefined,'daily-card');card.dataset.frame=gift.cosmetic.id;card.append(el('strong','今日收藏'),el('p',gift.cosmetic.name));preview.append(card);}
    box.append(preview);const status=el('p',view.equipped[gift.cosmetic.type]===gift.cosmetic.id?'已穿戴':'可在主页外观收藏中选择','dailyGiftStatus');status.setAttribute('role','status');
    box.append(button('穿戴这件外观','dailyGiftEquip',()=>{const ok=onEquip(gift.cosmetic.id,gift.cosmetic.type);const status=doc.getElementById('dailyGiftStatus');if(status)status.textContent=ok?(getSaved()===false?'已穿戴，本机未保存，刷新会丢失':'已穿戴'):'未能穿戴，请回主页选择已拥有的外观';}),status);
  }
  return {paint,paintCompletion,updateDate:()=>{if(getView().checkin.date!==date){makeupMessage='';paint();}}};
}
