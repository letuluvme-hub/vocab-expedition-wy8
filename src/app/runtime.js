import { parseCustomWords } from '../domain/custom-words.js';
import { createCombatController } from './combat.js';
import { createEncounterController } from './encounters.js';
import { createRun, advanceRun, finishBattleNode, endRunProgress, syncRoundCard, isDuplicateRunStart, registerRunStart } from '../domain/run.js';
import { assignRoundId } from '../domain/run.js';
import { newRoundId, noteRoundUnitComplete } from './rounds.js';
import { recordRoundUnitComplete } from '../domain/campaign.js';
import { generateMap } from '../domain/map.js';
import { drawWord as selectWord, isPoolComplete } from '../domain/word-selection.js';
import { drawLetters as generateLetters, bankCols, bankRows as layoutBankRows, bankPosOf as layoutBankPosOf } from '../domain/letter-bank.js';
import { createTitleScreen } from '../ui/screens/title.js';
import { createMapScreen } from '../ui/screens/map.js';
import { createFightScreen } from '../ui/screens/fight.js';
import { createPauseScreen } from '../ui/screens/pause.js';
import { createLearningCompleteScreen } from '../ui/screens/learning-complete.js';
import { createProgressStore } from '../services/progress.js';
import { PHASE } from '../domain/run-snapshot.js';
import { createProgressController } from './progress.js';
import { renderOver } from '../ui/screens/over.js';
import { paintHpBar } from '../ui/components/hp-bar.js';
import { pcHTML, heroStatLines, heroById, HERO_DEFAULT } from '../ui/components/hero.js';
import { rewardScope, renderRewardCard } from '../ui/components/reward-card.js';
import { pickCardHTML, CAT_LABEL } from '../ui/components/pick-card.js';
import { createEffects } from '../ui/effects.js';
import { createLifecycle } from './lifecycle.js';
import { createFoeAttackController } from './foe-attacks.js';
import { WORDS } from '../data/words.js';
import { createStorage, initializeDB } from '../services/storage.js';
import { norm, wordGapBefore } from '../domain/text.js';
import { comboRate as calculateComboRate, hitDmg as calculateHitDmg, wordDmg as calculateWordDmg,
  finTier as calculateFinTier, WORD_RATIO, WORD_COMBO_BOOST } from '../domain/damage.js';
import { hpBarGeom } from '../domain/hp.js';
import { canFinishFight } from '../domain/battle-rules.js';
import { unlockProgress, canSelectUnit, recordUnitComplete, transitionNextUnit,
  applyUnitTransition, applyUnitSegment, ensureProgress } from '../domain/campaign.js';
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
import { createAudioSettings, nearestVolStep } from '../ui/components/audio-settings.js';
import { createAudioCapability, CHANNEL } from '../services/audio-capability.js';
import { createAudioCompatibility } from '../ui/components/audio-compatibility.js';
import { growthSummary, GROWTH_VERSION } from '../domain/mastery-growth.js';
import { createMasteryGrowth } from '../ui/components/mastery-growth.js';
/* 逐轮难度（清单 10）：规则全在 domain/round-difficulty.js，这里只做接线 ——
   开局派生一次存进 run.difficulty，战斗里读它，绝不在换词/换单元时重算。 */
import { deriveRoundDifficulty, scaleEnemyHealth } from '../domain/round-difficulty.js';

/* ★ 把成长摘要转换成 createRun 接受的开局事实（docs/feature-mastery-growth.md）。
 *   规则全在 domain/mastery-growth.js，这里只做形状转换：规则算出的 bonusHp 原样带过去，
 *   baseMaxhp 是「角色基础值」70 + 角色 hp（成长之前），只作诊断留档。
 *   脏数据（mastered 非数组 / 词库为空）由 growthSummary 退化成 0，这里不会造出 NaN。 */
const growthFact=(mastered,words,hero)=>{
  const s=growthSummary(mastered,words);
  const m=(hero&&hero.mod)||{};
  return {version:GROWTH_VERSION,masteredAtStart:s.masteredCount,
    bonusHp:s.bonusHp,baseMaxhp:70+(m.hp||0)};
};

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
// 当前可见的 screen id：暂停屏要靠它知道「该回到哪一屏」。
const currentScreen = () => { const s=document.querySelector('.screen.on'); return s ? s.id : null };

const storage=createStorage();
let DB=initializeDB(storage.load());
/* ★ 存档一致性：saveDB **不再**直接 storage.save(DB)。
   整词答对时 creditWord 会调它，可那一刻 wordsDone / fin / enHp 都还没更新 ——
   直接落盘就会把「新掌握的词」和「上一帧的战斗」写在一起，暂停/刷新都读得到中间态。
   现在 saveDB 只**标脏**，由每个完成状态的动作末尾（progress 的 mutating 包装）
   或显式的相位切换走 commit(false)：那一刻所有副作用都已落地，
   于是「学习记录 + 当前快照」是同一次 commit，永远读不到旧奖励 / 旧相位。 */
let dbDirty=false;
const saveDB=()=>{ dbDirty=true };
let progressCtl=null;   // progress 在本文件后面才创建；用可变引用避免 TDZ。
/* ★ 真正的提交点。
 *   force=true（受闸门动作的事务末尾）：**无条件**把当前快照写下去。
 *     旧实现只在这里「若被 saveDB 标脏才提交」，而 enterNode / 半词 / 提示 /
 *     道具 / 商店按钮 / 语音开关这些真实动作根本不调 saveDB —— 于是它们改完的
 *     状态只活在内存里，玩家刷新就回到上一个动作。落盘的判据必须是
 *     「这个动作跑完了」，不是「学习记录碰巧脏了」。
 *   force=false（纯设置项 / 嵌套内部）：仍按 dbDirty 判定，且在事务内部一律延期，
 *     绝不写出中间态（badphase 快照）。
 *   没有远征时（音量、字母盘模式、导入词表、语音开关）只写 DB：
 *     存档里那份解不开的 activeRun 属于**未知字段**，原样保留，不在这里清掉。 */
const commit=(force)=>{
  if(mutationDepth>0) return false;                 // 事务未收尾：交给最外层
  const dirty=dbDirty;
  if(!force && !dirty) return false;
  dbDirty=false;
  // G 在本文件后面才声明（let），模块初始化早期调用这里会踩 TDZ —— 用 try 取。
  const run=(()=>{ try{ return G }catch(e){ return null } })();
  // 没有进行中的远征（纯设置项：音量、字母盘模式、导入词表、语音开关）：
  // 只写学习 DB。存档里那份解不开的 activeRun 属于**未知字段**，原样保留。
  // 这一局已结算时同理 —— endRun 的 store.clear 已经写过一次，不重复提交。
  if(!run || typeof run.result==='boolean'){
    if(!dirty) return false;
    try{ return storage.save(DB) }catch(e){ return false }
  }
  try{
    if(progressCtl) return progressCtl.checkpoint().ok;
    return storage.save(DB);
  }catch(e){ return false }
};
// 受闸门动作的事务边界：跑完 → 提交一次当前快照。
// mutationDepth 支持嵌套：enterNode→startFight、领奖→finishNode→advance、
// 战败→markEnding 这些内层收尾都不许提前写盘，只有最外层 depth 归零才提交。
let mutationDepth=0;
const mutate=fn=>{
  mutationDepth++;
  let out;
  try{ out=fn() }finally{ mutationDepth--; if(mutationDepth===0) commit(true) }
  return out;
};

/* ================= 音效系统 =================
   调性：D 小调五声音阶（D E F A C），所有音高都从这条音阶上取，不再随手写 Hz。
   音色分工：三角波=柔和提示音  方波=打击/受击  锯齿波=危险/失败  白噪音=瞬态质感
   信号链：voice → dry ─┐
                      ├→ limiter(限幅) → master(音量) → destination
           voice → send┴→ convolver(程序生成 IR) → wet ─┘
   每个 voice 用完即弃（osc.onended 回收并 disconnect），并有 voice 数上限，
   连续快速答对不会堆积节点、也不会削波爆音。
   无 AudioContext 环境（Node / 老浏览器）全部静默降级，不抛错。            */
