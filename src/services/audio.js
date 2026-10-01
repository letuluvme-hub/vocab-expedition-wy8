import { clamp } from '../domain/math.js';

export function createAudio({ getCombo, environment = globalThis }) {
const PENTA=[0,2,3,7,10];        // D 小调五声音阶的半音偏移
const PENTA_ROOT=146.83;         // 根音 D3
function pnote(i){               // 音阶取音：0=D3 4=C4 5=D4 9=A4 12=E5 …可跨八度
  const o=Math.floor(i/PENTA.length), k=i-o*PENTA.length;
  return PENTA_ROOT*Math.pow(2,(o*12+PENTA[k])/12);
}
const AU={
  ac:null, master:null, dry:null, send:null, conv:null, wet:null, nbuf:null,
  voices:0, maxVoices:32, vol:.55, muted:false, ready:false, lastKey:-9, lastHover:-9,
  ctx(){
    const a=this.build();
    if(!a) return null;                            // 没有音频能力 → 静默降级
    // 页面被切到后台 / 自动播放被拦时 context 会挂起：currentTime 不走，
    // onended 也就不会触发，voice 计数会一直堆积到上限导致「彻底没声音」。
    // 所以挂起期间直接拒绝发声，恢复时把计数清零。
    if(a.state==='suspended'){ this.voices=0; return null }
    if(a.state==='running' && this.wasSuspended){ this.voices=0; this.wasSuspended=false }
    return a;
  },
  /* 软削波曲线：|x|<0.7 完全透明，之后 tanh 式滚降逼近 1.0 —— 只防削顶，不压缩动态 */
  clipCurve(){
    const n=2048, c=new Float32Array(n);
    for(let i=0;i<n;i++){
      const x=i*2/n-1, a=Math.abs(x);
      c[i]= a<.7 ? x : Math.sign(x)*(.7+.29*Math.tanh((a-.7)/.29));
    }
    return c;
  },
  makeIR(dur,decay){             // 程序生成的衰减脉冲响应（小房间，1.35s）
    const a=this.ac, sr=a.sampleRate, len=Math.max(1,Math.floor(sr*dur));
    const b=a.createBuffer(2,len,sr);
    for(let c=0;c<2;c++){
      const d=b.getChannelData(c);
      for(let i=0;i<len;i++){ const t=i/len; d[i]=(Math.random()*2-1)*Math.pow(1-t,decay) }
    }
    return b;
  },
  makeNoise(){                   // 1.2s 白噪音缓冲，所有 noise() 共用
    const a=this.ac, sr=a.sampleRate, len=Math.floor(sr*1.2);
    const b=a.createBuffer(1,len,sr), d=b.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
    return b;
  },
  setVol(v){
    this.vol=clamp(v,0,1); this.muted=this.vol<=0;
    if(this.master){ try{ this.master.gain.setTargetAtTime(this.muted?0:this.vol,this.ac.currentTime,.02) }catch(e){} }
  },
  cleanup(nodes,done){ AU.voices--; for(let i=0;i<nodes.length;i++){ try{nodes[i].disconnect()}catch(e){} } if(done)done() },
  /* 在真实用户手势里调用：建图 + 解除挂起。ctx() 只负责取用、不负责 resume，
     这样任何非手势路径都不会偷偷启动 AudioContext（浏览器自动播放策略）。 */
  unlock(){
    const a=this.build();
    if(!a) return null;
    if(a.state!=='running'){ this.wasSuspended=true; try{ a.resume() }catch(e){} }
    if(a.state==='running') this.voices=0;
    return a;
  },
  /* 建图（幂等）。只在这里创建节点，ctx()/unlock() 共用。 */
  build(){
    if(this.ac) return this.ac;
    const w=environment;
    const Ctor=w&&(w.AudioContext||w.webkitAudioContext);
    if(!Ctor) return null;                         // 没有音频能力 → 静默降级
    try{
      const a=this.ac=new Ctor();
      // 安全限幅用 WaveShaper 软削波，而不是 DynamicsCompressor：
      // 压缩器在 2ms attack 下会把 0.12 的音硬压到 0.025（实测 5 倍衰减），
      // 动态全被吃光；软削波在 0.7 以下完全透明，只有真的要削顶时才介入。
      const lim=a.createWaveShaper();
      lim.curve=this.clipCurve(); lim.oversample='4x';
      this.master=a.createGain(); this.master.gain.value=this.muted?0:this.vol;
      this.dry=a.createGain(); this.dry.gain.value=1;
      this.send=a.createGain(); this.send.gain.value=.16;          // 混响 send（干湿比小，不糊）
      this.conv=a.createConvolver(); this.conv.buffer=this.makeIR(1.35,3.2);
      this.wet=a.createGain(); this.wet.gain.value=.85;
      this.dry.connect(lim);
      this.send.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(lim);
      lim.connect(this.master); this.master.connect(a.destination);
      this.nbuf=this.makeNoise();
      this.ready=true;
    }catch(e){ this.ac=null; return null }
    return this.ac;
  }
};
// 首次交互时唤醒 AudioContext（浏览器自动播放策略）。
// 监听器不摘除：直到真正 running 为止，每次手势都再试一次（Safari/Chrome 恢复时机不一）。
function audioUnlock(){ if(AU.ac&&AU.ac.state==='running'&&!AU.wasSuspended){ return } AU.unlock() }




// 升级版 tone()：极短起音(1~5ms) + 指数衰减，可选低通与混响 send
function tone(f,dur,type,vol,slide,o){
  o=o||{};
  const a=AU.ctx(); if(!a||!AU.ready) return;
  if(AU.voices>=AU.maxVoices) return;
  const t=(o.at!=null)?o.at:a.currentTime+(o.delay||0);
  const atk=Math.max(.001,Math.min(o.atk==null?.004:o.atk, dur*.4));
  const nodes=[]; const osc=a.createOscillator(), g=a.createGain();
  osc.type=type||'triangle';
  osc.frequency.setValueAtTime(Math.max(20,f),t);
  if(slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20,slide),t+dur*.9);
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.max(.0002,vol==null?.14:vol),t+atk);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  let tail=osc;
  if(o.cut){ const lp=a.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=o.cut;
    osc.connect(lp); tail=lp; nodes.push(lp) }
  tail.connect(g); g.connect(AU.dry); nodes.push(osc,g);
  if(o.send){ const s=a.createGain(); s.gain.value=o.send; g.connect(s); s.connect(AU.send); nodes.push(s) }
  AU.voices++;
  osc.onended=()=>AU.cleanup(nodes);
  osc.start(t); osc.stop(t+dur+.02);
}
// 打击噪音：白噪音过一个带通/高通，做「咔哒 / 噗 / 嘶」的瞬态
function noise(dur,ftype,freq,vol,o){
  o=o||{};
  const a=AU.ctx(); if(!a||!AU.ready||!AU.nbuf) return;
  if(AU.voices>=AU.maxVoices) return;
  const t=(o.at!=null)?o.at:a.currentTime+(o.delay||0);
  const nodes=[]; const src=a.createBufferSource(); src.buffer=AU.nbuf; src.loop=true;
  src.playbackRate.value=o.rate||(.85+Math.random()*.4);
  const bp=a.createBiquadFilter(); bp.type=ftype||'bandpass'; bp.Q.value=o.q||1;
  bp.frequency.setValueAtTime(Math.max(40,freq),t);
  if(o.sweep) bp.frequency.exponentialRampToValueAtTime(Math.max(40,o.sweep),t+dur);
  const g=a.createGain();
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(Math.max(.0002,vol==null?.1:vol),t+Math.min(.004,dur*.25));
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  src.connect(bp); bp.connect(g); g.connect(AU.dry); nodes.push(src,bp,g);
  if(o.send){ const s=a.createGain(); s.gain.value=o.send; g.connect(s); s.connect(AU.send); nodes.push(s) }
  AU.voices++;
  src.onended=()=>AU.cleanup(nodes);
  src.start(t,Math.random()*.5); src.stop(t+dur+.02);
}
// 按音阶排一组音（采样级精确调度，比 setTimeout 稳）
function arp(notes,step,dur,type,vol,o){
  const a=AU.ctx(); if(!a) return;
  const t0=a.currentTime+.006;
  notes.forEach((n,i)=>tone(n,dur,type,typeof vol==='function'?vol(i):vol,null,
    Object.assign({},o||{},{at:t0+i*step})));
}
const combo=()=>getCombo();

