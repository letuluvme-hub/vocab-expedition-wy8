import { clamp } from '../domain/math.js';
import { CHANNEL } from './audio-capability.js';

/* capability 与 utteranceTimeoutMs 都是**可选**注入：
   不给就不启用兼容层，老调用方 { ...原参数 } 的签名与行为原样保留。
   utteranceTimeoutMs 传 0 = 显式关掉超时兜底；不给（null/undefined）= 按朗读时长估算。 */
/* now / schedule / clearScheduled 同样是**可选**注入：不给就用真实 Date.now 与真实
   setTimeout，行为逐字不变；给了就让测试用假时钟钉死「多久之后」。
   ★ 占用上界、「每 120ms 轮询」这类**时长语义**必须可注入，否则只能真等。 */
export function createSpeech({ heroVoice, curHeroId, rnd, voiceLines: VOICE_LINES, foeLineCfg, onChange, onAnnouncementStart, environment = globalThis, capability = null, utteranceTimeoutMs = null, now: nowFn = null, schedule: scheduleFn = null, clearScheduled: clearFn = null }) {
  const TTS = (() => {
  const w=environment;
  const NOW    = typeof nowFn==='function'     ? nowFn     : () => Date.now();
  const later  = typeof scheduleFn==='function' ? scheduleFn : (fn,ms)=>setTimeout(fn,ms);
  const cancel = typeof clearFn==='function'    ? clearFn    : id=>clearTimeout(id);
  /* ★ 占用令牌的**保守硬上界**（毫秒）。浏览器一个回调都不给时占用也必须自己松手，
     否则低优先级播报永久静默（微信隐私模式、标签页被冻结、静默失败都是这个形态）。
     ★ 绝不复用 utteranceTimeoutMs：那是**可关闭**的兼容层开关（0 = 显式关），
       拿它当占用上界等于「关掉超时 = 永久 busy」。
     ★ 规则 = est×4，不低于 5s，最高封顶 30s。宁可多等一会儿，也绝不在词还在念的
       时候让播报插进来；真正的 end 仍然**早释放**，这条只是没人通知时的天花板。 */
  const PRIO_BOUND_MIN=5000, PRIO_BOUND_CEIL=30000;
  /* 终局台词队列的三个时长（毫秒）。写死成常量而不是散落的字面量：
     「留多长 grace」和「120ms 轮询」是一对，必须看得见关系。 */
  const FINAL_GRACE_MS=240;      // 通道空出来后先让给每 120ms 轮询的连胜反馈
  const FINAL_POLL_MS=120;       // 还占着就多久之后再问一次
  const FINAL_LIFETIME_MS=5000;  // 待播总寿命：过期就安静丢弃
  const FINAL_KINDS={ win:true, lose:true };
  const synth = w.speechSynthesis || null;
  const Utt = w.SpeechSynthesisUtterance || null;
  const supported = !!(synth && Utt && typeof synth.speak==='function');

  /* ---- 音色性别识别：按名字关键字打分，而不是依赖 voice.gender
     （Chrome/Edge 的 Web Speech 根本不提供 gender 字段） ---- */
  const FEMALE_RE=/(female|woman|zira|samantha|karen|moira|tessa|fiona|serena|allison|ava|victoria|susan|hazel|catherine|amelie|marie|helena|carla|tatiana|joana|lucia|paulina|sabina|ioana|jenny|michelle|emma|nicky|libby|zoe|aria|jessa|sonia|theresa|sin-ji|mei|ting-ting|li-mu|hsiao)/i;
  const MALE_RE=/(male|man|david|daniel|mark|alex|fred|rishi|evan|nathan|thomas|oliver|george|aaron|brian|christopher|dudley|eddy|grandpa|reed|rocko|ralph|bruce|ludwig|otto|maged|albert|bob|charles|dan|freddie|herbert|ian|james|jeremy|john|joe|kevin|martin|peter|philip|ray|roger|steve|tony|victor|will|junior|kangkang|hyunsu)/i;
  const voiceGender = v => {
    const s=(v.name||'')+' '+(v.voiceURI||'');
    if(FEMALE_RE.test(s)) return 'female';
    if(MALE_RE.test(s))   return 'male';
    return null;                                   // 认不出（如 Google US English）→ 当中性
  };
  // 英文音色：先精确 en-US，再退到任意 en-*，再退到 null（用浏览器默认音色）
  const enVoices = () => (TTS.voices||[]).filter(v=>v && String(v.lang||'').toLowerCase().indexOf('en')===0);
  /* 角色 → 音色的分配：
     1) 只看英文音色；2) en-US 优先；3) 同性别优先（认不出性别算中性，居中）
     4) 离线音色（localService）优先 —— 延迟低、不吃网
     找不到任何 en 音色就返回 null，交给浏览器默认音色 —— 分配失败绝不报错。 */
  function voiceFor(id){
    const cfg=heroVoice(id), all=enVoices();
    if(!all.length) return null;
    const pool=all.filter(v=>String(v.lang||'').toLowerCase()==='en-us');
    const use=pool.length?pool:all;
    const score=v=>{
      let s=0;
      const g=voiceGender(v);
      if(cfg.prefer&&g) s += (g===cfg.prefer?100:0);
      if(v.localService) s += 10;
      if(/natural|neural|enhanced|premium/i.test(v.name||'')) s += 4;   // 更自然的引擎
      return s;
    };
    let best=use[0], bs=score(best);
    for(let i=1;i<use.length;i++){ const s=score(use[i]); if(s>bs){ bs=s; best=use[i] } }
    return best;
  }

  // English feedback voices stay separate from the hero's teaching voice.
  function feedbackVoice(prefer = 'male', seed = 0) {
    const all=enVoices(); if(!all.length) return null;
    const us=all.filter(v=>String(v.lang||'').toLowerCase()==='en-us');
    const pool=us.length?us:all;
    const score=v=>(voiceGender(v)===prefer?100:0)+(v.localService?10:0)+(/natural|neural|enhanced|premium/i.test(v.name||'')?4:0);
    const best=Math.max(...pool.map(score));
    const tied=pool.filter(v=>score(v)===best);
    return tied[Math.abs(seed)%tied.length];
  }

  const T={
    supported: supported,
    voices: [],            // 浏览器异步填充，首次常为空数组
    on: true,               // 语音总开关（存 DB.voice，缺字段默认开）
    unlocked: false,        // 是否已经过用户手势（自动播放策略）
    _spoke: 0,              // 累计发声次数（测试观测点）
    _cancels: 0,            // 累计 cancel 次数（测试观测点）
    _lastLineAt: 0,         // 上一句战斗台词的时间戳
    _lastWordAt: 0,         // 上一次单词朗读的时间戳
    _lastFoeAt: 0,          // 上一句怪物中文台词的时间戳（怪物自己的限流）
    _busyUntil: 0,          // 预计还在说话的截止时间
    _lastPick: {},          // {heroId:kind: 上次取的台词下标} → 避免立刻重复
    _lastUtter: null,
    _probeTimers: [],        // 观测用的超时定时器（可从测试清理）
    _obs: null,              // 当前唯一活跃观测（utterance 级）
    _obsSeq: 0,              // 观测代号：迟到的旧回调靠它认出「自己已经不是当前那句了」
    // ★ 完整词朗读的「占用令牌」（docs/feature-word-streak.md）。
    //   只有 word() / hint()（用户自己要的读音）会**占住**它；战斗台词不会。
    //   代号（generation）是关键：stop() / 换一句会让当前代号作废，于是
    //   **上一句迟到的 onend 认不出自己是当前占用**，绝不会把新占用清掉。
    _prioGen: 0,
    _prioActive: false,
    _prioUntil: 0,
    _prioTimer: null,           // 本次占用的**硬上界**定时器（release/stop 时清掉自己那一个）
    cap: capability,

    /* 词/提示是否真的还在念。低优先级播报**唯一**的让路判据。
       没有注入 capability 时拿不到真实 end/error（那条路径上一个回调都不许
       改写，见 watchUtterance 的约定），于是退化成按朗读时长估算的**有界**
       占用：绝不会永久卡住「忙」而让播报永远静默。 */
    wordPriorityBusy(){ return T._prioActive === true || (T._prioUntil > NOW()) },

    /* 本次占用的硬上界：est×4，下限 5s，上限 30s。 */
    _prioBound(estMs){
      const est=Number(estMs)>0 ? Number(estMs) : 0;
      return Math.min(PRIO_BOUND_CEIL, Math.max(PRIO_BOUND_MIN, Math.round(est*4)));
    },

    /* 占住 / 释放「最高优先级」。gen 在每次 claim 与 stop 时自增：旧 utterance
       的迟到回调带着旧 gen 回来，发现自己不是当前占用 → 什么都不做。
       ★ 只在**真实**的 utterance end / error 时释放：onstart 是「开始」，不是
         「结束」，绝不在那里释放（那会让播报在词还在念的时候插进去）。
       ★ 另有一条**独立的保守硬上界**定时器：浏览器一个回调都不给时（微信隐私
         模式、静默失败、标签页被冻结）占用也必须自己松手，否则播报永久静默。
         它不是 utteranceTimeoutMs（那个可被显式关掉），也不是 wordPriorityBusy
         的估算窗口 —— 是一条独立的有界兜底，「真实 end 早释放」仍然优先生效。 */
    _claimPriority(u, estMs){
      const gen=++T._prioGen;
      const bound=T._prioBound(estMs);
      T._prioActive=true;
      T._prioUntil=NOW()+bound;
      // ★ 清掉上一句遗留的上界定时器：每个占用只留**自己那一个**，
      //   否则旧定时器会一直挂在 event loop 上（stop/release 同理，见 _releasePriority）。
      if(T._prioTimer!=null){ try{ cancel(T._prioTimer) }catch(e){} T._prioTimer=null }
      // 真实结束与硬上界**共用**同一个 release：谁先到谁松手，另一个自动作废。
      const release=()=>{
        if(gen!==T._prioGen) return;                   // 迟到的旧 end/error：不许碰新占用
        if(T._prioTimer!=null){ try{ cancel(T._prioTimer) }catch(e){} T._prioTimer=null }
        T._prioActive=false; T._prioUntil=0;
        T._afterChannelIdle();                         // 通道空出来了 → 终局台词可以排队补播
      };
      T._prioTimer=later(release, bound);
      // ★ 没有 capability 时**一个字都不许改**：那条路径的契约就是
      //   「没注入就不装监听、不改写别人的回调」（见 speech-failure 的断言）。
      //   有界兜底靠上面的定时器成立，与 capability 无关。
      if(!T.cap) return u;
      // 装在 watchUtterance **之前**：watchUtterance 保留并链式调用已有回调，
      // 「真实事件原样传下去」的约定不受影响。
      const prevEnd=u.onend, prevErr=u.onerror;
      u.onend=ev=>{ if(typeof prevEnd==='function'){ try{ prevEnd.call(u,ev) }catch(e){} } release() };
      u.onerror=ev=>{ if(typeof prevErr==='function'){ try{ prevErr.call(u,ev) }catch(e){} } release() };
      return u;
    },
    _releasePriority(){
      T._prioGen++;                                   // 作废旧代号：旧 end 再来也认不出自己
      if(T._prioTimer!=null){ try{ cancel(T._prioTimer) }catch(e){} T._prioTimer=null }
      T._prioActive=false; T._prioUntil=0;
    },

    /* ★ 低优先级播报（完整词连胜的分层文案）的「占用令牌」。
       它**独立于**词的占用，但同样是 generation 保护 + 真实 end 早释放 +
       保守硬上界兜底。存在的唯一理由：播报一旦真的送出，就在念了 ——
       普通战斗台词（**即使 force:true**）来抢道就必须让路，否则玩家刚听到
       「Godlike」就被一声普通攻击打断，那这次播报等于没播。
       ★ 只有新的 word / hint（更该被听见的东西）才有资格 cancel 它。 */
    _annGen: 0,
    _annActive: false,
    _annUntil: 0,
    _annTimer: null,

    announcementBusy(){ return T._annActive === true || (T._annUntil > NOW()) },

    _claimAnnouncement(u, estMs){
      const gen=++T._annGen;
      const bound=T._prioBound(estMs);
      T._annActive=true;
      T._annUntil=NOW()+bound;
      if(T._annTimer!=null){ try{ cancel(T._annTimer) }catch(e){} T._annTimer=null }
      const release=()=>{
        if(gen!==T._annGen) return;                 // 迟到的旧 end/error：不许碰新播报
        if(T._annTimer!=null){ try{ cancel(T._annTimer) }catch(e){} T._annTimer=null }
        T._annActive=false; T._annUntil=0;
        T._afterChannelIdle();
      };
      T._annTimer=later(release, bound);
      // 与词占用同一条铁律：没注入 capability 时一个字都不许改。
      if(!T.cap) return u;
      const prevEnd=u.onend, prevErr=u.onerror;
      u.onend=ev=>{ if(typeof prevEnd==='function'){ try{ prevEnd.call(u,ev) }catch(e){} } release() };
      u.onerror=ev=>{ if(typeof prevErr==='function'){ try{ prevErr.call(u,ev) }catch(e){} } release() };
      return u;
    },
    _releaseAnnouncement(){
      T._annGen++;
      if(T._annTimer!=null){ try{ cancel(T._annTimer) }catch(e){} T._annTimer=null }
      T._annActive=false; T._annUntil=0;
    },

    /* ★ 低优先级播报（完整词连胜的分层文案）。全部条件都是为了「不抢话」：
       1) 不支持 TTS / 玩家关掉了朗读 / 没有文案 → false，**绝不**替他打开偏好；
       2) 词或提示正在念 → false（不插话、不排队）；
       3) 合成器自己还在说或队列还堵着 → false；
       3b) 上一条播报还在念 → false（播报自己不排队，避免两次提示叠在一起）；
       4) 说了就**不 cancel** 任何东西（noCancel）：正在读的那句绝不能被打断。
       true = 这一句真的发出去了；false = 这次没播（调用方只当「没播」）。 */
    announcement(text, { count = 1 } = {}){
      const s=String(text==null?'':text).trim();
      if(!T.supported || !T.on || !s) return false;
      if(T.wordPriorityBusy()) return false;
      if(T.announcementBusy()) return false;
      try{ if(synth && (synth.speaking || synth.pending)) return false }catch(e){}
      const level=clamp(Math.floor(Number(count)||1),1,10);
      return T.speak(s, { rate:1.04, pitch:Math.max(.68,.86-level*.02),
        voice:feedbackVoice('male'), volume:1, noCancel:true, announce:true,
        onStart:()=>{ if(typeof onAnnouncementStart==='function') onAnnouncementStart(level) } });
    },

    /* ★ 终局台词（win / lose）的「一条有界延迟」队列。
       为什么需要：玩家打赢的那一瞬，词往往正在念（拼完就朗读），于是
       line('win', force) 直接拿到 false —— 玩家只听到词的读音，胜利那句
       被静默吞掉。修法不是抢词（那会把词的读音截断，更糟），而是**记下来**，
       等通道真的空出来再补播。
       规则（每一条都是为了「不变成噪音」）：
         - **只有一条**：已有待播就丢弃后来的，绝不无限排队；
         - **等两个占用**：词（最高优先级）与播报都真结束；
         - **留 240ms grace**：给「每 120ms 轮询一次」的连胜反馈先抢通道的机会，
           所以实际顺序永远是「先播报、后终局台词」；
         - **5s 寿命**：通道一直不空（真机上等于异常）就安静丢弃，绝不补播陈旧时刻；
         - **noCancel 补播**：补的时候绝不 cancel 任何东西；
         - **generation**：stop() / 关掉朗读之后绝不补播。 */
    _final: null,
    _finalTimer: null,
    _gen: 0,
    _clearFinal(){ if(T._finalTimer!=null){ try{ cancel(T._finalTimer) }catch(e){} T._finalTimer=null } T._final=null },
    _armFinal(ms){
      if(T._finalTimer!=null){ try{ cancel(T._finalTimer) }catch(e){} T._finalTimer=null }
      if(!T._final) return;
      T._finalTimer=later(()=>{ T._finalTimer=null; T._flushFinal() }, ms);
    },
    /* 通道刚刚空出来：留一段 grace 再补播，把通道先让给 120ms 轮询的连胜反馈。 */
    _afterChannelIdle(){ if(T._final) T._armFinal(FINAL_GRACE_MS) },
    _finalScopeCurrent(check){
      try{return typeof check!=='function'||check()===true}catch(e){return false}
    },
    _queueFinal(kind,h,text,o,isCurrent){
      if(!T._finalScopeCurrent(isCurrent)) return false;
      if(T._final) return false;                  // 只排一条：绝不无限排队
      T._final={ kind:kind, heroId:h, text:String(text), o:o,
                 gen:T._gen, isCurrent:isCurrent, expiresAt:NOW()+FINAL_LIFETIME_MS };
      return true;
    },
    _flushFinal(){
      const q=T._final;
      if(!q) return false;
      if(q.gen!==T._gen || NOW()>q.expiresAt || !T._finalScopeCurrent(q.isCurrent)){ T._clearFinal(); return false }   // 过期/换场：丢弃
      if(T.wordPriorityBusy() || T.announcementBusy()){ T._armFinal(FINAL_POLL_MS); return false }
      T._clearFinal();
      const now=NOW();
      const ok=T.speak(q.text, Object.assign({ noCancel:true }, q.o));         // 补播绝不 cancel
      if(ok) T._lastLineAt=now;
      return ok;
    },

    /* 终局台词（win / lose）的入口：通道空就立刻念，被占着就**记一条**等补播。
       ★ 采样与音色在这里就定好（和普通台词同一套逻辑：随机 + 不立刻重复），
         免得补播那一刻 rnd 已经变了、听起来像另一句。 */
    _lineFinal(kind,id,opt){
      if(!T._finalScopeCurrent(opt&&opt.isCurrent)) return false;
      const h=id||curHeroId();
      const bank=VOICE_LINES[h] || VOICE_LINES.scholar;
      const arr=bank[kind] || bank.atk;
      if(!arr || !arr.length) return false;
      // 不抢词，也不截断已经送出的播报：两个占用都在就排队。
      if(T.wordPriorityBusy() || T.announcementBusy())
        return T._queueFinal(kind,h,this._pickLineText(h,kind,arr), this._lineOpts(h), opt&&opt.isCurrent);
      const now=NOW();
      // 通道空着：终局台词绕过限流，直接念（这一刻必须听到）。
      const ok=T.speak(this._pickLineText(h,kind,arr), this._lineOpts(h));
      if(ok) T._lastLineAt=now;
      return ok;
    },
    _pickLineText(h,kind,arr){
      let i=rnd(arr.length);
      if(arr.length>1 && i===T._lastPick[h+':'+kind]) i=(i+1)%arr.length;
      T._lastPick[h+':'+kind]=i;
      return arr[i];
    },
    _lineOpts(h){
      const v=heroVoice(h);
      return {rate:Math.max(0.85,v.rate), pitch:v.pitch, voice:voiceFor(h), volume:.95};
    },

    /* 兼容层是可选的：没注入就完全不做事，绝不改变原有朗读行为。 */
    report(fn,...args){ const c=this.cap; if(!c||typeof c[fn]!=='function') return; try{ c[fn](...args) }catch(e){} },
    clearProbeTimers(){ const t=this._probeTimers; this._probeTimers=[]; for(let i=0;i<t.length;i++){ try{ cancel(t[i]) }catch(e){} } },

    /* ★ 一次只观测**一个** utterance。
       每次 watch 都发一个递增 token；所有回调先验 token，
       于是「上一句迟到的 onend/onerror」不可能碰到这一句的结论或定时器：
         - 旧 onend 曾经会 clearProbeTimers()，把新句的探测定时器一起清掉 → 静默失败被永久放过
         - 旧 onerror 会把新句已经拿到的 available 覆盖成 blocked → 玩家看到假故障
       stop() 只作废当前 token + 收掉它自己的定时器，不动别人的。 */
    _retire(obs){ if(!obs) return; if(obs.timer!=null){ try{ cancel(obs.timer) }catch(e){}
      this._probeTimers=this._probeTimers.filter(x=>x!==obs.timer); obs.timer=null } obs.dead=true },

    /* 探测截止时间：
       - 显式给了 utteranceTimeoutMs（>0）就用它，测试要能钉死一个值；
       - 没给就按文本长度估一个「念完这句话大概要多久」再留余量。
       ★ 绝不用固定 4s 判长句：一句正常念完的台词可能超过 4 秒，
         固定 deadline 会把「念得慢」误报成「放不出声」。 */
    _deadline(text,rate){
      if(utteranceTimeoutMs==null) return 0;
      if(utteranceTimeoutMs===0) return 0;                      // 显式关掉兜底
      if(utteranceTimeoutMs>0 && utteranceTimeoutMs<60000) return utteranceTimeoutMs;
      return 0;
    },
    _estimated(text,rate){
      const est=Math.max(1200, String(text).length*90/Math.max(0.1,rate||0.9));
      return Math.min(60000, Math.round(est*1.6+800));
    },

    /* ★ 装观测监听器，但**绝不覆盖**utterance 上原有的 onstart/onend/onerror：
       那可能是别的模块（动画节奏、成就提示）已经挂上去的回调。
       这里先记下旧的，装一个「先调旧的、再记状态」的包装器 ——
       ★ 并且把**浏览器给的真事件原样传下去**（别的模块要靠 event 里的信息），
         别人的回调抛异常也绝不许遮住探测结论。
       没有注入 capability 时完全不动 utterance：老行为逐字保留。 */
    watchUtterance(u,o){
      if(!u||typeof u!=='object') return null;
      if(!T.cap) return u;                                       // 没开兼容层：不装、不计时
      o=o||{};
      const prevStart=u.onstart, prevEnd=u.onend, prevErr=u.onerror;
      const obs={ token:++T._obsSeq, timer:null, dead:false };
      T._obs=obs;                                                // 新观测取代旧观测
      const live=()=>T._obs===obs && !obs.dead;                   // 只有当前 token 才有发言权
      const call=(fn,ev)=>{ if(typeof fn==='function'){ try{ fn.call(u,ev) }catch(e){} } };

      const started=ev=>{
        call(prevStart,ev);
        if(!live()) return;
        // ★ onstart = 接口真的把话送出去了。这只证明「接口可用」，
        //   不等于真机能听见（措辞仍由 AVAILABLE_CLAIM 把关）。
        //   开口了就说明这条路是通的，所以立刻解除超时兜底 ——
        //   长台词接下来念多久都不该再被判成「放不出声」。
        // Start clears only the silent-start timer, not ownership: a real
        // playback error can still arrive before this utterance ends.
        if(obs.timer!=null){ cancel(obs.timer); T._probeTimers=T._probeTimers.filter(id=>id!==obs.timer); obs.timer=null }
        T.report('observeOk',CHANNEL.SPEECH);
      };
      const done=ev=>{
        call(prevEnd,ev);                                        // 真事件，不是新造的 {target:u}
        if(!live()) return;                                      // 迟到的旧 onend：不许碰新观测
        T._retire(obs); T._obs=null;
        T.report('observeOk',CHANNEL.SPEECH);
      };
      const fail=ev=>{
        const kind=ev&&ev.error;
        call(prevErr,ev);
        if(!live()) return;
        T._retire(obs); T._obs=null;
        // ★ 「我们自己叫停」不是故障：synth.cancel()、换一句、退出关卡都会让
        //   在念的那句以 canceled/interrupted 收场。把这个报成 blocked，
        //   表现就是玩家正常操作却反复被弹「浏览器无法朗读」。
        if(kind==='canceled'||kind==='cancelled'||kind==='interrupted') return;
        T.report('reportUtteranceFailure',CHANNEL.SPEECH,'utterance-error',kind);
      };
      u.onstart=started; u.onend=done; u.onerror=fail;

      // 静默失败兜底：接了 utterance 但既不 start 也不 end 也不 error（微信里最常见的形态）→ 超时算失败
      const ms = utteranceTimeoutMs === 0 ? 0 : (T._deadline(o.text,o.rate) || T._estimated(o.text,o.rate));
      if(ms>0 && ms<60000){
        const id=obs.timer=later(()=>{
          this._probeTimers=this._probeTimers.filter(x=>x!==id);
          obs.timer=null;
          if(!live()) return;                                    // 已经作废：绝不迟到报警
          obs.dead=true; T._obs=null;
          T.report('reportUtteranceFailure',CHANNEL.SPEECH,'utterance-timeout');
        }, ms);
        this._probeTimers.push(id);
      }
      return u;
    },

    /* getVoices() 首次返回空数组是规范行为：音色列表异步加载。
       必须监听 voiceschanged 补一次，否则整个语音层永远是「无音色」状态。 */
    loadVoices(){
      if(!T.supported) return;
      try{ T.voices = synth.getVoices() || [] }catch(e){ T.voices=[] }
    },
    /* 第一次用户手势里调用：iOS Safari 必须在此刻 speak 一次空串才肯后续发声。
       ★ 不支持时**不要**急着报 no-api：父层还没恢复存档里的朗读开关，
         一个本来就把朗读关掉的玩家不该被弹「浏览器不支持朗读」。
         只在玩家自己开着朗读却真的用不了时才下结论。 */
    unlock(){
      if(!T.supported){ if(T.on) T.report('noCapability',CHANNEL.SPEECH); return false }
      T.unlocked=true;
      try{
        if(synth.paused) synth.resume();
        if(!T._primed){                       // 一次性「空串暖机」
          T._primed=true;
          const u=new Utt(' '); u.volume=0; u.lang='en-US';
          synth.speak(u);
        }
      }catch(e){}
      return true;
    },
    /* 纯静音取消（不抛错）。返回布尔，和 speak/word/line 保持同一套约定。
       ★ 取消同时作废当前观测：cancel 会让在念的那句以 canceled/interrupted 收场，
         那不是故障；而且残留的探测定时器必须在 cancel 的同一刻收掉，
         否则几秒后凭空冒出一条「朗读超时」的假故障。 */
    stop(){
      // ★ 作废「最高优先级占用」：换句/清场之后，旧 utterance 的迟到 onend
      //   认不出自己是当前占用（gen 已自增），绝不会把**新**一句的占用清掉。
      T._releasePriority();
      // 同理作废播报的占用：stop() 之后绝不该还有「通道被占着」的残留。
      T._releaseAnnouncement();
      // ★ 清掉终局队列并作废代号：暂停 / 退出关卡 / 关掉朗读之后，
      //   绝不该在几秒后突然补一句「胜利！」—— 玩家已经不在那个场景里了。
      T._gen++; T._clearFinal();
      T._retire(T._obs); T._obs=null;
      if(!T.supported) return false;
      try{ synth.cancel(); return true }catch(e){ return false }
    },

    /* 底层发声。o: {rate,pitch,volume,voice,lang}
       ★ 每次发声前先 cancel：连续快速答题会往队列里堆 utterance，
       越堆越慢、越排越后 —— 不 cancel 的话第 10 个词要等前 9 个念完。 */
    speak(text, o){
      if(!T.on || !text) return false;
      if(!T.supported){ T.report('noCapability',CHANNEL.SPEECH); return false }
      o=o||{};
      const rate=clamp(o.rate==null?0.9:o.rate, 0.1, 2);
      // ★ 玩家自己关掉朗读时**不**开探测：那不是故障（偏好 ≠ 故障）。
      //   但真的开口念了，就说明玩家想要声音，这时候失败必须看得见。
      T.report('beginProbe',CHANNEL.SPEECH);
      // noCancel = 低优先级通道（announcement）：它只在「什么都没在说」时才被允许
      //   调用，所以这里绝不能顺手 cancel 掉别的东西。
      if(o.noCancel!==true){ try{ T.stop(); T._cancels++ }catch(e){} }
      let u;
      try{ u=new Utt(String(text)) }catch(e){ T.report('reportUtteranceFailure',CHANNEL.SPEECH,'utterance-error','construct'); return false }
      try{
        u.lang  = o.lang || 'en-US';
        u.rate  = rate;
        u.pitch = clamp(o.pitch==null?1:o.pitch, 0, 2);
        u.volume= clamp(o.volume==null?1:o.volume, 0, 1);
        const v = o.voice!==undefined ? o.voice : voiceFor(curHeroId());
        if(v) u.voice=v;                       // 拿不到音色就不设，用浏览器默认
      }catch(e){}
      T._spoke++;
      // 估算占用时长：语音队列不暴露剩余时间，用文本长度粗估，供限流判断
      const est=Math.max(500, String(text).length*80/Math.max(0.1,rate));
      T._busyUntil=NOW()+est;
      T._lastUtter=u;
      // 词/提示占住最高优先级；播报占住自己的低优先级通道（都在 watchUtterance
      // 之前装，链式保留真实回调）。
      if(o.highPriority===true) T._claimPriority(u, est);
      if(o.announce===true) T._claimAnnouncement(u, est);
      if(typeof o.onStart==='function') {
        const generation=T._annGen; let started=false;
        u.onstart=()=>{
          if(started || !T.on || generation!==T._annGen || !T._annActive) return;
          started=true; try{ o.onStart() }catch(e){ /* Optional impact must not block speech. */ }
        };
      }
      T.watchUtterance(u,{ text:String(text), rate:rate });
      // speak 抛错 = 这一路真的放不出声（微信隐私模式 / 系统 TTS 缺失时常见）
      try{ synth.speak(u); return true }catch(e){ T._retire(T._obs); T._obs=null; if(o.highPriority===true) T._releasePriority(); if(o.announce===true) T._releaseAnnouncement(); T.report('reportUtteranceFailure',CHANNEL.SPEECH,'utterance-error',e&&e.message); return false }
    },
    busy(){ return NOW() < T._busyUntil },

    /* 角色语速（单词朗读用）。角色没配 voice 也能拿到安全值。 */
    rate(id){ return heroVoice(id).rate },
    pitch(id){ return heroVoice(id).pitch },

    /* ① 拼完单词自动朗读 —— 这是「知道读音」的核心训练，所以最高优先级：
       永远会念，不参与限流，也不会被战斗台词吞掉。 */
    word(w, id){
      if(!T.supported || !T.on || !w) return false;
      const h=id||curHeroId(), v=heroVoice(h);
      const ok=T.speak(String(w).trim(), {rate:v.rate, pitch:v.pitch, voice:voiceFor(h), volume:1,
        highPriority:true});
      if(ok) T._lastWordAt=NOW();
      return ok;
    },
    /* ② 发音提示按钮：慢速 0.7，把每个音节听得清清楚楚。
       连按不排队（speak 内部会先 cancel）。 */
    hint(w, id){
      if(!T.supported || !T.on) return false;
      if(!w) return false;
      const h=id||curHeroId(), v=heroVoice(h);
      return T.speak(String(w).trim(), {rate:0.7, pitch:v.pitch, voice:voiceFor(h), volume:1,
        highPriority:true});
    },
    /* ③④ 战斗台词：随机采样 + 不立刻重复 + 限流。
       绝不能每次攻击都说话（会盖住单词朗读、也会吵）。
       ★ 返回值对**终局台词（win/lose + force:true）**多一层意思：
         true = 「已受理」——要么这一刻就念了，要么**记下来等通道空出来补播**；
         false = 这次没念**而且也不会补**（不支持和朗读、无文案、或队列已有一条）。
         非终局台词的 true 仍然严格等于「这一刻真的送出去了」。 */
    line(kind, id, opt){
      if(!T.supported || !T.on) return false;
      // ★ 终局台词（win / lose）走「一条有界延迟」而不是直接丢弃。
      //   判据放在最前面：这两个瞬间**必须**送达（玩家打赢却只听到词的读音，
      //   等于胜利反馈丢了），而它们又绝不能抢词的读音 —— 所以排队，不抢占。
      if(FINAL_KINDS[kind]===true) return T._lineFinal(kind,id,opt);
      // ★ 完整词朗读是最高优先级：战斗台词（**即使 force:true**）也不许打断它。
      if(T.wordPriorityBusy()) return false;
      // ★ 连胜播报虽然低优先级，但**已经送出去了就在念**：普通台词（**即使
      //   force:true**）也不许截断它，否则玩家刚听到里程碑就被一声攻击盖掉。
      //   force 的豁免只针对「限流」，绝不针对「正在念的别的句子」。
      if(T.announcementBusy()) return false;
      const h=id||curHeroId();
      const bank=VOICE_LINES[h] || VOICE_LINES.scholar;
      const arr=bank[kind] || bank.atk;
      if(!arr || !arr.length) return false;
      const now=NOW();
      // ★ 限流是默认行为，不能因为调用方没传 opt 就绕过。
      //   （曾经写成 `if(opt && opt.force!==true)`，结果 line('combo') 这种
      //    不传参的调用直接跳过全部限流，每次连击都喊，非常吵。）
      //   只有显式 force:true 才允许插队 —— 胜利/失败/濒死那三个瞬间。
      if(!(opt && opt.force===true)){
        // 限流：两句台词之间至少 2.6s，且不压在单词朗读的 1.4s 尾巴上
        if(now-T._lastLineAt < 2600) return false;
        if(now-T._lastWordAt < 1400) return false;
        if(opt && opt.p!=null && Math.random() > opt.p) return false;
      }
      // 不立刻重复：只有一句时无所谓，多句时避开上一句
      let i=rnd(arr.length);
      if(arr.length>1 && i===T._lastPick[h+':'+kind]) i=(i+1)%arr.length;
      T._lastPick[h+':'+kind]=i;
      const v=heroVoice(h);
      const ok=T.speak(arr[i], {rate:Math.max(0.85,v.rate), pitch:v.pitch, voice:voiceFor(h), volume:.95});
      if(ok) T._lastLineAt=now;
      return ok;
    },
    /* English monster dialogue keeps each species' pace and pitch.
       Words and streaks retain priority; a missing voice uses the system en-US fallback. */
    foeLine(foe, opt){
      if(!T.supported || !T.on || !foe) return false;
      if(T.wordPriorityBusy()) return false;      // 怪物台词不抢词的读音
      if(T.announcementBusy()) return false;      // 也不许截断已经送出的连胜播报
      opt=opt||{};
      const cfg = foeLineCfg(foe);
      if(!cfg) return false;
      const v = feedbackVoice(cfg.vo, cfg.seed||0);
      const now=NOW();
      // 限流：怪物之间至少 2.6s；不压在单词朗读尾巴（1.4s）上；
      //      也不压在角色刚说完的台词尾巴（1.8s）上 —— 免得两段话叠在一起。
      if(!(opt && opt.force===true)){
        if(now-T._lastFoeAt  < 2600) return false;
        if(now-T._lastWordAt < 1400) return false;
        if(now-T._lastLineAt < 1800) return false;
      }
      const arr=cfg.lines;
      let i=rnd(arr.length);
      const key='foe:'+(cfg.key||'');
      if(arr.length>1 && i===T._lastPick[key]) i=(i+1)%arr.length;
      T._lastPick[key]=i;
      const ok=T.speak(arr[i], {rate:cfg.rate, pitch:cfg.pitch, voice:v,
                                 lang:'en-US', volume:cfg.volume==null?.92:cfg.volume});
      if(ok) T._lastFoeAt=now;
      return ok;
    },
    /* ⑤ 开关：存 DB.voice（老存档没这字段 → 默认开，向后兼容）
       ★ 关掉时**清掉**这一路上已经挂着的故障提示：玩家自己选择不听了，
         再继续弹「浏览器无法朗读」就是噪音，而且会诱导他以为是游戏坏了。
         这绝不代表声音其实是好的 —— 只是这一路不再需要提示。 */
    setOn(b){
      T.on=!!b;
      try{ onChange(T.on) }catch(e){}
      if(!T.on){ T.stop(); T.report('disableChannel',CHANNEL.SPEECH) }
      else T.report('enableChannel',CHANNEL.SPEECH);
      return T.on;
    },
    toggle(){ return T.setOn(!T.on) }
  };
  // ★ 构造时**不**报 no-api：父层还没恢复存档里的偏好，
  //   一个本来就把朗读关掉的玩家不该一进游戏就被弹「浏览器不支持朗读」。
  //   真正用到时（unlock / speak）再判，那时才知道玩家是不是自己想听。
  if(supported){
    T.loadVoices();
    if(typeof synth.addEventListener==='function') synth.addEventListener('voiceschanged',()=>T.loadVoices());
    else synth.onvoiceschanged=()=>T.loadVoices();       // 老 Safari 只有 on* 属性
  }
  return T;

  })();
  return TTS;
}
