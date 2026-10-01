import { parseCustomWords } from '../domain/custom-words.js';
import { createCombatController } from './combat.js';
import { createEncounterController } from './encounters.js';
import { createRun, advanceRun, finishBattleNode, endRunProgress, isDuplicateRunStart, registerRunStart } from '../domain/run.js';
import { generateMap } from '../domain/map.js';
import { drawWord as selectWord } from '../domain/word-selection.js';
import { drawLetters as generateLetters, bankCols, bankRows as layoutBankRows, bankPosOf as layoutBankPosOf } from '../domain/letter-bank.js';
import { createTitleScreen } from '../ui/screens/title.js';
import { createMapScreen } from '../ui/screens/map.js';
import { createFightScreen } from '../ui/screens/fight.js';
import { renderOver } from '../ui/screens/over.js';
import { paintHpBar } from '../ui/components/hp-bar.js';
import { pcHTML, heroStatLines, heroById, HERO_DEFAULT } from '../ui/components/hero.js';
import { rewardScope, renderRewardCard } from '../ui/components/reward-card.js';
import { pickCardHTML, CAT_LABEL } from '../ui/components/pick-card.js';
import { createEffects } from '../ui/effects.js';
import { createLifecycle } from './lifecycle.js';
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
const lifecycle=createLifecycle();

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
/* ================= 工具 ================= */
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const rnd = n => Math.floor(Math.random()*n);
const pick = a => a[rnd(a.length)];
const shuffle = a => { a=a.slice(); for(let i=a.length-1;i>0;i--){const j=rnd(i+1); const t=a[i];a[i]=a[j];a[j]=t;} return a; };

/* 词组排版微调：让「最长的那个单词」也能自己占满一整行。
   为什么需要：living conditions 的 conditions 有 10 个字母，320px 屏上按默认
   槽宽（27px + 5px 间距）需要 10×27+9×5 = 315px，而可用宽只有 278px ——
   flex 只能从单词中间断开，排成 LIVING|COND / ITIONS，短语就散架了。

   做法：按单词分段量出「最长的那段有几个槽位」，超宽就整体等比收窄槽位与间距
   （最多收到 68%，不至于缩成看不清），换「每个单词都不被拆开」。
   单个单词（没有空格）时直接返回 —— 普通词保持原槽宽，视觉不变。
   全程只改 style.width / style.gap：不动 DOM 结构、不动 class、不动判定。
   Node 的 DOM 桩没有 getComputedStyle，所以必须 typeof 守卫。 */

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
const {burst,ring,floatTxt,flash,centerOf,heroPoint,animHero,wordFinisher}=createEffects({sfx});

/* ================= 词库 ================= */

const allWords = u => u===0 ? DB.custom.map(x=>({u:0,d:2,w:x.w,z:x.z,th:'custom'})) : WORDS.filter(x=>x.u===u);

/* ================= 主动道具（战斗中可点，按 1/2/3 快捷键）=================
   设计原则：每个道具都有明确代价，不能无脑全带。
   吸血类回复少、爆发类消耗连击、防御类牺牲伤害。 */

const relicById = id => RELICS.filter(r=>r.id===id)[0];
const itemById=id=>ITEMS.filter(x=>x.id===id)[0];

/* 角色没有 voice 字段时（老数据 / 未来新增角色）也能拿到安全默认值 */
const HERO_VOICE_DEFAULT={rate:0.9, pitch:1.0, prefer:null};

/* 兼容老存档：DB.hero 缺失时回退到第一位，绝不让 undefined 渗进数值计算 */

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
let selIdx=0;

