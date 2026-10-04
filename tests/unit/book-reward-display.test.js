import test from 'node:test';
import assert from 'node:assert/strict';
import {rewardScope,renderRewardCard} from '../../src/ui/components/reward-card.js';
import {renderOver} from '../../src/ui/screens/over.js';

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this._text='';this._html='';this.hidden=false;this.disabled=false;}
  appendChild(child){this.children.push(child);return child;}
  set textContent(value){this._text=String(value);this.children=[];this._html='';}
  get textContent(){return this.children.length?this.children.map(child=>child.textContent).join('\n'):this._text;}
  set innerHTML(value){this._html=String(value);this._text='';this.children=[];}
  get innerHTML(){return this._html;}
}
const card = overrides => ({id:'WR-book',unit:1,heroId:'ranger',accuracy:95,kills:5,floor:9,
  earnedAt:'2026-10-04T04:00:00.000Z',roundNumber:2,completedUnits:[1],roundComplete:false,...overrides});
function withDocument(fn,ids=[]){
  const previous=globalThis.document,els=new Map(ids.map(id=>[id,new Element('div')]));
  globalThis.document={createElement:tag=>new Element(tag),getElementById:id=>els.get(id)||null};
  try{return fn(els);}finally{globalThis.document=previous;}
}
function renderedCard(value){return withDocument(()=>{const box=new Element('div');renderRewardCard(box,value);return box.children[0];});}
const OVER_IDS=['oReward','oAgain','oNext','oIcon','oTitle','oText','oFloor','oKill','oAcc','oRelics'];
function over(bookId,unit=1){
  const run={unit,maxFloor:9,kills:5,att:20,attOk:19,relics:[],reward:card({unit,bookId}),...(bookId?{bookId}: {})};
  const db={rewards:[run.reward],unknown:{kept:true}},before=structuredClone({run,db}),calls=[];
  const campaign={counts:()=>({complete:false,passed:true,total:29,remaining:0}),next:current=>current===6?null:current+1,isUnlocked:()=>true};
  const els=withDocument(els=>{renderOver({run,db,win:true,campaign,onNextUnit:()=>calls.push('next'),
    onTitle:()=>calls.push('title'),show:id=>calls.push(id)});return els;},OVER_IDS);
  assert.deepEqual({run,db},before,'display must not rewrite saved reward or learning proof');
  return {els,calls};
}

test('reward ranges are selected from the saved book, with upper legacy spelling unchanged',()=>{
  assert.equal(rewardScope(1),'Unit 1 水与资源');assert.equal(rewardScope(1,'wy8a'),'Unit 1 水与资源');
  assert.equal(rewardScope(1,'wy8b'),'八下 · Unit 1');assert.equal(rewardScope(6,'wy8b'),'八下 · Unit 6');
  assert.equal(rewardScope(-1,'wy8b'),'八下 · 全册');assert.equal(rewardScope(0,'wy8b'),'我的词表');
  assert.equal(rewardScope(1,'future-unknown'),'Unit 1 水与资源');
});

test('lower-book commemorative card shows book-specific scope and only its recorded completed units',()=>{
  const value=card({bookId:'wy8b',unit:3,completedUnits:[1,3]}),before=structuredClone(value),rendered=renderedCard(value);
  assert.equal(rendered.children[2].textContent,'八下 · Unit 3 · 游侠');
  assert.equal(rendered.children[4].textContent,'本轮完成单元：八下 · Unit 1、八下 · Unit 3');
  assert.doesNotMatch(rendered.textContent,/水与资源|成长与发现|Unit 2|全册已掌握/);
  assert.match(rendered.textContent,/本轮学习范围未完成/);assert.deepEqual(value,before);
});

test('upper-book old cards and explicitly upper cards render identically without invented book labels',()=>{
  const legacy=card(),explicit=card({bookId:'wy8a'});
  assert.equal(renderedCard(legacy).textContent,renderedCard(explicit).textContent);
  const rendered=renderedCard(legacy);assert.equal(rendered.children[2].textContent,'Unit 1 水与资源 · 游侠');
  assert.equal(rendered.children[4].textContent,'本轮完成单元：Unit 1 水与资源');
  assert.doesNotMatch(rendered.textContent,/八上|八下/);
});

test('lower-book settlement and next-unit action display the same book without changing continuation rules',()=>{
  const {els,calls}=over('wy8b');
  assert.match(els.get('oText').textContent,/完成了八下 · Unit 1的本次远征/);
  assert.match(els.get('oText').textContent,/八下 · Unit 2 的词汇已解锁/);
  assert.equal(els.get('oNext').textContent,'继续 八下 · Unit 2');
  assert.match(els.get('oNext').title,/进入 八下 · Unit 2/);
  assert.equal(els.get('oNext').hidden,false);assert.equal(els.get('oAgain').hidden,true);
  assert.match(els.get('oReward').textContent,/八下 · Unit 1 · 游侠/);
  els.get('oNext').onclick();assert.deepEqual(calls,['s-over','title','next']);
});

test('last lower-book settlement names the correct range and does not claim whole-book mastery',()=>{
  const {els}=over('wy8b',6);assert.match(els.get('oText').textContent,/完成了八下 · Unit 6的本次远征/);
  assert.match(els.get('oText').textContent,/本册词汇已完成/);assert.equal(els.get('oNext').hidden,true);
  assert.doesNotMatch(els.get('oText').textContent,/外星来客|全册已掌握/);
});

test('explicit upper-book and old settlement keep every visible text and continuation callback unchanged',()=>{
  const legacy=over(),explicit=over('wy8a');
  for(const id of OVER_IDS)assert.equal(legacy.els.get(id).textContent,explicit.els.get(id).textContent,id);
  assert.equal(legacy.els.get('oNext').textContent,'继续 Unit 2');
  assert.match(legacy.els.get('oText').textContent,/完成了Unit 1 水与资源的本次远征/);
  assert.doesNotMatch(legacy.els.get('oText').textContent,/八上|八下/);
  legacy.els.get('oNext').onclick();assert.deepEqual(legacy.calls,['s-over','title','next']);
});