/* ★ 兼容层实例必须在 audio / speech **之前**建好：两者都要注入它。
   顺序反了就成了两个服务拿到 undefined，探测结果没人接 —— 表现就是
   「微信里没声音，但游戏从不提示」，也就是这个功能白做。
   提示条组件在下面才 mount（它要往主页 DOM 里画），所以用 let 先占位：
   onStatus 回调里用 ?. 读，mount 之前的状态变化只更新数据不画，
   mount 时的那次 paint() 会把最新状态补上 —— 于是不存在 TDZ，也不丢状态。 */
let audioCompatibility=null;
const audioCapability=createAudioCapability({onStatus:()=>{ try{ audioCompatibility&&audioCompatibility.paint() }catch(e){} }});

const { AU,sfx,tone,noise,arp,pnote,audioUnlock }=createAudio({getCombo:()=> (typeof B!=='undefined'&&B&&typeof B.combo==='number')?B.combo:0, capability:audioCapability});
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
  volStep=nearestVolStep(v);
  if(DB.mute && v>0) volStep=0;
  /* ★ 走 setVol 而不是直接赋值：setVol 内部会把「玩家要不要这一路声音」
     告诉兼容层。直接写 AU.vol 会让兼容层一直以为音效是开着的 ——
     一个静音的玩家照样会收到「浏览器放不出音效」的提示。 */
  AU.setVol(v<=0?0:VOL_STEPS[volStep]);
})();
const saveVol=()=>{ DB.vol=AU.vol; DB.mute=AU.muted; saveDB(); commit(false) };
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

/* ★ 单元解锁的唯一口径（docs/feature-campaign.md）：纯派生自 DB.mastered +
   DB.unitProgress，不缓存、不维护第二套状态。UI 与运行时入口读的是同一份，
   所以「主页显示已解锁」与「真的能开跑」不可能分叉。 */
const campaignState = () => unlockProgress({ units: UNITS.map(u=>u.n), wordsFor: allWords,
  mastered: DB.mastered, unitProgress: ensureProgress(DB) });

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
/* ★ onChange 必须落盘，不能只标脏：语音开关是玩家随时会按的按钮，
   标脏后没有后续动作来触发提交，于是「内存已关、盘上还是开」——
   刷新一次语音自己回来了。commit(false) 在事务内部会自动延期到最外层。 */
const TTS=createSpeech({heroVoice,curHeroId,rnd,voiceLines:VOICE_LINES,foeLineCfg,
  onChange:enabled=>{DB.voice=enabled;saveDB();commit(false)},
  capability:audioCapability});

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
/* 起手就按存档设置语音开关（老存档没这字段 → DB.voice 默认 true） */
/* ★ 走 setOn 而不是直接写 TTS.on：setOn 内部会把「玩家要不要朗读」告诉兼容层。
   直接赋值的话兼容层以为朗读一直开着 —— 一个本来就把朗读关掉的玩家，
   只要碰巧在没 speechSynthesis 的平台上，就会被弹「浏览器不支持朗读」。
   顺序：音量与朗读两个偏好都落到服务上之后，兼容层才知道该不该下结论。 */
try{ TTS.setOn((typeof DB!=='undefined' && DB.voice!==undefined) ? !!DB.voice : true) }catch(e){}

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
// ★ 当前相位：暂停快照靠它决定「存什么、恢复成什么样」。
//   它是**恢复检查点**的描述，不是闭包：跨刷新后靠它重建待办，
//   绝不能把 setTimeout 的回调序列化过去。
let PHASE_STATE=PHASE.MAP;
let ENCOUNTER=null;  // 已展开但未必已选择的事件/营火/商店/奖励卡描述
const setPhase=p=>{ PHASE_STATE=p };
// 结算相位的结果：这一局已经打完，只差一次收尾（纪念卡 + 清快照）。
// 它必须进快照，否则刷新后没人知道该补「赢的结算」还是「输的结算」。
let OUTCOME=null;

function newRun(){
  // ★ 运行时闸门：主页把锁住的单元画成不可点只是一层，真正的拒绝在这里 ——
  //   任何绕过 UI 的路径（测试探针、将来的恢复流程）都过不了这一关。
  if(!canSelectUnit(campaignState(),curUnit)){
    toast(curUnit>0 ? ('完成 Unit '+(curUnit-1)+' 的全部词汇后解锁 Unit '+curUnit) : '这个单元还不能开始');
    return false;
  }
  const pool=allWords(curUnit);
  if(!pool.length){alert('这个单元还没有词，去「导入词表」添加吧');return false}
  lifecycle.resetRun();TTS.stop();B=null;
  OUTCOME=null;
  // ★ 知识成长（docs/feature-mastery-growth.md）：**只在这里**读一次 DB.mastered，
  //   把成长事实交给 createRun 加进 maxhp。读一次就够 —— 本局内达到 20 词、
  //   跨单元、续段都不再重算（所以「中途退出重进」不会白赚一次上限）。
  //   恢复存档的路径根本不经过 newRun，所以也绝不会被当前 DB 重算。
  G=createRun(curUnit,curHero(),pool,Math.random,growthFact(DB.mastered,WORDS,curHero()));
  // ★ 轮次身份（docs/feature-rounds.md）：这里注入一个持久 roundId。
  //   它必须不同于进程内自增的 run.id（R1/R2…，刷新后会重复）。
  //   轮次**编号**不在这儿取：registerRunStart 在真正 +1 之后从 DB.runs 取，
  //   所以「是不是真正新开一轮」和「这是第几轮」永远是同一个事实。
  assignRoundId(G,newRoundId());
  // ★ 远征次数的唯一入口：真正新开一轮才 +1，恢复/读档不经过这里。
  registerRunStart(DB,G);applyRelicInit();saveDB();
  // ★ 逐轮难度（清单 10）：**只在真正新开一轮时派生一次**。
  //   必须在 registerRunStart 之后 —— 它才是把 run.roundNumber 定下来的那一步
  //   （轮次编号的唯一来源是 DB.runs，见 domain/run.js）。派生完就存进 run，
  //   本局内换词、换战斗、跨单元、续段一律不再调用：
  //   玩家在同一轮里并没有变强，难度就不该悄悄涨。
  //   ★ 恢复路径根本不经过 newRun，所以恢复/刷新绝不重算（否则刷新一次就升一档）。
  G.difficulty=deriveRoundDifficulty({roundNumber:G.roundNumber,unit:G.unit,
    segments:(G.campaign&&G.campaign.segments)||1});
  ENCOUNTER=null; setPhase(PHASE.MAP);
  show('s-map');renderMap();
  // 完整建好 G 与相位之后才提交：快照必须是一局**可玩**的远征，
  // 不能是「次数已 +1、地图还没建出来」的那一帧。force=true：无条件写一次。
  commit(true);
  return true;
}
// ★ 玩家点「开始远征 / 再来一次 / 下一单元」的唯一入口。
// 连点时第二次会看到「当前 G 还是一场没结束的远征」，直接放弃 —— 不建 run、不计数。
// 判据是状态而不是时间窗：时间窗会误伤「放弃这次远征 → 立刻重开」和
// 「结算完 → 立刻下一单元」这些正常操作。
// 内部强制重开（测试探针、将来的恢复流程）直接调 newRun()，不受这个闸门约束。
function startRunFromUi(){
  // 暂停中返回主页的那一局不算「重复触发」：它本来就该由 startRunFromUi 接管
  // （确认放弃 → 建新局）。只有**正在玩**的一局才挡住连点。
  if(isDuplicateRunStart(G) && !(progress.isPaused() && progress.atTitle()))return false;
  return progress.startRunFromUi();
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
  // ★ 逐轮难度（清单 10）：血量缩放**只在这里发生一次**，用本局冻结的
  //   run.difficulty（不是当前 DB.runs —— 那样换一次战斗就升一档）。
  //   BOSS 的 +40 是**固定奖励**，在缩放之后叠加：反过来的话 BOSS 会随轮次
  //   额外膨胀一截，那是没人设计过的难度。
  //   G.difficulty 缺失（旧存档）→ scaleEnemyHealth 按基线返回原值，
  //   于是旧档的怪物血量与节奏逐字不变。
  const hpMax = scaleEnemyHealth(Math.round(perWord*targetWords), G&&G.difficulty);
  // 从词库按难度出题：越深越难
  const budget = boss?3:Math.min(3, 1+Math.floor(G.floor/3)+(elite?1:0));
  const qword = drawWord(budget);
  // ★ 词池已抽干（自定义小词表、或本单元词汇全部完成）：不进战斗，
  //   也不生成空字母盘 —— 统一走「本单元词汇已全部完成」检查点。
  if(!qword) return showLearningComplete();
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
  ENCOUNTER=null; setPhase(PHASE.BATTLE);
  // 蓄力自主攻击（清单 13）：固定配置在这里**应用一次**。
  // ★ 不在 nextWord 里重置 —— 换一个词不该把蓄力时间重排，否则玩家
  //   每答完一词就获得一段新的无敌窗口，怪等于永远打不到人。
  foeAttackCtl.start();
  show('s-fight'); renderFight();
  sfx.enemy(boss||elite);
  foeCry('spawn');                                    // ← 语音层：敌人登场叫（音高按敌人种类散开）
  // ← 语音层：入场中文台词。用 zh-CN 音色、每种怪不同 rate/pitch；
  //   受 TTS.on 总开关 + 限流控制；没有中文音色时静默跳过（叫声仍在）。
  TTS.foeLine({n:e.n, elite:elite, boss:boss, ic:e.ic});
}
// 按难度抽词：budget 越高，可选池越大但平均词长越长；池太小时放宽，避免深层反复出同样几个词
function drawWord(budget){return selectWord(G,B,budget)}
/* 「本单元词汇已全部完成」检查点 —— 抽词唯一的穷尽出口。
 *
 * 它是**检查点**不是结算：kills / gold / wins / DB.mastered 一个都不动，
 * run.result 仍是 undefined，B 里的真实血量原样带进快照。
 * 这样刷新后恢复的仍是同一句事实：「词都学会了，怪还没死」。
 * ENCOUNTER 也不带：这里没有卡要选。
 * 下一单元的衔接是后续功能，这个屏只说「本单元完成」，不预告解锁。 */
