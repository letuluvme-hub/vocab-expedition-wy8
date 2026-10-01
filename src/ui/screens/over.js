/* 结算页：只绘制当前 run.reward 这张纪念卡 + 本局统计。
 * 记录逻辑（写入 DB.rewards / DB.best / run.result）由父层负责 ——
 * 纯绘制函数绝不替父层落库，避免「画一次就存一次」的双写。
 * show(id) 与 onTitle() 是回调：切屏与标题页重绘都归父层编排。
 */
import { UNITS } from '../../data/units.js';
import { RELICS } from '../../data/relics.js';
import { clamp } from '../../domain/math.js';
import { rewardScope, renderRewardCard } from '../components/reward-card.js';

const relicById = id => RELICS.filter(r => r.id === id)[0];

export function renderOver({ run, db, win, onTitle, show }) {
  const $ = id => document.getElementById(id);
  const G = run;
  const acc = clamp(Math.round(G.attOk / Math.max(1, G.att) * 100), 0, 100);

  const rewardBox = $('oReward'); rewardBox.innerHTML = ''; rewardBox.hidden = !win;
  if (win && G.reward) renderRewardCard(rewardBox, G.reward);

  $('oAgain').textContent = win ? (G.unit === 0 ? '复习自定义词表' : '复习本单元') : '再来一次';
  const next = UNITS.find(u => G.unit > 0 && u.n === G.unit + 1);
  $('oNext').hidden = !win || !next;
  $('oNext').textContent = next ? '继续 Unit ' + next.n : '继续下一 Unit';
  $('oIcon').textContent = win ? '🏆' : '💀';
  $('oTitle').textContent = win ? '远征成功！' : '远征结束';
  $('oText').textContent = win
    ? '你击败了词汇之王，完成了' + rewardScope(G.unit) + '的本次远征！' +
      (G.unit > 0 && !next ? '已到本册最后一个单元，可复习本单元或返回选择单元。' : '')
    : '你倒在了第 ' + G.floor + ' 层。那些还没记住的词，还在等着你。';
  $('oFloor').textContent = G.maxFloor;
  $('oKill').textContent = G.kills;
  $('oAcc').textContent = acc + '%';
  const rb = $('oRelics'); rb.innerHTML = '';
  if (!G.relics.length) rb.innerHTML = '<span style="font-size:12px;color:var(--dim)">这次没有获得遗物</span>';
  G.relics.forEach(id => { const r = relicById(id); if (!r) return;
    const d = document.createElement('div'); d.className = 'relic'; d.textContent = r.ic; d.title = r.n; rb.appendChild(d); });
  show('s-over');
  onTitle();
}