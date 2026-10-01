/* 通关纪念卡：只记录本次远征表现，不代表掌握所选范围的全部词汇。
 * 标题页的收藏列表和结算页共用这一份渲染，保证文案与层级只有一处来源。
 */
import { UNITS } from '../../data/units.js';
import { heroById } from './hero.js';

export function rewardScope(unit) {
  const u = UNITS.find(x => x.n === unit);
  return u ? u.t : (unit === -1 ? '全册' : '所选范围');
}

export function renderRewardCard(box, r) {
  box.innerHTML = '';
  const card = document.createElement('article'); card.className = 'reward-card';
  const title = document.createElement('h3'); title.textContent = '词王征服者 · 通关纪念卡'; card.appendChild(title);
  const scope = document.createElement('p'); scope.textContent = rewardScope(r.unit) + ' · ' + heroById(r.heroId).n; card.appendChild(scope);
  const stats = document.createElement('p'); stats.textContent = '拼写正确率 ' + r.accuracy + '% · 击败词灵 ' + r.kills + ' · 到达 ' + r.floor + ' 层'; card.appendChild(stats);
  const note = document.createElement('small'); note.textContent = '击败最终 BOSS 的纪念，不代表已掌握全部词汇。'; card.appendChild(note);
  const stamp = document.createElement('small'); stamp.textContent = '获得于 ' + new Date(r.earnedAt).toLocaleString('zh-CN') + ' · 卡片 ' + r.id; card.appendChild(stamp);
  box.appendChild(card);
}