function showLearningComplete(){
  if(!G) return false;
  // 词池抽干 = 本单元目标词全部完整拼对：这是**真实**的完成事实，值得记一次。
  // 幂等（domain 内部挡重复），且不改任何次数。
  if(recordUnitComplete(DB,G.unit)) saveDB();
  // ★ 本轮完成范围（docs/feature-rounds.md）：词池抽干是「本轮把这个单元的
  //   目标词全部整词拼对」的真实证据，记一次。到过某个单元不算。
  if(noteRoundUnitComplete(G)) saveDB();
  // ★ 本轮范围刚变长，这一轮**已经拿到**的那张卡必须立刻同步（L2）：
  //   玩家在这个检查点可以直接「结束本轮学习」——明确放弃、不做战败结算，
  //   但放弃之前学完的词是真实事实，绝不能因为没再打一次 BOSS 就留在旧卡上。
  //   syncRoundCard 只更新已有卡：不 mint、不结算、不动 wins / earnedAt。
  if(syncRoundCard(G,DB)) saveDB();
  ENCOUNTER=null; setPhase(PHASE.LEARNING_COMPLETE);
  lifecycle.pause();                       // 冻结在途延迟任务：这一局不再往前跑
  show('s-learning-complete');
  learningCompleteScreen.render();
  // 落盘：玩家在这个屏上刷新，回来还是这个检查点。
  // 恢复路径由 progress.rebuildFromPhase 处理，绝不重发奖励或重抽词。
  return commit(true);
}
/* ================= 单元解锁主线（docs/feature-campaign.md）=================
 * 三个动作，全部走 progress 的闸门与事务边界：
 *   nextUnit()     —— 「继续下一单元」：本单元词汇全部完成 → 进入已解锁的下一单元。
 *   continueUnit() —— 「继续本单元词汇」：BOSS 打完了但本单元还有词，换一段地图继续。
 *   两者都**不** createRun / registerRunStart / applyRelicInit / 重发新手道具 /
 *   回血 / 补影分身额度 / 生成纪念卡 / 动 DB.wins —— 同一轮学习，只是换词池与地图。
 *   迁移不是击杀：kills / gold / wins / 奖励一个都不动。
 */
const CAMPAIGN_REFUSALS = {
  'no-run':    '现在没有进行中的远征',
  'custom':    '自定义词表没有下一单元',
  'already':   '已经在这一轮的新单元里了',
  'last-unit': '已经是本册最后一个单元',
  'incomplete':'本单元的词还没全部完成',
  'locked':    '下一个单元还没有解锁',
  'phase':     '现在不在可以切换单元的界面上',
  'settled':   '这一局已经结算了，不能再从结算屏继续',
};
function campaignRefuse(facts){
  toast(CAMPAIGN_REFUSALS[facts&&facts.reason] || '现在不能切换单元');
  return false;
}
/* ★★ 跨单元 / 跨段的**来源相位闸门**（应用层唯一的准入判据）。
 *
 * 为什么必须有它（领域层的 startedUnit 守卫已经被移除）：
 *   domain 现在只回答「Unit N 的下一单元是几」，判据是 run.unit + 当前 counts。
 *   于是「普通地图上的一次误调用 / 测试探针 / 连点」全都满足同一个判据：
 *   一份把所有 259 个词都记成已掌握的旧存档，连点三次就能 1→2→3→4 一路跳过去，
 *   每一跳都在**重发物资**（虽然 run 本身守住了）之外凭空吃掉一段学习。
 *   领域层不该、也无法知道「玩家此刻站在哪一屏」。
 *
 * 两个动作各自只认一个来源：
 *   nextUnit    —— 词汇完成检查点（PHASE.LEARNING_COMPLETE），
 *                  或一局**已成功结算**的 BOSS（run.result===true）且本单元词已学完。
 *   continueUnit—— 一局**已成功结算**的 BOSS（run.result===true）且同单元还有词可练。
 * 两个动作都会把相位/结果换掉（MAP + result===undefined），
 * 所以第二次、第三次连点在闸门这里就被拒 —— 幂等由「来源状态」保证，不靠时间窗。
 *
 * 这同时保证「已结算的一局只可能被明确的用户按钮复活」：reopenRun 只接受
 * result===true 的那一局，后台恢复路径（rebuildFromPhase）根本不调这两个动作，
 * 定时器 / visibilitychange 更碰不到它们。 */
