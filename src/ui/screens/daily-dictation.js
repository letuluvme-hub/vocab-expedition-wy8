import { createDictationKeyboard } from '../components/dictation-keyboard.js';
import { pixelMonsterSVG } from '../components/pixel-art.js';
import { ENEMIES, BOSS } from '../../data/enemies.js';
import '../../styles/home-atlas.css';

export function createDailyDictationScreen({ controller, show, onHome, onEnter = () => {}, document: doc = globalThis.document, confirm = globalThis.confirm } = {}) {
  const el = (tag, cls, text, id) => { const n = doc.createElement(tag); if(cls)n.className=cls; if(text !== undefined)n.textContent=text; if(id)n.id=id; return n; };
  const button = (text, id, action, secondary = false) => { const b=el('button','daily-button'+(secondary?' secondary':''),text,id); b.type='button'; b.onclick=action; return b; };
  const screen = el('section','screen daily-dictation daily-screen',undefined,'s-daily');
  doc.getElementById('app').appendChild(screen);
  const entry = el('details','daily-dictation daily-entry home-practice',undefined,'dailyEntry');
  const entrySummary = el('summary','home-practice-summary','练习与收藏');
  const title = doc.getElementById('s-title'); title.append(entry);
  const atlasHost = el('div','',undefined,'dailyAtlasHost');
  title.insertBefore(atlasHost,doc.getElementById('keyboardTipHost')||title.querySelector('.lbl'));
  const keyboard = createDictationKeyboard({ document: doc, onInput: key => controller.input(key) });
  let hintAnswer = '', selectionUnit = '1';
  const state = () => controller.state();
  const active = () => screen.classList.contains('on');
  function home() { if(state() && state().phase !== 'completed')controller.pause('home'); keyboard.destroy(); onHome(); }
  function open() { onEnter(); show('s-daily'); if(state()?.phase === 'completed')renderSelection(); else if(state())render(); else renderSelection(); }
  function paintEntry() {
    const extraHosts = ['dailyCollectionHost','dailyHomeReport'].map(id => entry.querySelector('#'+id) || el('div','',undefined,id));
    entry.replaceChildren(entrySummary,el('p','daily-note','按需练习，伙伴、收藏和学习记录都在这里。'));
    const s=state();
    entry.append(button(s&&s.phase!=='completed'?'继续练习':'开始练习','dailyOpen',open));
    if(s?.phase==='completed')entry.append(el('p','daily-note',`本次完成 ${controller.summary().completed} / ${s.words.length} 词 · 学习记录已保留`));
    // Keep mounted report/collection nodes and the native details open state on repaint.
    for(const host of extraHosts) entry.append(host);
  }
  function header(label) {
    screen.replaceChildren(); keyboard.destroy();
    const row=el('div','daily-header');row.append(el('h2','daily-heading',label,'dailyStage'),button('主页','dailyHome',home,true));screen.append(row);
    if(controller.saved()===false)screen.append(el('p','daily-warning','本次进度没能保存，刷新会丢失。继续练习仍然有效。','dailySaveWarning'));
  }
  function renderSelection() {
    header('选择今日词表');
    screen.append(el('p','daily-note','选学校今天要默写的单元，也可以粘贴词表。每次最多 16 词；余下词会留到后续练习。'));
    const label=el('label','daily-label','教材单元');label.htmlFor='dailyUnit';
    const select=el('select','daily-select',undefined,'dailyUnit');
    for(const n of [1,2,3,4,5,6,0]) { const o=el('option','',n?`Unit ${n}`:'我粘贴的词表');o.value=String(n);select.append(o); }
    select.value=selectionUnit;select.onchange=()=>{selectionUnit=select.value;};screen.append(label,select);
    const customLabel=el('label','daily-label','当日默写词表（每行：英文 中文）');customLabel.htmlFor='dailyCustomText';
    const text=el('textarea','daily-text',undefined,'dailyCustomText');text.rows=4;text.placeholder='cat 猫\nlook after 照顾';
    // The reusable parser's saved custom list is read via an explicit controller getter.
    text.value=controller.customWords().map(w=>w.w+' '+w.z).join('\n');
    const message=el('p','daily-note','','dailyImportMessage');
    screen.append(customLabel,text,button('保存并使用这份词表','dailyImport',()=>{
      const result=controller.importWords(text.value);
      message.textContent=result.words.length?`已保存 ${result.words.length} 词${result.bad?`；${result.bad} 行格式未识别，请检查` : ''}`:'没有识别出词，请按“英文 中文”逐行填写';
      if(result.words.length){selectionUnit='0';select.value='0';}
      if(controller.saved()===false)message.textContent+='；本机保存失败，刷新会丢失';
    },true),message);
    if(controller.invalid())screen.append(el('p','daily-warning','旧每日进度无法恢复，原存档仍然保留。'),button('丢弃无法恢复的每日进度','dailyDiscard',()=>{if(confirm('只丢弃无法恢复的每日进度？已学词、自由远征与收藏都会保留。')){controller.discard();renderSelection();}},true));
    else screen.append(button('开始热身','dailyStart',()=>{if(controller.start({unit:Number(select.value)}))render();else message.textContent='没有可练习的词，请先保存词表';}));
  }
  function render() {
    if(!active()){paintEntry();return;}
    const s=state();if(!s){renderSelection();return;}
    hintAnswer='';
    if(s.phase==='completed') { renderCompleted(); paintEntry(); return; }
    if(s.paused) {
      header(s.pauseReason==='time-budget'?'今天先到这里':'每日默写已暂停');
      screen.append(el('p','daily-note',s.pauseReason==='time-budget'?'已练习约 15 分钟。结束本次，已完成的词照常保留；未完成词留到后续练习。':'已完成和当前拼写都保留。继续时接着练，停留在这里不会计时。'));
      if(s.pauseReason!=='time-budget')screen.append(button('继续练习','dailyResume',()=>controller.resume()));
      screen.append(button('结束本次','dailyFinish',()=>controller.finish(),true));return;
    }
    if(s.phase==='formal-ready') {
      header('准备正式默写');
      screen.append(el('p','daily-note',`已热身 ${s.warmupDone.length} 词。热身只记练习，不记掌握。接下来只有中文释义，用完整键盘默写。`),button('开始正式默写','dailyFormal',()=>controller.beginFormal()));return;
    }
    header(s.phase==='warmup'?'热身':'正式默写');
    const summary=controller.summary(), word=s.words[s.index];
    screen.append(el('p','daily-note',`第 ${s.index+1} / ${s.words.length} 词 · 已练习 ${Math.floor(summary.elapsedMs/60000)} 分钟`, 'dailyProgress'));
    if(s.remaining)screen.append(el('p','daily-note',`今日选 ${s.words.length} 词；余下 ${s.remaining} 词保留到后续练习`,'dailySelectionInfo'));
    if(s.phase==='formal') {
      const encounter=s.encounters.find(e=>s.index>=e.start&&s.index<e.end);
      const panel=el('div','daily-encounter');
      const sprite=el('div','daily-monster');sprite.innerHTML=pixelMonsterSVG(encounter.boss?BOSS:ENEMIES[encounter.index%ENEMIES.length],encounter.boss,false,{anim:false});
      panel.append(sprite,el('p','daily-note',`${encounter.boss?'首领':'战斗 '+(encounter.index+1)} · ${s.encounters.length} 场中的第 ${encounter.index+1} 场。练完本组词即可前进，无限时攻击；拼错不扣血。`,'dailyEncounter'));screen.append(panel);
    } else screen.append(el('p','daily-note','从字母盘选字母热身，每个词练一次。'));
    screen.append(el('p','daily-prompt',word.z,'dailyPrompt'));
    const input=el('p','daily-input',s.attempt.input||'…','dailyInput');input.setAttribute('aria-live','polite');input.setAttribute('aria-label','当前拼写');screen.append(input);
    const feedback=el('p','daily-feedback',s.attempt.feedback,'dailyFeedback');feedback.setAttribute('aria-live','polite');screen.append(feedback);
    if(s.attempt.completed) {
      screen.append(el('p','daily-note',s.phase==='warmup'?'热身完成':s.results.at(-1)?.eligible?'一次拼对，已记入默写掌握':'已完成，留到后续复习'),button('下一个','dailyNext',()=>controller.next()));
    } else if(s.phase==='formal') {
      const keys=el('div','',undefined,'dailyKeys');screen.append(keys);keyboard.render(keys,word);
      const hint=el('p','daily-note','','dailyHintAnswer');hint.setAttribute('aria-live','polite');
      screen.append(button('提示下一个字母（本词会进入复习）','dailyHint',()=>{const ch=controller.hint();if(ch!==false){hintAnswer=ch.toUpperCase();doc.getElementById('dailyHintAnswer').textContent='提示：'+hintAnswer;}},true),hint);
      if(s.attempt.errors || s.attempt.hints || s.attempt.reveals)screen.append(button('留到复习，下一词','dailyDefer',()=>controller.defer(),true),el('p','daily-note','本词尚未拼完，保留错误记录。已拼对的词照常保留，按复习计划再练。'));
    } else {
      const bank=controller.letters(),keys=el('div','daily-bank',undefined,'dailyWarmupKeys');
      bank.letters.forEach((ch,i)=>{const b=button(ch.toUpperCase(),undefined,()=>controller.input(ch),true);b.disabled=bank.used[i];b.dataset.key=ch;keys.append(b);});screen.append(keys);
      screen.append(button('退格','dailyUndo',()=>controller.input('Backspace'),true));
    }
    screen.append(button('暂停 / 保存','dailyPause',()=>controller.pause(),true));
  }
  function renderCompleted() {
    header('今日完成'); const s=state(),summary=controller.summary();
    const result=el('div','daily-summary',undefined,'dailySummary');
    result.append(el('p','',`正式完成 ${summary.completed} / ${summary.planned} 词`),el('p','',`留到复习 ${summary.deferred} 词（未拼完）`),el('p','',`一次拼对 ${summary.firstTry} / ${summary.assessed}${summary.assessed?`（${Math.round(summary.firstTry/summary.assessed*100)}%）`:''}`),el('p','daily-note','正确率包含正式拼完的词，以及已经出错或使用帮助的未完成尝试；热身不计。'),el('p','',`热身 ${summary.warmup} 词 · 练习 ${Math.floor(summary.elapsedMs/60000)} 分 ${Math.floor(summary.elapsedMs/1000)%60} 秒`));
    if(summary.reason!=='pool-exhausted')result.append(el('p','daily-note',`本次结束，${summary.planned-summary.completed} 个未完成词留到后续练习。`));
    screen.append(result,el('h3','daily-heading','待复习词'));
    const wrong=el('ul','daily-wrong',undefined,'dailyWrong');if(!summary.wrong.length)wrong.append(el('li','','本次没有错词'));
    for(const w of summary.wrong)wrong.append(el('li','',w.w+' · '+w.z));screen.append(wrong,button('收好记录，回主页','dailyDoneHome',home));
    const extra=el('div','',undefined,'dailyCompletionExtra');screen.append(extra);
  }
  function handleKey(event) {
    if(!active()||!state()||state().paused||state().phase==='completed')return false;
    if(state().phase==='formal')return keyboard.handleKey(event);
    if(state().phase!=='warmup'||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||/^(INPUT|TEXTAREA|SELECT)$/i.test(event.target?.tagName)||event.target?.isContentEditable)return false;
    const key=event.key==='Backspace'?event.key:String(event.key||'').toLowerCase();
    if(key!=='Backspace'&&!/^[a-z]$/.test(key))return false;
    event.preventDefault();return controller.input(key);
  }
  function updateTime() {
    if(!active()||!state()||state().paused||state().phase==='completed')return;
    if(controller.checkTime())return;
    const progress=doc.getElementById('dailyProgress');if(progress)progress.textContent=`第 ${state().index+1} / ${state().words.length} 词 · 已练习 ${Math.floor(controller.summary().elapsedMs/60000)} 分钟`;
  }
  return { paintEntry, open, render, handleKey, updateTime, active };
}
