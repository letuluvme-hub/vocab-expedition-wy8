/* 结算页：只绘制当前 run.reward 这张纪念卡 + 本局统计。
 * 记录逻辑（写入 DB.rewards / DB.best / run.result）由父层负责 ——
 * 纯绘制函数绝不替父层落库，避免「画一次就存一次」的双写。
 * show(id) 与 onTitle() 是回调：切屏与标题页重绘都归父层编排。
 */
import { UNITS } from '../../data/units.js';
import { RELICS } from '../../data/relics.js';
import { clamp } from '../../domain/math.js';
import { rewardScope, rewardRoundLine, renderRewardCard } from '../components/reward-card.js';

const relicById = id => RELICS.filter(r => r.id === id)[0];

export function renderOver({ run, db, win, campaign, onTitle, show,
  onNextUnit, onContinueUnit, onAgain, onHome }) {
  const $ = id => document.getElementById(id);
  const G = run;
  const acc = clamp(Math.round(G.attOk / Math.max(1, G.att) * 100), 0, 100);

  const rewardBox = $('oReward'); rewardBox.innerHTML = ''; rewardBox.hidden = !win;
  if (win && G.reward) renderRewardCard(rewardBox, G.reward);

  /* BOSS 胜利与「本单元词汇完成」是两个独立事实（docs/feature-campaign.md）：
   *   词汇完成 → 可以进入下一个单元（携带现有物资，同一轮学习）。
   *   词汇没完成 → **绝不许**提前解锁，但也不能把玩家卡住：
   *               给「继续本单元词汇」入口，用新一段学习地图继续抽未完成的词。
   *   战败 → 两种入口都不给（逃跑/战败不推进学习主线）。 */
  // 没有 campaign 视图（旧的接线/测试台）就**没有解锁依据**：这时退回旧行为，
  // 绝不凭空显示一个「继续 Unit N+1」。真实运行期 runtime 一定传 campaign。
  const uc = campaign && campaign.counts ? campaign.counts(G.unit) : null;
  const unitComplete = !!(uc && uc.complete);
  // ★ 自定义单元没有「下一单元」，但**可以有**「继续本单元词汇」：打完 BOSS、
  //   自己词表里还有词没练完时，玩家照样需要一条不卡死的续练入口。
  //   next() 对单元 0 会返回教材里的 Unit 2，所以这里自己把 custom 挡掉。
  const custom = G.unit === 0;
  const nextUnit = custom ? null : (campaign && campaign.next ? campaign.next(G.unit) : null);
  const lastByCatalog = !nextUnit && !custom && G.unit > 0;
  const nextOpen = win && unitComplete && nextUnit != null && campaign.isUnlocked(nextUnit);
  const continueOpen = win && !!uc && !unitComplete && (uc.total > 0 || custom);
  const bookLast = win && unitComplete && lastByCatalog;

  const again = $('oAgain');
  again.textContent = win ? (G.unit === 0 ? '复习自定义词表' : '复习本单元') : '再来一次';
  // 「复习」永远是**新开一轮**去重练，不是「继续」。把两个语义混在一起会让玩家
  // 以为复习能顺带推进单元。
  again.onclick = onAgain ? () => { onAgain(); } : null;
  const home = $('oHome');
  if (home) home.onclick = onHome ? () => { onHome(); } : () => { onTitle(); show('s-title'); };

  const next = $('oNext');
  if (nextOpen) {
    next.hidden = false;
    next.textContent = '继续 Unit ' + nextUnit;
    next.title = '带着当前的金币、道具和遗物进入 Unit ' + nextUnit + '（同一轮学习，不算新开一次远征）';
    next.onclick = onNextUnit ? () => { onNextUnit(); } : null;
  } else if (continueOpen) {
    const left = uc && uc.remaining ? uc.remaining : 0;
    next.hidden = false;
    next.textContent = '继续本单元词汇';
    next.title = '本单元还有 ' + left + ' 个词没完成。点它会在同一轮学习里换一段地图继续练；'
      + '金币、道具、遗物都保留，也不算新开一次远征。';
    next.onclick = onContinueUnit ? () => { onContinueUnit(); } : null;
  } else {
    // 隐藏时仍保留旧标签，保证与旧版逐元素比对（legacy parity）逐字一致；
    // 它永远不会可见，也没有任何回调。
    next.hidden = true;
    next.textContent = nextUnit ? ('继续 Unit ' + nextUnit) : '继续下一 Unit';
    next.onclick = null;
  }

  $('oIcon').textContent = win ? '🏆' : '💀';
  $('oTitle').textContent = win ? '远征成功！' : '远征结束';
  $('oText').textContent = win
    ? '你击败了词汇之王，完成了' + rewardScope(G.unit) + '的本次远征（' + rewardRoundLine(G.reward || {}) + '）！'
      + (bookLast ? '本册词汇已完成，可复习本单元或返回选择单元。'
        : nextOpen ? ('Unit ' + nextUnit + ' 的词汇已解锁，可以带着现有物资继续。')
          : continueOpen ? ('本单元还有 ' + uc.remaining + ' 个词没完成，完成后才能进入下一个单元。')
            : (!uc && lastByCatalog ? '已到本册最后一个单元，可复习本单元或返回选择单元。' : ''))
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