function campaignSourceRefusal(kind){
  if(!G) return { reason:'no-run' };
  const settledWin = (typeof G.result==='boolean') && G.result===true;
  if(kind==='next'){
    if(PHASE_STATE===PHASE.LEARNING_COMPLETE) return null;
    return settledWin ? null : { reason:'phase' };
  }
  // continue：本单元「打完 BOSS 但词还没学完」之后的续练入口。
  return settledWin ? null : { reason:'phase' };
}
// 屏幕上的血才是真的：最后一词没打死怪时，run.hp 可能还是进战斗前的旧值。
// 这里把活着的战斗里的真实 myHp/shield 结转回 run，再换地图 —— 否则玩家会发现
// 「打完最后一个词莫名其妙回血」，那是拿 stale run.hp 覆盖真实战况。
function carryLiveHp(){
  if(B && typeof B.myHp==='number' && !B.over){
    G.hp=clamp(B.myHp,1,G.maxhp);
    G.shield=clamp(B.shield|0,0,G.maxhp);
  }
}
// 重新激活这一轮：结算屏上的 G.result 是布尔值（已结算，快照已被清掉）。
// 「继续」是一次**明确的用户动作**，所以这里把它退回 active 并立刻重建快照 ——
// 这不是让后台计时器复活旧局：复活路径（ENDING 相位）完全不经过这里。
function reopenRun(){
  if(!G) return false;
  lifecycle.resetRun();          // 冻结中的待办全部作废：不得复活旧结算
  TTS.stop();
  ENCOUNTER=null; OUTCOME=null;
  G.result=undefined;            // 同一轮学习继续，不是新开一次
  return true;
}
function nextUnit(){
  if(!G) return campaignRefuse({reason:'no-run'});
  // ★ 先问来源相位：普通地图上的一次误调用、探针、连点都在这里被拒。
  const src=campaignSourceRefusal('next');
  if(src) return campaignRefuse(src);
  const facts=transitionNextUnit({run:G,progress:campaignState()});
  if(!facts.ok) return campaignRefuse(facts);
  // ★ facts.from 必须就是**当前**这一局的单元。领域层 applyUnitTransition 也会查这一条，
  //   但它返回 null 时已经太晚：carryLiveHp / recordUnitComplete 都写过状态了。
  //   所以这里先自己判一次，绝不在「注定被拒」的过渡上留下任何副作用。
  if(facts.from!==G.unit) return campaignRefuse({reason:'phase'});
  // ★ **过渡之前**先抓住本单元的真实词池。applyUnitTransition 会把 G.pool 换成下一个
  //   单元的词池，那时再看 G 就分不清「Unit 1 的词答完了没有」（run.done 是跨单元
  //   累计的，不会被过渡清空，所以词池是唯一需要提前抓住的那一半）。
  //   解锁口径（DB.mastered 历史覆盖）保持不变：历史全掌握的存档点一下继续下一单元
  //   仍然合法，只是本轮 completedUnits 不许因此被记上。
  const fromPool=G.pool.slice();
  const applied=applyUnitTransition(G,facts,{words:allWords(facts.to)});
  if(!applied) return campaignRefuse({reason:'phase'});
  // 过渡成功之后才结转真实血量、才记完成凭据（顺序反了就是拿 stale hp 覆盖战况）。
  carryLiveHp();
  if(recordUnitComplete(DB,facts.from)) saveDB();
  // 用过渡前抓的真实词池判定「本轮整词完成」，而不是已经换过池的 G。
  if(recordRoundUnitComplete(G,facts.from,{pool:fromPool})) saveDB();
  // 合法过渡记下了新的完成范围：已有卡立刻同步（不 mint、不结算）。
  if(syncRoundCard(G,DB)) saveDB();
  curUnit=G.unit;
  reopenRun();
  lifecycle.resetBattle();       // 上一场的迟到回调作废
  B=null;
  setPhase(PHASE.MAP);
  show('s-map'); renderMap();
  toast('Unit '+facts.from+' 的词汇已全部完成，进入 Unit '+facts.to+'（物资保留）');
  return true;
}
function continueUnit(){
  if(!G) return campaignRefuse({reason:'no-run'});
  // 「继续本单元词汇」只从**成功结算的 BOSS 局**出发：普通地图上不存在这个动作，
  // 一次连点的第二次调用会看到 result 已经变回 undefined，在这里被拒。
  const src=campaignSourceRefusal('continue');
  if(src) return campaignRefuse(src);
  const uc=campaignState().counts(G.unit);
  if(uc && uc.complete){ toast('本单元词汇已经全部完成'); return false; }
  if(!allWords(G.unit).length) return false;
  const applied=applyUnitSegment(G,{words:allWords(G.unit)});
  if(!applied) return campaignRefuse({reason:'phase'});
  carryLiveHp();
  reopenRun();
  lifecycle.resetBattle();
  B=null;
  setPhase(PHASE.MAP);
  show('s-map'); renderMap();
  toast('继续练 Unit '+G.unit+' 的词汇（物资保留，不算新开一次远征）');
  return true;
}
// 生成字母盘（答案字母 + 干扰字母）
function drawLetters(qword){return generateLetters(G,B,qword)}
// 敌人还活着时换下一个词
function nextWord(){
  const budget=B.boss?3:Math.min(3, 1+Math.floor(G.floor/3)+(B.elite?1:0));
  const nw=drawWord(budget);
  // ★ 最后一个未完成的词刚答完、这一场还没打死怪：进「词汇已全部完成」检查点。
  //   combat 的整词分支已经先判过 lethal（真打死就走 winFight 的既有奖励），
  //   所以走到这里一定还有未打死的怪 —— 这里绝不调 winFight / endRun(true)，
  //   kills / gold / wins 一律不动，怪物血与 run 状态如实保留。
  if(!nw) return showLearningComplete();
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
// B.used / B.bad / B.input 全在 B 上没动，所以进度一个字母都不丢。
// 字母盘显示偏好：纯设置项，标脏后必须显式提交（有远征时 commit 会把快照一起写）。
$('tBankMode').onclick=()=>{ DB.kbMode=!isKbMode(); saveDB(); commit(false); if(B&&!B.over) renderFight(); syncBankBar() };
// 切换大小写显示：纯显示层。判定走 norm()（转小写），所以两种显示都能正常判对
$('tBankCase').onclick=()=>{ DB.kbUpper=!isKbUpper(); saveDB(); commit(false); if(B&&!B.over) renderFight(); syncBankBar() };


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
  if(!TTS.on){ TTS.setOn(true); paintSayBtn(); audioSettings.paint(); }        // 死结保护：先开回来再念
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
/* 兼容入口：show() 仍会调它。开关现在住在主页的 #audioSettings 面板里，
   显隐由那一层的 .screen 机制天然完成（离开主页整块不渲染），
   所以这里什么都不用做 —— 也不再需要 MutationObserver 兜底。
   保留函数名只为不打乱既有调用顺序。 */
function syncVoiceBtn(){ /* no-op：主页设置区不再是浮动层 */ }
const audioSettings=createAudioSettings({
  /* 音量与朗读是两个完全独立的 prefs，字段仍是 DB.vol / DB.mute / DB.voice。 */
  audio:{ vol:()=>AU.vol, muted:()=>AU.muted },
  tts:{ supported:()=>!!(TTS&&TTS.supported), on:()=>!!(TTS&&TTS.on) },
  onVolumeStep:dir=>{ volStep=(volStep+dir+VOL_STEPS.length)%VOL_STEPS.length;
    AU.setVol(VOL_STEPS[volStep]); saveVol(); audioSettings.paint(); if(!AU.muted) sfx.ui() },
  onVoiceToggle:force=>{ TTS.unlock();
    if(force===true) TTS.setOn(true); else TTS.toggle();
    audioSettings.paint(); paintSayBtn(); if(TTS.on) sfx.ui() },
}).mount();
/* ---- 音频兼容提示条：挂在主页声音设置区下面（index.html 里的 #audioCompatibility）----
 * 放在 audio-settings 之后 mount：两个容器在 HTML 里也是这个顺序，提示条是对
 * 声音设置的补充说明。create 返回 { mount, paint }，**不是** refs ——
 * 写成 const compat=xxx.mount() 会把 mount 的返回值当组件用，下一次 paint 拿不到。
 *
 * onRetry 只能派发、不能自己 resume：重试必须发生在**真实手势**里，
 * 而这个 onclick 本身就在一次真实点击中，正好满足自动播放策略。
 * ★ 绝不顺手替玩家把静音/关掉的朗读开回来 —— 那是他的偏好，不是故障。 */
audioCompatibility=createAudioCompatibility({
  capability:audioCapability,
  onRetry:()=>{ try{ AU.unlock() }catch(e){} try{ TTS.unlock() }catch(e){} }
});
audioCompatibility.mount($('audioCompatibility'));
// ★ 知识成长只读区（docs/feature-mastery-growth.md）：挂在主页的 #masteryGrowthHost 里。
//   getSummary 每次 paint 都重新按**当前** DB.mastered 现算，所以本局学到新词、
//   导入自定义词表、切换单元之后回到主页，数字都是当下的事实（不缓存第二套状态）。
//   mount 幂等：renderTitle 被反复调用（继续远征 / 回主页 / 切后台）都复用同一个盒子。
const masteryGrowthView=createMasteryGrowth({
  getSummary:()=>growthSummary(DB.mastered,WORDS),
});
// ★ mount() 的返回值是**挂好的 DOM 盒子**，不是组件本身（与 audioSettings 同口径）：
//   把组件另存一份，renderTitle 里要调的是它的 paint()。
masteryGrowthView.mount(document.getElementById('masteryGrowthHost'));
// 音色是异步到货的（getVoices() 首次返回空数组），所以等 voiceschanged 再重画一次
// 设置区 —— 不用 setInterval 轮询，既不空转也不会吊住 Node 测试进程。
try{
  const sy=(typeof window!=='undefined')&&window.speechSynthesis;
  if(sy){
    const repaint=()=>{ try{ audioSettings.paint(); paintSayBtn() }catch(e){} };
    if(typeof sy.addEventListener==='function') sy.addEventListener('voiceschanged',repaint);
    else sy.onvoiceschanged=repaint;
  }
}catch(e){}
// 渲染道具栏：只显示玩家真正持有的道具，并标出快捷键
function renderItems(){return fightScreen.renderItems()}
// 使用道具
function useItem(id){return progress.useItem(id)}
// idx：本次要按下的字母实例下标。省略时回落到 B.sel（点击路径就是这么调的）。
// 打字路径直接传下标，因此完全不依赖 B.sel / 光标。
function pressKey(idx){return progress.pressLetter(idx)}
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
// ★ winFight 是「战斗胜利」的唯一结算入口，也是唯一的授权点。
//   canFinishFight 的四道闸门缺一不可（判据收在 domain/battle-rules.js）：
//     1) over / finished —— 本场已经结算过：连点 / 重复 damage / 迟到回调都无效，
//                        金币 / kills / 掌握表 / 奖励面板只发一次。
//     2) 整词拼完     —— 半个词绝不算赢，也绝不可能走 win 绕过掌握判定。
//     3) enHp 合法    —— NaN / undefined 一律 fail closed，不当成「已打空」。
//     4) enHp <= 0    —— 敌人真的被打空；而非完整词伤害有 1 血地板，
//                        所以「打空」这件事本身只可能由整词大招造成。
//   单字母 / 荆棘 / 道具路径现在都不再调 winFight，这几道是纵深防御：
//   即使将来新增伤害来源、或测试探针直接调 winFight，也绕不过去。
// ★ 走到这里时当前词必然已经拼完（见 combat.js pressKey 的 wordComplete 分支），
//   而「学会」也已经在那个分支里 creditWord 过一次 —— 所以这里**不再**重复
//   creditWord，也不再需要「没拼完」的补救提示：那是授权闸门之前的旧语义。
//   「学会一个词」的唯一入口是 combat 的整词分支，不在本文件。
function winFight(){
  if(!canFinishFight(B)) return false;
  B.over=true; B.won=true;
  foeAttackCtl.stop();          // 怪已死：相位转defeated，迟到的定时回调不再结算伤害
  sfx.win();
  // 语音：胜利台词强制发声（force=true 绕过限流 —— 这一刻是整局的高潮）
  lifecycle.scheduleBattle(()=>TTS.line('win',null,{force:true}), 260);
  burst(innerWidth/2,innerHeight*0.4,B.foe.tint,44,7);
  ring(innerWidth/2,innerHeight*0.4,'#ffce4d');
  G.kills++;
  let g=25+(B.boss?120:B.elite?60:0)+Math.floor(G.floor*4);
  if(B.boss) g+=50;
  if(hasR('purse')) g+=25;
  // goldGain 内部已把金币加进 G.gold，这里只算最终数额用于文案
  goldGain(Math.round(g*(B.goldMult||1)));   // 贪婪钱币 ×3
  // 相位切到待领奖：金币与击杀已经入账，900ms 只延迟展示。
  setPhase(PHASE.REWARD);
  // 立即确定并发布同一批奖励卡，暂停或刷新都不重新抽取。
  const rolled=encounters.rollBattleRewards(Math.round(g*(B.goldMult||1)),null);
  lifecycle.scheduleBattle(()=>encounters.showRolledRewards(rolled),900);
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
  if(!B||B.over) return;
  B.over=true;
  foeAttackCtl.stop();          // 战斗已结束：不再有后续主动伤害
  // 致命一击会把 myHp 扣成负数，而快照的校验口径是 [0, maxhp]：战败那一刻的
  // 快照会因此被判为损坏，于是「刚输掉就暂停/刷新」反而进不去这一局。
  // 这里夹到 0 —— 战斗已结束，负血没有任何后续语义（也不会被结转回 G）。
  B.myHp=Math.max(0,B.myHp);
  sfx.lose();
  TTS.line('lose',null,{force:true});               // ← 语音：失败台词，角色自己的收场白
  flash('#ff547055');
  const run=G;
  // ★ 走 lifecycle 而不是裸 setTimeout：这样在 800ms 里暂停/切后台会被真正冻结，
  //   玩家继续后才补结算。裸 setTimeout 会在暂停期间照样把这一局结算掉。
  markEnding(false,run,800);
}
/* 「这一局已打完，只差收尾」：切到结算相位 + 排一次最终结算。
   立刻把快照落盘（结果就是玩家在这段延迟里刷新，回来仍能补出同一个结算，
   而不是重新开奖一次）。guardRun 保证迟到的回调不会结算换掉的那一局。 */
function markEnding(win,guardRun,delay){
  ENCOUNTER=null; OUTCOME=!!win; setPhase(PHASE.ENDING);
  lifecycle.scheduleRun(()=>{ if(G && G!==guardRun) return; endRunNow(win) },delay);
  // ★ ending 相位必须无条件落盘（DB.wins / 纪念卡在 finishBattleNode 那一刻已改完）：
  //   这一局即将结束，后面再没有受闸门动作来顺带提交它了。
  //   在事务内部（领奖→finishNode→markEnding）这里会延期，由最外层一次性提交。
  commit(true);
}
function finishNode() {
  const result=finishBattleNode(G,B,DB);
  if(result==='ignored')return;
  // ★ BOSS 的两种结局都走 markEnding：胜负、纪念卡、清快照必须是一次结算。
  //   B.rewardTaken 已置位、battle.finished 已被 finishBattleNode 标记，
  //   所以恢复路径**绝不能再调 finishNode**（它只会拿到 'ignored'）。
  if(result==='boss-win'){toast('🏆 通关！回复 30 生命');markEnding(true,G,700);return}
  if(result==='boss-loss'){toast('👑 词汇之王逃脱了……远征失败');markEnding(false,G,700);return}
  advance();
}
        // 双击去重窗口：够挡住连点，又短到不会挡住正常下一次推进
function advance(){
  if(!G)return;
  const result=advanceRun(G);
  // ★ locked（400ms 双击窗口）也要提交：调用方（商店「离开」）已经发布了
  //   chosenId 并切到 encounter-done，此刻盘上必须有一份**合法**的快照，
  //   否则刷新后这一局会被判损坏。提交的是「已选完、等推进」这个真实状态。
  if(result==='locked'){ commit(true); return }
  if(result==='ended'){endRunNow(false);return}
  // 本单元词汇已全部完成时，领完奖励推进不再把人丢回地图让他点一个
  // 一进去就撞检查点的战斗节点 —— 直接显示同一个检查点。
  if(isPoolComplete(G)){ showLearningComplete(); return }
  ENCOUNTER=null; setPhase(PHASE.MAP);
  show('s-map');renderMap();
  // 延迟的营火/事件推进也走这里（不在事务内），所以必须无条件落盘。
  commit(true);
}
$('tHint').onclick=()=>progress.requestHint();
$('tSkip').onclick=()=>progress.skipFight();
$('tFlee').onclick=()=>progress.fleeFight();
document.addEventListener('keydown',e=>{
  // 暂停屏优先：暂停期间任何键都不得改状态（闸门在 progress 里，这里只是不抢键）。
  if(progress.isPaused()) return;
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
      if(id) progress.useItem(id);
      e.preventDefault();
    }
    else if(e.key==='Backspace'){
      progress.undoLetter();
      e.preventDefault();
    }
    // 电脑键盘直接打字（A-Z / a-z，效果与点击字母键完全一致）
    else if(e.key.length===1 && /[a-z]/i.test(e.key)){
      progress.typeLetter(e.key);
      e.preventDefault();
    }
  }
});
// 打字入口：把敲下的字符映射到字母盘上的一个字母实例，再走**和点击同一个** pressKey
// 判定 —— 不经过 B.sel、不依赖任何光标，所以有没有光标对打字路径毫无影响。
// 返回是否消费了这次输入（字母盘上没有这个字母时不消费，交给浏览器默认行为）。
function typeLetter(raw){return progress.typeLetter(raw)}
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


