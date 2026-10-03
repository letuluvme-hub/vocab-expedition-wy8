import { chromium, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { verifyPublishedFiles, verifyLegacyPlay, verifyDailyPlay } from './verify-public-checks.mjs';

const url=process.argv[2];
if(!/^https:\/\/letuluvme-hub\.github\.io\/vocab-expedition-wy8\/(?:\?.*)?$/.test(url||''))throw new Error('Expected exact public game URL');
const chrome=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser=await chromium.launch({executablePath:existsSync(chrome)?chrome:undefined,args:['--mute-audio']});
try {
  const output=path.resolve('test-results/public-verification');mkdirSync(output,{recursive:true});
  const request=await browser.newContext();
  let publication;
  try {publication=await verifyPublishedFiles({request:request.request,url,directory:path.resolve('dist'),expectedVersion:JSON.parse(readFileSync('public/version.json','utf8')).version});}
  finally {await request.close();}
  const mobile=[];
  for(const width of [320,390]){
    const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
    try {
      await context.grantPermissions(['clipboard-read','clipboard-write']);
      await context.addInitScript(()=>{
        let seed=0x51a7;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        if(!sessionStorage.getItem('public-check')){
          localStorage.setItem('wy8a_rogue_v1',JSON.stringify({runs:7,wins:2,mastered:['factory'],best:4,custom:[{w:'cat',z:'猫'}],hero:'ranger',kbMode:true,kbUpper:true,rewards:[],voice:false,mute:true,vol:0,future:{keep:true}}));
          sessionStorage.setItem('public-check','1');
        }
      });
      const page=await context.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(url,{waitUntil:'networkidle',timeout:60000});
      const legacy=await verifyLegacyPlay(page),daily=await verifyDailyPlay(page);
      expect(errors).toEqual([]);await page.screenshot({path:path.join(output,`title-${width}.png`),fullPage:true});
      mobile.push({width,legacy,daily,pageErrors:errors});
    } finally {await context.close();}
  }
  const report={url,browser:browser.version(),publication,mobile};
  writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}
