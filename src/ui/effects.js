import {clamp} from '../domain/math.js';

export function createEffects({environment=globalThis,sfx}) {
  const {document}=environment;
  const $=id=>document.getElementById(id);
  const setTimeout=environment.setTimeout.bind(environment);
  const clearTimeout=environment.clearTimeout.bind(environment);
  const requestAnimationFrame=environment.requestAnimationFrame.bind(environment);
  const addEventListener=environment.addEventListener.bind(environment);
const cv=$('fx'), ctx=cv.getContext('2d');
let parts=[], raf=0;
function sizeCanvas(){ cv.width=environment.innerWidth*environment.devicePixelRatio; cv.height=environment.innerHeight*environment.devicePixelRatio;
  ctx.setTransform(environment.devicePixelRatio,0,0,environment.devicePixelRatio,0,0) }
addEventListener('resize',sizeCanvas); sizeCanvas();

function burst(x,y,color,n,speed){
  for(let i=0;i<(n||12);i++){
    const a=Math.random()*Math.PI*2, s=(speed||3)*(.4+Math.random());
    parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-1.6,life:1,decay:.02+Math.random()*.03,
      r:1.6+Math.random()*2.6,c:color||'#22d3ee'});
  }
  loop();
}
function ring(x,y,color){
  parts.push({ring:1,x,y,vx:0,vy:0,life:1,decay:.045,r:6,c:color||'#ffce4d'});
  loop();
}
function floatTxt(x,y,txt,color){
  const d=document.createElement('div');
  d.className='float'; d.textContent=txt; d.style.color=color;
  d.style.left=x+'px'; d.style.top=y+'px';
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),1000);
}
function flash(color){
  const f=document.createElement('div');
  f.className='flashfx'; f.style.background=color;
  document.body.appendChild(f);
  requestAnimationFrame(()=>f.classList.add('go'));
  setTimeout(()=>f.remove(),400);
}
function loop(){
  if(raf) return;
  raf=requestAnimationFrame(function step(){
    ctx.clearRect(0,0,environment.innerWidth,environment.innerHeight);
    for(let i=parts.length-1;i>=0;i--){
      const p=parts[i];
      p.life-=p.decay;
      if(p.life<=0){ parts.splice(i,1); continue }
      p.x+=p.vx; p.y+=p.vy; p.vy+=p.ring?0:.14; p.vx*=.985;
      ctx.globalAlpha=Math.max(0,p.life);
      ctx.fillStyle=p.c;
      if(p.ring){ ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(1+(1-p.life)*7),0,6.3);
        ctx.strokeStyle=p.c; ctx.lineWidth=2.4*p.life; ctx.stroke() }
      else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r*p.life,0,6.3); ctx.fill() }
    }
    ctx.globalAlpha=1;
    raf = parts.length ? requestAnimationFrame(step) : 0;
  });
}
const centerOf = el => { if(!el) return {x:environment.innerWidth/2,y:environment.innerHeight/2};
  const r=el.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2} };

/* ================= 角色动画 =================
   只做「加 class → 到点移除」，动画本体全在 CSS keyframes 里（不用 JS 逐帧）。
   .pci 上同时可能挂着 idle/atk/hurt/fin：状态类互斥（每次进来先把旧的摘掉），
   idle 挂在外壳 .pc 上，永不冲突。
   ★ 单字母 = 'atk'（.34s 轻挥）；整词大招 = 'fin'（.78s 蓄力+暴挥）——
     两个 kind 走不同的 keyframes 和不同时长，视觉上不会混淆。 */
let heroAnimT=0;
const HERO_ANIM_CLS=['atk','hurt','fin'];
const HERO_ANIM_MS={hurt:440, fin:820, atk:360};
function animHero(kind){
  const fig=$('fPcI');
  if(!fig) return;
  clearTimeout(heroAnimT);
  fig.classList.remove(...HERO_ANIM_CLS);
  void fig.offsetWidth;            // 强制重排，让连续两次攻击能重新触发动画
  if(kind) fig.classList.add(kind);
  const ms=HERO_ANIM_MS[kind]||360;
  heroAnimT=setTimeout(()=>fig.classList.remove(...HERO_ANIM_CLS), ms);
}
// 角色形象辅助：中心点（粒子/飘字用）
const heroPoint=()=> centerOf($('fPc'));