/* 结算的**内存侧**：只改 DB 与 G、只画结算屏，绝不落盘。
   落盘由 progress.endRunNow 统一做 —— 它必须在 DB 改完之后，用**同一次**
   storage.save 写入「新 totals + 纪念卡」与「快照已删除」。
   分两次写就会出现：先删快照写一次（此时 totals 还是旧的），
   或者先记奖励写一次（此时快照还在，刷新会再结算一遍）。 */
function settleRun(win){
  if(!G)return;
  if(typeof G.result==='boolean')return;   // 绝不重复结算
  lifecycle.resetRun();                    // 冻结中的待办全部作废：已结束的局不得再动
  endRunProgress(G,DB,win);
  ENCOUNTER=null; OUTCOME=null; setPhase(PHASE.MAP);
  // 结算屏的三个动作各自语义明确：复习=新开一轮；继续下一单元/继续本单元词汇=
  // 同一轮跨段继续。oNext 的可见性与文案由 over.js 按「本单元词汇是否完成」决定。
  renderOver({run:G,db:DB,win,campaign:campaignState(),onTitle:renderTitle,show,
    onAgain:()=>{ if(!G||typeof G.result!=='boolean')return; curUnit=G.unit; startRunFromUi() },
    onNextUnit:()=>{ if(!G||typeof G.result!=='boolean')return; progress.nextUnit() },
    onContinueUnit:()=>{ if(!G||typeof G.result!=='boolean')return; progress.continueUnit() },
    onHome:()=>{ progress.abandonRun(); renderTitle(); show('s-title') }});
  return true;
}
// 结束路径的统一入口：闸门 + 结算 + 一次原子提交。
function endRunNow(win){ return progress.endRun(win) }
/* 已展开卡片的选择入口：暂停期间一律无效（闸门在 progress 里）。
 * 已展开的卡都带 data-opt=id，这里按 id 点真实的那张。 */
