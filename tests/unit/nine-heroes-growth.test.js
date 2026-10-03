import {encodeSnapshot,decodeSnapshot,PHASE} from '../../src/domain/run-snapshot.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {HEROES} from '../../src/data/heroes.js';
import {WORDS} from '../../src/data/words.js';
import {createRun} from '../../src/domain/run.js';
import {growthSummary} from '../../src/domain/mastery-growth.js';
import {heroFinisherMultiplier} from '../../src/domain/hero-rules.js';
import {hitDmg,wordDmg,wordDmgCap} from '../../src/domain/damage.js';
import {createWordQ} from '../../src/domain/word-quality.js';

const run=(id,extra={})=>({...createRun(1,HEROES.find(h=>h.id===id),[]),...extra,heroId:id});
const battle=(extra={})=>({combo:5,dmgBonus:0,rageLeft:0,freezeWord:false,wordStreak:0,wordsDone:0,myHp:60,shield:0,enHp:500,enMax:1000,word:{w:'example'},wordQ:createWordQ(),...extra});
test('九个角色：旧身份顺序保持，新增三个进攻角色有生命和提示代价',()=>{
 assert.deepEqual(HEROES.map(h=>h.id),['scholar','warrior','scout','lucky','healer','ranger','berserker','pyromancer','assassin']);
 for(const id of ['berserker','pyromancer','assassin']){const r=run(id);assert.ok(r.maxhp<70);assert.equal(r.hm,-1)}
});
test('角色进攻条件：护盾、金币、半血、长词、无帮助与残血分别生效',()=>{
 assert.equal(heroFinisherMultiplier(run('warrior'),battle({shield:2})),1.2);
 assert.equal(heroFinisherMultiplier(run('warrior'),battle()),1);
 assert.equal(heroFinisherMultiplier(run('lucky',{gold:200}),battle()),1.2);
 assert.equal(heroFinisherMultiplier(run('lucky',{gold:9999}),battle()),1.2);
 assert.equal(heroFinisherMultiplier(run('berserker'),battle()),1.25);
 assert.equal(heroFinisherMultiplier(run('berserker'),battle({myHp:30})),1.45);
 assert.equal(heroFinisherMultiplier(run('pyromancer'),battle()),1.4);
 assert.equal(heroFinisherMultiplier(run('pyromancer'),battle({word:{w:'cat'}})),1);
 assert.equal(heroFinisherMultiplier(run('assassin'),battle()),1.35);
 assert.equal(heroFinisherMultiplier(run('assassin'),battle({enHp:350})),1.6);
 for(const field of ['wrong','hint','listen','revealed'])assert.equal(heroFinisherMultiplier(run('assassin'),battle({wordQ:{...createWordQ(),[field]:1}})),1);
 assert.equal(heroFinisherMultiplier(run('assassin'),battle({wordQ:undefined})),1);
 assert.equal(heroFinisherMultiplier(run('scholar'),battle()),1.15);
});
test('攻击成长：每10教材掌握词+4%，150词封顶60%，去重及自定义词无收益',()=>{
 for(const [n,pct] of [[0,0],[9,0],[10,4],[20,8],[100,40],[150,60],[259,60]])assert.equal(growthSummary(WORDS.slice(0,n).map(w=>w.w),WORDS).bonusAttackPct,pct);
 assert.equal(growthSummary([...WORDS.slice(0,10).flatMap(w=>[w.w,w.w.toUpperCase()]),'madeupword'],WORDS).bonusAttackPct,4);
});
test('新开局冻结攻击成长；旧成长无攻击，伪造成长拒绝，叠装备仍受伤害上限保护',()=>{
 const g={version:2,masteredAtStart:100,bonusHp:5,bonusAttackPct:40,baseMaxhp:70};
 const grown=createRun(1,HEROES[4],[],Math.random,g),plain=run('healer');
 assert.equal(grown.maxhp,70);assert.equal(grown.growth.bonusAttackPct,40);
 assert.ok(hitDmg(grown,battle())>hitDmg(plain,battle()));assert.ok(wordDmg(grown,battle())>wordDmg(plain,battle()));
 const old=createRun(1,HEROES[4],[],Math.random,{...g,version:1});assert.equal(hitDmg(old,battle()),hitDmg(plain,battle()));
 const forged=createRun(1,HEROES[4],[],Math.random,{...g,bonusAttackPct:60});assert.equal(forged.maxhp,65);
 const stacked=battle({combo:50,dmgBonus:500,rageLeft:3});assert.ok(wordDmg(grown,stacked)<=wordDmgCap(7));
});

test('version 2 attack facts persist exactly through snapshots; forged facts fail closed',()=>{
 const r=createRun(1,HEROES[0],WORDS.filter(w=>w.u===1),()=>0.5,{version:2,masteredAtStart:100,bonusHp:5,bonusAttackPct:40});
 const encoded=encodeSnapshot({phase:PHASE.MAP,run:r,battle:null,encounter:null},{now:100});
 assert.ok(encoded);const restored=decodeSnapshot(JSON.parse(JSON.stringify(encoded)));assert.ok(restored.ok);assert.deepEqual(restored.value.run.growth,r.growth);
 assert.equal(hitDmg(restored.value.run,battle()),hitDmg(r,battle()));
 r.growth.bonusAttackPct=60;assert.equal(encodeSnapshot({phase:PHASE.MAP,run:r,battle:null,encounter:null}),null);
});
