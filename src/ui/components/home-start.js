import {availableHeroId} from '../../domain/hero-unlocks.js';
import {bookById} from '../../data/books.js';
import {heroById,HERO_DEFAULT} from './hero.js';

// Presentation only. Dismissal is persisted by the app's existing save port.
export function createHomeStart({getDB,getBook,getUnit,allWords,onDismiss}){
 let row,range,guide,manual=false;
 const $=id=>document.getElementById(id);
 function dismiss(){manual=false;onDismiss();paint()}
 function build(){
  if(row)return;
  const screen=$('s-title'),sub=screen.querySelector('.sub');row=$('startRow');
  if(!row||!sub)return;
  sub.after(row);
  row.appendChild($('continueRow'));
  range=document.createElement('p');range.id='homeRange';range.setAttribute('aria-live','polite');row.appendChild(range);
  const help=document.createElement('button');help.id='homeHowTo';help.type='button';help.textContent='怎么玩';help.onclick=()=>{manual=true;paint();guide.scrollIntoView({block:'nearest'});};row.appendChild(help);
  guide=document.createElement('section');guide.id='homeTutorial';guide.setAttribute('aria-label','新手教程');
  guide.innerHTML='<h2>第一次玩？三步就会</h2><ol><li>开始后，点地图上<b>发亮的节点</b>。</li><li>战斗时看中文，点字母<b>拼英文</b>。</li><li>拼对就能出招，打败怪物继续前进。</li></ol>';
  const done=document.createElement('button');done.id='homeTutorialDismiss';done.type='button';done.textContent='知道了';done.onclick=dismiss;guide.appendChild(done);row.after(guide);
  const choices=document.createElement('section');choices.id='homeChoices';choices.setAttribute('aria-label','调整词汇和角色');
  const book=$('textbookPicker');screen.insertBefore(choices,book);
  // Keep the same controls and callbacks; only their home grouping changes.
  const rangeLabel=book.nextElementSibling,heroLabel=$('units').nextElementSibling;
  for(const node of [book,rangeLabel,$('units'),heroLabel,$('heroes'),$('heroDesc')])choices.appendChild(node);
 }
 function paint(){
  build();if(!row)return;
  const db=getDB(),unit=getUnit();
  range.textContent='当前：'+bookById(getBook()).short+' · '+(unit===0?'我的词表':'Unit '+unit)+' · '+allWords(unit).length+' 词 · '+heroById(availableHeroId(db,db.hero||HERO_DEFAULT)).n;
  guide.hidden=db.homeTutorialSeen===true&&!manual;
  const sub=$('s-title').querySelector('.sub');sub.textContent='看中文，拼英文，让你的角色出招打怪。';
 }
 return {paint,dismiss};
}