function chooseEncounter(id){
  if(!ENCOUNTER) return false;
  const screen = ENCOUNTER.kind==='shop' ? 'rPicks' : (ENCOUNTER.kind==='rest' ? 'rPicks' : 'ePicks');
  const box=$(screen); if(!box) return false;
  const btn=(box._kids||[]).filter(b=>b.dataset && b.dataset.opt===id)[0]
    || Array.prototype.slice.call(box.children).filter(b=>b.dataset && b.dataset.opt===id)[0];
  if(!btn||!btn.onclick) return false;
  btn.onclick();
  return true;
}
function takeReward(id){
  if(!ENCOUNTER||ENCOUNTER.kind!=='reward') return false;
  const box=$('pPicks'); if(!box) return false;
  const btn=Array.prototype.slice.call(box.children).filter(b=>b.dataset && b.dataset.opt===id)[0];
  if(!btn||!btn.onclick) return false;
  btn.onclick();
  return true;
}
// oAgain / oNext / oHome 的回调由 renderOver 在**每次结算时**挂上：
// 旧实现是在启动时挂一次静态回调，于是它永远看不见「本单元词汇是否已完成」，
// 也没法区分「继续下一单元」和「继续本单元词汇」两种语义。
$('mQuit').onclick=()=>{ if(confirm('放弃这次远征？进度不会保存')){ progress.abandonRun(); renderTitle(); show('s-title') } };

/* ================= 标题页 ================= */
// 角色形象 HTML：全部部件用 <i>，靠 data-h 上色/变形（标题页与战斗页共用同一套图形）
// 部件顺序 = 叠放顺序，必须与战斗页 #fPcI 里那段静态 HTML 完全一致，否则两处显示会不同。

// 卡片上的数值速览：把 mod 翻成「生命 -10 / 提示 +1」这种一眼能懂的短标签

function renderHeroes(){return titleScreen.renderHeroes()}
function renderTitle(){
  titleScreen.renderTitle();
  // 知识成长区跟着主页一起重画：数字必须反映**此刻**的 DB.mastered
  // （本局学完词、导入自定义词表之后回到主页，+1 必须立刻可见）。
  try{ masteryGrowthView.paint() }catch(e){}
  // 存在快照（或存在解不开的快照）时，主页必须给出入口：
  // 刷新后玩家看到的是主页，不会被自动丢进战斗或听见语音。
  const row=$('continueRow'), btn=$('continueRun');
  if(!row||!btn)return;
  const t=progress.titleState();
  // 坏快照也让入口可见：否则玩家只能手改存档才能丢掉这份远征。
  row.hidden=!(t.hasSnapshot||t.hasUnusableSnapshot);
  if(t.hasSnapshot){
    btn.textContent='继续远征';
    // 同页暂停中的那一局没有落盘时间（heldInMemory），如实说「还在这一页里」，
    // 绝不显示成「保存于 null」—— 那看起来像一个坏掉的时间戳。
    btn.title = t.heldInMemory
      ? '继续 Unit '+t.unit+' 第 '+t.floor+' 层（还在这一页里，关掉页面就会丢失）'
      : '继续 Unit '+t.unit+' 第 '+t.floor+' 层（保存于 '+t.savedAt+'）';
  } else if(t.hasUnusableSnapshot){
    btn.textContent=t.unusableReason==='version'?'远征进度无法恢复':'远征进度已损坏';
    btn.title='点一下可以查看原因并丢弃这份远征进度（掌握记录与纪念卡不受影响）';
  }
}
// One state owner; feature controllers and renderers receive explicit live getters/actions.
const state={get DB(){return DB},get G(){return G},get B(){return B}};
// 暂停/恢复接线：encounters 把「当前展开的界面描述」交给 runtime 存进快照。
// 描述里只有 id 与展示字段，没有闭包，也没有 DOM。
const publishEncounter=d=>{ ENCOUNTER=d };
const titleScreen=createTitleScreen({getDB:()=>DB,getUnit:()=>curUnit,allWords,getCampaign:campaignState,
  onHero:id=>{DB.hero=id;saveDB();commit(false)},
  // 选中的单元必须真的解锁：锁住的按钮根本不会回调，这里是第二道。
  onUnit:unit=>{ if(canSelectUnit(campaignState(),unit)) curUnit=unit }});
const mapScreen=createMapScreen({getRun:()=>G,onEnter:n=>progress.enterNode(n),onToast:toast,onNodeSound:()=>sfx.node()});
const fightScreen=createFightScreen({getRun:()=>G,getBattle:()=>B,getDB:()=>DB,
  getFoeAttackWindow:()=>foeAttackCtl.window(),
  onPress:i=>{ if(progress.isPaused())return; B.sel=i;progress.pressLetter(i)},
  onUseItem:id=>progress.useItem(id),paintSayBtn});
const pauseScreen=createPauseScreen({getRun:()=>G,
  onResume:()=>{ resumeFromPause() },
  // ★ 返回主页**不放弃**远征：只把这一局留在内存里继续暂停，快照照旧留着。
  //   以前这里是 resume + abandonRun —— 玩家只是想去主页看看别的入口，
  //   回来时发现整局被删了，而且 resume 还会把冻结中的回调挂上（推进/结算在主页自己跑）。
  onHome:()=>{ progress.returnToTitle(); renderTitle(); show('s-title') },
  onAbandon:()=>{
    // ★ 只有真删掉了才说「已放弃」：清不掉时 abandonRun 自己会如实提示，
    //   这里再补一句成功的话就成了谎报。
    if(progress.abandonRun()) toast('已放弃这次远征');
    renderTitle(); show('s-title');
  }});