function spawnFinWord(x,y,text,cls,delayMs,dx,dy,clampX){
  const d=document.createElement('div');
  d.className='finword'+(cls?' '+cls:'');
  d.textContent=text;
  d.style.left=x+'px'; d.style.top=y+'px';
  if(dx!==undefined) d.style.setProperty('--dx', dx+'px');
  if(dy!==undefined) d.style.setProperty('--dy', dy+'px');
  if(delayMs) d.style.animationDelay=delayMs+'ms';   // 命中节奏用 CSS 延迟，不靠 JS 计时器串联
  document.body.appendChild(d);
  if(clampX){
    // 只量这一次宽度（每词一次，不是每帧），换来「长词也绝不切边」
    const hw=(d.offsetWidth||0)/2;
    const vw=environment.innerWidth;
    if(hw>0){
      const nx=clamp(x, hw+6, Math.max(hw+6, vw-hw-6));
      if(nx!==x){
        d.style.left=nx+'px';
        if(dx!==undefined) d.style.setProperty('--dx', (dx+(nx-x))+'px');  // 飞行终点跟着一起挪
      }
    }
  }
  setTimeout(()=>d.remove(), 1100);
  return d;
}
/* 命中冲击波：一个 10px 圆环放大到 ~90px，纯 transform */
function finWave(x,y){
  const d=document.createElement('div');
  d.className='finwave';
  d.style.left=x+'px'; d.style.top=y+'px';
  document.body.appendChild(d);
  setTimeout(()=>d.remove(), 620);
}
/* 整词大招的完整反馈包。只在「整词拼完」那一个分支里调用，
   且与 creditWord() 同处一个分支 —— 记学会和大招动画天生同步。 */
function wordFinisher(word,dmg){
  animHero('fin');                                    // 专属大招动作，不复用单字母的 'atk'
  const av=$('fAv');
  av.classList.remove('hurt','finhurt'); void av.offsetWidth; av.classList.add('finhurt');
  setTimeout(()=>av.classList.remove('finhurt'), 560);
  const c=centerOf(av);
  const hp=heroPoint();
  // 完整单词：先从角色位置甩向敌人，命中后在敌人身上炸成金色大字。
  // 飞行路径走在 .vsrow 这一带的中线上，不会压到下方卡片里的中文释义和字母槽。
  // clampX：实测「treatment」这类 9 字母词以敌人中心为锚会溢出屏幕左边 53px，
  //          两枚都收进视口，保证长词也一眼看全。
  const pop=spawnFinWord(c.x, c.y, word, 'pop', 190, undefined, undefined, true);
  const px=parseFloat(pop.style.left)||c.x;      // 夹逼后的真实落点，冲击波跟着它走
  spawnFinWord(hp.x, hp.y-26, word, 'go', 0, px-hp.x, c.y-(hp.y-26), true);
  finWave(px, c.y);
  burst(px,c.y,'#ffce4d',54,8);                     // 54 粒子（单字母只有 20）
  burst(px,c.y,'#ffffff',22,10);
  ring(px,c.y,'#ffce4d'); ring(px,c.y,'#ffe9a0');  // 双圈
  floatTxt(px,c.y-36,'整词 -'+dmg,'#ffce4d');
  flash('#ffce4d3a');
  // 震屏：位移 ≤5px、时长 .3s，挂在 .fmid 上 —— 不和 .screen.on 的 fade 抢同一条 animation
  const fm=document.querySelector('.fmid');
  if(fm){ fm.classList.remove('finshake'); void fm.offsetWidth; fm.classList.add('finshake');
          setTimeout(()=>fm.classList.remove('finshake'),320) }
  sfx.finisher();                                     // 独立音效档，不复用 sfx.hit()
}

return {burst,ring,floatTxt,flash,centerOf,heroPoint,animHero,wordFinisher};
}
