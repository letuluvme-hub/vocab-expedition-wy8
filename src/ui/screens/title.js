/* 标题页：角色卡片 + 单元列表 + 统计 + 纪念卡收藏。
 * 状态一律走 getter 快照（getDB / getUnit），本模块不读也不写任何全局。
 * 变更（选角色 / 选单元）通过 onHero / onUnit 回调交回父层，本模块只负责画。
 */
import { HEROES } from '../../data/heroes.js';
import { UNITS } from '../../data/units.js';
import { HERO_DEFAULT, heroById, pcHTML, heroStatLines } from '../components/hero.js';
import { renderRewardCard } from '../components/reward-card.js';

export function createTitleScreen({ getDB, getUnit, allWords, getCampaign, onHero, onUnit }) {
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
    const sel = heroById(getDB().hero || HERO_DEFAULT).id;
    box.innerHTML = '';
    HEROES.forEach(H => {
      const b = document.createElement('button');
      b.className = 'hcard' + (H.id === sel ? ' sel' : '');
      b.type = 'button';
      b.setAttribute('aria-pressed', H.id === sel ? 'true' : 'false');
      b.innerHTML = pcHTML(H.id) + '<b>' + H.n + '</b><span class="hs">' + heroStatLines(H).join('<br>') + '</span>';
      b.onclick = () => { onHero(H.id); renderHeroes() };
      box.appendChild(b);
    });
    const cur = heroById(sel);
    const d = $('heroDesc');
    if (d) d.innerHTML = '<b>' + cur.n + '</b> · <i>' + cur.tag + '</i><br>' + cur.d;
  }

  function renderTitle() {
    renderHeroes();
    const DB = getDB();
    const box = $('units'); box.innerHTML = '';
    const curUnit = getUnit();
    UNITS.forEach(u => {
      const ws = allWords(u.n);
      const b = document.createElement('button');
      const open = unlocked(u.n);
      b.className = 'unit' + (curUnit === u.n ? ' sel' : '') + (open ? '' : ' locked');
      // ★ data-unit 是给「严格定位」用的：按文本 'Unit 2 ' 找按钮会同时命中
      //   「完成 Unit 2 全部词汇后解锁」这类说明文案（那正是之前把单元号藏起来的
      //   原因 —— 靠躲测试而不是靠结构，迟早又会被别的文本命中）。
      //   单元名与编号照常可见，脚本改用 data-unit / <b> 定位。
      b.setAttribute('data-unit', String(u.n));
      // 进度口径统一来自 campaign（同一份 dictationMastered + 同一份 trim+lower 身份），
      // 所以主页说的「已掌握 12/45」与解锁判据永远不会是两套算法。
      const c = counts(u.n);
      const m = c ? c.done : (DB.dictationMastered || []).filter(w => ws.some(x => x.w === w)).length;
      const total = c ? c.total : ws.length;
      const head = '<b>' + u.t + '</b><span>' + ws.length + ' 词' + (ws.length ? '' : '（空）') + '</span>';
      if (!open) {
        const need = u.n - 1;
        b.innerHTML = head + '<em>🔒 完成 Unit ' + need + ' 全部词汇后解锁</em>';
        b.title = '完成 Unit ' + need + ' 的全部词汇后解锁这个单元；已解锁的单元随时可以复习';
        b.disabled = true;
        // ★ 锁定单元**不挂 onclick**：不是 disabled 还能点，而是一下都点不动。
        //   真正的闸门仍在 runtime.startRunFromUi（防止绕过 UI 直接开跑）。
        b.onclick = null;
      } else {
        b.innerHTML = head + (ws.length ? '<em>' + unitProgressLine({ c, done: m, total }) + '</em>' : '');
        b.title = '';
        b.disabled = false;
        b.onclick = () => { onUnit(u.n); renderTitle() };
      }
      box.appendChild(b);
    });
    $('sRun').textContent = DB.runs;
    $('sWin').textContent = DB.wins;
    $('sMaster').textContent = (DB.dictationMastered || []).length;
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

/* 进度只反映当前正式默写证据；旧远征完成凭据不授予解锁。 */
function unitProgressLine({ done, total }) {
  if (!done) return '未开始';
  if (total > 0 && done >= total) return '已完成 ' + done + '/' + total;
  return '已掌握 ' + done + '/' + total;
}
