import { WORDS } from '../data/words.js';
import { createStorage, initializeDB } from '../services/storage.js';
import { norm, wordGapBefore } from '../domain/text.js';
import { comboRate as calculateComboRate, hitDmg as calculateHitDmg, wordDmg as calculateWordDmg,
  finTier as calculateFinTier, WORD_RATIO, WORD_COMBO_BOOST } from '../domain/damage.js';
import { hpBarGeom } from '../domain/hp.js';
import { wordComplete as isWordComplete, creditWordProgress, onWordWrongProgress } from '../domain/learning.js';
import { createSpeech } from '../services/speech.js';
import { createAudio } from '../services/audio.js';
import { checkVersion } from '../services/version.js';
import { HEROES } from '../data/heroes.js';
import { ITEMS } from '../data/items.js';
import { RELICS } from '../data/relics.js';
import { UNITS } from '../data/units.js';
import { ENEMIES, BOSS } from '../data/enemies.js';
import { VOICE_LINES, FOE_LINES, ELITE_LINES } from '../data/voice-lines.js';
import { foeArtHTML } from '../ui/components/monster-art.js';

// Transitional coordinator: preserve original event ordering during extraction.
export function startGame() {

/* 原创平涂怪物，配合原页面大眼粗描边英雄。
 * 接入 renderFight: $('fAv').innerHTML = foeArtHTML(B.foe, B.boss, B.elite);
 * 仅返回可信静态 SVG；foe.n 仅用于 Map 查找，绝不插入输出。
 * 类型：词灵、语素蛛、石化词素、歧义章鱼、拼写幽灵、单复数蝎、冰封词灵、词形旋风、词汇之王。
 * 不依赖 DOM，不改战斗状态、容器尺寸、动画、粒子或伤害逻辑。
 */



// ============================================================
//  版本检测 + 强制刷新提示
//  ============================================================
//  页面启动后延迟 2.5 秒读取小型 version.json 清单。
//  版本不同才显示手动刷新提示，断网/file:// 时静默降级。
//  发版只修改 public/version.json；Vite 同步注入运行版本与旧客户端桥接标记。
//
//  三条不能破的约束：
//    1) 检测绝不能阻塞首屏 —— 延后到 DOMContentLoaded 之后再等 2.5s；
//    2) 任何异常都必须静默降级 —— 游戏永远照常启动，不许红屏、不许卡住；
//    3) 提示条不许压住游戏内容 —— 靠 --verh 撑 --padB 把内容真实顶上来，
//       而不是靠 z-index 盖在字母盘/血条上面（那正是旧 toast 的坑）。
// ============================================================
const APP_VERSION=__APP_VERSION__;
// 记录「已经提示过哪个版本」。用户关掉提示条时写入，同一版本不再反复弹；
// 版本一变就重新提示。用独立 key，不进存档 DB（存档 key 仍是 wy8a_rogue_v1）。
const VER_SEEN_KEY='wy8a_ver_seen_v1';
const VER_DELAY=2500;

const verSeenGet = () => { try{ return localStorage.getItem(VER_SEEN_KEY)||'' }catch(e){ return '' } };
const verSeenSet = v => { try{ localStorage.setItem(VER_SEEN_KEY, String(v||'')) }catch(e){} };

/* 当前页面的干净 URL（去掉 ?query 和 #hash），并把 file:// 挡在门外。
   file:// 下 fetch 本地文件必被 CORS 拒（Chrome 直接抛 TypeError），
   与其白发一次请求 + 吞一个异常，不如一开始就返回 ''。 */
function verSelfUrl(){
  try{
    if(typeof location==='undefined'||!location||!location.href) return '';
    if(String(location.protocol||'')==='file:') return '';
    const h=String(location.href);
    if(!/^https?:\/\//i.test(h)) return '';   // 只认 http/https（别用 slice 比前缀：
                                           // 'https://' 是 8 个字符不是 7 个）
    return h.split('#')[0].split('?')[0];
  }catch(e){ return '' }
}

/* 强制刷新：给 URL 挂一个时间戳，让浏览器把这当成一个全新的地址，
   缓存里没有、必须回源拉 —— 这是唯一在所有浏览器上都确定有效的做法。
   （location.reload(true) 的 forceGet 参数早就被规范废弃、
     Chrome/Firefox 都会忽略它，所以只当兜底。） */
function verHardReload(){
  try{
    const base=verSelfUrl();
    if(base && typeof location.replace==='function'){
      location.replace(base+'?v='+Date.now());
      return 'replace';
    }
  }catch(e){}
  try{ if(typeof location.reload==='function'){ location.reload(true); return 'reload' } }catch(e){}
  return 'none';
}

/* 显示提示条。会先查「这个版本是不是已经提示过了」，是就直接不弹。 */
function verShow(remote){
  try{
    if(!remote) return false;
    if(verSeenGet()===remote) return false;   // 同一版本提示过了 → 不再烦用户
    let bar=document.getElementById('verbar');
    if(!bar){
      bar=document.createElement('div');
      bar.id='verbar';
      bar.innerHTML='<span class="vmsg">发现新版本 <b></b>，点右侧按钮强制刷新以启用</span>'+
                    '<button class="vbtn" id="verGo" type="button">立即刷新</button>'+
                    '<button class="vx" id="verX" type="button" aria-label="关闭提示">✕</button>';
      document.body.appendChild(bar);
      const go=bar.querySelector('#verGo'), x=bar.querySelector('#verX');
      if(go) go.onclick=()=>verHardReload();
      if(x)  x.onclick =()=>verHide();
    }
    const tag=bar.querySelector('.vmsg b');
    if(tag) tag.textContent='v'+remote;
    bar.classList.add('on');
    // 给 <html> 挂标记：--verh 撑开 --padB，内容被真实顶上来而不是被遮住
    const de=document.documentElement;
    if(de&&de.classList&&de.classList.add) de.classList.add('hasver');
    try{ console.log('[版本检测] 发现新版本 v'+remote+'（当前 v'+APP_VERSION+
                      '）—— 请强制刷新'); }catch(e){}
    return true;
  }catch(e){ return false }
}
/* 关掉提示条。只是隐藏，并把当前 remote 记成「提示过了」，
   版本检测本身不受影响（下次发版 remote 变了会重新提示）。 */
function verHide(){
  try{
    const bar=document.getElementById('verbar');
    if(bar){
      const tag=bar.querySelector('.vmsg b');
      const shown=tag?String(tag.textContent||'').replace(/^v/,'') : '';
      if(shown) verSeenSet(shown);
      if(bar.classList&&bar.classList.remove) bar.classList.remove('on');
    }
    const de=document.documentElement;
    if(de&&de.classList&&de.classList.remove) de.classList.remove('hasver');
  }catch(e){}
}

/* 真正的检测。永远不抛异常，永远不阻塞：
   返回 Promise（便于测试），失败一律 resolve(false)。 */
function verCheck(){ return checkVersion({current:APP_VERSION,pageUrl:typeof location==='undefined'?'':location.href,fetcher:typeof fetch==='function'?fetch:null,announce:verShow}); }

/* 排期：DOMContentLoaded 之后再等 VER_DELAY，只跑一次，不轮询。 */
function verSchedule(){
  const go=()=>{ try{ setTimeout(verCheck,VER_DELAY) }catch(e){} };
  try{
    if(typeof document!=='undefined' && document.addEventListener &&
       document.readyState!=='complete'){
      document.addEventListener('DOMContentLoaded',go);
    }else go();
  }catch(e){ try{ go() }catch(e2){} }
}
verSchedule();

// ============================================================
//  外研版（新标准）八年级上册 词库
//  d: 难度 1易 2中 3难(短语/长词)
// ============================================================
/* ================= 词库：外研版（新标准）八年级上册 Unit 1-6 =================
   来源：家长实拍教材照片 6 张 + OCR + 人工校对，共 259 词
   格式：{d:难度(1/2/3), u:单元号, w:英文, z:中文释义, th:主题} */


/* ================= 工具 ================= */
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const rnd = n => Math.floor(Math.random()*n);
const pick = a => a[rnd(a.length)];
const shuffle = a => { a=a.slice(); for(let i=a.length-1;i>0;i--){const j=rnd(i+1); const t=a[i];a[i]=a[j];a[j]=t;} return a; };

/* 词组的空格：算出「哪些字母前面是一个空格」。
   返回一个长度与 norm(w) 相同的布尔数组：gapBefore[i]===true 表示
   「原文里第 i 个字母是一个新单词的首字母」，也就是它前面本来有个空格。

   为什么单独一张表、而不是直接改 norm()：
     norm() 是全部拼写判定的唯一依据（pressKey 的对错、checkWin、
     B.input 的长度上限……），一旦让它保留空格，所有判定逻辑都要跟着改，
     风险极高。所以 norm() 一个字都不动，空格只在这里被「翻译」成下标表，
     纯粹给渲染层画分隔用 —— 判定、输入、字母盘都看不见这张表。

   规则：跳过原文里的所有非字母字符（空格、连字符等），遇到字母就记一位，
   并且「跳过的非字母数量>0 且已经见过至少一个字母」时，在该字母前标一个 gap。
   这样 super-speed 这种带连字符的词也会被正确拆成两个视觉段。 */

/* 词组排版微调：让「最长的那个单词」也能自己占满一整行。
   为什么需要：living conditions 的 conditions 有 10 个字母，320px 屏上按默认
   槽宽（27px + 5px 间距）需要 10×27+9×5 = 315px，而可用宽只有 278px ——
   flex 只能从单词中间断开，排成 LIVING|COND / ITIONS，短语就散架了。

   做法：按单词分段量出「最长的那段有几个槽位」，超宽就整体等比收窄槽位与间距
   （最多收到 68%，不至于缩成看不清），换「每个单词都不被拆开」。
   单个单词（没有空格）时直接返回 —— 普通词保持原槽宽，视觉不变。
   全程只改 style.width / style.gap：不动 DOM 结构、不动 class、不动判定。
   Node 的 DOM 桩没有 getComputedStyle，所以必须 typeof 守卫。 */
function fitPhraseSlots(sl, gapBefore){
  try{
    if(typeof getComputedStyle!=='function') return;
    // ★ 必须先把上一次留下的行内 gap 清掉再量。
    //   #fSlots 是常驻元素，而槽位每次渲染都是新建的 —— 所以槽位上没有残留，
    //   只有 sl.style.gap 会留下来。不清的话上一句缩过的间距会被当成这次的
    //   基准，越缩越窄（实测 4.32px → 3.80px → … 累叠），排版会越玩越歪。
    if(sl.style) sl.style.gap='';
    if(!gapBefore || !gapBefore.some(Boolean)) return;      // 不是词组 → 不碰
    const kids=sl.children; if(!kids || kids.length<3) return;
    const slotEls=[], seps=[];
    for(let i=0;i<kids.length;i++){
      const c=kids[i].className||'';
      if(c==='slotsep') seps.push(kids[i]);
      else if(c.split(' ').indexOf('slot')>=0) slotEls.push(kids[i]);
    }
    if(!slotEls.length) return;
    const box=sl.getBoundingClientRect();
    const avail=(box && box.width) || sl.clientWidth || 0;
    if(avail<40) return;                                    // 量不到宽度（未布局）就放弃
    // 每个单词占几个槽位
    const runs=[]; let run=1;
    for(let i=1;i<gapBefore.length;i++){ if(gapBefore[i]){ runs.push(run); run=1; } else run++; }
    runs.push(run);
    const maxRun=Math.max.apply(null, runs);
    if(maxRun<2) return;
    const w0=slotEls[0].getBoundingClientRect().width||0;
    if(!w0) return;
    const csSl=getComputedStyle(sl);
    const g0=parseFloat(csSl.columnGap||csSl.gap)||0;
    const sepW=seps.length ? (seps[0].getBoundingClientRect().width||0) : 0;
    // 最长的单词要多宽：槽宽×个数 + 间距×(个数-1) + 它前面那个间隔
    const need=maxRun*w0+(maxRun-1)*g0+sepW;
    if(need<=avail+0.5) return;
    const k=Math.max(0.68, avail/need);
    if(k>=0.995) return;
    for(let i=0;i<slotEls.length;i++) slotEls[i].style.width=(w0*k)+'px';
    if(g0) sl.style.gap=(g0*k)+'px';
  }catch(e){ /* 量不到就按默认排，绝不能因为排版把战斗页搞崩 */ }
}
const has = (a,v) => a.indexOf(v)>=0;
const show = id => { document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on')); $(id).classList.add('on'); window.scrollTo(0,0); try{ syncVoiceBtn() }catch(e){} };

const storage=createStorage();
let DB=initializeDB(storage.load());
const saveDB=()=>storage.save(DB);

/* ================= 音效系统 =================
   调性：D 小调五声音阶（D E F A C），所有音高都从这条音阶上取，不再随手写 Hz。
   音色分工：三角波=柔和提示音  方波=打击/受击  锯齿波=危险/失败  白噪音=瞬态质感
   信号链：voice → dry ─┐
                      ├→ limiter(限幅) → master(音量) → destination
           voice → send┴→ convolver(程序生成 IR) → wet ─┘
   每个 voice 用完即弃（osc.onended 回收并 disconnect），并有 voice 数上限，
   连续快速答对不会堆积节点、也不会削波爆音。
   无 AudioContext 环境（Node / 老浏览器）全部静默降级，不抛错。            */
const { AU,sfx,tone,noise,arp,pnote,audioUnlock }=createAudio({getCombo:()=> (typeof B!=='undefined'&&B&&typeof B.combo==='number')?B.combo:0});
addEventListener('pointerdown',audioUnlock);
addEventListener('keydown',audioUnlock);
addEventListener('touchstart',audioUnlock);

/* ---------- 音量 / 静音：存进 wy8a_rogue_v1，老存档没这字段也能正常跑 ---------- */
const VOL_STEPS=[.55,.3,.12,0];
let volStep=0;
(function loadVol(){
  let v=(typeof DB.vol==='number')?DB.vol:.55;
  if(DB.mute) v=0;
  v=clamp(v,0,1);
  volStep=0; let best=1e9;
  VOL_STEPS.forEach((s,i)=>{ const d=Math.abs(s-v); if(d<best){ best=d; volStep=i } });
  if(DB.mute && v>0) volStep=0;
  AU.vol=VOL_STEPS[volStep]; AU.muted=v<=0;
})();
const saveVol=()=>{ DB.vol=AU.vol; DB.mute=AU.muted; saveDB() };
/* 音量按钮：改为挂到「标题页」底部的 .volrow 里（不再是右上角浮层）。
   音量逻辑与存档字段（AU.vol / AU.muted / DB.vol / DB.mute）保持不变。 */
(function mountVolBtn(){
  if(typeof document==='undefined'||!document.body) return;
  const b=document.getElementById('volBtn'), v=document.getElementById('volVal');
  if(!b) return;
  const paint=()=>{
    b.textContent=AU.muted?'🔇':(AU.vol>=.5?'🔊':'🔉');
    if(v) v.textContent=AU.muted?'静音':(Math.round(AU.vol*100)+'%');
    b.title='音量 '+(AU.muted?'静音':Math.round(AU.vol*100)+'%')+'（点击切换：55% → 30% → 12% → 静音）';
  };
  b.onclick=()=>{ volStep=(volStep+1)%VOL_STEPS.length; AU.setVol(VOL_STEPS[volStep]);
    saveVol(); paint(); if(!AU.muted) sfx.ui() };
  b.oncontextmenu=e=>{ e.preventDefault(); volStep=(volStep+VOL_STEPS.length-1)%VOL_STEPS.length;
    AU.setVol(VOL_STEPS[volStep]); saveVol(); paint(); if(!AU.muted) sfx.ui() };
  paint();
})();
/* UI 点击 / 悬停提示音（事件委托，只作用于主要按钮和地图节点） */
if(typeof document!=='undefined'&&document.addEventListener){
  document.addEventListener('click',e=>{
    const t=e.target&&e.target.closest?e.target.closest('.btn,.node.pick'):null;
    if(t) sfx.ui();
  });
  document.addEventListener('pointerover',e=>{
    const t=e.target&&e.target.closest?e.target.closest('.btn,.node.pick,.item'):null;
    if(t) sfx.hover();
  });
}

/* ================= 粒子/飘字 ================= */
const cv=$('fx'), ctx=cv.getContext('2d');
let parts=[], raf=0;
function sizeCanvas(){ cv.width=innerWidth*devicePixelRatio; cv.height=innerHeight*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0) }
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
    ctx.clearRect(0,0,innerWidth,innerHeight);
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
const centerOf = el => { if(!el) return {x:innerWidth/2,y:innerHeight/2};
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

/* ================= 词库 ================= */

const allWords = u => u===0 ? DB.custom.map(x=>({u:0,d:2,w:x.w,z:x.z,th:'custom'})) : WORDS.filter(x=>x.u===u);

/* ================= 遗物 ================= */

/* ================= 主动道具（战斗中可点，按 1/2/3 快捷键）=================
   设计原则：每个道具都有明确代价，不能无脑全带。
   吸血类回复少、爆发类消耗连击、防御类牺牲伤害。 */

const relicById = id => RELICS.filter(r=>r.id===id)[0];
const itemById=id=>ITEMS.filter(x=>x.id===id)[0];

/* ================= 奖励类别 =================
   每张奖励卡都带一个结构化字段 cat，UI 徽标直接读它，
   不再靠「获得道具 X」这类标题前缀去暗示类别。
   relic 遗物：永久被动，进 G.relics
   item  道具：进背包 G.bag
   heal  恢复：即时回血
   boost 增益：改变下一场战斗的一次性增强
   event 事件：事件/商店/营火里的一次性结果（金币、离场等），不是掉落物
   none  无：没有实际收益（跳过/离开/继续前进） */
const CAT_LABEL={relic:'遗物',item:'道具',heal:'恢复',boost:'增益',event:'事件',none:'无'};
/* 统一的奖励卡渲染：所有界面（战斗奖励/事件/商店/营火）共用，
   保证徽标、图标、描述的分层在任何地方都一致。 */
function pickCardHTML(o){
  const cat=CAT_LABEL[o.cat]?o.cat:'none';
  return '<i class="ctag" data-cat="'+cat+'">'+CAT_LABEL[cat]+'</i>'
    +'<b>'+(o.ic?o.ic+' ':'')+o.t+'</b>'
    +'<span>'+o.d+'</span>'
    +(o.tip?'<span class="ctip">'+o.tip+'</span>':'');
}

/* ================= 玩家角色 =================
   纯 CSS 形象（无图片/无 emoji），data-h 决定外形。
   mod 字段全部是「加法」：hp/hint/noise/shield/gold 为增量，
   combo 为连击加成倍率，regen 为每场战斗开场回血。
   —— 数值差异是 roguelite 的深度来源：每个角色都有明确的代价。 */
/* voice：Web Speech API 的角色专属音色。
   rate  语速（0.1~2，0.7 慢速适合「听读音」按钮，默认朗读 0.85~1.0）
   pitch 音高（0~2，<1 低沉男声，>1 清亮）
   prefer 性别偏好：female/male/null。系统里找不到对应性别的 en 音色时，
   自动回退到任意 en-US 音色 —— 分配失败绝不影响游戏运行。 */

/* 角色没有 voice 字段时（老数据 / 未来新增角色）也能拿到安全默认值 */
const HERO_VOICE_DEFAULT={rate:0.9, pitch:1.0, prefer:null};
const heroById=id=>HEROES.filter(h=>h.id===id)[0] || HEROES[0];
/* 兼容老存档：DB.hero 缺失时回退到第一位，绝不让 undefined 渗进数值计算 */
const HERO_DEFAULT=HEROES[0].id;
const curHeroId=()=> heroById(DB.hero||HERO_DEFAULT).id;
const curHero  =()=> heroById(curHeroId());
/* 当前角色的音色参数（永远返回完整对象，缺字段自动补默认） */
const heroVoice = id => heroById(id).voice || HERO_VOICE_DEFAULT;

/* ================= 语音层：Web Speech API =================
   为什么用 speechSynthesis 而不是 WebAudio 合成人声：
   WebAudio 的振荡器只能发出「音高」，拼不出英语的音素（/θ/ /æ/ /ɪ/ 这些），
   硬合成只会得到机器人 soundscape，根本不像人话。speechSynthesis 是浏览器
   原生 TTS —— 系统自带真人级音色、零依赖零体积，还能按角色挑不同音色。

   ★ 降级（本层最重要的一条）：Node 测试环境 / 老浏览器 / 隐私模式里没有
   speechSynthesis 时，TTS.supported=false，speak/word/line/hint 全部静默返回
   false，游戏逻辑一行不变、不抛任何异常。UI 按钮会自动变成禁用态。      */
const TTS=createSpeech({heroVoice,curHeroId,rnd,voiceLines:VOICE_LINES,foeLineCfg,onChange:enabled=>{DB.voice=enabled;saveDB()}});

/* ---- 语音层的启动挂钩 ----
   1) 浏览器自动播放策略：speechSynthesis 必须先有用户手势才肯发声。
      沿用音效系统那套 pointerdown/keydown/touchstart 时机（不改动它的实现，
      这里只另挂一份自己的监听器，互不干扰）。
   2) 页面切到后台时掐掉正在说的语音：后台标签页的 TTS 在部分浏览器上会
      继续跑并把队列堆满，回到前台就变成「延迟十几秒才出声」。            */
if(typeof addEventListener==='function'){
  const ttsUnlock=()=>TTS.unlock();
  addEventListener('pointerdown',ttsUnlock);
  addEventListener('keydown',ttsUnlock);
  addEventListener('touchstart',ttsUnlock);
}
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('visibilitychange',()=>{
    try{ if(document.hidden) TTS.stop() }catch(e){}
  });
}
/* 起手就按存档设置语音开关（老存档没这字段 → DB.voice 默认 true） */
try{ TTS.on = (typeof DB!=='undefined' && DB.voice!==undefined) ? !!DB.voice : true }catch(e){}

/* ---- 战斗台词库：每个角色 5 类 × 4 句（atk/combo/low/win/lose）
   —— 台词一律用短英文：语音引擎本来就锁定 en-US，用中文会被英文音色念成
   塑料感的中文，而且句子越长越容易盖住单词朗读。短英文顺带强化单词记忆。 */


/* ---- 怪物叫声：走 WebAudio 合成，不走 TTS。
   判断依据：怪物的「语言」不是英语，用英文 TTS 念怪叫既不像怪叫、又会占用
   语音队列跟单词朗读抢话。WebAudio 的锯齿波 + 带通噪声 + 频率下滑能做出
   低吼/尖啸/垂死呜咽，而且完全不碰 sfx 对象、不影响单词朗读队列。       */
function foeCry(kind){
  const a=AU.ctx(); if(!a) return false;          // 无音频能力 → 静默降级
  const t=a.currentTime;
  // 依敌人种类变调：同一只怪每场叫一次，音高按 ic 稳定散开，听感有区分度
  let hsh=0; const ic=(B&&B.foe&&B.foe.ic)?String(B.foe.ic):'x';
  for(let i=0;i<ic.length;i++) hsh=(hsh*31+ic.charCodeAt(i))&0x7fff;
  const kindCfg={spawn:{f:1.35, d:.34, type:'sawtooth', cut:900,  q:1.1, vol:.13},
                 hit:  {f:1.0,  d:.16, type:'square',   cut:1400, q:1.6, vol:.11},
                 die:  {f:0.62, d:.62, type:'sawtooth', cut:700,  q:2.4, vol:.14}}[kind] || null;
  if(!kindCfg) return false;
  const base=(72+hsh%46)*kindCfg.f;
  try{
    // 1) 主体：低频 growl，带频率下滑（kind='die' 时下滑更长更慢 = 垂死呜咽）
    const o=a.createOscillator(), g=a.createGain(), f=a.createBiquadFilter();
    o.type=kindCfg.type; o.frequency.setValueAtTime(base,t);
    o.frequency.exponentialRampToValueAtTime(Math.max(38,base*(kind==='die'?.42:kind==='spawn'?1.8:.7)), t+kindCfg.d);
    f.type='lowpass'; f.frequency.setValueAtTime(kindCfg.cut*2.4,t);
    f.frequency.exponentialRampToValueAtTime(kindCfg.cut,t+kindCfg.d);
    f.Q.value=kindCfg.q;
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(kindCfg.vol,t+.02);      // 软起音，不爆
    g.gain.exponentialRampToValueAtTime(.0001,t+kindCfg.d);
    o.connect(f); f.connect(g); g.connect(AU.dry||a.destination);
    o.start(t); o.stop(t+kindCfg.d+.05);
    o.onended=()=>{ try{o.disconnect();f.disconnect();g.disconnect()}catch(e){} };
    // 2) 质感层：极短带通噪声 = 嘶声/尖叫的「毛边」
    const n=a.createBufferSource(), ng=a.createGain(), nf=a.createBiquadFilter();
    const len=Math.max(1,Math.floor(a.sampleRate*0.18));
    const buf=a.createBuffer(1,len,a.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.2);
    n.buffer=buf;
    nf.type='bandpass'; nf.frequency.setValueAtTime(base*4.5,t);
    nf.frequency.exponentialRampToValueAtTime(base*2,t+.18); nf.Q.value=3;
    ng.gain.setValueAtTime(kindCfg.vol*.5,t);
    ng.gain.exponentialRampToValueAtTime(.0001,t+.18);
    n.connect(nf); nf.connect(ng); ng.connect(AU.dry||a.destination);
    n.start(t); n.stop(t+.2);
    n.onended=()=>{ try{n.disconnect();nf.disconnect();ng.disconnect()}catch(e){} };
    return true;
  }catch(e){ return false }
}

/* ================= 敌人 ================= */



/* ---- 怪物中文台词库：每种怪一套嗓音 + 一组短句
   ★ 台词一律 4-8 字：中文句子越长，越容易被念得拖沓、越容易盖住单词朗读，
     还会让语音引擎的预估时长变长，把后面的单词挤到队列后面。
   ★ rate/pitch 按怪物「性格」分档：石头类低沉缓慢、幽灵/旋风尖锐快促，
     BOSS 最慢最低 —— 配合 zhVoices 的中文音色，一听就知道是谁在说话。
   ★ seed 让不同怪在候选中文音色里转到不同的嗓音（zhVoiceFor 里取模用）。 */

/* 精英怪：额外多一句狠话（同一条嗓音，不会换人；BOSS 用自己的专属台词） */

function foeLineCfg(foe){
  if(!foe || !foe.n) return null;
  const base=FOE_LINES[foe.n];
  if(!base) return null;                        // 认不出的怪 → 不说话，只留叫声
  const isElite=!!foe.elite;
  const lines = isElite ? base.lines.concat(ELITE_LINES) : base.lines;
  return {key:foe.n, seed:base.seed, rate:base.rate, pitch:base.pitch,
          vo:base.vo, volume:base.volume, lines:lines};
}

/* ================= 状态 ================= */
let G=null;          // 当前远征
let B=null;          // 当前战斗
let curUnit=1;
let selIdx=0;        // 字母光标

function newRun(){
  const pool=allWords(curUnit);
  if(!pool.length){ alert('这个单元还没有词，去「导入词表」添加吧'); return false }
  const H=curHero(), M=H.mod||{};
  const maxhp=70+(M.hp||0);                 // 角色差异：生命上限
  B=null;                // 新远征不沿用上一场战斗或成功标记。
  G={ unit:curUnit, hp:maxhp, maxhp:maxhp, shield:M.shield||0, gold:M.gold||0, floor:1, maxFloor:1,
      relics:[], skipFree:false, heroId:H.id, hm:M.hint||0, hnoise:M.noise||0,
      hcombo:M.combo||1, hregen:M.regen||0, hleech:M.leech||0,
      pool:pool.slice(), kills:0, att:0, attOk:0, deckHint:0, history:[], avail:null, node:null,
      done:new Set(),       // 本局已答对的词：不再出现
      wrong:[],             // 答错过的词：下一场优先复习
      bag:{} };             // 道具背包 {itemId: 剩余次数}
  G.bag={ leech:2 };       // 新手送 2 个吸血獠牙，先让她体验到「连打能回血」
  applyRelicInit();
  DB.runs++; saveDB();
  buildMap();
  show('s-map'); renderMap();
  return true;
}
// 答对 → 本局退休；答错 → 进复习队列
function onWordRight(w){
  G.done.add(w);
  const i=G.wrong.indexOf(w); if(i>=0) G.wrong.splice(i,1);
}
function onWordWrong(w){ onWordWrongProgress(G,w) }
// ★ 护盾的唯一加/减入口：夹在 [0, G.maxhp]。
//   上限：护盾跨战斗结转（finishNode 的 G.shield=B.shield），磐石之躯每场可再用 2 个、
//   护盾符文再加 15 —— 不封顶的话护盾会无限累积到远超生命上限，
//   「血条百分比 = 还能挨多少打」虽然仍成立，但玩家会拿着比血还厚的盾，战斗失去压力。
//   下限：防止任何路径把护盾算成负数（负护盾会让血条宽度算出负值）。
function addShield(n){
  G.shield=clamp((G.shield|0)+(n|0), 0, G.maxhp);
  return G.shield;
}
function applyRelicInit(){
  if(has(G.relics,'shield') && !G.shieldGiven){ addShield(15); G.shieldGiven=true }
  if(has(G.relics,'battery')) G.hp=Math.min(G.maxhp,G.hp+8);
}
const hasR = id => has(G.relics,id);
const goldGain = n => G.gold += hasR('greed') ? Math.round(n*1.5) : n;
// 每层连击的加成率：遗物「连击徽章」翻倍，角色幸运儿再乘 0.9（连击更钝）
// —— 单一来源，避免「伤害按新规则算、面板文案按老规则显示」的漂移
const comboRate = () => calculateComboRate(G);

/* ================= 地图生成 ================= */
// 杀戮尖塔式：每层 2-4 个节点，节点间连线，只能走向下一层相邻的节点
const NODES={
  battle:{ic:'⚔️',t:'遭遇词灵',d:'普通战斗'},
  elite: {ic:'☠️',t:'精英战',   d:'强敌，但奖励丰厚'},
  event: {ic:'❓',t:'未知事件', d:'可能是好事，也可能是坏事'},
  rest:  {ic:'🔥',t:'营火',     d:'回血或获得遗物'},
  shop:  {ic:'🛒',t:'商店',     d:'用金币换血量、提示或遗物'},
  boss:  {ic:'👑',t:'词汇之王', d:'最终首领'}
};
/* ---- 商店投放规则：按金币曲线定档，不是随手拍的百分比 ----
 * 金币只来自战斗：25 + 层数×4（精英再 +60）。逐层累加的期望持有量：
 *   进入 r=1≈15   r=2≈38   r=3≈65   r=4≈93   r=5≈124  r=6≈157  r=7≈193
 * 商店最便宜的货 35 金币（贪婪钱币），最有用的是 45 金币的疗伤药剂。
 *   → 走到 r<=2 手里最多 ~38 金币，连一瓶药都买不起，商店纯粹是扫兴（差 7 块，最难受）
 *   → r=3 起有 ~65 金币，买得起 1 瓶药，商店才开始有意义
 * 所以：前期（r<=2）彻底不出商店；中期（r=3..6）保持 12%；首领战前一行强制营火+商店。 */
const MAP_EARLY_MAX=2;                 // 前期边界：r<=2 无商店
function buildMap(){
  const rows=[]; const ROWS=9;
  for(let r=0;r<ROWS;r++){
    const isBoss = r===ROWS-1;
    const isPreBoss = r===ROWS-2;      // 首领战前一行：固定补给点
    let cnt;
    if(isBoss) cnt=1;
    else if(r===0) cnt=3;
    else cnt=2+rnd(2);           // 2~3
    // 首领战前一行先整排定型：必有「营火 + 商店」，其余位置随机，保证有变化
    let plan=null;
    if(isPreBoss){
      const extra=pick(['battle','battle','event','elite']);   // 第 3 格随机
      if(cnt>=3){
        // cnt=3：商店放正中（x=0.5），两边最好认，不会被挤到边缘看不见
        plan = rnd(2)?['rest','shop',extra] : [extra,'shop','rest'];
      }else{
        // cnt=2：只有左右两格，随机左右顺序，避免每次地图长得一模一样
        plan = rnd(2)?['rest','shop'] : ['shop','rest'];
      }
    }
    const row=[];
    for(let c=0;c<cnt;c++){
      let type;
      if(isBoss) type='boss';
      // 第 1 行（r===0）不放商店：开局 0 金币，进去什么也买不起，只会让玩家困惑。
      // 第 1 行只有 战斗 / 事件 / 休息。
      else if(r===0) type=rnd(2)?'battle':pick(['event','rest']);
      else if(isPreBoss) type=plan[c];
      // 前期（r<=2）权重：战斗 52% / 事件 16% / 营火 24% / 精英 8%
      // 商店那份 12% 份额让给营火：前期没有商店补给，营火从 14% 提到 24% 补上，
      // 否则前两层容易带着残血进中期。
      else if(r<=MAP_EARLY_MAX){
        const roll=Math.random();
        type = roll<0.52?'battle' : roll<0.68?'event' : roll<0.92?'rest':'elite';
      }
      // 中后期（r=3..6）权重：战斗 50% / 事件 16% / 营火 14% / 商店 12% / 精英 8%
      else {
        const roll=Math.random();
        type = roll<0.50?'battle' : roll<0.66?'event' : roll<0.80?'rest' : roll<0.92?'shop':'elite';
      }
      // 横向均分整行：cnt=3 → 0.1667/0.5/0.8333；cnt=2 → 0.25/0.75；cnt=1 → 0.5
      // （旧式 0.5/cnt + c*0.5/cnt 只铺满左半边，窄屏必然重叠）
      row.push({type, x:(c+0.5)/cnt, row:r, done:false, links:[]});
    }
    rows.push(row);
  }
  // 连线：按 x 距离做邻接判定，避免 0.5/rnd(1.2) 触发 Infinity 而连成蜘蛛网
  //   dx <= 0.34 → 直连（视觉上基本竖直）
  //   dx <= 0.60 → 用确定性哈希按概率连（不随 renderMap 重绘而变化）
  //   其余不连；最后统一保底：每个下一层节点至少有一条入边
  const DX_DIRECT=0.34, DX_NEAR=0.60, P_NEAR=0.45;
  const hash2=(a,b)=>{ let h=(a*73856093)^(b*19349663);
    h=Math.imul(h^(h>>>13),1274126177); return ((h^(h>>>16))>>>0)/4294967296 };
  const key=n=> n.row*131+Math.round(n.x*1000);
  for(let r=0;r<ROWS-1;r++){
    const cur=rows[r], nxt=rows[r+1];
    cur.forEach(n=>{
      nxt.forEach(m=>{
        const dx=Math.abs(n.x-m.x);
        if(dx<=DX_DIRECT) n.links.push(m);
        else if(dx<=DX_NEAR && hash2(key(n),key(m))<P_NEAR) n.links.push(m);
      });
      if(!n.links.length){                       // 兜底出边：连最近的
        let best=nxt[0];
        nxt.forEach(m=>{ if(Math.abs(m.x-n.x)<Math.abs(best.x-n.x)) best=m });
        n.links.push(best);
      }
    });
    nxt.forEach(m=>{                            // 兜底入边：杜绝不可达的死路
      if(cur.some(n=>n.links.indexOf(m)>=0)) return;
      let best=cur[0];
      cur.forEach(n=>{ if(Math.abs(n.x-m.x)<Math.abs(best.x-m.x)) best=n });
      best.links.push(m);
    });
  }
  G.rows=rows; G.cur=null; G.floor=1; G.maxFloor=1;
  G.avail=rows[0].slice();
  G.pending=null;
}
/* 地图几何：全部按容器实际像素计算，保证任意层数/宽度下节点都不重叠 */
const MAP_V_GAP=12;        // 相邻层之间的垂直净间隙（要求 ≥8）
const MAP_D_BASE=56, MAP_D_BOSS=70, MAP_D_MIN=34;
function mapMetrics(){
  const box=$('map');
  const W=box.clientWidth||640;               // 容器实际像素宽
  const ROWS=G.rows.length;
  const isBoss=r=> G.rows[r] && G.rows[r][0] && G.rows[r][0].type==='boss';
  // 横向：同层最多 3 个节点，x=0.1667/0.5/0.8333，相邻中心距 = W/3
  // 直径上限 = W/3 - 4，保证窄屏（320px 及以下）横向也不重叠
  const d=clamp(Math.floor(W/3-4), MAP_D_MIN, MAP_D_BASE);
  const dia=r=> isBoss(r)? MAP_D_BOSS : d;
  // 垂直：每段间距 = 上下两节点半径之和 + 净间隙（BOSS 更大，间距自动加大）
  const steps=[];
  for(let r=0;r<ROWS-1;r++) steps.push((dia(r)+dia(r+1))/2 + MAP_V_GAP);
  const padTop=dia(0)/2 + 16, padBot=dia(ROWS-1)/2 + 20;
  let H=padTop+padBot+steps.reduce((a,b)=>a+b,0);
  // 旧版固定高度 452px：不足时把余量摊进层间距（取两者较大值）
  if(H<452){ const k=(452-padTop-padBot)/steps.reduce((a,b)=>a+b,0);
    for(let i=0;i<steps.length;i++) steps[i]*=k; H=452 }
  const yOf=[]; let y=padTop;
  for(let r=0;r<ROWS;r++){ yOf.push(y); if(r<ROWS-1) y+=steps[r] }
  H=Math.ceil(y+padBot);
  return {W,ROWS,H,d,yOf,padBot};
}
function renderMap(){
  const box=$('map'); box.innerHTML='';
  const M=mapMetrics(), W=M.W, H=M.H, yOf=M.yOf;
  box.style.height=H+'px';
  box.style.setProperty('--nd', M.d+'px');
  box.style.setProperty('--ndb', MAP_D_BOSS+'px');
  // SVG 用与容器一致的像素 viewBox（1:1 映射，stroke-width 不再被横向拉伸变形）
  let svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">';
  G.rows.forEach((row,r)=>{
    if(r===0) return;
    G.rows[r-1].forEach(n=>{
      n.links.forEach(m=>{
        const x1=n.x*W, y1=yOf[r-1], x2=m.x*W, y2=yOf[r];
        const act = G.avail.indexOf(n)>=0 || (G.node===n);
        svg+='<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" vector-effect="non-scaling-stroke" stroke="'+
          (act?'#22d3ee':'#ffffff22')+'" stroke-width="'+(act?2.2:1.4)+
          '" stroke-linecap="round" stroke-dasharray="'+(act?'':'4 5')+'" opacity="'+(act?.65:.34)+'"/>';
      });
    });
  });
  svg+='</svg>';
  box.insertAdjacentHTML('beforeend',svg);
  // 节点
  G.rows.forEach((row,r)=>{
    row.forEach(n=>{
      const el=document.createElement('div');
      const isAvail=G.avail.indexOf(n)>=0;
      el.className='node '+(n.done?'done ':'')+(n.type==='boss'?'boss ':'')+
        (isAvail?'pick':(G.node?'lock':''));
      el.style.left=(n.x*100)+'%';
      el.style.top=yOf[r]+'px';
      el.textContent=NODES[n.type].ic;
      el.title=NODES[n.type].t;
      if(isAvail) el.onclick=()=>enterNode(n);
      box.appendChild(el);
    });
  });
  $('mFloor').textContent=G.floor;
  $('mGold').textContent=G.gold;
  paintHpBar('mHp','mHpS','mHpT',G.hp,G.shield,G.maxhp);
  const rb=$('mRelics'); rb.innerHTML='';
  G.relics.forEach(id=>{
    const r=relicById(id); if(!r) return;
    const d=document.createElement('div');
    d.className='relic'; d.textContent=r.ic; d.title=r.n+'：'+r.d;
    d.onclick=()=>{ toast(r.n+'：'+r.d) };
    rb.appendChild(d);
  });
  $('mTip').textContent = G.avail.length ? '有 '+G.avail.length+' 个可选' : '';
  // 呼吸提示音：只在「可选节点集合真的变了」时响一次（避免 resize 重绘反复触发）
  const sig=G.avail.map(n=>n.x+','+n.y).join('|');
  if(sig && sig!==G.availSig){ G.availSig=sig; sfx.node() }
}
// 旋转/缩放窗口后重算地图尺寸（节点直径依赖容器宽度）
let mapRz=0;
addEventListener('resize',()=>{
  if(!G || !$('s-map').classList.contains('on')) return;
  clearTimeout(mapRz);
  mapRz=setTimeout(renderMap,120);
});
let toastT=0;
function toast(msg){
  clearTimeout(toastT);
  /* 提示文字一律落进当前页 HUD 里的 .hudmsg 专用行。
     旧实现是 position:fixed;top:14px 的浮层，而 HUD 正好 position:sticky 占住顶部，
     于是每条提示都直接盖在两条血条上（实测盖住血条 59%/60% 的面积）。
     .hudmsg 在文档流里、与两条血条同属一个 flex 列，所以物理上不可能重叠。 */
  const scr=document.querySelector('.screen.on');
  const lane=scr&&scr.querySelector?scr.querySelector('.hudmsg'):null;
  if(lane){
    // 从「无 HUD 页面」切到战斗页时，上一条兜底浮层可能还亮着 —— 必须先收掉，
    // 否则它会跟着留在屏幕上，正好压在 HUD 的血条上。
    const old=document.getElementById('toastEl');
    if(old) old.style.opacity='0';
    lane.textContent=msg; lane.classList.add('on');
    toastT=setTimeout(()=>lane.classList.remove('on'),2400);
    return;
  }
  // 兜底：没有 HUD 的页面（标题/奖励/事件等）才用居中浮层
  let t=document.getElementById('toastEl');
  if(!t){ t=document.createElement('div');
    t.id='toastEl';
    t.style.cssText='position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:99;'+
      'background:rgba(20,20,35,.96);border:1px solid #ffffff2e;padding:10px 16px;border-radius:11px;'+
      'font-size:12.5px;max-width:min(88vw,460px);box-shadow:0 8px 26px #0009;'+
      'transition:opacity .25s;pointer-events:none;line-height:1.45;text-align:center';
    document.body.appendChild(t);
  }
  t.textContent=msg; t.style.opacity='1';
  toastT=setTimeout(()=>{t.style.opacity='0'},2400);
}

/* ================= 节点 ================= */
function enterNode(n){
  G.node=n; G.avail=[];
  if(n.type==='battle'||n.type==='elite'||n.type==='boss') startFight(n);
  else if(n.type==='rest') showRest();
  else if(n.type==='shop') showShop();
  else showEvent();
}

/* ================= 战斗 ================= */
function startFight(n){
  const elite = n.type==='elite', boss = n.type==='boss';
  const e = boss ? BOSS : pick(ENEMIES);
  const lv = boss ? 9 : (elite ? 5+Math.floor(G.floor/2) : 1+Math.floor(G.floor/2));
  // 血量 = 每词伤害 × 目标词数（深层靠 perWord 递增来加难度）
  // 每词伤害 = 字母小伤害之和 + 整词大招那一击
  //   字母 ≈ 词长(~6) × base × 连击均值(1.45)
  //   大招 ≈ base × WORD_RATIO × (1 + 连击均值 × comboRate × WORD_COMBO_BOOST)
  // ★ 大招变强后必须同步抬血量，否则每场战斗会从设计的 4 词被压缩到 1.4 词，
  //   深层直接秒杀、难度曲线整个塌掉。
  // ★ BOSS 原本用的是一个写死的 130（≈ 第9层的 perWord），靠「5 词 vs 4 词」拉开难度。
  //   现在 perWord 整体抬高了，写死的 130 反而会低于第 9 层普通怪 —— 首领变弱。
  //   所以 BOSS 走同一套公式（base 按第 9 层算），难度差仍然由 targetWords 5 vs 4 承担。
  const avgLen = 6;
  const base = 7+Math.floor((boss?9:G.floor)*0.7);
  const finMult = 1 + 1.45*comboRate()*WORD_COMBO_BOOST;
  const perWord = Math.round(avgLen*base*1.45 + base*WORD_RATIO*finMult + (boss?9:G.floor)*1.5);
  const targetWords = boss?5 : (elite?4 : 4);
  const hpMax = Math.round(perWord*targetWords);
  // 从词库按难度出题：越深越难
  const budget = boss?3:Math.min(3, 1+Math.floor(G.floor/3)+(elite?1:0));
  const qword = drawWord(budget);
  const lt = drawLetters(qword);
  B={ word:qword, letters:lt.letters, used:lt.used, bad:new Array(lt.letters.length).fill(false),
      node:n, foe:e, boss:boss, elite:elite,
      myHp:G.hp, enHp:hpMax, enMax:hpMax, shield:G.shield,
      input:[], sel:0, hints:3+(G.hm||0)+(hasR('hint')?2:0)+(G.shopHints||0)+(G.nextHint||0),
      // hintUsed=提示窗口宽度（相对当前位置，敲字母会消耗）；hintTotal=累计用了几次（只增不减，给标签/统计用）
      hintUsed:(G.nextHint?1:0), hintTotal:(G.nextHint?1:0),
      combo:0, maxCombo:0, dmgBonus:0, firstWrong:true,
      lethUsed:hasR('lucky')?1:0, ghostUsed:false, wordsDone:0, over:false, mistaken:[],
      // 连续整词计数：每拼完一个词 +1（连错清零），只影响大招的档位 finTier()，
      // 有上限（FIN_TIER_MAX），所以不可能数值爆炸
      wordStreak:0,
      rageLeft:0, freezeWord:false, chainNext:false, goldMult:1, usedThisFight:{} };
  if(G.nextHint) toast('🔮 水壶生效：本场已揭示首字母');
  G.nextHint=0;
  if(boss){ B.hints+=2; B.enMax+=40; B.enHp=B.enMax }
  G.shopHints=0;   // 商店买的提示本场用完后清零
  if(G.hregen){ const h=Math.min(G.hregen,G.maxhp-B.myHp); B.myHp+=h;
    if(h>0) setTimeout(()=>toast('💚 开场治疗：回复 '+h+' 点生命'),260) }
  show('s-fight'); renderFight();
  sfx.enemy(boss||elite);
  foeCry('spawn');                                    // ← 语音层：敌人登场叫（音高按敌人种类散开）
  // ← 语音层：入场中文台词。用 zh-CN 音色、每种怪不同 rate/pitch；
  //   受 TTS.on 总开关 + 限流控制；没有中文音色时静默跳过（叫声仍在）。
  TTS.foeLine({n:e.n, elite:elite, boss:boss, ic:e.ic});
}
// 按难度抽词：budget 越高，可选池越大但平均词长越长；池太小时放宽，避免深层反复出同样几个词
function drawWord(budget){
  // 本局已答对的词不再出现；全答完则重置让整册循环巩固
  let pool=G.pool.filter(w=>!G.done.has(w.w));
  if(pool.length<3) pool=G.pool.slice();
  // 答错过的词优先复习（最多占一半，避免整场都是生词）
  const due=G.wrong.map(w=>pool.filter(x=>x.w===w)[0]).filter(Boolean);
  const fresh=pool.filter(w=>due.indexOf(w)<0);
  if(due.length && fresh.length){
    const fromDue=Math.min(due.length, 1+Math.floor(due.length/2));
    const fromFresh=Math.min(fresh.length, 1+Math.floor(fresh.length/2));
    pool=shuffle(due).slice(0,fromDue).concat(shuffle(fresh).slice(0,fromFresh));
  } else {
    pool=shuffle(pool);
  }
  const exact=pool.filter(w=>w.d===budget);
  const harder=pool.filter(w=>w.d>budget);
  const softer=pool.filter(w=>w.d<budget);
  // 优先取恰好该难度的词；不够则用更难的补，再不够才放宽到更简单的
  let src=exact;
  if(src.length<3) src=src.concat(harder);
  if(src.length<3) src=src.concat(softer);
  if(!src.length) src=pool;
  // 避免立刻重复上一个词
  for(let i=0;i<10;i++){ const c=pick(src); if(!B||!B.word||c.w!==B.word.w) return c }
  return pick(src);
}
// 生成字母盘（答案字母 + 干扰字母）
function drawLetters(qword){
  const letters=norm(qword.w).split('');
  const cnt={}; letters.forEach(ch=>cnt[ch]=(cnt[ch]||0)+1);
  const uniq=[];
  Object.keys(cnt).forEach(ch=>{ for(let i=0;i<cnt[ch];i++) uniq.push(ch) });
  // 干扰字母：基础 3 个（答对一个要付出选择成本），随层数递增，精英额外 +3
  // 上限 10 —— 再多字母盘就挤到不好点了，尤其在 320px 窄屏
  // 探险家的 hnoise=-1：干扰字母少一个，排雷更轻松
  const noise=clamp(3+Math.floor(G.floor/2)+(B&&B.elite?3:0)+(G.hnoise||0),2,10);
  const ALPHA='abcdefghijklmnopqrstuvwxyz'.split('');
  for(let i=0;i<noise;i++){
    let ch=pick(ALPHA), guard=0;
    // 干扰字母必须不在答案里，否则会削弱「排除法」的乐趣
    while(uniq.indexOf(ch)>=0 && guard++<20) ch=pick(ALPHA);
    if(uniq.indexOf(ch)<0) uniq.push(ch);
  }
  return { letters:shuffle(uniq), used:new Array(uniq.length).fill(false) };
}
// 敌人还活着时换下一个词
function nextWord(){
  const budget=B.boss?3:Math.min(3, 1+Math.floor(G.floor/3)+(B.elite?1:0));
  const nw=drawWord(budget);
  const nl=drawLetters(nw);
  B.word=nw; B.letters=nl.letters; B.used=nl.used;
  B.bad=new Array(nl.letters.length).fill(false);
  B.freezeWord=false;   // 寒冰护符只保护一个词
  B.input=[]; B.sel=0; B.hintUsed=0; B.hintTotal=0;
  if(hasR('scholar') && B.wordsDone===1){ B.hintUsed=1; B.hintTotal=1 }   // 学者之书：揭示首字母
  renderFight();
}
// 字母盘列数：唯一来源，渲染与键盘导航共用，避免两处算法漂移
// 仅「字母盘模式」用；键盘模式下 gridTemplateColumns 不生效，改由 bankRows() 给行列
function bankCols(n){ return n<=6?3 : n<=9?4 : n<=12?4 : n<=16?5 : 6 }

/* ================= 字母盘布局：字母盘模式 ↔ QWERTY 键盘模式 =================
   - 偏好存在 DB（存档 key 仍是 wy8a_rogue_v1，新增字段，老存档缺字段时回落默认值 false）
   - kbMode：字母盘按电脑 QWERTY 三行阶梯排；gridMode：沿用原来的乱序网格
   - kbUpper：纯显示开关。判定永远走 norm()（转小写），所以两种显示都能正常判对   */
const QWERTY_ROWS=['qwertyuiop','asdfghjkl','zxcvbnm'];
// 每个小写字母在 QWERTY 上的 {行, 列}；不在键盘上的（如误入的非 a-z）返回 null
const QWERTY_POS=(()=>{ const m={};
  QWERTY_ROWS.forEach((r,ri)=>{ for(let i=0;i<r.length;i++) m[r[i]]={row:ri,col:i} });
  return m })();
const isKbMode =()=> !!DB.kbMode;
const isKbUpper=()=> !!DB.kbUpper;
// 把 B.letters 按当前模式算成 [[行内字母索引,...], ...]，行内顺序 = 视觉从左到右
// 键盘模式：每个字母落在它真实键盘位置那一行，行内按键盘列排序（不左右颠倒）；
//            没有字母的键盘行不输出（不留空行），所以行数由实际字母动态决定（1~3 行）
function bankRows(){
  const n=B.letters.length, rows=[];
  if(!isKbMode()){                      // 字母盘模式：保持原有 grid 顺序
    const cols=bankCols(n);
    for(let i=0;i<n;i++){ const r=(i/cols)|0; (rows[r]=rows[r]||[]).push(i) }
    return rows;
  }
  const bucket=[[],[],[]];
  for(let i=0;i<n;i++){ const p=QWERTY_POS[B.letters[i]]; if(p) bucket[p.row].push({i,col:p.col}) }
  for(const b of bucket){
    if(!b.length) continue;             // 空键盘行不显示
    b.sort((x,y)=>x.col-y.col);         // 行内保持键盘的水平顺序
    rows.push(b.map(o=>o.i));
  }
  return rows.length?rows:[[0]];        // 极端兜底：至少渲染一行，别让容器空掉
}
// 某个字母实例在当前布局下的视觉位置；找不到返回 null
function bankPosOf(i){
  const rows=bankRows();
  for(let r=0;r<rows.length;r++){
    const c=rows[r].indexOf(i);
    if(c>=0) return {row:r,col:c,rows:rows.length};
  }
  return null;
}
/* ================= 字母盘交互：纯点击 + 电脑键盘打字（无光标）=================
   2026-10 改版：字母盘上**没有光标**。
   - 玩家看不到、也用不到「当前选中键」：渲染不再给按键加 .sel 高亮。
   - 方向键 ←→↑↓ 在字母盘上不做任何事（不移动、不发声、不改输入）。
   - B.sel 仍在内部保留，但语义降级为「最近一次点击/打字的字母索引」，
     只用于把点击或键盘输入翻译成 pressKey() 的参数。 */
/* ===== 护盾血条：百分比必须等于「实际还能挨多少打」=====
   ★ 原 bug：分子加了护盾、分母却只用 G.maxhp，
     护盾 20 + 生命 60、上限 60 时算出 133% 被 clamp 成 100% ——
     血条显示满格，实际生命只剩 60%，玩家会误判自己很安全。
   现在分母用「生命上限 + 当前护盾」，分子用「当前生命 + 当前护盾」：
     护盾 20 + 生命 60、上限 60 → 80/80 = 100%（满格 = 真能挨满，确实安全）
     护盾 20 + 生命 30、上限 60 → 50/80 = 62.5%（和「只能再挨 50 点」一致）
     护盾 0  + 生命 30、上限 60 → 30/60 = 50%（退化成纯血条，行为不变）
   返回值同时给出护盾那一层的宽度，供两层画法（见 paintHpBar）复用。 */

// 唯一写血条的地方：战斗页与地图页都走它，杜绝两处公式漂移。
// 「hp/shield/maxhp」单位是「点」，不是百分比 —— 换算只在这里发生一次。
function paintHpBar(fillId,shId,txtId,hp,shield,maxhp){
  const g=hpBarGeom(hp,shield,maxhp);
  const f=$(fillId); if(f) f.style.width=g.pct+'%';
  const s=$(shId);
  // 护盾层贴在生命层右边界：left = 生命层宽度，width = 总宽 − 生命层宽度
  if(s){ s.style.left=g.hpPct+'%'; s.style.width=g.shPct+'%'; s.style.display=g.sh>0?'':'none'; }
  const t=$(txtId); if(t) t.textContent=Math.max(0,hp|0)+'/'+maxhp+(g.sh?' +'+g.sh+'盾':'');
  return g;
}
// 敌人血条没有护盾概念，单独保留（也走 paintHpBar 保持同一套换算口径）
function renderFight(){
  const enPct=clamp(B.enHp/B.enMax*100,0,100);
  $('fEn').style.width=enPct+'%';
  $('fEnT').textContent=B.boss?('词汇之王 '+Math.max(0,B.enHp)+'/'+B.enMax):(Math.max(0,B.enHp)+'/'+B.enMax);
  paintHpBar('fMy','fMyS','fMyT',B.myHp,B.shield,G.maxhp);
  // 角色形象：只更新外形数据属性 + 名字（血条统一由上面的 HUD 负责）
  const H=heroById(G.heroId||HERO_DEFAULT), pc=$('fPc');
  if(pc) pc.dataset.h=H.id;
  const nm=$('fMyName'); if(nm) nm.textContent=H.n;
  $('fAv').innerHTML=foeArtHTML(B.foe,B.boss,B.elite);
  $('fName').textContent=B.foe.n+(B.boss?'（首领）':B.elite?'（精英）':'');
  $('fZh').textContent=B.word.z;
  // 字符数按 norm() 的字母数算（否则 keep an eye on 会显示「14 字符」，
  // 而槽位只有 11 个，对不上）；词组额外标一个「词组」标签。
  // ★ 长度与 isPhrase 都先算成局部变量再拼进文案：nospoiler 回归测试有一条正则
  //   /\$('fCat')\.textContent\s*=[^;]*(tgt\[|word\.w(?!\.length)|rightCh)/
  // 专门盯「战斗页信息栏直接回显单词」。这里必须一个 word.w 都不出现在等号之后。
  const nLetters=norm(B.word.w).length;
  const isPhrase=/\s/.test(String(B.word.w||''));
  $('fCat').textContent='Unit '+B.word.u+' · '+nLetters+' 字符'+(isPhrase?' · 词组':'')+(B.word.d>=3?' · 困难':'');
  // tags
  const tg=$('fTags'); tg.innerHTML='';
  const add=(txt,cls)=>{ const s=document.createElement('span'); s.className='tg '+(cls||''); s.textContent=txt; tg.appendChild(s) };
  if(B.combo>0) add('连击 '+B.combo, 'ok');
  if(B.dmgBonus>0) add('增伤 +'+B.dmgBonus+'%','ok');
  if(B.hintTotal>0) add('已用提示 '+B.hintTotal,'bad');
  if(B.boss) add('首领','bad');
  // slots
  const sl=$('fSlots'); sl.innerHTML='';
  const tgt=norm(B.word.w);
  // 词组：单词边界表。gapBefore[i]=true 表示第 i 个字母是一个新单词的首字母
  //（也就是它前面在原文里是个空格）。判定完全不看这张表 —— 仍只用 norm() 的 tgt。
  const gapBefore=wordGapBefore(B.word.w, tgt.length);
  // 提示窗口是「相对当前位置」的：从当前进度往后 hintUsed 个字母，
  // 而不是从第 0 位数 —— 否则已填过字母后再提示，提示区间会整个落在已填区间里被覆盖（白白扣次数）。
  // 窗口锚在 input.length：敲进一个正确字母，左边界随之上移，剩余揭示数自动 -1；
  // 退格则左边界回退，之前揭示的字母重新露出来（那个字母玩家自己刚敲进去过，本来就知道，不算白赚）。
  const absFrom=B.input.length;
  const absTo=Math.min(absFrom+Math.max(0,B.hintUsed), tgt.length);
  for(let i=0;i<tgt.length;i++){
    // 空格分隔：画在【前一个单词的最后一个字母之后】，即本字母是空格时。
    // 用 i>0 && gapBefore[i] 触发，保证不会多出一个头部间隔。
    if(i>0 && gapBefore[i]){
      const sep=document.createElement('div');
      sep.className='slotsep';           // 故意不带 'slot'：不进索引、不参与判定
      sep.setAttribute('aria-hidden','true');
      sl.appendChild(sep);
    }
    const d=document.createElement('div');
    let cls='slot';
    if(i<absFrom) cls += B.input[i]===tgt[i]? ' f':' w';
    else if(i<absTo) cls+=' hint';
    d.className=cls;
    d.textContent = (i<absFrom)? B.input[i] : (i<absTo? tgt[i] : '');
    sl.appendChild(d);
  }
  fitPhraseSlots(sl, gapBefore);
  // bank —— 两种排布共用同一份数据（used/bad/sel 全在 B 上，切模式不会丢进度）
  const bank=$('fBank');
  const n=B.letters.length;
  const kb=isKbMode(), upper=isKbUpper();
  const rows=bankRows();                 // 视觉行：键盘模式=qwer 三行，字母盘模式=原 grid 分行
  bank.className='bank '+(kb?'kb':'grid');
  if(kb){
    // 键宽自适应：让「最长行」正好塞进容器宽，绝不溢出、也尽量不缩得太小。
    // 行宽 = 行内键数×键宽 + (n-1)×间距，而阶梯缩进 padding-left 也会吃掉一点宽度，
    // 所以要解 kw = (可用宽 - (n-1)×间距) / (n + 阶梯系数)，多行取最小值。
    const GAP=7, STAIR=[0,.42,.84];        // 与 CSS 里 .kbrow.r1/.r2 的 padding 保持一致
    const pe=bank.parentElement;
    const availW=bank.clientWidth||(pe&&pe.clientWidth)||(innerWidth||390);
    let kw=52;
    rows.forEach((row,ri)=>{
      const n=row.length||1, k=STAIR[ri]!==undefined?STAIR[ri]:.84;
      kw=Math.min(kw, Math.floor((availW-(n-1)*GAP)/(n+k)));
    });
    kw=Math.max(20,Math.min(52,kw||44));   // 最坏情况（320px + 满行 qwerty）也不会溢出
    bank.style.setProperty('--kbw',kw+'px');
    bank.style.gridTemplateColumns='';    // 键盘模式不用 grid，避免与 CSS 的 flex 打架
    bank.style.maxWidth='';
  }else{
    // 列数随字母数增加，但限制最多 6 列，窄屏才不会挤
    const cols = bankCols(n);
    bank.style.gridTemplateColumns='repeat('+cols+',minmax(0,1fr))';
    bank.style.maxWidth=(cols*66)+'px';
  }
  bank.innerHTML='';
  const keyEls=B.keyEls=[];              // 字母索引 → DOM 按钮（键盘模式 children 是行，索引对不上）
  const mkKey=(ch,i)=>{
    const b=document.createElement('button');
    let cls='key';
    if(B.used[i]) cls+=' gone';
    else if(B.bad[i]) cls+=' bad';
    if(upper) cls+=' uc';
    b.className=cls;
    b.textContent=upper?ch.toUpperCase():ch;   // 纯显示层；判定仍读小写的 B.letters[i]
    b.disabled=B.used[i];
    b.title=B.used[i]?'已填入':B.bad[i]?'已试过，不是这个字母':'';
    b.onclick=()=>{ B.sel=i; pressKey(i) };
    keyEls[i]=b;
    return b;
  };
  if(kb){
    rows.forEach((row,ri)=>{              // 每行一个 .kbrow，行内居中 + 阶梯缩进（r0/r1/r2）
      const r=document.createElement('div');
      r.className='kbrow r'+ri;
      row.forEach(i=>r.appendChild(mkKey(B.letters[i],i)));
      bank.appendChild(r);
    });
  }else{
    rows.forEach(row=>row.forEach(i=>bank.appendChild(mkKey(B.letters[i],i))));
  }
  syncBankBar();
  $('tHintN').textContent=B.hints+' 次';
  $('tHint').disabled=B.hints<=0;
  $('tSkip').textContent=hasR('ghost')&&!B.ghostUsed?'影分身':'跳过';
  $('tFlee').disabled=G.gold<10;
  $('fCombo').textContent=B.combo>0?('连击 '+B.combo+'  ✦ 伤害 ×'+(1+B.combo*comboRate()).toFixed(1)):'';
  renderItems();
}
// 同步字母盘模式按钮的高亮状态与文案（renderFight 每次都会调）
function syncBankBar(){
  const mb=$('tBankMode'), cb=$('tBankCase'), mv=$('tBankModeV'), cv=$('tBankCaseV');
  if(mb) mb.className='bkbtn'+(isKbMode()?' on':'');
  if(cb) cb.className='bkbtn'+(isKbUpper()?' on':'');
  if(mv) mv.textContent=isKbMode()?'开':'关';
  if(cv) cv.textContent=isKbUpper()?'开':'关';
  try{ paintSayBtn() }catch(e){}      // 语音按钮状态跟着战斗渲染一起刷新
}
// 切换字母盘排布：字母盘 ↔ QWERTY 键盘。只改 DB + 重渲染，
// B.used / B.bad / B.input 全在 B 上没动，所以进度一个字母都不丢
$('tBankMode').onclick=()=>{ DB.kbMode=!isKbMode(); saveDB(); if(B&&!B.over) renderFight(); syncBankBar() };
// 切换大小写显示：纯显示层。判定走 norm()（转小写），所以两种显示都能正常判对
$('tBankCase').onclick=()=>{ DB.kbUpper=!isKbUpper(); saveDB(); if(B&&!B.over) renderFight(); syncBankBar() };


/* ================= 「听读音」按钮 + 语音开关 =================
   · 独立于「提示」按钮：提示只揭示字母，这个只出声、不改任何游戏状态。
   · 慢速 0.7 朗读当前目标单词；长按 = 连读两遍（背单词时反复听最有用）。
   · 点击同时兼作语音总开关的快捷入口：已经关着的时候点它会先开回来再念，
     否则「关了语音 → 按钮也没用 → 永远开不回来」会变成死结。             */
function paintSayBtn(){
  const b=$('tSay'), v=$('tSayV');
  if(!b) return;
  const usable=TTS.supported && TTS.on;
  b.className='bkbtn say'+(usable?'':' off');
  b.title = !TTS.supported ? '当前浏览器不支持语音朗读（不影响游戏）'
    : !TTS.on ? '语音已关闭 —— 点击重新开启'
    : '🔊 听读音：慢速朗读当前目标单词（长按 = 连读两遍）';
  if(v) v.textContent = !TTS.supported?'不可用':(TTS.on?'慢速':'已关');
}
// 发声成功才做喇叭脉冲动画：无声/关闭环境下没有动画，不会给假反馈
function pulseSay(){
  const b=$('tSay'); if(!b) return;
  b.classList.remove('on2'); void (b.offsetWidth||0); b.classList.add('on2');
  setTimeout(()=>{ try{ b.classList.remove('on2') }catch(e){} },480);
}
function sayCurrentWord(times){
  if(!B||B.over||!B.word) { toast('还没有开始战斗'); return false }
  if(!TTS.supported){ toast('当前浏览器不支持语音朗读，不影响游戏'); return false }
  if(!TTS.on){ TTS.setOn(true); paintSayBtn(); }        // 死结保护：先开回来再念
  /* ★ 听读音 = 消耗「提示次数」B.hints，和「揭示下一个字母」是同一个资源池。
     玩家必须权衡：是花一次提示听发音，还是留到需要字母时再用。
     拼完整词的自动朗读走 TTS.word()，不消耗 hints —— 那是完成后的奖励。 */
  if(B.hints<=0){ toast('没有提示次数了，自己拼拼看'); return false }
  B.hints--;
  if(typeof paintHintBtn==='function') paintHintBtn();
  const n=times||1;
  for(let i=0;i<n;i++){
    // 连读要错开：speak 内部每次都会 cancel，所以必须串行 setTimeout，
    // 否则第二遍会把第一遍立刻掐掉，听起来只剩一声。
    if(i===0){ if(TTS.hint(B.word.w)) pulseSay() }
    else setTimeout(()=>{ if(TTS.on && TTS.hint(B.word.w)) pulseSay() }, 950*i);
  }
  return true;
}
(function mountSayBtn(){
  const b=$('tSay'); if(!b) return;
  b.onclick=()=>{ TTS.unlock(); sayCurrentWord(1) };
  // 长按 = 连读两遍。pointerdown/up 在移动端和桌面都稳，比 mouse 事件可靠。
  let holdT=0;
  const start=()=>{ holdT=setTimeout(()=>sayCurrentWord(2),420) };
  const end  =()=>{ clearTimeout(holdT) };
  if(b.addEventListener){
    b.addEventListener('pointerdown',start);
    b.addEventListener('pointerup',end);
    b.addEventListener('pointercancel',end);
    b.addEventListener('pointerleave',end);
  }
  paintSayBtn();
})();
// 音色异步到货后重画按钮（voiceschanged 之后才知道能不能发声）
if(TTS && TTS.supported && typeof addEventListener==='function'){
  try{ TTS.loadVoices() }catch(e){}
}
// 语音总开关（独立于音效音量，两者可分别静音）。
// ★ 战斗页不显示这个按钮：它原本 position:fixed 钉在右上角（top:10px;right:60px），
//   而战斗页的敌方血条也在 sticky HUD 的右上角，窄屏手机上两者直接重叠、挡住血量数字。
//   战斗时改用字母盘上方的「🔊 听读音」按钮控制朗读，总开关只在标题/地图/奖励等界面出现。
function syncVoiceBtn(){
  const b=document.getElementById('voiceBtn');
  if(!b) return;
  const scr=document.querySelector('.screen.on');
  b.style.display=(scr&&scr.id==='s-fight')?'none':'flex';
}
(function mountVoiceBtn(){
  if(typeof document==='undefined'||!document.body||document.getElementById('voiceBtn')) return;
  const b=document.createElement('button');
  b.id='voiceBtn'; b.type='button';
  b.style.cssText='position:fixed;top:10px;right:60px;z-index:75;width:42px;height:42px;padding:0;'+
    'border-radius:12px;border:1px solid #ffffff26;background:rgba(16,16,30,.8);color:#fff;'+
    'font-size:19px;line-height:1;cursor:pointer;backdrop-filter:blur(10px);'+
    'box-shadow:0 6px 18px #0007;display:flex;align-items:center;justify-content:center;'+
    '-webkit-tap-highlight-color:transparent';
  // show() 里会直接调 syncVoiceBtn()；这里再挂一个 MutationObserver 兜底，
  // 防止将来有绕过 show() 的界面切换方式导致按钮没跟着隐藏。
  try{
    if(typeof MutationObserver==='function' && document.body){
      new MutationObserver(syncVoiceBtn).observe(document.body,
        {attributes:true,attributeFilter:['class'],subtree:true});
    }
  }catch(e){}
  try{ if(typeof window.addEventListener==='function') window.addEventListener('resize',syncVoiceBtn) }catch(e){}
  const paint=()=>{
    if(!TTS.supported){ b.textContent='🔇'; b.style.opacity=.3;
      b.title='当前浏览器不支持语音朗读（不影响游戏）'; return }
    b.textContent=TTS.on?'🗣':'🔇';
    b.style.opacity=TTS.on?1:.45;
    b.title=TTS.on?'语音朗读：开（点击关闭）':'语音朗读：关（点击开启）';
  };
  b.onclick=()=>{ TTS.unlock(); TTS.toggle(); paint(); paintSayBtn(); if(TTS.on) sfx.ui() };
  b.oncontextmenu=e=>{ e.preventDefault(); TTS.unlock(); TTS.setOn(true); paint(); paintSayBtn() };
  document.body.appendChild(b); paint(); syncVoiceBtn();
  // 音色是异步到货的（getVoices() 首次返回空数组），所以等 voiceschanged
  // 再重画一次按钮 —— 不用 setInterval 轮询，既不空转也不会吊住 Node 测试进程。
  try{
    const sy=(typeof window!=='undefined')&&window.speechSynthesis;
    if(sy){
      if(typeof sy.addEventListener==='function') sy.addEventListener('voiceschanged',()=>{ paint(); paintSayBtn() });
      else sy.onvoiceschanged=()=>{ paint(); paintSayBtn() };
    }
  }catch(e){}
})();
// 渲染道具栏：只显示玩家真正持有的道具，并标出快捷键
function renderItems(){
  const box=$('fItems'); if(!box) return;
  box.innerHTML=''; box._kids=[];
  const held=Object.keys(G.bag||{}).filter(id=>(G.bag[id]|0)>0);
  if(!held.length){
    box.innerHTML='<div class="none">🎒 背包是空的 —— 商店和精英战会掉落道具</div>';
    return;
  }
  held.forEach((id,idx)=>{
    const it=itemById(id); if(!it) return;
    const left=G.bag[id]|0;
    const usedInFight=(B.usedThisFight[id]|0);
    const capped=usedInFight>=it.max;
    const b=document.createElement('button');
    b.className='item'+(left<=0||capped?' off':'')+(B.rageLeft>0&&id==='rage'?' fire':'');
    b.title=it.d+'\n'+it.tip+(capped?'\n（本场已用满 '+it.max+' 次）':'');
    b.innerHTML='<span class="kb">'+(idx+1)+'</span><span class="ct">×'+left+'</span>'+
      '<span class="ic">'+it.ic+'</span><span class="nm">'+it.n+'</span>';
    if(!capped) b.onclick=()=>useItem(id);
    box.appendChild(b);
  });
}
// 使用道具
function useItem(id){
  if(!B||B.over||!G) return;
  const it=itemById(id); if(!it) return;
  if((G.bag[id]|0)<=0){ toast('🎒 没有'+it.n+'了'); return }
  if((B.usedThisFight[id]|0)>=it.max){ toast('本场已用满 '+it.n+'（上限 '+it.max+' 次）'); return }
  const tgt=norm(B.word.w);
  let msg='';
  switch(id){
    case 'leech':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      B.myHp=Math.min(G.maxhp,B.myHp+1);
      msg='🩸 獠牙吸取了 1 点生命';
      break;
    case 'rage':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      B.rageLeft=3; B.combo=0;
      msg='🔥 怒火点燃！接下来伤害 ×2.5（连击已清空）';
      break;
    case 'freeze':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      B.freezeWord=true;
      msg='❄️ 敌人被冻住：这个词不扣血，但伤害减半';
      break;
    case 'chain':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      B.chainNext=true;
      msg='⚡ 闪电蓄势：下一个正确字母额外 +3 连击';
      break;
    case 'reveal':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      // 相对语义：从当前进度往后至少揭示 2 个（而不是从第 0 位数）
      B.hintUsed=Math.max(B.hintUsed,2);
      B.hintTotal=Math.max(B.hintTotal||0,2);
      {
        const rt=norm(B.word.w), rp=B.input.length;
        const need=Math.min(2, rt.length-rp);
        for(let j=0;j<B.letters.length;j++){
          if(!B.used[j]&&B.bad[j]&&B.letters[j]===rt[rp]){ B.bad[j]=false }
        }
        msg='👁️ 透视：已揭示接下来 '+need+' 个字母（不消耗提示）';
      }
      break;
    case 'purge':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      let freed=0; B.bad.forEach((b,j)=>{ if(b){B.bad[j]=false;freed++} });
      msg='🧹 扫除 '+freed+' 个误标字母，重新可选';
      break;
    case 'greed':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      B.goldMult=3;
      msg='💰 本场金币 ×3';
      break;
    case 'stone':
      B.usedThisFight[id]=(B.usedThisFight[id]|0)+1; G.bag[id]--;
      // ★ 战斗中护盾存在 B.shield 上，不是 G.shield。
      //   （原写成 addShield(20) 会把护盾加到远征状态，战斗里一点用没有 —— 道具白耗。）
      B.shield=clamp((B.shield|0)+20, 0, G.maxhp);
      renderFight();
      msg='🪨 获得 20 点护盾';
      break;
  }
  if(msg){ toast(msg); sfx.item(id);
    const av=centerOf($('fItems'));
    burst(av.x,av.y,it.tint||'#ffce4d',16,3.5) }
  renderFight();
}
// idx：本次要按下的字母实例下标。省略时回落到 B.sel（点击路径就是这么调的）。
// 打字路径直接传下标，因此完全不依赖 B.sel / 光标。
function pressKey(idx){
  if(!B || B.over) return;
  const i=(idx===undefined||idx===null)?B.sel:idx;
  if(i<0||i>=B.letters.length||B.used[i]) { sfx.bad(); return }
  const ch=B.letters[i];
  const tgt=norm(B.word.w);
  const pos=B.input.length;
  const keyEl=(B.keyEls&&B.keyEls[i])||(($('fBank').children||[])[i]);

  // 恢复：若当前位置所需的正确字母被误标为 bad，则自动解封
  // （否则手滑标错一个字母会让整个词永远拼不完）
  const needCh=tgt[pos];
  if(needCh && !B.letters.some((c,j)=>c===needCh && !B.used[j] && !B.bad[j])){
    let freed=false;
    for(let j=0;j<B.letters.length;j++){
      if(!B.used[j] && B.bad[j] && B.letters[j]===needCh){ B.bad[j]=false; freed=true }
    }
    if(freed){ toast('已解开「'+needCh.toUpperCase()+'」，再试一次'); renderFight(); return }
  }

  // 已标记为错：再点只抖动，不再扣血（惩罚已付过）
  if(B.bad[i]){
    sfx.bad();
    if(keyEl){ keyEl.classList.add('flash'); setTimeout(()=>keyEl.classList.remove('flash'),340) }
    toast('「'+ch.toUpperCase()+'」不在这个词里，换一个字母');
    return;
  }

  if(tgt[pos]===ch){
    // ✅ 正确
    B.used[i]=true; B.input.push(ch);
    // 提示窗口锚在 input.length：进度 +1 会让窗口左边界右移一格，
    // 所以把已揭示数 -1 抵消掉，否则会「白赚」下一个字母的提示。
    // 退格不需要对称处理：那时 hintUsed 已归零，擦掉的字母不会凭空白送回提示。
    if(B.hintUsed>0) B.hintUsed--;
    G.att++; G.attOk++;
    sfx.good();
    if(keyEl){ keyEl.classList.add('good'); const c=centerOf(keyEl);
      burst(c.x,c.y,'#3ddc84',14,4); floatTxt(c.x,c.y-14,'+'+hitDmg(),'#3ddc84') }
    B.combo++;
    B.maxCombo=Math.max(B.maxCombo,B.combo);
    if(B.combo>1){ const cb=$('fCombo'); cb.classList.remove('hot'); void cb.offsetWidth; cb.classList.add('hot');
      if(B.combo%5===0){ toast('🔥 '+B.combo+' 连击！伤害 +'+(5*Math.ceil(B.combo/5))+'%');
        B.dmgBonus+=5*Math.ceil(B.combo/5); sfx.combo();
        TTS.line('combo'); } }   // ← 语音：连击里程碑必喊（force=false 但里程碑本身稀有，限流不会误伤）
    // 语音：攻击台词。普通字母命中概率很低（p=.18），连击越高越爱喊（兴奋度）
    if(B.combo>=3) TTS.line('atk',null,{p:.18+Math.min(.42,B.combo*.05)});
    else          TTS.line('atk',null,{p:.12});
    dealDamage(hitDmg());
    if(B.rageLeft>0){ B.rageLeft--; if(B.rageLeft===0) toast('🔥 怒火熄灭了') }
    // 吸血獠牙：答对就回血
    if((G.bag.leech|0)>0 && (B.usedThisFight.leech|0)<6 && B.myHp<G.maxhp){
      B.usedThisFight.leech=(B.usedThisFight.leech|0)+1; G.bag.leech--;
      B.myHp=Math.min(G.maxhp,B.myHp+1);
      floatTxt(innerWidth/2,innerHeight*0.5,'+1','#ff6b8a');
    }
    // 游侠特性：每个正确字母回 1 点血（不消耗道具背包，与吸血獠牙独立共存）
    if((G.hleech|0)>0 && B.myHp<G.maxhp){
      B.myHp=Math.min(G.maxhp,B.myHp+G.hleech);
      // 回血飘字锚在 HUD 的我方血条上（小血条已删，锚点跟着换）
      const hp2=centerOf($('fMy')); floatTxt(hp2.x,hp2.y-4,'+'+G.hleech,'#3ddc84');
    }
    // 连锁闪电：额外连击
    if(B.chainNext){ B.chainNext=false; B.combo+=3; B.dmgBonus+=8; toast('⚡ 连锁触发！连击 +3') }
    if(hasR('focus') && B.combo>0 && B.combo%6===0) B.dmgBonus+=5;  // 专注：连击越长额外增伤
    if(B.word.d>=3 && B.combo>0 && rnd(6)===0) toast('💡 记住这个词！');
    if(wordComplete()){
      // ── 整词拼完：一次大招 ─────────────────────────────────────────────
      // ★ 判据用 wordComplete()（和掌握判定 winFight() 里同一个函数），
      //   不用裸的 input.length 比较，杜绝两边口径漂移。
      // ★ 大招动画(wordFinisher) 与 creditWord() 在同一个分支里连续执行，
      //   中间没有任何 return 分支，所以不可能出现「动画播了没记学会」
      //   或「记了学会没动画」。
      const bonus=wordDmg();       // 大招伤害：≥ 单字母 ×3.2（见 wordDmg 的夹逼）
      creditWord(B.word.w);        // 整词拼完 → 记为学会（掌握表 + 本局退休，见 creditWord）
      B.wordsDone=(B.wordsDone||0)+1;
      B.wordStreak=(B.wordStreak||0)+1;   // 连续整词 → 下一次大招更强（封顶见 finTier）
      wordFinisher(B.word.w, bonus);        // 完整单词展示 + 专属动画 + 冲击波 + 震屏 + 重音效
      sfx.word();                            // 保留原来的清脆铃声，叠在大招之上更有层次
      foeCry('hit');                                          // ← 语音层：怪物被击叫（WebAudio 合成）
      TTS.word(B.word.w);                                     // ← 语音：整词拼出自动朗读（最高优先级，抢在下一句台词前）
      if(hasR('battery') && B.wordsDone%3===0){ B.myHp=Math.min(G.maxhp,B.myHp+3); toast('🔋 永动电池：回复 3 生命') }
      B.enHp-=bonus;
      if(B.enHp<=0){ renderFight(); foeCry('die'); winFight(); return }
      B.combo=0;          // 换词时连击结算：防止伤害跨词无限叠加
      nextWord();
      return;
    }
    renderFight();
    if(B.enHp<=0) return winFight();
  }else{
    // ❌ 错误：区分「单词里根本没这个字母」和「字母对、只是顺序不对」
    // 两者都要扣血，但只有后者**不能**标记 bad —— 那个字母后面还要用来拼词，
    // 一旦标成不可选，这个词就永远拼不完（死局）。
    const inWord = tgt.indexOf(ch) >= 0;
    sfx.bad();
    if(keyEl){ keyEl.classList.add('flash'); const c=centerOf(keyEl);
      burst(c.x,c.y,inWord?'#ffb020':'#ff5470',16,4.5) }
    if(inWord){
      // 字母在单词里、只是位置不对：扣 ORDER_DMG（约为「完全不认识」的一半），
      // 但绝不标记 B.bad —— 这个字母后面还要用来拼词，标了就再也拼不完。
      // soft=true 让 hurtPlayer 跳过「错词记录」：顺序错不是知识错误，
      // 不能因此把一个已经学会的词踢出掌握表、也不能算进复习队列。
      G.att++;
      if(B.freezeWord){ toast('❄️ 冰冻中：这次不扣血'); }
      else hurtPlayer(B.boss?8:6, ch, tgt[pos], {soft:true});
      B.combo=Math.max(0,B.combo-1);
      B.wordStreak=0;   // 同样是一次失手 → 连续整词计数清零
      toast('「'+ch.toUpperCase()+'」在这个单词里，但位置不对');
    }else{
      // 这个字母压根不在单词里：真正不认识，扣血并标记
      B.bad[i]=true;
      G.att++;
      if(B.freezeWord){ toast('❄️ 冰冻中：这次不扣血'); }
      else hurtPlayer(B.boss?16:12, ch, tgt[pos]);
      // 专注头环：连击中断时保留一半，而不是清零
      B.combo = hasR('focus') ? Math.floor(B.combo/2) : 0;
      B.wordStreak=0;   // 真正答错 → 连续整词计数清零，大招回到基础档
    }
    renderFight();
  }
}
function hitDmg(){ return calculateHitDmg(G,B) }
/* ================= 战斗反馈的两条路径 =================
   玩家必须一眼看出「这一下是打对一个字母」还是「整个词拼完了」，
   所以伤害、动画、音效、视觉全部走两套独立参数，绝不共用：
     单字母 hitDmg()  → animHero('atk')  .34s 轻挥 + 20 粒子 + sfx.hit()
     整词   wordDmg() → animHero('fin')  .78s 蓄力暴挥 + 全词展示 + 冲击波
                                    + 54 粒子 + 双圈 + 闪屏 + 震屏 + sfx.finisher()
   掌握判定只有 wordComplete() 一个口径（见下），两条路径共用同一个分支入口，
   所以「动画播了但没记学会」/「记了学会但没动画」这两种漂移都不可能发生。 */
         // 整词的基础伤害 = 单字母基础伤害 × 4（连击为 0 时的静态倍率）
 // 大招额外再吃 1.8 份连击加成 → 连击流玩法的收益明显更高
   // 硬下限：任何层数/连击/道具组合下，整词伤害都 ≥ 单字母 ×3.2
     // 绝对上限：连击 + 增伤 + 怒火叠满也不会数值爆炸
   // 连续整词逐级增强：第1词×1，第5词起封顶×1.48
function finTier(){ return calculateFinTier(B) }
function wordDmg(){ return calculateWordDmg(G,B) }
/* 在敌人身上炸开一个巨大的完整单词：position:fixed + transform/opacity，
   动画结束即自删，不留残影、不触发任何重排。
   cls='go' 的那枚用 --dx/--dy 从角色位置甩向敌人（位移量由调用方算好写进 CSS 变量）。
   clampX=true 时按「元素实测宽度」把水平位置收进视口 ——
   ★ 实测发现：词条靠左（敌人在 .vsrow 左半边），34px 字号下 9 个字母就有 176px 宽，
     以敌人中心为锚点必然有 53px 溢出屏幕左边（「treatment」的 l=-53）。
     所以这里必须在插入 DOM 后量一次宽度再夹一次 x，词永远完整可见。 */
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
    const vw=innerWidth;
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
function dealDamage(d){
  B.enHp-=d;
  animHero('atk');                                   // ← 角色追加：每个正确字母都挥一下
  const av=$('fAv'); av.classList.remove('hurt'); void av.offsetWidth; av.classList.add('hurt');
  const c=centerOf(av);
  burst(c.x,c.y,B.foe.tint,20,5);
  floatTxt(c.x,c.y,'-'+d,B.foe.tint);
  // 角色出手的火花：从角色位置飞向敌人，形成「攻击」的视觉因果
  const hp=heroPoint();
  if(hp.x>0&&hp.x<innerWidth){ burst((hp.x+c.x)/2,(hp.y+c.y)/2,'#ffffff',6,4.5) }
  sfx.hit();
  if(B.enHp<=0 && B.enHp>-40) flash('#ff547033');
  if(B.enHp<=0) winFight();
}
function hurtPlayer(d,wrongCh,rightCh,opt){
  // opt.soft = 「字母在单词里、只是顺序不对」这类非知识错误：
  //   照样扣血、照样可能致死，但**不**记错词、不动掌握表、不播「不在这个词里」的文案
  //   （那句话对顺序错是错的，而且调用方紧接着会播准确的那句）。
  const soft=!!(opt&&opt.soft);
  let dmg=d;
  if(B.lethUsed>0){ B.lethUsed--; dmg=0; toast('🍀 幸运草：免于本次惩罚') }
  else if(B.firstWrong && B.boss){ B.firstWrong=false; dmg=Math.round(dmg/2); toast('🛡️ 首领首击减半') }
  if(dmg>0){
    if(B.shield>0){
      const a=Math.min(B.shield,dmg); B.shield-=a; dmg-=a;
      floatTxt(innerWidth/2,innerHeight*0.35,'护盾 -'+a,'#22d3ee');
    }
    if(dmg>0){
      B.myHp-=dmg;
      animHero('hurt');                               // ← 角色追加：受伤反应（抖动+变红）
      const c=centerOf($('fAv'));
      floatTxt(innerWidth/2,innerHeight*0.42,'-'+dmg,'#ff5470');
      flash('#ff54702e');
      sfx.hurt();
      // 语音：低血量时角色担心/打气。只在跨过 30% 血线那一刻喊，
      // 每次受伤都喊会盖住单词朗读、也会吵到崩溃。
      if(B.myHp>0 && B.myHp < G.maxhp*0.3 && !B._lowSaid){
        B._lowSaid=true; TTS.line('low',null,{force:true});
      } else if(B.myHp>=G.maxhp*0.5) B._lowSaid=false;   // 回血后重置，下次濒死还能喊
    }
  }
  // 荆棘护符：她答错时反弹 5 血给敌人（只结算一次，且不影响胜负判定）
  if(hasR('thorn') && dmg>0){ B.enHp-=5;
    const tc=centerOf($('fAv'));
    floatTxt(tc.x,tc.y,'荆棘 -5','#3ddc84');
    if(B.enHp<=0) winFight(); }
  // 错词记录：进本局复习队列，下一场优先出现。
  // soft（顺序错）不算 —— 玩家认识这个词，只是手滑排错了顺序；
  // 记进去会把已学会的词踢出掌握表，惩罚过重且与「只有完整拼出的词才算学会」冲突。
  if(!soft){
    if(!B.mistaken) B.mistaken=[];
    if(B.mistaken.indexOf(B.word.w)<0){ B.mistaken.push(B.word.w);
      onWordWrong(B.word.w);
      if(DB.mastered.indexOf(B.word.w)>=0) DB.mastered.splice(DB.mastered.indexOf(B.word.w),1);
      saveDB() }
  }
  // ★ 不要在这里报出完整单词或下一个该填的字母 —— 错误提示剧透 = 直接给答案。
  // 只告诉她「这个字母不对」，让她自己回忆词形。
  // soft 时跳过：调用方紧接着会播更准确的「位置不对」。
  if(!soft) toast('❌ 「'+wrongCh+'」不在这个词里，再想想');
  if(B.myHp<=0) loseFight();
}
function winFight(){
  if(B.over) return;
  B.over=true; B.won=true;
  sfx.win();
  // 语音：胜利台词强制发声（force=true 绕过限流 —— 这一刻是整局的高潮）
  setTimeout(()=>TTS.line('win',null,{force:true}), 260);
  burst(innerWidth/2,innerHeight*0.4,B.foe.tint,44,7);
  ring(innerWidth/2,innerHeight*0.4,'#ffce4d');
  // 标记掌握：只认「整词答完」，不认「打赢了」。
  // 敌人可能死于收尾一击（最后一个字母 / 荆棘反弹 / 道具直伤），
  // 那一刻当前单词往往只拼了一半 —— 半个词绝不能进掌握表，
  // 否则下次复习时这个没真学会的词就再也不会出现了。
  // 精英的额外门槛（必须打出连击）保留。
  // 记下「这局有个词没答完」，900ms 后的结算面板要如实告诉玩家（提示语 + 结算副标题）
  const unfinished = wordComplete()? null : B.word.w;
  if(wordComplete() && (!B.elite || B.combo>0)) creditWord(B.word.w);
  if(unfinished) toast('⚔️ 敌人倒下了，但「'+unfinished+'」还没拼完，下次继续');
  G.kills++;
  let g=25+(B.boss?120:B.elite?60:0)+Math.floor(G.floor*4);
  if(B.boss) g+=50;
  if(hasR('purse')) g+=25;
  // goldGain 内部已把金币加进 G.gold，这里只算最终数额用于文案
  goldGain(Math.round(g*(B.goldMult||1)));   // 贪婪钱币 ×3
  // 结算
  setTimeout(()=>{
    const acc=clamp(Math.round(G.attOk/Math.max(1,G.att)*100),0,100);
    show('s-pick');
    $('pTitle').textContent=B.boss?'🎉 击败词汇之王！':B.elite?'☠️ 精英击破！':'⚔️ 战斗胜利！';
    $('pSub').textContent='击杀 '+B.foe.ic+' '+B.foe.n+' · 正确率 '+acc+'% · 最高连击 '+B.maxCombo+' · 获得 '+g+' 金币'
      +(unfinished? ' · ⚠️「'+unfinished+'」没拼完，不算学会':'');
    const picks=$('pPicks'); picks.innerHTML='';
    const opts=[];
    if(!B.boss){
      const heal=Math.round(12+B.enMax*0.12);
      // 回血要作用在 B.myHp 上，否则会被 finishNode 的结转覆盖
      opts.push({cat:'heal',ic:'💚',t:'恢复生命',d:'回复 '+heal+' 点生命',fn:()=>{ B.myHp=Math.min(G.maxhp,B.myHp+heal); finishNode() }});
    }
    if(hasR('scholar') && rnd(3)===0){
      opts.push({cat:'boost',ic:'🃏',t:'先知卡',d:'下一场战斗开始时，自动揭示一个字母',fn:()=>{ G.nextHint=true; finishNode() }});
    }
    const availRel = RELICS.filter(r=>!has(G.relics,r.id));
    if(availRel.length){
      const three=shuffle(availRel).slice(0,3);
      // 标题只留遗物名，图标由卡片统一渲染（原来 r.n+' '+r.ic 把图标重复塞进了标题）
      three.forEach(r=>opts.push({cat:'relic',ic:r.ic,t:r.n,d:r.d,fn:()=>{ G.relics.push(r.id); sfx.relic();
        toast('获得遗物：'+r.n); applyRelicInit(); finishNode() }}));
    }
    // 战斗胜利掉落道具（精英/BOSS 必掉，普通战斗 35% 概率）
    if((B.elite||B.boss||Math.random()<0.35)){
      const drop=shuffle(ITEMS.filter(it=>(G.bag[it.id]|0)<it.max))[0];
      if(drop){
        const n=B.boss?3:(B.elite?2:1);
        // 「获得道具」前缀去掉，类别由徽标承担；tip 拆成独立的一行
        opts.push({cat:'item',ic:drop.ic,t:drop.n+' ×'+n,d:drop.d,tip:drop.tip,
          fn:()=>{ G.bag[drop.id]=(G.bag[drop.id]|0)+n; sfx.coin();
            toast('🎒 获得 '+drop.n+' ×'+n); finishNode() }});
      }
    }
    if(!opts.length) opts.push({cat:'none',ic:'✅',t:'继续前进',d:'没有更多奖励了',fn:finishNode});
    opts.forEach(o=>{
      const b=document.createElement('button');
      b.className='pick';
      b.dataset.cat=CAT_LABEL[o.cat]?o.cat:'none';   // 供 CSS 上色与测试断言
      b.innerHTML=pickCardHTML(o);
      b.onclick=o.fn;
      picks.appendChild(b);
    });
    $('pSkip').style.display=opts.length>1?'':'none';
    $('pSkip').onclick=()=>{ if(opts.length) opts[0].fn(); else finishNode() };
  },900);
}
function markMastered(w){
  if(DB.mastered.indexOf(w)<0){ DB.mastered.push(w); saveDB() }
}
// 「学会一个词」的唯一入口：跨局掌握表 + 本局退休必须同时发生。
// 这两件事一旦分开写，就会漂移出「没答完却记成学会」的漏洞：
// 掌握表决定这个词以后还复习不复习，本局退休决定它还会不会再出现。
// 少了任何一半，学习记录都会自相矛盾。
function creditWord(w){ if(creditWordProgress(DB,G,w)) saveDB() }
// 当前这个词是否已经「整词拼完」—— 「学会」的唯一判据。
// norm() 会剥掉连字符/撇号等非字母字符，B.input 只累加正确字母，
// 所以两边的长度口径一致，可以直接比。
function wordComplete(){ return isWordComplete(B) }
function loseFight(){
  if(B.over) return;
  B.over=true; sfx.lose();
  TTS.line('lose',null,{force:true});               // ← 语音：失败台词，角色自己的收场白
  flash('#ff547055');
  const run=G;
  setTimeout(()=>{ if(G===run) endRun(false) },800);
}
function finishNode(){
  if(!G || !B || B.finished) return;
  B.finished=true;
  const run=G;
  const n=B.node; if(n) n.done=true;
  G.hp=clamp(B.myHp,1,G.maxhp);      // 把战斗中的生命结转回远征状态
  G.shield=B.shield;                 // 护盾同理，跨战斗保留
  // 只有「真打赢」才算通关 BOSS；逃跑/跳过/影分身不算
  if(B.boss && B.won){ G.hp=Math.min(G.maxhp,G.hp+30); toast('🏆 通关！回复 30 生命'); DB.wins++; DB.best=Math.max(DB.best,9); saveDB();
    setTimeout(()=>{ if(G===run) endRun(true) },700); return }
  if(B.boss){ toast('👑 词汇之王逃脱了……远征失败'); setTimeout(()=>{ if(G===run) endRun(false) },700); return }
  advance();
}
const ADV_LOCK_MS=400;        // 双击去重窗口：够挡住连点，又短到不会挡住正常下一次推进
function advance(){
  // 幂等保护：用「时间窗」而不是布尔锁。布尔锁一旦漏清就会永久卡死（领完奖励无法进入下一层），
  // 时间窗天然会过期，任何异常/提前 return 路径都不可能把游戏锁住。
  const _now=Date.now();
  if(G.advAt && _now-G.advAt < ADV_LOCK_MS){ return }
  G.advAt=_now;
  G.floor++;
  G.maxFloor=Math.max(G.maxFloor,G.floor);
  if(hasR('battery')) G.hp=Math.min(G.maxhp,G.hp+8);
  G.hp=clamp(G.hp,1,G.maxhp);
  G.avail=(G.node&&G.node.links.length)?G.node.links.slice():[];
  G.cur=G.node;
  if(!G.avail.length){ endRun(false); return }
  show('s-map'); renderMap();
}
  $('tHint').onclick=()=>{
  if(!B||B.over||B.hints<=0) return;
  const tgt=norm(B.word.w);
  const pos=B.input.length;                       // 当前待输入的位置（下一个字母）
  const left=tgt.length-pos;                      // 还剩几个字母没填
  // 剩下的字母已经全被揭示了 → 不再白扣次数
  if(pos>=tgt.length || B.hintUsed>=left){
    toast(pos>=tgt.length? '这个词已经填完啦':'剩余字母已经全部揭示');
    return;
  }
  B.hints--; B.hintUsed++; B.hintTotal=(B.hintTotal||0)+1;
  // 提示同时解开被误标的字母，避免死局
  let freed=0;
  for(let j=0;j<B.letters.length;j++){
    if(!B.used[j]&&B.bad[j]&&B.letters[j]===tgt[pos]){ B.bad[j]=false; freed++ }
  }
  sfx.hint();
  renderFight();
  const nextCh=tgt[pos]||'';
  $('fCat').textContent='提示：第 '+(pos+1)+' 个字母是 '+nextCh.toUpperCase()+
    '（已揭示接下来 '+Math.min(B.hintUsed,left)+' / '+left+' 个）'+
    (freed?('（顺便解开了 '+freed+' 个误标字母）'):'');
};
$('tSkip').onclick=()=>{
  if(!B||B.over) return;
  if(hasR('ghost')&&!B.ghostUsed){ B.ghostUsed=true; toast('👻 影分身：免费撤退，不计失败'); finishNode(); return }
  if(hasR('ghost')) { toast('本场影分身已用完'); return }
  // 普通跳过：损失本场生命（注意要扣 B.myHp，否则会被 finishNode 的结转覆盖掉）
  const loss=Math.round(B.myHp*0.4);
  B.myHp=Math.max(1,B.myHp-loss);
  B.over=true;
  toast('跳过：损失 '+loss+' 点生命');
  finishNode();
};
$('tFlee').onclick=()=>{
  if(!B||B.over||G.gold<10) return;
  G.gold-=10; B.over=true;
  toast('逃跑成功，损失 10 金币');
  sfx.flee();
  finishNode();
};
document.addEventListener('keydown',e=>{
  if($('s-fight').classList.contains('on') && B && !B.over){
    // 焦点在输入框里时一律不抢键（自定义词表导入框、存档文本框等）
    const tn=(e.target&&e.target.tagName||'').toUpperCase();
    if(tn==='INPUT'||tn==='TEXTAREA') return;
    // 字母盘上没有光标，所以方向键 ←→↑↓ 在这里不做任何事：
    // 既不移动、不发声，也不改输入；连 preventDefault 都不做，
    // 让方向键保持浏览器默认行为（页面照常滚动），和其他界面一致。
    if(e.key==='1'||e.key==='2'||e.key==='3'){
      // 数字键快速使用第 N 个道具
      const held=Object.keys(G.bag||{}).filter(id=>(G.bag[id]|0)>0);
      const id=held[parseInt(e.key,10)-1];
      if(id) useItem(id);
      e.preventDefault();
    }
    else if(e.key==='Backspace'){
      if(B.input.length){
        const ch=B.input.pop();
        // 释放最后填入的那个字母实例，并清除其「已试过」标记
        for(let i=B.letters.length-1;i>=0;i--){
          if(B.used[i]&&B.letters[i]===ch){ B.used[i]=false; B.bad[i]=false; break }
        }
        G.attOk=Math.max(0,G.attOk-1);
        B.combo=Math.max(0,B.combo-1);
        sfx.undo();
        renderFight();
      }
      e.preventDefault();
    }
    // 电脑键盘直接打字（A-Z / a-z，效果与点击字母键完全一致）
    else if(e.key.length===1 && /[a-z]/i.test(e.key)){
      typeLetter(e.key);
      e.preventDefault();
    }
  }
});
// 打字入口：把敲下的字符映射到字母盘上的一个字母实例，再走**和点击同一个** pressKey
// 判定 —— 不经过 B.sel、不依赖任何光标，所以有没有光标对打字路径毫无影响。
// 返回是否消费了这次输入（字母盘上没有这个字母时不消费，交给浏览器默认行为）。
function typeLetter(raw){
  if(!B || B.over) return false;
  const ch=String(raw||'').toLowerCase();
  if(ch.length!==1 || ch<'a' || ch>'z') return false;
  const n=B.letters.length;
  // 优先挑「没被填过、也没被标错」的实例；重复字母出现多次也能对上正确的那个
  let pick=-1, fallback=-1;
  for(let i=0;i<n;i++){
    if(B.letters[i]!==ch || B.used[i]) continue;
    if(!B.bad[i]){ pick=i; break }
    if(fallback<0) fallback=i;      // 全被标错了：仍走 pressKey，由它给出「已试过」提示
  }
  if(pick<0) pick=fallback;
  if(pick<0) return false;          // 字母盘上根本没有这个字母 → 不当作输入
  B.sel=pick; pressKey(pick);
  return true;
}
function moveSel(d){
  let n=B.letters.length;
  for(let i=0;i<n;i++){ B.sel=(B.sel+d+n*2)%n; if(!B.used[B.sel]&&!B.bad[B.sel]) break }
  sfx.key(); renderFight();
}

/* ================= 事件 ================= */
const EVENTS=[
 {ic:'🎁',t:'神秘的背包',x:'你捡到一个鼓鼓的背包，主人却不见了。',o:[
   {cat:'relic',ic:'💎',t:'打开看看',d:'随机获得一个遗物',fn:()=>{ const av=RELICS.filter(r=>!has(G.relics,r.id));
      if(av.length){ const r=pick(av); G.relics.push(r.id); applyRelicInit(); sfx.relic(); return '你找到了 '+r.ic+' '+r.n+'！' }
      G.gold=goldGain(40); return '包里只有 40 金币，但聊胜于无。' }},
   {cat:'none',ic:'🚶',t:'不关我事',d:'离开，什么也不发生',fn:()=>'你背起包继续赶路。'}
 ]},
 {ic:'⛲',t:'神秘泉水',x:'一股清泉从石缝涌出，水面泛着微微的光。',o:[
   {cat:'heal',ic:'💚',t:'喝一口',d:'回复 25 点生命',fn:()=>{ G.hp=Math.min(G.maxhp,G.hp+25); return '伤口愈合了。' }},
   {cat:'boost',ic:'🔮',t:'灌满水壶',d:'获得 2 次免费提示（下一场战斗）',fn:()=>{ G.nextHint=(G.nextHint||0)+2; return '水壶泛着微光，下场战斗会帮你。' }},
   {cat:'heal',ic:'🥾',t:'装进瓶子带走',d:'回复 10 点生命',fn:()=>{ G.hp=Math.min(G.maxhp,G.hp+10); return '你还是带了点水。' }}
 ]},
 {ic:'⚔️',t:'老兵的剑',x:'一位老兵递给你一把剑：「会用吗？」',o:[
   {cat:'relic',ic:'🔥',t:'学以致用',d:'获得「连击徽章」，连击加成翻倍',fn:()=>{ G.relics.push('combo'); sfx.relic(); return '你的连击从此更锋利。' }},
   {cat:'event',ic:'💰',t:'卖掉换钱',d:'获得 60 金币',fn:()=>{ G.gold=goldGain(60); return '你换到了 60 金币。' }}
 ]},
 {ic:'📚',t:'遗忘之书',x:'一本书在你面前打开，书页上全是单词，却一个都读不懂。',o:[
   {cat:'relic',ic:'🧠',t:'认真研读',d:'当前战斗下次的拼写正确率提升：回复 20 生命并获得遗物',fn:()=>{ G.hp=Math.min(G.maxhp,G.hp+20);
      const av=RELICS.filter(r=>!has(G.relics,r.id)); if(av.length){ const r=pick(av); G.relics.push(r.id); sfx.relic(); applyRelicInit(); return '你读懂了 '+r.n+' 的含义。' }
      return '你读懂了更多，知识就是力量。' }},
   {cat:'heal',ic:'😴',t:'合上书休息',d:'回复 15 点生命',fn:()=>{ G.hp=Math.min(G.maxhp,G.hp+15); return '小憩片刻。' }}
 ]},
 {ic:'🎲',t:'命运的赌局',x:'一个蒙面人推来一枚硬币：「猜正反，赢了钱翻倍，输了归我。」',o:[
   {cat:'event',ic:'🪙',t:'押上 40 金币',d:'一半概率翻倍，一半概率全失',fn:()=>{ G.gold=goldGain(40);
      if(Math.random()<.5){ const w=G.gold; G.gold=w*2; return '硬币停在正面！你获得了 '+G.gold+' 金币。' }
      G.gold=0; return '反面。你的金币全没了。' }},
   {cat:'none',ic:'✋',t:'不赌了',d:'安全离开',fn:()=>'你明智地走开了。'}
 ]},
 {ic:'👺',t:'迷路的词灵',x:'一个小词灵缩在墙角，看起来迷路了。',o:[
   {cat:'heal',ic:'🍬',t:'给它一颗糖',d:'花费 20 金币，获得 12 点生命',fn:()=>{ if(G.gold<20) return '你金币不够。';
      G.gold-=20; G.hp=Math.min(G.maxhp,G.hp+12); return '它带你找到了一条捷径，你感觉好多了。' }},
   {cat:'event',ic:'📖',t:'教它拼写',d:'获得 30 金币的「学费」',fn:()=>{ const g=goldGain(30); return '它学会了，血量 +5。'.replace('血量 +5','')+' 你获得了 '+g+' 金币。' }}
 ]}
];
function showEvent(){
  const e=pick(EVENTS);
  $('eIcon').textContent=e.ic; $('eTitle').textContent=e.t; $('eText').textContent=e.x;
  const box=$('ePicks'); box.innerHTML=''; box._kids=[]; box._used=false;
  e.o.forEach(o=>{
    const b=document.createElement('button');
    b.className='pick';
    b.dataset.cat=CAT_LABEL[o.cat]?o.cat:'none';
    b.innerHTML=pickCardHTML(o);
    b.onclick=()=>{
      if(box._used)return; box._used=true;   // 双击保护：只生效一次
      const msg=o.fn(); toast(msg||'');
      if(G.hp<=0){ endRun(false); return }
      setTimeout(()=>{ const n=G.node; if(n)n.done=true; advance() },1100);
    };
    box.appendChild(b);
  });
  show('s-event');
}
function showRest(){
  $('rTitle').textContent='营火 🔥';
  $('rSub').textContent='只能选择一项';
  const rbox=$('rPicks'); rbox.innerHTML=''; rbox._kids=[]; rbox._used=false;
  const healAmt=hasR('forge')?20:12;
  const av=RELICS.filter(r=>!has(G.relics,r.id));
  const opts=[
    {cat:'heal',ic:'💚',t:'休息',d:'回复 '+healAmt+' 点生命',fn:()=>{ G.hp=Math.min(G.maxhp,G.hp+healAmt); return '你睡了个好觉。' }},
    {cat:'event',ic:'🧭',t:'研究地图',d:'回复 6 点生命并获得 40 金币',fn:()=>{ G.hp=Math.min(G.maxhp,G.hp+6); G.gold=goldGain(40); return '你规划了路线，还捡到了钱。' }}
  ];
  if(av.length){
    const r=pick(av);
    opts.push({cat:'relic',ic:r.ic,t:'冥想 · '+r.n,d:r.d,fn:()=>{ G.relics.push(r.id); sfx.relic(); applyRelicInit(); return '你获得了 '+r.n+'！' }});
  }
  opts.forEach(o=>{
    const b=document.createElement('button');
    b.className='pick';
    b.dataset.cat=CAT_LABEL[o.cat]?o.cat:'none';
    b.innerHTML=pickCardHTML(o);
    b.onclick=()=>{ if(rbox._used)return; rbox._used=true; toast(o.fn()||''); setTimeout(()=>{ const nd=G.node; if(nd)nd.done=true; advance() },900) };
    $('rPicks').appendChild(b);
  });
  show('s-rest');
}
function showShop(){
  $('rTitle').textContent='商店 🛒';
  // 明确显示当前金币：玩家进商店第一眼要知道买不买得起
  $('rSub').textContent='你的金币：'+G.gold+' 枚 —— 用金币强化自己';
  $('rPicks').innerHTML='';
  const opts=[
    {cat:'heal',ic:'💚',t:'疗伤药剂 · 45 金币',d:'回复 35 点生命',fn:()=>{ if(G.gold<45) return '金币不够。';
      G.gold-=45; G.hp=Math.min(G.maxhp,G.hp+35); return '伤口愈合了。' }},
    {cat:'boost',ic:'🔮',t:'提示卷轴 · 40 金币',d:'下一场战斗 +3 次提示',fn:()=>{ if(G.gold<40) return '金币不够。';
      G.gold-=40; G.shopHints=(G.shopHints||0)+3; return '卷轴收入行囊。' }},
    {cat:'boost',ic:'💪',t:'磨砺石 · 70 金币',d:'生命上限 +10 并回满',fn:()=>{ if(G.gold<70) return '金币不够。';
      G.gold-=70; G.maxhp+=10; G.hp=G.maxhp; return '你更强了。' }}
  ];
  const av=RELICS.filter(r=>!has(G.relics,r.id));
  if(av.length){ const r=pick(av);
    opts.push({cat:'relic',ic:r.ic,t:r.n+' · 80 金币',d:r.d,fn:()=>{ if(G.gold<80) return '金币不够。';
      G.gold-=80; G.relics.push(r.id); sfx.relic(); applyRelicInit(); return '你买下了 '+r.n+'！' }}) }
  // 卖道具：只卖玩家还没拿满的
  const shopItems=shuffle(ITEMS.filter(it=>(G.bag[it.id]|0)<it.max)).slice(0,3);
  shopItems.forEach(it=>{
    opts.push({cat:'item',ic:it.ic,t:it.n+' ×3 · '+it.price+' 金币',d:it.d,tip:it.tip,
      fn:()=>{ if(G.gold<it.price) return '金币不够。';
        G.gold-=it.price; G.bag[it.id]=(G.bag[it.id]|0)+3;
        sfx.coin(); return '获得 '+it.n+' ×3！' }})
  });
  opts.push({cat:'none',ic:'🚪',t:'离开商店',d:'什么都不买',leave:true,fn:()=>'你空手离开了。'});
  // 商店的按钮必须保持可点：只有「离开」才 advance()，之前用整盒共用的 _used 标记做双击保护，
  // 结果玩家买了任何一件东西之后，_used 永远为 true，连「离开商店」都点不动 —— 整局死锁。
  // 现在改成：购买可重复点（每件都是独立的一次交易，符合商店直觉，也允许连买多件）；
  // 「离开」靠 advance() 自己的时间窗去重；单按钮加一层极短的点击冷却，只防手滑连点，不影响正常购买。
  const CLICK_CD_MS=260;
  const sbox=$('rPicks');
  opts.forEach(o=>{
    const b=document.createElement('button');
    b.className='pick';
    b.dataset.cat=CAT_LABEL[o.cat]?o.cat:'none';
    b.innerHTML=pickCardHTML(o);
    b.onclick=()=>{
      if(o.leave){ const n=G.node; if(n)n.done=true; advance(); return }
      const now=Date.now();
      if(b._at && now-b._at < CLICK_CD_MS) return;   // 仅防手滑连点扣两次金币
      b._at=now;
      const m=o.fn(); if(m) toast(m);
    };
    sbox.appendChild(b);
  });
  show('s-rest');
}
// 纪念卡只记录本次远征表现，不代表掌握所选范围的全部词汇。
function rewardScope(unit){
  const u=UNITS.find(x=>x.n===unit);
  return u?u.t:(unit===-1?'全册':'所选范围');
}
function renderRewardCard(box,r){
  box.innerHTML='';
  const card=document.createElement('article'); card.className='reward-card';
  const title=document.createElement('h3'); title.textContent='词王征服者 · 通关纪念卡'; card.appendChild(title);
  const scope=document.createElement('p'); scope.textContent=rewardScope(r.unit)+' · '+heroById(r.heroId).n; card.appendChild(scope);
  const stats=document.createElement('p'); stats.textContent='拼写正确率 '+r.accuracy+'% · 击败词灵 '+r.kills+' · 到达 '+r.floor+' 层'; card.appendChild(stats);
  const note=document.createElement('small'); note.textContent='击败最终 BOSS 的纪念，不代表已掌握全部词汇。'; card.appendChild(note);
  const stamp=document.createElement('small'); stamp.textContent='获得于 '+new Date(r.earnedAt).toLocaleString('zh-CN')+' · 卡片 '+r.id; card.appendChild(stamp);
  box.appendChild(card);
}
function endRun(win){
  if(!G) return; // 清档后忽略尚未执行的结算回调。
  const acc=clamp(Math.round(G.attOk/Math.max(1,G.att)*100),0,100);
  const rewardBox=$('oReward'); rewardBox.innerHTML=''; rewardBox.hidden=!win;
  if(win){
    if(!G.reward){
      G.reward={id:'WR-'+Date.now().toString(36)+'-'+DB.runs+'-'+DB.rewards.length,
        unit:G.unit,heroId:G.heroId,accuracy:acc,kills:G.kills,floor:G.maxFloor,earnedAt:new Date().toISOString()};
      DB.rewards.push(G.reward);
    }
    renderRewardCard(rewardBox,G.reward);
  }
  DB.best=Math.max(DB.best,G.maxFloor); saveDB();
  G.result=!!win;
  $('oAgain').textContent=win?(G.unit===0?'复习自定义词表':'复习本单元'):'再来一次';
  const next=UNITS.find(u=>G.unit>0 && u.n===G.unit+1);
  $('oNext').hidden=!win || !next;
  $('oNext').textContent=next?'继续 Unit '+next.n:'继续下一 Unit';
  $('oIcon').textContent=win?'🏆':'💀';
  $('oTitle').textContent=win?'远征成功！':'远征结束';
  $('oText').textContent=win?'你击败了词汇之王，完成了'+rewardScope(G.unit)+'的本次远征！'+(G.unit>0 && !next?'已到本册最后一个单元，可复习本单元或返回选择单元。':'')
    :'你倒在了第 '+G.floor+' 层。那些还没记住的词，还在等着你。';
  $('oFloor').textContent=G.maxFloor;
  $('oKill').textContent=G.kills;
  $('oAcc').textContent=acc+'%';
  const rb=$('oRelics'); rb.innerHTML='';
  if(!G.relics.length) rb.innerHTML='<span style="font-size:12px;color:var(--dim)">这次没有获得遗物</span>';
  G.relics.forEach(id=>{ const r=relicById(id); if(!r)return;
    const d=document.createElement('div'); d.className='relic'; d.textContent=r.ic; d.title=r.n; rb.appendChild(d) });
  show('s-over');
  renderTitle();
}
$('oAgain').onclick=()=>{ if(!G || typeof G.result!=='boolean') return; curUnit=G.unit; newRun() };
$('oNext').onclick=()=>{ if(!G || !G.result || !UNITS.some(u=>G.unit>0 && u.n===G.unit+1)) return; curUnit=G.unit+1; newRun() };
$('oHome').onclick=()=>{ G=null; B=null; renderTitle(); show('s-title') };
$('mQuit').onclick=()=>{ if(confirm('放弃这次远征？进度不会保存')){ G=null; renderTitle(); show('s-title') } };

/* ================= 标题页 ================= */
// 角色形象 HTML：全部部件用 <i>，靠 data-h 上色/变形（标题页与战斗页共用同一套图形）
// 部件顺序 = 叠放顺序，必须与战斗页 #fPcI 里那段静态 HTML 完全一致，否则两处显示会不同。
function pcHTML(id){
  return '<div class="pc" data-h="'+id+'"><div class="pci">'+
    '<i class="pc-shadow"></i><i class="pc-cape"></i><i class="pc-torso"></i>'+
    '<i class="pc-hairb"></i><i class="pc-sash"></i><i class="pc-arm"></i>'+
    '<i class="pc-hand"></i><i class="pc-prop"></i><i class="pc-head"></i>'+
    '<i class="pc-blush"></i><i class="pc-eye pc-eyeL"></i><i class="pc-eye pc-eyeR"></i>'+
    '<i class="pc-lid"></i><i class="pc-mouth"></i><i class="pc-hair"></i>'+
    '<i class="pc-hairt"></i><i class="pc-gear"></i>'+
  '</div></div>';
}
// 卡片上的数值速览：把 mod 翻成「生命 -10 / 提示 +1」这种一眼能懂的短标签
function heroStatLines(H){
  const M=H.mod||{}, out=[];
  if(M.hp)      out.push('生命 '+(M.hp>0?'+':'')+M.hp);
  if(M.hint)    out.push('提示 '+(M.hint>0?'+':'')+M.hint);
  if(M.noise)   out.push('干扰字母 '+(M.noise>0?'+':'')+M.noise);
  if(M.shield)  out.push('护盾 +'+M.shield);
  if(M.gold)    out.push('金币 +'+M.gold);
  if(M.regen)   out.push('开场回血 +'+M.regen);
  if(M.leech)   out.push('答对回血 +'+M.leech);
  if(M.combo)   out.push('连击加成 '+(M.combo*100-100).toFixed(0)+'%');
  return out;
}
function renderHeroes(){
  const box=$('heroes'); if(!box) return;
  const sel=curHeroId();
  box.innerHTML='';
  HEROES.forEach(H=>{
    const b=document.createElement('button');
    b.className='hcard'+(H.id===sel?' sel':'');
    b.type='button';
    b.setAttribute('aria-pressed', H.id===sel?'true':'false');
    b.innerHTML=pcHTML(H.id)+'<b>'+H.n+'</b><span class="hs">'+heroStatLines(H).join('<br>')+'</span>';
    b.onclick=()=>{ DB.hero=H.id; saveDB(); renderHeroes() };
    box.appendChild(b);
  });
  const cur=curHero();
  const d=$('heroDesc');
  if(d) d.innerHTML='<b>'+cur.n+'</b> · <i>'+cur.tag+'</i><br>'+cur.d;
}
function renderTitle(){
  renderHeroes();
  const box=$('units'); box.innerHTML='';
  UNITS.forEach(u=>{
    const ws=allWords(u.n);
    const b=document.createElement('button');
    b.className='unit'+(curUnit===u.n?' sel':'');
    const m=DB.mastered.filter(w=>ws.some(x=>x.w===w)).length;
    b.innerHTML='<b>'+u.t+'</b><span>'+ws.length+' 词'+(ws.length?'':'（空）')+'</span>'+
      (ws.length?'<em>'+(m?('已掌握 '+m+'/'+ws.length):'未开始')+'</em>':'');
    b.onclick=()=>{ curUnit=u.n; renderTitle() };
    box.appendChild(b);
  });
  $('sRun').textContent=DB.runs;
  $('sWin').textContent=DB.wins;
  $('sMaster').textContent=DB.mastered.length;
  $('sFloor').textContent=DB.best;
  $('rewardSummary').textContent='通关纪念卡 · '+DB.rewards.length+' 张（点击查看）';
  const cards=$('rewardCards'); cards.innerHTML='';
  if(!DB.rewards.length){
    const empty=document.createElement('p'); empty.className='note'; empty.textContent='击败最终 BOSS 后，纪念卡会收藏在这里。'; cards.appendChild(empty);
  }
  DB.rewards.slice().reverse().forEach(r=>{
    const slot=document.createElement('div'); renderRewardCard(slot,r); cards.appendChild(slot);
  });
}
$('startRun').onclick=()=>{ if(newRun()){} };
$('toRelics').onclick=()=>{
  const box=$('rlBox'); box.innerHTML='';
  RELICS.forEach(r=>{
    const d=document.createElement('div');
    d.className='rlc'+(G&&has(G.relics,r.id)?' sel':'');
    d.innerHTML='<div class="ic">'+r.ic+'</div><b>'+r.n+'</b><span>'+r.d+'</span>';
    box.appendChild(d);
  });
  show('s-relics');
};
$('toImport').onclick=()=>{
  $('ta').value=DB.custom.map(x=>x.w+' '+x.z).join('\n');
  $('impMsg').textContent=''; show('s-import');
};
$('doImport').onclick=()=>{
  const lines=$('ta').value.split('\n'); const out=[]; let bad=0;
  for(let i=0;i<lines.length;i++){
    const l=lines[i].trim(); if(!l) continue;
    const m=l.match(/^([A-Za-z][A-Za-z'’-]*(?:[ ][A-Za-z'’-]+)*)\s*[,，]\s*(.+)$/)
          || l.match(/^([A-Za-z][A-Za-z'’-]*(?:[ ][A-Za-z'’-]+)*)\s+([\s\S]+)$/);
    if(!m){ bad++; continue }
    out.push({w:m[1].trim(), z:m[2].trim()});
  }
  if(!out.length){ $('impMsg').innerHTML="<span style='color:var(--bad)'>没解析出词，格式：英文 中文</span>"; return }
  DB.custom=out; saveDB();
  $('impMsg').innerHTML="<span style='color:var(--ok)'>导入 "+out.length+" 个词"+(bad?("，"+bad+" 行被跳过"):"")+"</span>";
  renderTitle();
};
$('clearCustom').onclick=()=>{
  if(!confirm('清空自定义词库？')) return;
  DB.custom=[]; saveDB(); $('ta').value=''; $('impMsg').innerHTML="<span style='color:var(--mut)'>已清空</span>"; renderTitle();
};
$('toReset').onclick=()=>{
  if(!confirm('清空所有存档（远征次数、通关次数、已掌握词、自定义词库、通关纪念卡）？')) return;
  const keepHero=DB.hero;   // 清档不该让人重选角色
  // 字母盘显示偏好也留着：清档清的是进度，不是界面口味（与 keepHero 同理）
  const keepKb={kbMode:DB.kbMode,kbUpper:DB.kbUpper};
  DB={runs:0,wins:0,mastered:[],best:0,custom:[],rewards:[],hero:keepHero,kbMode:keepKb.kbMode,kbUpper:keepKb.kbUpper};
  G=null; B=null;
  $('oReward').innerHTML=''; $('oReward').hidden=true;
  saveDB(); renderTitle();
};
document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>{ renderTitle(); show('s-title') });

renderTitle();


if (import.meta.env.DEV && window.__VOCAB_TEST__ === true) {
  window.__gameTest = {
    get DB(){return DB}, set DB(value){DB=value},
    get G(){return G}, set G(value){G=value},
    get B(){return B}, set B(value){B=value},
    get curUnit(){return curUnit}, set curUnit(value){curUnit=value},
    newRun,startFight,pressKey,endRun,renderFight,renderTitle,renderMap,
    enterNode,showEvent,showRest,showShop,finishNode,advance,winFight,
    loseFight,drawLetters,norm,hitDmg,wordDmg,wordComplete,typeLetter,
    creditWord,onWordWrong,hpBarGeom,paintHpBar,bankRows,syncBankBar,
    sayCurrentWord,useItem,show,TTS,AU,WORDS,UNITS,HEROES,ITEMS,RELICS,
  };
}
}
