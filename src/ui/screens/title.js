/* 标题页：角色卡片 + 单元列表 + 统计 + 纪念卡收藏。
 * 状态一律走 getter 快照（getDB / getUnit），本模块不读也不写任何全局。
 * 变更（选角色 / 选单元）通过 onHero / onUnit 回调交回父层，本模块只负责画。
 */
import { HEROES } from '../../data/heroes.js';
import {BOOKS,bookById,bookUnits,DEFAULT_BOOK_ID} from '../../data/books.js';
import { HERO_DEFAULT, heroById, pcHTML, heroStatLines } from '../components/hero.js';
import { renderRewardCard } from '../components/reward-card.js';
import { canonicalMasteryKeys } from '../../domain/mastery-growth.js';
import { HERO_LORE } from '../../data/story.js';

export function createTitleScreen({ getDB, getUnit, allWords, getCampaign, onHero, onUnit,
  getBook=()=>DEFAULT_BOOK_ID, onBook, getHeroUnlock, onStory }) {
  const $ = id => document.getElementById(id);

  /* 单元解锁（docs/feature-campaign.md）。getCampaign 不注入时**退回旧行为**：
   * 全部单元可点。这不是 UI 层的礼貌，而是为了旧接线/旧测试台不被这次改动悄悄破坏 ——
   * 真正的闸门在 runtime 的 startRunFromUi（见 domain/campaign 的 canSelectUnit）。
   * 锁定单元仍然**画出来**并写清解锁条件：隐藏会让玩家以为游戏坏了。 */
  const campaign = () => (getCampaign ? getCampaign() : null);
  const unlocked = n => { const c = campaign(); return !c || c.isUnlocked(n); };
  const counts = n => { const c = campaign(); return c && c.counts ? c.counts(n) : null; };

  function renderHeroes() {
    const box = $('heroes'); if (!box) return;
    const roleState=id=>getHeroUnlock?getHeroUnlock(id):{unlocked:true,requirements:[]};
    const chosen=heroById(getDB().hero||HERO_DEFAULT).id;
    const sel=roleState(chosen).unlocked?chosen:HERO_DEFAULT;
    box.innerHTML = '';
    HEROES.forEach(H => {
      const b = document.createElement('button');
      b.className = 'hcard' + (H.id === sel ? ' sel' : '');
      const unlock=roleState(H.id);
      b.setAttribute('data-hero',H.id);
      b.type = 'button';
      b.setAttribute('aria-pressed', H.id === sel ? 'true' : 'false');
      b.innerHTML = pcHTML(H.id) + '<b>' + H.n + '</b><span class="hs">' + heroStatLines(H).join('<br>') + '</span>';
      const status=document.createElement('span');status.className='heroUnlock';
      status.textContent=H.id==='scholar'?'初始角色 · 开荒推荐':unlock.unlocked?'已解锁':unlock.requirements.map(r=>r.label+' '+Math.min(r.current,r.target)+'/'+r.target).join(' · ');
      b.appendChild(status);if(!unlock.unlocked)b.className+=' heroLocked';b.disabled=!unlock.unlocked;
      b.title=H.d+(unlock.unlocked?'':'\n解锁条件：'+status.textContent);
      if(unlock.unlocked)b.onclick = () => { onHero(H.id); renderHeroes() };
      box.appendChild(b);
    });
    const cur = heroById(sel);
    const d = $('heroDesc');
    if (d) d.innerHTML = '<b>' + cur.n + '</b> · <i>' + cur.tag + '</i><br>' + cur.d;
    // 「查看档案」跳到远征故事屏里这位角色的档案（没接线的旧测试台不画这个按钮）。
    if (d && onStory && HERO_LORE[cur.id]) {
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'btn g'; open.id = 'heroStory';
      open.textContent = '📖 ' + HERO_LORE[cur.id].name + ' 的档案';
      open.onclick = () => onStory(cur.id);
      d.appendChild(document.createElement('br'));
      d.appendChild(open);
    }
  }

  function renderTitle() {
    renderHeroes();
    const DB = getDB();
    const book=bookById(getBook()), units=bookUnits(book.id);
    const host=$('textbookPicker');
    if(host){
      host.replaceChildren();
      const label=document.createElement('label');label.htmlFor='textbookSelect';label.textContent='教材册';
      const select=document.createElement('select');select.id='textbookSelect';select.setAttribute('aria-label','选择教材册');
      for(const b of BOOKS){const option=document.createElement('option');option.value=b.id;option.textContent=b.label+' · '+b.words.length+' 词';select.appendChild(option)}
      select.value=book.id;select.onchange=()=>{onBook?.(select.value);renderTitle()};host.appendChild(label);host.appendChild(select);
    }
    document.title=book.pageTitle||('词汇远征 · '+book.label);
    const sub=$('s-title')?.querySelector?.('.sub');if(sub)sub.textContent='看中文，拼英文，让你的角色出招打怪。';
    const box = $('units'); box.innerHTML = '';
    const curUnit = getUnit();
    units.forEach(u => {
      const ws = allWords(u.n);
      const b = document.createElement('button');
      const open = unlocked(u.n);
      b.className = 'unit' + (curUnit === u.n ? ' sel' : '') + (open ? '' : ' locked');
      // ★ data-unit 是给「严格定位」用的：按文本 'Unit 2 ' 找按钮会同时命中
      //   「完成 Unit 2 全部词汇后解锁」这类说明文案（那正是之前把单元号藏起来的
      //   原因 —— 靠躲测试而不是靠结构，迟早又会被别的文本命中）。
      //   单元名与编号照常可见，脚本改用 data-unit / <b> 定位。
      b.setAttribute('data-unit', String(u.n));
      // 「学会」按统一口径现算：正式默写掌握 + 远征整词拼对 + 预习不看提示拼对，
      // trim+lower 身份去重；不把任何展示计数写回存档或解锁规则。
      const c = counts(u.n);
      const m = canonicalMasteryKeys([...(Array.isArray(DB.dictationMastered) ? DB.dictationMastered : []), ...(Array.isArray(DB.mastered) ? DB.mastered : [])], ws).length;
      const expedition = canonicalMasteryKeys(DB.mastered, ws).length;
      const total = ws.length;
      const head = '<b>' + u.t + '</b><span>' + ws.length + ' 词' + (ws.length ? '' : '（空）') + '</span>';
      const progress = ws.length ? '<em>' + unitProgressLine({ c, done: m, total, expedition }) + '</em>' : '';
      if (!open) {
        const need = u.n - 1;
        b.innerHTML = head + (expedition > 0 ? progress : '') + '<em>🔒 完成 Unit ' + need + ' 全部词汇后解锁</em>';
        b.title = '完成 Unit ' + need + ' 的全部词汇后解锁这个单元；已解锁的单元随时可以复习';
        b.disabled = true;
        // ★ 锁定单元**不挂 onclick**：不是 disabled 还能点，而是一下都点不动。
        //   真正的闸门仍在 runtime.startRunFromUi（防止绕过 UI 直接开跑）。
        b.onclick = null;
      } else {
        b.innerHTML = head + progress;
        b.title = '';
        b.disabled = false;
        b.onclick = () => { onUnit(u.n); renderTitle() };
      }
      box.appendChild(b);
    });
    $('sRun').textContent = DB.runs;
    $('sWin').textContent = DB.wins;
    const expeditionStat = $('sExpedition');
    if (expeditionStat) {
      const textbook = units.filter(u => u.n > 0).flatMap(u => allWords(u.n));
      expeditionStat.textContent = canonicalMasteryKeys(DB.mastered, textbook).length;
    }
    // 「学会」统计：正式默写掌握 + 远征整词拼对 + 预习不看提示拼对，只数教材词、去重。
    const allTextbook = BOOKS.flatMap(b => b.words);
    $('sMaster').textContent = canonicalMasteryKeys([...(Array.isArray(DB.dictationMastered) ? DB.dictationMastered : []), ...(Array.isArray(DB.mastered) ? DB.mastered : [])], allTextbook).length;
    const masterLabel = $('sMaster').nextElementSibling; if (masterLabel) masterLabel.textContent = '学会单词';
    $('sFloor').textContent = DB.best;
    $('rewardSummary').textContent = '通关纪念卡 · ' + DB.rewards.length + ' 张（点击查看）';
    const cards = $('rewardCards'); cards.innerHTML = '';
    if (!DB.rewards.length) {
      const empty = document.createElement('p'); empty.className = 'note'; empty.textContent = '击败最终 BOSS 后，纪念卡会收藏在这里。'; cards.appendChild(empty);
    }
    DB.rewards.slice().reverse().forEach(r => {
      const slot = document.createElement('div'); renderRewardCard(slot, r); cards.appendChild(slot);
    });
  }

  return { renderHeroes, renderTitle };
}

/* 部分远征进度也有明确读数；只有旧凭据而无逐词记录时保留已有完成说明。 */
function unitProgressLine({ c, done, total }) {
  if (c && c.passed && done < total) return '远征已通关 · 学会 ' + done + '/' + total;
  if (!done) return '未开始';
  return '学会 ' + done + '/' + total;
}
