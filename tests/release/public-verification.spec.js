import { test, expect } from '@playwright/test';
import { verifyLegacyPlay, verifyDailyPlay } from '../../scripts/verify-public-checks.mjs';

for(const width of [320,390])test(`public verifier preserves old practice and completes honest daily learning at ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:844});
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.addInitScript(()=>{
    let seed=0x51a7;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    if(!sessionStorage.getItem('public-check')){
      localStorage.setItem('wy8a_rogue_v1',JSON.stringify({runs:7,wins:2,mastered:['factory'],best:4,custom:[{w:'cat',z:'猫'}],hero:'ranger',kbMode:true,kbUpper:true,rewards:[],voice:false,mute:true,vol:0,future:{keep:true}}));
      sessionStorage.setItem('public-check','1');
    }
  });
  await page.goto('/vocab-expedition-wy8/');
  const legacy=await verifyLegacyPlay(page);
  expect(legacy).toMatchObject({savePreserved:true,customWordPracticed:true,formalMastered:0});
  const daily=await verifyDailyPlay(page);
  expect(daily).toMatchObject({previewLearned:['dog'],hintedWord:'cat',clipboardCopied:true,width});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('wy8a_rogue_v1')));
  expect(saved.future).toEqual({keep:true});expect(saved.mastered).toEqual(expect.arrayContaining(['factory','cat','dog']));
});