function newRun(){
  const pool=allWords(curUnit);
  if(!pool.length){alert('这个单元还没有词，去「导入词表」添加吧');return false}
  lifecycle.resetRun();TTS.stop();B=null;
  G=createRun(curUnit,curHero(),pool);
  // ★ 远征次数的唯一入口：真正新开一轮才 +1，恢复/读档不经过这里。
  registerRunStart(DB,G);applyRelicInit();saveDB();
  show('s-map');renderMap();return true;
}
// ★ 玩家点「开始远征 / 再来一次 / 下一单元」的唯一入口。
// 连点时第二次会看到「当前 G 还是一场没结束的远征」，直接放弃 —— 不建 run、不计数。
// 判据是状态而不是时间窗：时间窗会误伤「放弃这次远征 → 立刻重开」和
// 「结算完 → 立刻下一单元」这些正常操作。
// 内部强制重开（测试探针、将来的恢复流程）直接调 newRun()，不受这个闸门约束。
function startRunFromUi(){
  if(isDuplicateRunStart(G))return false;
  return newRun();
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

/* ---- 商店投放规则：按金币曲线定档，不是随手拍的百分比 ----
 * 金币只来自战斗：25 + 层数×4（精英再 +60）。逐层累加的期望持有量：
 *   进入 r=1≈15   r=2≈38   r=3≈65   r=4≈93   r=5≈124  r=6≈157  r=7≈193
 * 商店最便宜的货 35 金币（贪婪钱币），最有用的是 45 金币的疗伤药剂。
 *   → 走到 r<=2 手里最多 ~38 金币，连一瓶药都买不起，商店纯粹是扫兴（差 7 块，最难受）
 *   → r=3 起有 ~65 金币，买得起 1 瓶药，商店才开始有意义
 * 所以：前期（r<=2）彻底不出商店；中期（r=3..6）保持 12%；首领战前一行强制营火+商店。 */
                 // 前期边界：r<=2 无商店
function buildMap(){G.rows=generateMap();G.cur=null;G.floor=1;G.maxFloor=1;G.avail=G.rows[0].slice();G.pending=null}
/* 地图几何：全部按容器实际像素计算，保证任意层数/宽度下节点都不重叠 */
        // 相邻层之间的垂直净间隙（要求 ≥8）

function mapMetrics(){return mapScreen.mapMetrics()}
function renderMap(){return mapScreen.renderMap()}
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
  lifecycle.resetBattle();
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
      lethUsed:hasR('lucky')?1:0, wordsDone:0, over:false, mistaken:[],
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
function drawWord(budget){return selectWord(G,B,budget)}
// 生成字母盘（答案字母 + 干扰字母）
function drawLetters(qword){return generateLetters(G,B,qword)}
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


/* ================= 字母盘布局：字母盘模式 ↔ QWERTY 键盘模式 =================
   - 偏好存在 DB（存档 key 仍是 wy8a_rogue_v1，新增字段，老存档缺字段时回落默认值 false）
   - kbMode：字母盘按电脑 QWERTY 三行阶梯排；gridMode：沿用原来的乱序网格
   - kbUpper：纯显示开关。判定永远走 norm()（转小写），所以两种显示都能正常判对   */

// 每个小写字母在 QWERTY 上的 {行, 列}；不在键盘上的（如误入的非 a-z）返回 null

const isKbMode =()=> !!DB.kbMode;
const isKbUpper=()=> !!DB.kbUpper;
// 把 B.letters 按当前模式算成 [[行内字母索引,...], ...]，行内顺序 = 视觉从左到右
// 键盘模式：每个字母落在它真实键盘位置那一行，行内按键盘列排序（不左右颠倒）；
//            没有字母的键盘行不输出（不留空行），所以行数由实际字母动态决定（1~3 行）
function bankRows(){return layoutBankRows(B.letters,isKbMode())}
// 某个字母实例在当前布局下的视觉位置；找不到返回 null
function bankPosOf(i){return layoutBankPosOf(B.letters,isKbMode(),i)}
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

// 敌人血条没有护盾概念，单独保留（也走 paintHpBar 保持同一套换算口径）
function renderFight(){return fightScreen.renderFight()}
// 同步字母盘模式按钮的高亮状态与文案（renderFight 每次都会调）
function syncBankBar(){return fightScreen.syncBankBar()}
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
    else { const word=B.word.w; lifecycle.scheduleBattle(()=>{ if(B && B.word.w===word && TTS.on && TTS.hint(word)) pulseSay() }, 950*i) }
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
function renderItems(){return fightScreen.renderItems()}
// 使用道具
function useItem(id){return combat.useItem(id)}
// idx：本次要按下的字母实例下标。省略时回落到 B.sel（点击路径就是这么调的）。
// 打字路径直接传下标，因此完全不依赖 B.sel / 光标。
function pressKey(idx){return combat.pressKey(idx)}
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
function dealDamage(d){return combat.dealDamage(d)}
function hurtPlayer(d,wrongCh,rightCh,opt){return combat.hurtPlayer(d,wrongCh,rightCh,opt)}
function winFight(){
  if(B.over) return;
  B.over=true; B.won=true;
  sfx.win();
  // 语音：胜利台词强制发声（force=true 绕过限流 —— 这一刻是整局的高潮）
  lifecycle.scheduleBattle(()=>TTS.line('win',null,{force:true}), 260);
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
  lifecycle.scheduleBattle(()=>encounters.showBattleRewards(g,unfinished),900);
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
  const result=finishBattleNode(G,B,DB);
  if(result==='ignored')return;
  if(result==='boss-win'){toast('🏆 通关！回复 30 生命');saveDB();lifecycle.scheduleRun(()=>endRun(true),700);return}
  if(result==='boss-loss'){toast('👑 词汇之王逃脱了……远征失败');lifecycle.scheduleRun(()=>endRun(false),700);return}
  advance();
}
        // 双击去重窗口：够挡住连点，又短到不会挡住正常下一次推进
function advance(){
  if(!G)return;
  const result=advanceRun(G);
  if(result==='locked')return;
  if(result==='ended'){endRun(false);return}
  show('s-map');renderMap();
}
$('tHint').onclick=()=>combat.requestHint();
$('tSkip').onclick=()=>combat.skipFight();
$('tFlee').onclick=()=>combat.fleeFight();
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
      combat.undoLetter();
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
function typeLetter(raw){return combat.typeLetter(raw)}
function moveSel(d){
  let n=B.letters.length;
  for(let i=0;i<n;i++){ B.sel=(B.sel+d+n*2)%n; if(!B.used[B.sel]&&!B.bad[B.sel]) break }
  sfx.key(); renderFight();
}

/* ================= 事件 ================= */

function showEvent(){return encounters.showEvent()}
function showRest(){return encounters.showRest()}
function showShop(){return encounters.showShop()}
// 纪念卡只记录本次远征表现，不代表掌握所选范围的全部词汇。


function endRun(win){
  if(!G)return;
  endRunProgress(G,DB,win);saveDB();
  renderOver({run:G,db:DB,win,onTitle:renderTitle,show});
}
$('oAgain').onclick=()=>{ if(!G || typeof G.result!=='boolean') return; curUnit=G.unit; startRunFromUi() };
$('oNext').onclick=()=>{ if(!G || !G.result || !UNITS.some(u=>G.unit>0 && u.n===G.unit+1)) return; curUnit=G.unit+1; startRunFromUi() };
$('oHome').onclick=()=>{ lifecycle.resetRun(); TTS.stop(); G=null; B=null; renderTitle(); show('s-title') };
$('mQuit').onclick=()=>{ if(confirm('放弃这次远征？进度不会保存')){ lifecycle.resetRun(); TTS.stop(); G=null; B=null; renderTitle(); show('s-title') } };

/* ================= 标题页 ================= */
// 角色形象 HTML：全部部件用 <i>，靠 data-h 上色/变形（标题页与战斗页共用同一套图形）
// 部件顺序 = 叠放顺序，必须与战斗页 #fPcI 里那段静态 HTML 完全一致，否则两处显示会不同。

// 卡片上的数值速览：把 mod 翻成「生命 -10 / 提示 +1」这种一眼能懂的短标签

function renderHeroes(){return titleScreen.renderHeroes()}
function renderTitle(){return titleScreen.renderTitle()}
// One state owner; feature controllers and renderers receive explicit live getters/actions.
const state={get DB(){return DB},get G(){return G},get B(){return B}};
const titleScreen=createTitleScreen({getDB:()=>DB,getUnit:()=>curUnit,allWords,
  onHero:id=>{DB.hero=id;saveDB()},onUnit:unit=>{curUnit=unit}});
const mapScreen=createMapScreen({getRun:()=>G,onEnter:enterNode,onToast:toast,onNodeSound:()=>sfx.node()});
const fightScreen=createFightScreen({getRun:()=>G,getBattle:()=>B,getDB:()=>DB,
  onPress:i=>{B.sel=i;pressKey(i)},onUseItem:useItem,paintSayBtn});
const combat=createCombatController({state,ports:{$,norm,clamp,rnd,hasR,itemById,hitDmg,wordDmg,wordComplete,
  creditWord,onWordWrong,centerOf,heroPoint,toast,sfx,TTS,burst,floatTxt,flash,ring,animHero,
  wordFinisher,foeCry,renderFight,nextWord,winFight,loseFight,finishNode,saveDB,
  scheduleBattle:lifecycle.scheduleBattle}});
const encounters=createEncounterController({state,ports:{$,clamp,pick,shuffle,rnd,has,hasR,goldGain,applyRelicInit,
  sfx,toast,advance,endRun,finishNode,show,scheduleRun:lifecycle.scheduleRun,scheduleBattle:lifecycle.scheduleBattle}});
        // 字母光标

$('startRun').onclick=()=>{ startRunFromUi() };
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
  const {words:out,bad}=parseCustomWords($('ta').value);
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
  lifecycle.resetRun(); TTS.stop(); G=null; B=null;
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