const learningCompleteScreen=createLearningCompleteScreen({getRun:()=>G,getBattle:()=>B,
  db:DB,getCampaign:campaignState,
  // 「继续下一单元」= 同一轮学习跨单元：走 progress 的闸门与事务，不新建 run、不加次数。
  onNext:()=>{ progress.nextUnit() },
  // 「保存并返回主页」= 暂停式返回：不放弃这一局，进度留档，随时能继续。
  onHome:()=>{ if(progress.returnToTitle()){ renderTitle(); show('s-title') }
    else { renderTitle(); show('s-title') } },
  // 「结束本轮学习」= 主动放弃并回主页。刻意**不**走 endRun(false)：
  // 那是战败结算，会把这一轮记成「失败」并盖上失败标签，而玩家明明是自己收手的。
  onQuit:()=>{ if(confirm('结束本轮学习？这次远征的进度会被清掉（已学会的词和掌握记录会保留）。')){
    // ★ 「结束本轮学习」是**明确放弃**，不是战败结算：绝不调 endRun(false)（那会把
    //   「放弃」写成一次败绩、还会重发统计）。但放弃之前这一轮已经拿到的那张纪念卡
    //   仍然必须带着最新完成范围落盘 —— 同步只动元数据（completedUnits / roundComplete /
    //   轮次身份），不 mint、不动 wins / earnedAt，所以放弃不会丢卡，也不会多卡。
    //   saveDB 之后走一次 commit(false)：dbDirty 已标脏，最外层事务已收尾，这里直接写。
    if(syncRoundCard(G,DB)){ saveDB(); commit(false); }
    progress.abandonRun(); renderTitle(); show('s-title'); toast('已结束本轮学习'); } }});
/* 暂停 → 冻结 + 存快照 + 切到暂停屏。
 * 冻结由 progress 控制器按入口逐个挡住（不是 CSS 遮罩）：暂停期间
 * 输入、道具、提示、跳过、逃跑、地图节点、事件选项、领奖、推进全部无效。 */
function pauseNow(opts){
  const from=PHASE_STATE;
  const result=progress.pause(Object.assign({fromReload:false},opts||{}));
  // 这一局已经结算（结算屏上）：切后台/关页面都不该再存，更不该切到暂停屏抢界面。
  if(result.reason==='finished') return result;
  show('s-pause');
  pauseScreen.renderPause({saved:result.saved,reason:result.reason,fromReload:!!(opts&&opts.fromReload)});
  // AudioContext 挂起：浏览器要求在用户手势里恢复，所以这里只挂起。
  try{ if(AU.ctx()&&typeof AU.ctx().suspend==='function') AU.ctx().suspend() }catch(e){}
  return result;
}
/* 回到暂停前那一屏，并重画它。
   这是**同页恢复**：DOM 里的卡片都还在原样，所以事件/营火/商店/奖励
   一律不重建 —— 重建会把 _used 清掉（同一个回血能被点两次），
   也会重新挂一批按钮，让玩家拿着旧引用再点一次。
   ENCOUNTER_DONE（已选完、等推进）更是必须原样留着：冻结中的那个
   「推进到下一层」在 resume 后正好补上一次。 */
function resumeFromPause(){
  const meta=progress.pauseMeta();
  const from=meta?meta.screen:null;
  progress.resume();
  try{ const c=AU.ctx(); if(c&&typeof c.resume==='function') c.resume() }catch(e){}
  restoreScreen(from);
}
/* 同页恢复共用的「回到那一屏」。暂停屏的「继续」和主页的「继续远征」走同一条。 */
function restoreScreen(from){
  if(from==='s-map'){ show('s-map'); renderMap() }
  else if(from==='s-fight'){ show('s-fight'); renderFight() }
  // 词汇完成检查点：同页暂停/回主页再回来，必须回**同一个**检查点，
  // 而不是掉到地图或生成一张已经答完的字母盘。
  else if(from==='s-learning-complete'){ show('s-learning-complete'); learningCompleteScreen.render() }
  else if(from==='s-pick'){ show('s-pick') }
  else if(from==='s-rest'||from==='s-event'||from==='s-pick') show(from)   // 原样回来
  else { show('s-map'); renderMap() }
}
/* 蓄力自主攻击控制器（清单 13）。必须建在 combat 之后 —— 它要调 combat.enemyHit。
   frozen 用函数而不是常量：词汇完成屏、奖励屏、结算屏上怪都不该再主动攻击，
   而这些相位是运行期才知道的。 */
const foeAttackCtl=createFoeAttackController({
  state, lifecycle, now:()=>Date.now(),
  foeAttackHit:d=>combat.enemyHit(d),
  // 相位变化时提交一次快照（同一个入口，与 DB 记录同一次 save）。
  commit:()=>commit(true),
  renderFight:()=>renderFight(),
  toast:m=>toast(m),
  // ★ 事务边界：整条「推进相位 → 结算伤害 → 发布」必须在**最外层**收一次口。
  //   致死一击会在 enemyHit 里重入 loseFight → stop()/markEnding()，没有它就会
  //   在中途写出一份「战斗已结束却仍挂在 battle 相位」的非法快照，
  //   也让「相位已收招但血没扣」那一帧有机会落盘。
  mutate:fn=>mutate(fn),
  // UI 刷新节拍专用口：只 paint 蓄力条，绝不整屏 renderFight（会重建字母盘）。
  paintAttack:f=>fightScreen.paintFoeAttack(f),
  frozen:()=>progress.isPaused()||progress.isFinished()
      ||(PHASE_STATE!==PHASE.BATTLE)||!B||B.over||B.finished,
});
const combat=createCombatController({state,ports:{$,norm,clamp,rnd,hasR,itemById,hitDmg,wordDmg,wordComplete,
  creditWord,onWordWrong,centerOf,heroPoint,toast,sfx,TTS,burst,floatTxt,flash,ring,animHero,
  wordFinisher,foeCry,renderFight,nextWord,winFight,loseFight,finishNode,saveDB,
  scheduleBattle:lifecycle.scheduleBattle,
  // 有效字母尝试 → 蓄力打断（清单 13）。只在 pressKey 真正接受输入后调用。
  notifyLetterAttempted:()=>foeAttackCtl.notifyLetterAttempted()}});
const encounters=createEncounterController({state,ports:{$,clamp,pick,shuffle,rnd,has,hasR,goldGain,applyRelicInit,
  sfx,toast,advance,endRun:endRunNow,finishNode,show,scheduleRun:lifecycle.scheduleRun,scheduleBattle:lifecycle.scheduleBattle,
  publishEncounter,setPhase,
  // ★ 事务边界：商店购买、营火/事件选择、领奖这些副作用都在这里收尾提交。
  //   少了它，「扣了钱/给了遗物」只改内存，玩家刷新就白嫖一次。
  mutate:fn=>mutate(fn),
  // 事件/营火/商店/奖励的按钮回调自己也要问闸门：暂停屏挡得住点击，挡不住
  // 「玩家握着暂停前那个按钮引用再 dispatchEvent 一次」。
  canAct:()=>!progress.isPaused()}});
/* 进度控制器：暂停闸门 + 快照采集/提交 + 恢复检查点重建。
 * 必须在 titleScreen/fightScreen 之后创建（它们闭包引用 progress）。 */
