/* 通关纪念卡：只记录本次远征表现，不代表掌握所选范围的全部词汇。
 * 标题页的收藏列表和结算页共用这一份渲染，保证文案与层级只有一处来源。
 */
import { UNITS } from '../../data/units.js';
import { heroById } from './hero.js';

export function rewardScope(unit) {
  const u = UNITS.find(x => x.n === unit);
  return u ? u.t : (unit === -1 ? '全册' : '所选范围');
}

/* 轮次行。旧卡没有 roundNumber 时老实说「旧版记录」——
   绝不按 db.runs / 卡片数量猜一个编号，那是在伪造一条玩家没经历过的历史。 */
export function rewardRoundLine(r) {
  const n = r && r.roundNumber;
  return (typeof n === 'number' && Number.isInteger(n) && n > 0)
    ? ('第 ' + n + ' 轮')
    : '旧版记录 · 未记录轮次';
}

/* 单元号 → 显示名。自定义词表（0）不自称任何教材单元。 */
function unitLabel(u) {
  if (u === 0) return '我的词表';
  const t = UNITS.find(x => x.n === u);
  return t ? t.t : ('Unit ' + u);
}

/* 本轮完成单元行。只列 completedUnits —— 那是「本轮整词完成」的证据；
   到过某个单元、半词、跳过 BOSS 都不会进这个列表。
   ★ 缺字段与空数组是**两件事**：旧卡（任务 8 之前发的）根本没有这个字段，
   「没有记录」≠「记录了没有完成」。把 unknown 说成 false 就是在替玩家下结论。 */
function completedUnitsLine(r) {
  if (!Array.isArray(r.completedUnits)) return '本轮完成单元：未记录完成范围';
  if (!r.completedUnits.length) return '本轮完成单元：尚无整词完成的单元';
  return '本轮完成单元：' + r.completedUnits.map(unitLabel).join('、');
}

/* 整轮范围完成行。名义口径是「本轮学习范围已完成」，不是「全册已掌握」——
   从 Unit 3 开局的这一轮范围只有 3..6，说「全册」就是虚报。
   同上：undefined 是「旧卡没记过」，如实说不知道，不谎报成「未完成」。 */
function completionLine(r) {
  if (r && r.roundComplete === true) return '本轮学习范围已完成';
  if (r && r.roundComplete === false) return '本轮学习范围未完成';
  return '本轮完成范围：未记录完成范围';
}

export function renderRewardCard(box, r) {
  box.innerHTML = '';
  const card = document.createElement('article'); card.className = 'reward-card';
  const title = document.createElement('h3'); title.textContent = '词王征服者 · 通关纪念卡'; card.appendChild(title);
  const round = document.createElement('p'); round.className = 'reward-round';
  round.textContent = rewardRoundLine(r); card.appendChild(round);
  const scope = document.createElement('p'); scope.textContent = rewardScope(r.unit) + ' · ' + heroById(r.heroId).n; card.appendChild(scope);
  const stats = document.createElement('p'); stats.textContent = '拼写正确率 ' + r.accuracy + '% · 击败词灵 ' + r.kills + ' · 到达 ' + r.floor + ' 层'; card.appendChild(stats);
  const done = document.createElement('p'); done.className = 'reward-done';
  done.textContent = completedUnitsLine(r); card.appendChild(done);
  const note = document.createElement('small'); note.textContent = '击败最终 BOSS 的纪念，不代表已掌握全部词汇。'; card.appendChild(note);
  const complete = document.createElement('small'); complete.className = 'reward-complete';
  complete.textContent = completionLine(r); card.appendChild(complete);
  const stamp = document.createElement('small'); stamp.textContent = '获得于 ' + new Date(r.earnedAt).toLocaleString('zh-CN') + ' · 卡片 ' + r.id; card.appendChild(stamp);
  box.appendChild(card);
}