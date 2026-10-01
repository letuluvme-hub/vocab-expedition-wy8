/* 标题页：角色卡片 + 单元列表 + 统计 + 纪念卡收藏。
 * 状态一律走 getter 快照（getDB / getUnit），本模块不读也不写任何全局。
 * 变更（选角色 / 选单元）通过 onHero / onUnit 回调交回父层，本模块只负责画。
 */
import { HEROES } from '../../data/heroes.js';
import { UNITS } from '../../data/units.js';
import { HERO_DEFAULT, heroById, pcHTML, heroStatLines } from '../components/hero.js';
import { renderRewardCard } from '../components/reward-card.js';

export function createTitleScreen({ getDB, getUnit, allWords, onHero, onUnit }) {
  const $ = id => document.getElementById(id);

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
      b.className = 'unit' + (curUnit === u.n ? ' sel' : '');
      const m = DB.mastered.filter(w => ws.some(x => x.w === w)).length;
      b.innerHTML = '<b>' + u.t + '</b><span>' + ws.length + ' 词' + (ws.length ? '' : '（空）') + '</span>' +
        (ws.length ? '<em>' + (m ? ('已掌握 ' + m + '/' + ws.length) : '未开始') + '</em>' : '');
      b.onclick = () => { onUnit(u.n); renderTitle() };
      box.appendChild(b);
    });
    $('sRun').textContent = DB.runs;
    $('sWin').textContent = DB.wins;
    $('sMaster').textContent = DB.mastered.length;
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