const progressStore=createProgressStore(storage);
const progress=createProgressController({state,api:{
  getRun:()=>G, getBattle:()=>B, getDB:()=>DB,
  getPhase:()=>PHASE_STATE, setPhase,
  getOutcome:()=>OUTCOME,
  getEncounter:()=>ENCOUNTER, setEncounter:d=>{ ENCOUNTER=d },
  setRun:r=>{ G=r }, setBattle:b=>{ B=b },
  show, screen:()=>currentScreen(), toast, renderMap, renderFight, renderTitle,
  // 词汇完成检查点：恢复与同页返回都走这一个入口，保证是同一块屏。
  showLearningComplete:()=>showLearningComplete(),
  lifecycle,
  // 蓄力自主攻击（清单 13）：快照采集时刷新剩余时间；恢复时按 remainingMs 重建。
  captureFoeAttack:()=>{ if(B&&B.foeAttack) B.foeAttack=foeAttackCtl.captureFact()||B.foeAttack },
  restoreFoeAttack:fact=>foeAttackCtl.restore(fact),
  // 暂停/继续的蓄力冻结与重定位。pauseFoeAttack 必须在 lifecycle.pause() 之前调
  // （采真实的 due-now 剩余），resumeFoeAttack 在 lifecycle.resume() 之后调
  // （只重定位 dueAt，不重排已冻结的同页队列）。
  pauseFoeAttack:()=>foeAttackCtl.pause(),
  resumeFoeAttack:()=>foeAttackCtl.resume(),
  // 结算的内存侧（改 DB / 画结算屏）；落盘由控制器用同一次写完成。
  settleRun:w=>settleRun(w),
  // 同页恢复：把玩家放回他离开的那一屏。
  restoreScreen:from=>restoreScreen(from),
  // 受闸门动作的事务边界：动作返回即提交。
  mutate:fn=>mutate(fn),
  TTS, audio:{suspend:()=>{}, resume:()=>{}},
  confirm:m=>confirm(m),
  newRun:()=>newRun(),
  // 受闸门保护的动作：全部走 progress，暂停期间一律无效。
  pressLetter:i=>combat.pressKey(i), typeLetter:ch=>combat.typeLetter(ch),
  undoLetter:()=>combat.undoLetter(), useItem:id=>combat.useItem(id),
  requestHint:()=>combat.requestHint(), skipFight:()=>combat.skipFight(),
  fleeFight:()=>combat.fleeFight(),
  enterNode:n=>enterNode(n),
  chooseEncounter:id=>chooseEncounter(id),
  takeReward:id=>takeReward(id),
  // 恢复时按快照描述重建事件/营火/商店/奖励卡（不重新 roll）
  reopenEncounter:d=>{
    // 快照里的奖励检查点可能还没有卡面（暂停正好落在 900ms 延迟里）：
    // 那时用 live state 重建面板 —— 金币早已入账，B.rewardTaken 仍是 false，
    // 所以只可能展开一次，绝不会二次发奖。
    if(d && d.kind==='reward' && (!d.options||!d.options.length)) return encounters.showBattleRewards(d.gold,d.unfinished);
    return encounters.reopenEncounter(d);
  },
  advance:()=>advance(),
  // 单元解锁主线的动作（受闸门 + 事务保护）
  nextUnit:()=>nextUnit(),
  continueUnit:()=>continueUnit(),
  clearRun:()=>{ G=null; B=null; ENCOUNTER=null; setPhase(PHASE.MAP) },
},store:progressStore});
progressCtl=progress;

        // 字母光标

/* 切后台 / 关闭页面：安全保存一次并进入暂停屏。
 * 回前台**不自动继续** —— 刷新后玩家面对的是暂停屏，必须自己点「继续」，
 * 所以不会一回到页面就撞上敌人或自动播语音。 */
if(typeof document!=='undefined' && document.addEventListener){
  document.addEventListener('visibilitychange',()=>{
    try{ if(document.hidden) TTS.stop() }catch(e){}
    try{
      // 已结算的一局（结算屏上）不参与：切后台既不重存也不抢界面。
      if(document.hidden){ if(G && !progress.isPaused() && !progress.isFinished()) pauseNow({fromReload:true}) }
      else progress.onVisible();
    }catch(e){}
  });
}
if(typeof addEventListener==='function'){
  addEventListener('pagehide',()=>{
    try{ if(G && !progress.isPaused() && !progress.isFinished()) pauseNow({fromReload:true}) }catch(e){}
  });
}

/* 暂停入口：地图与战斗各一个显式按钮。冻结逻辑在 progress 控制器里。 */
$('mPause').onclick=()=>{ if(G && !progress.isFinished()) pauseNow() };
$('tPause').onclick=()=>{ if(G&&B && !progress.isFinished()) pauseNow() };
$('continueRun').onclick=()=>{
  const out=progress.continueRun();
  if(!out.ok){
    // 明确的失败原因：损坏 / 版本不支持 / 没有快照。
    // 明确说明原因并询问是否丢弃。
    if(out.reason==='invalid'||out.reason==='version'){
      if(confirm(out.message+'\n\n要丢弃这份存档里的远征进度吗？（掌握记录、自定义词库和纪念卡都会保留）')){
        // ★ 清不掉就不能紧接一句「已丢弃」：那会让玩家以为存档干净了，
        //   刷新后那一局又回来。clear 失败时由它自己如实提示。
        if(progress.discardSnapshot()){ renderTitle(); toast('已丢弃无法恢复的远征进度') }
        else renderTitle();
      }
    } else toast(out.message||'没有可以继续的远征');
  }
};
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
  commit(false);
  renderTitle();
};
$('clearCustom').onclick=()=>{
  if(!confirm('清空自定义词库？')) return;
  DB.custom=[]; saveDB(); commit(false); $('ta').value=''; $('impMsg').innerHTML="<span style='color:var(--mut)'>已清空</span>"; renderTitle();
};
$('toReset').onclick=()=>{
  if(!confirm('清空所有存档（远征次数、通关次数、已掌握词、自定义词库、通关纪念卡）？')) return;
  const keepHero=DB.hero;   // 清档不该让人重选角色
  // 字母盘显示偏好也留着：清档清的是进度，不是界面口味（与 keepHero 同理）
  const keepKb={kbMode:DB.kbMode,kbUpper:DB.kbUpper};
  DB={runs:0,wins:0,mastered:[],best:0,custom:[],rewards:[],unitProgress:{},
      hero:keepHero,kbMode:keepKb.kbMode,kbUpper:keepKb.kbUpper};
  // 清档必须连未结束的远征快照一起删，否则刷新会把「已清空」的存档复活成一局死局。
  // 走 progress.resetProgress：删快照与写新的 DB 在**同一次** storage.save 里完成。
  lifecycle.resetRun(); TTS.stop(); progress.resetProgress();
  $('oReward').innerHTML=''; $('oReward').hidden=true;
  commit(false); renderTitle();
};
document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>{ renderTitle(); show('s-title') });

renderTitle();


if (import.meta.env.DEV && window.__VOCAB_TEST__ === true) {
  window.__gameTest = {
    get DB(){return DB}, set DB(value){DB=value},
    get G(){return G}, set G(value){G=value},
    get B(){return B}, set B(value){B=value},
    get curUnit(){return curUnit}, set curUnit(value){curUnit=value},
    newRun,startFight,pressKey,endRun:endRunNow,renderFight,renderTitle,renderMap,
    enterNode,showEvent,showRest,showShop,finishNode,advance,winFight,
    nextUnit,continueUnit,campaignState,
    loseFight,drawLetters,norm,hitDmg,wordDmg,wordComplete,typeLetter,
    creditWord,onWordWrong,hpBarGeom,paintHpBar,bankRows,syncBankBar,
    sayCurrentWord,useItem,show,TTS,AU,WORDS,UNITS,HEROES,ITEMS,RELICS,
    // 暂停/恢复测试面：只暴露动作，不暴露内部实现
    progress, pauseNow, resumeFromPause, chooseEncounter, takeReward,
    // 蓄力自主攻击（清单 13）：只暴露动作与事实，不暴露定时器内部。
    foeAttack:foeAttackCtl, enemyHit:d=>combat.enemyHit(d),
    get phase(){return PHASE_STATE}, get encounter(){return ENCOUNTER},
    get outcome(){return OUTCOME},
  };
}
}
