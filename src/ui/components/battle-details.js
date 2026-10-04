import {foeTraits} from '../../domain/foe-traits.js';
import {INTERRUPT_HINT} from './foe-attack-meter.js';

/* The panel borrows the progress controller's real pause. It owns no timer,
 * combat rule or save field. Opponents remain above the sheet as context. */
export function createBattleDetails({getRun,getBattle,onOpen,onClose}) {
  let dialog=null,body=null,mechanism=null,trigger=null,token=null,focusBefore=null;
  const inertBefore=new Map();
  const D=()=>typeof document==='undefined'?null:document;
  function place(){
    if(!dialog)return;
    const stage=D().getElementById('fBattleStage');
    const bottom=stage.getBoundingClientRect().bottom;
    dialog.style.top=Math.max(0,bottom+4)+'px';
  }
  function release(){
    inertBefore.forEach((value,node)=>{node.inert=value});inertBefore.clear();
    if(dialog)dialog.hidden=true;
    trigger?.setAttribute('aria-expanded','false');
    D()?.getElementById('fBattleStage')?.setAttribute('aria-label','双方战况');
  }
  function close({resume=true}={}){
    if(!token)return false;
    const owned=token.run===getRun()&&token.battle===getBattle()
      &&D().getElementById('s-fight').classList.contains('on');
    token=null;release();
    if(resume&&owned)onClose?.();
    if(focusBefore?.isConnected)focusBefore.focus({preventScroll:true});
    return true;
  }
  function open(){
    if(token)return false;
    const run=getRun(),battle=getBattle();
    if(!run||!battle||battle.over||onOpen?.()!==true)return false;
    token={run,battle};focusBefore=D().activeElement;
    const stage=D().getElementById('fBattleStage');
    [...D().getElementById('s-fight').children].filter(n=>n!==dialog).forEach(n=>{
      inertBefore.set(n,n.inert);n.inert=true;
    });
    // Inert stops input; it does not hide the original HP or sprites.
    stage.setAttribute('aria-label','双方战况（查看详情时战斗已暂停）');
    dialog.hidden=false;trigger.setAttribute('aria-expanded','true');
    render();place();D().getElementById('fDetailsClose').focus({preventScroll:true});
    return true;
  }
  function build(){
    if(dialog?.isConnected)return body;
    const doc=D(),screen=doc?.getElementById('s-fight'),stage=doc?.getElementById('fBattleStage');
    if(!screen||!stage)return null;
    const dock=doc.createElement('div');dock.id='fActionDock';
    const items=doc.getElementById('fItems');dock.appendChild(items);
    trigger=doc.createElement('button');trigger.id='fDetailsOpen';trigger.type='button';
    trigger.textContent='装备 · 机制';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','fBattleDetails');trigger.onclick=open;dock.appendChild(trigger);
    screen.insertBefore(dock,screen.querySelector('.bankbar'));
    dialog=doc.createElement('section');dialog.id='fBattleDetails';dialog.hidden=true;
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','fDetailsTitle');
    const header=doc.createElement('header');
    const title=doc.createElement('h2');title.id='fDetailsTitle';title.textContent='装备与战斗机制';header.appendChild(title);
    const button=doc.createElement('button');button.id='fDetailsClose';button.type='button';button.textContent='关闭 · 继续';button.onclick=()=>close();header.appendChild(button);dialog.appendChild(header);
    const paused=doc.createElement('p');paused.className='battleDetailsPaused';paused.textContent='战斗已暂停，查看不会消耗提示或道具';dialog.appendChild(paused);
    body=doc.createElement('div');body.id='fDetailsBody';
    mechanism=doc.createElement('div');mechanism.id='fDetailsMechanism';body.appendChild(mechanism);dialog.appendChild(body);screen.appendChild(dialog);
    doc.addEventListener('keydown',event=>{
      if(!token)return;
      if(!screen.classList.contains('on')){close({resume:false});return}
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close()}
      else if(event.key==='Tab'){
        const nodes=[...dialog.querySelectorAll('button,[href],[tabindex="0"]')].filter(n=>!n.disabled&&!n.hidden);
        const first=nodes[0],last=nodes.at(-1);
        if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last?.focus()}
        else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first?.focus()}
      }
    },true);
    globalThis.addEventListener?.('resize',place);
    return body;
  }
  function render(){
    if(!build())return;
    if(token&&(token.run!==getRun()||token.battle!==getBattle()))close({resume:false});
    const battle=getBattle(),trait=foeTraits(battle?.foe);
    mechanism.textContent='';
    const charge=D().createElement('p');charge.textContent=INTERRUPT_HINT+'。收招后会再次蓄力。';mechanism.appendChild(charge);
    if(trait){const text=D().createElement('p');text.textContent=trait.tag+'：'+trait.tip;mechanism.appendChild(text)}
  }
  return {getMount:build,render,isOpen:()=>!!token,open,close};
}
