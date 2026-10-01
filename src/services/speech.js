import { clamp } from '../domain/math.js';

export function createSpeech({ heroVoice, curHeroId, rnd, voiceLines: VOICE_LINES, foeLineCfg, onChange, environment = globalThis }) {
  const TTS = (() => {
  const w=environment;
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

  /* ---- 中文音色（怪物说中文台词用）
     ★ 为什么必须单独筛：en 音色念中文是「塑料味」，完全不像人说话。
     ★ 判定要同时认 zh-CN / zh_CN / zh-Hans / zh-TW / 裸 zh：各系统写法不统一
       （Windows 是 zh-CN，Android 常是 zh-CN，macOS 有 zh-CN 与 zh-TW，
        Chrome 桌面版还可能出现 zh_CN 下划线写法）。统一小写并把 _ 换成 -。 */
  const normLang = v => String((v&&v.lang)||'').toLowerCase().replace(/_/g,'-');
  const zhVoices = () => (T.voices||[]).filter(v=>v && normLang(v).indexOf('zh')===0);
  /* 中文音色的性别同样只能靠名字猜：常见 zh-CN 本地音色有
     Microsoft Huihui / Yaoyao（女）、Kangkang 小新（男）、Google 普通话（中性）。 */
  const ZH_FEMALE=/(huihui|xiaoxiao|xiaoyi|xiaohan|xiaomo|yaoyao|tingting|ting-ting|sin-ji|mei-?jia|panpan|yunxia|liangliang|female|woman)/i;
  const ZH_MALE=/(kangkang|yunxi|yunjian|yunfeng|yunyang|haowen|danny|male|man)/i;
  const zhGender = v => {
    const s=(v.name||'')+' '+(v.voiceURI||'');
    if(ZH_FEMALE.test(s)) return 'female';
    if(ZH_MALE.test(s))   return 'male';
    return null;
  };
  /* 怪物 → 中文音色：同性别优先、离线音色优先、更自然的引擎优先；
     最后按 seed 在候选里转一格，让不同怪尽量落到不同中文嗓子上。
     一个 zh 音色都没有 → 返回 null（调用方静默跳过，绝不报错）。 */
  function zhVoiceFor(cfg, seed){
    const all=zhVoices();
    if(!all.length) return null;
    const pool=all.filter(v=>normLang(v)==='zh-cn');
    const use=pool.length?pool:all;
    const ranked=use.map(v=>{
      let s=0; const g=zhGender(v);
      if(cfg&&cfg.vo&&g) s += (g===cfg.vo?100:0);
      if(v.localService) s += 10;
      if(/natural|neural|enhanced|premium|普通话/i.test(v.name||'')) s += 4;
      return {v:v,s:s};
    }).sort((a,b)=>b.s-a.s).map(x=>x.v);
    return ranked[Math.abs(seed||0)%ranked.length];
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

    /* getVoices() 首次返回空数组是规范行为：音色列表异步加载。
       必须监听 voiceschanged 补一次，否则整个语音层永远是「无音色」状态。 */
    loadVoices(){
      if(!T.supported) return;
      try{ T.voices = synth.getVoices() || [] }catch(e){ T.voices=[] }
    },
    /* 第一次用户手势里调用：iOS Safari 必须在此刻 speak 一次空串才肯后续发声 */
    unlock(){
      if(!T.supported) return false;
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
    /* 纯静音取消（不抛错）。返回布尔，和 speak/word/line 保持同一套约定。 */
    stop(){ if(!T.supported) return false; try{ synth.cancel(); return true }catch(e){ return false } },

    /* 底层发声。o: {rate,pitch,volume,voice,lang}
       ★ 每次发声前先 cancel：连续快速答题会往队列里堆 utterance，
       越堆越慢、越排越后 —— 不 cancel 的话第 10 个词要等前 9 个念完。 */
    speak(text, o){
      if(!T.supported || !T.on || !text) return false;
      o=o||{};
      try{ T.stop(); T._cancels++ }catch(e){}
      let u;
      try{ u=new Utt(String(text)) }catch(e){ return false }
      try{
        u.lang  = o.lang || 'en-US';
        u.rate  = clamp(o.rate==null?0.9:o.rate, 0.1, 2);
        u.pitch = clamp(o.pitch==null?1:o.pitch, 0, 2);
        u.volume= clamp(o.volume==null?1:o.volume, 0, 1);
        const v = o.voice!==undefined ? o.voice : voiceFor(curHeroId());
        if(v) u.voice=v;                       // 拿不到音色就不设，用浏览器默认
      }catch(e){}
      T._spoke++;
      // 估算占用时长：语音队列不暴露剩余时间，用文本长度粗估，供限流判断
      const est=Math.max(500, String(text).length*80/Math.max(0.1,o.rate||0.9));
      T._busyUntil=Date.now()+est;
      T._lastUtter=u;
      try{ synth.speak(u); return true }catch(e){ return false }
    },
    busy(){ return Date.now() < T._busyUntil },

    /* 角色语速（单词朗读用）。角色没配 voice 也能拿到安全值。 */
    rate(id){ return heroVoice(id).rate },
    pitch(id){ return heroVoice(id).pitch },

    /* ① 拼完单词自动朗读 —— 这是「知道读音」的核心训练，所以最高优先级：
       永远会念，不参与限流，也不会被战斗台词吞掉。 */
    word(w, id){
      if(!T.supported || !T.on || !w) return false;
      const h=id||curHeroId(), v=heroVoice(h);
      const ok=T.speak(String(w).trim(), {rate:v.rate, pitch:v.pitch, voice:voiceFor(h), volume:1});
      if(ok) T._lastWordAt=Date.now();
      return ok;
    },
    /* ② 发音提示按钮：慢速 0.7，把每个音节听得清清楚楚。
       连按不排队（speak 内部会先 cancel）。 */
    hint(w, id){
      if(!T.supported || !T.on) return false;
      if(!w) return false;
      const h=id||curHeroId(), v=heroVoice(h);
      return T.speak(String(w).trim(), {rate:0.7, pitch:v.pitch, voice:voiceFor(h), volume:1});
    },
    /* ③④ 战斗台词：随机采样 + 不立刻重复 + 限流。
       绝不能每次攻击都说话（会盖住单词朗读、也会吵）。 */
    line(kind, id, opt){
      if(!T.supported || !T.on) return false;
      const h=id||curHeroId();
      const bank=VOICE_LINES[h] || VOICE_LINES.scholar;
      const arr=bank[kind] || bank.atk;
      if(!arr || !arr.length) return false;
      const now=Date.now();
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
    /* ⑤ 怪物入场中文台词。
       ★ 与 foeCry() 的 WebAudio 叫声是两层东西：叫声是「非人声怪叫」，
         这里才是怪物「说人话」。两者可以叠加，人声优先、限流让位。
       ★ 必须用 zh-CN 音色 —— 用 en 音色念中文是塑料味。
       ★ 找不到任何 zh 音色 → 静默返回 false，只留 WebAudio 叫声，绝不报错。 */
    foeLine(foe, opt){
      if(!T.supported || !T.on || !foe) return false;
      opt=opt||{};
      const cfg = foeLineCfg(foe);
      if(!cfg) return false;
      const v = zhVoiceFor(cfg, cfg.seed||0);
      if(!v) return false;                      // 无中文音色 → 优雅降级
      const now=Date.now();
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
                                 lang:'zh-CN', volume:cfg.volume==null?.92:cfg.volume});
      if(ok) T._lastFoeAt=now;
      return ok;
    },
    /* ⑤ 开关：存 DB.voice（老存档没这字段 → 默认开，向后兼容） */
    setOn(b){
      T.on=!!b;
      try{ onChange(T.on) }catch(e){}
      if(!T.on) T.stop();
      return T.on;
    },
    toggle(){ return T.setOn(!T.on) }
  };
  if(supported){
    T.loadVoices();
    if(typeof synth.addEventListener==='function') synth.addEventListener('voiceschanged',()=>T.loadVoices());
    else synth.onvoiceschanged=()=>T.loadVoices();       // 老 Safari 只有 on* 属性
  }
  return T;

  })();
  return TTS;
}