const sfx={
  /* 答对一个字母：噪声 click + 音高随连击沿五声音阶上行的三角波，音量随连击微增 */
  good(){
    const c=combo();
    const f=pnote(12+Math.min(c,6));                       // E5 → 随连击爬到 A5
    const v=.13+Math.min(c,12)*.005;
    noise(.045,'highpass',3200,.055);                       // 高频「咔哒」瞬态
    tone(f,.11,'triangle',v,null,{send:.08});
    tone(f*2,.06,'sine',v*.22,null,{delay:.012});           // 一丝亮泽，仍以三角波为主
  },
  /* 答错：低通闷响 + 短促下滑冲击，像被敲了一下 */
  bad(){ noise(.1,'lowpass',520,.16,{sweep:220,q:.7}); tone(pnote(3),.17,'square',.11,pnote(1),{cut:1400}) },
  /* 敌人受击：硬方波冲击 + 窄带瞬态 */
  hit(){ noise(.06,'bandpass',1900,.1,{q:1.4}); tone(pnote(2),.085,'square',.1,pnote(1)); tone(92,.07,'triangle',.12) },
  /* 键盘移动：极短的高频 tick，音高随连击沿音阶上行（连击听觉爬升的主力） */
  key(){
    const a=AU.ctx(); if(a&&a.currentTime-AU.lastKey<.03) return;   // 节流：快速滑动不糊
    AU.lastKey=a?a.currentTime:0;
    noise(.02,'highpass',5000,.03);
    tone(pnote(9+Math.min(combo(),8)),.035,'triangle',.05);
  },
  coin(){ arp([pnote(14),pnote(17)],.055,.13,'triangle',.11) },
  /* 整词拼完：最爽的一刻 —— 快速上滑 + 大铃铛 + 亮噪闪粉 */
  word(){
    noise(.05,'highpass',4200,.09);
    tone(pnote(12),.26,'triangle',.15,pnote(17),{cut:5200});       // 「叮——」的上滑
    tone(pnote(16),.55,'triangle',.15,null,{delay:.19,send:.3});     // 铃铛基音
    tone(pnote(19),.5,'triangle',.08,null,{delay:.21,send:.34});     // 铃铛五度泛音
    noise(.2,'highpass',6000,.045,{delay:.19});
  },
  /* 整词大招：比 word() 更「重」的一档 —— 低频轰击(蓄力) → 金属撞击(命中) →
     五声音阶大琶音(收招) → 长混响尾。整词路径专用，单字母绝不调用它，
     这样「拼完一个词」有自己独立的声音签名（低频 + 宽音域，和 hit() 的短促窄带完全不同）。
     节点数控制在 7 个以内，别把 AU.maxVoices(32) 的预算吃掉。 */
  finisher(){
    noise(.22,'lowpass',760,.17,{sweep:130,send:.1});              // 蓄力的低频轰
    tone(72,.34,'triangle',.15,pnote(-2),{cut:600});               // 亚低频下坠
    noise(.07,'bandpass',2600,.14,{q:.9});                         // 金属撞击头
    tone(pnote(7),.2,'square',.07,pnote(12),{cut:3400});           // 撞击体的滑音
    arp([pnote(12),pnote(16),pnote(19),pnote(21)],.062,.42,'triangle',.1,{send:.3});
    noise(.26,'highpass',6500,.04,{delay:.24,send:.2});            // 高频闪粉
  },
  /* 连击里程碑：清脆的上行三连 + 闪粉 */
  combo(){ const b=Math.min(Math.floor(combo()/5),3);
    arp([pnote(14+b),pnote(16+b),pnote(19+b)],.06,.14,'triangle',.11);
    noise(.14,'highpass',5200,.05,{delay:.1}) },
  /* 敌人出场：低沉锯齿 growl；首领更长更沉 */
  enemy(big){
    const d=big?.7:.42, v=big?.15:.11;
    noise(d,'lowpass',big?420:700,.11,{sweep:180});
    tone(pnote(big?-1:0),d,'sawtooth',v,pnote(big?-3:-2),{cut:600});
    tone(pnote(big?0:2),d*.9,'sawtooth',v*.7,pnote(big?-2:0),{cut:520});
  },
  /* 地图节点可选：极轻的呼吸提示（软起音，不吵） */
  node(){
    tone(pnote(7),.34,'triangle',.045,null,{atk:.09,send:.2});
    tone(pnote(10),.4,'triangle',.04,null,{atk:.12,delay:.14,send:.24});
  },
  /* 遗物：比金币更有分量 —— 低频落点 + 三音上行 + 混响尾 */
  relic(){
    tone(pnote(0),.3,'triangle',.11);
    arp([pnote(7),pnote(10),pnote(12)],.075,.4,'triangle',.1,{send:.26});
    noise(.22,'highpass',4800,.04);
  },
  /* 通关：爆炸 + 五声音阶上行跑动 + 和弦收尾 */
  win(){
    noise(.5,'lowpass',1400,.17,{sweep:200});
    tone(110,.4,'triangle',.15,55);
    arp([pnote(10),pnote(12),pnote(14),pnote(16),pnote(17),pnote(19)],.075,.3,'triangle',.13,{send:.22});
    arp([pnote(14),pnote(17),pnote(19),pnote(22)],.09,.7,'triangle',.1,{delay:.42,send:.34});
  },
  /* 失败：锯齿下行 + 噪声下坠 */
  lose(){
    noise(.6,'lowpass',900,.12,{sweep:120});
    arp([pnote(10),pnote(8),pnote(7),pnote(4),pnote(2)],.12,.34,'sawtooth',.11,{cut:900,send:.24});
    tone(pnote(0),.8,'triangle',.12,null,{delay:.5});
  },
  /* 玩家受伤：比 bad() 更沉，闷响 + 下滑 */
  hurt(){ noise(.16,'lowpass',420,.15,{sweep:150}); tone(pnote(1),.22,'square',.1,pnote(-1),{cut:900}) },
  undo(){ tone(pnote(12),.07,'triangle',.06,pnote(10)) },
  hint(){ arp([pnote(12),pnote(14),pnote(16)],.05,.16,'triangle',.08,{send:.18}) },
  flee(){ arp([pnote(9),pnote(7)],.09,.2,'triangle',.08); noise(.18,'bandpass',700,.05) },
  /* 道具：按 id 给不同「手感」 */
  item(id){
    switch(id){
      case 'leech':                                    // 吸血：上滑的「嘶」
        noise(.3,'bandpass',420,.09,{sweep:1800,q:.9});
        tone(pnote(7),.28,'triangle',.07,pnote(10));
        break;
      case 'rage':                                     // 爆发：低频轰
        noise(.45,'lowpass',800,.17,{sweep:110});
        tone(pnote(3),.45,'sawtooth',.14,pnote(0),{cut:700});
        tone(70,.35,'triangle',.13);
        break;
      case 'freeze':                                   // 冰冻：清脆的「叮」
        tone(pnote(19),.6,'triangle',.12,null,{send:.36});
        tone(pnote(21),.45,'sine',.05,null,{delay:.04,send:.3});
        noise(.4,'highpass',6000,.05);
        break;
      case 'chain':                                    // 闪电：窄带电弧
        noise(.16,'bandpass',2600,.09,{sweep:700,q:7});
        arp([pnote(16),pnote(19)],.04,.08,'square',.07);
        break;
      case 'reveal':                                   // 透视：微光闪烁
        arp([pnote(14),pnote(16),pnote(17)],.045,.2,'triangle',.07,{send:.2});
        break;
      case 'purge':                                    // 扫除：宽频一扫
        noise(.34,'bandpass',2600,.08,{sweep:280,q:.6});
        break;
      case 'greed': sfx.coin(); break;
      case 'stone':                                    // 护盾：石头闷响
        noise(.2,'lowpass',600,.15,{sweep:200});
        tone(pnote(0),.22,'triangle',.12);
        break;
      default: sfx.coin();
    }
  },
  /* UI：点击 / 悬停 */
  ui(){ noise(.022,'bandpass',2400,.05,{q:1.2}); tone(pnote(14),.04,'triangle',.055) },
  hover(){
    const a=AU.ctx(); if(a&&a.currentTime-AU.lastHover<.045) return;
    AU.lastHover=a?a.currentTime:0;
    tone(pnote(17),.028,'triangle',.028);
  }
};
return { AU, sfx, tone, noise, arp, pnote, audioUnlock };
}
