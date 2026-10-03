/* 选词出招：纯规则，无 DOM / 无全局状态（docs/feature-word-choice.md）。
 *
 * 核心想法（参照 Bookworm Adventures）：词越长、越难，打得越疼。
 * 以前每个词都是系统指定的，玩家在战斗里没有任何取舍；现在每一词给 2–3 个
 * 候选（中文释义 + 字母数 + 预估伤害），「挑短词稳拿 / 挑长词一口气打穿」
 * 本身就是战术，而且鼓励的方向（去挑战更长更难的词）与学习方向一致。
 *
 * 不变式：
 *  · 主词 = 既有 drawWord() 的结果，候选只是在它旁边追加 —— 错词复习的优先级、
 *    词池穷尽检查点、「已完成的词绝不再出」全部沿用 word-selection.js 的口径。
 *  · 候选选择**不消耗随机数**（确定性哈希）：既有抽词 / 字母盘 / 怪物的随机
 *    序列一位都不漂移，旧的种子测试与对照基线不受影响。
 *  · 预估伤害与真实结算共用 hitDmg / wordDmg，只是在一个拷贝上模拟，不改战斗。
 */
import { pendingWords } from './word-selection.js';
import { hitDmg, wordDmg } from './damage.js';
import { norm } from './text.js';

export const OFFER_SIZE = 3;

const keyOf = w => String(w == null ? '' : w).trim().toLowerCase();
const lenOf = w => norm(w.w).length;

// 确定性小哈希：同一局面给同一组候选（刷新 / 测试可复现），但不同词之间会散开。
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* 主词 + 至多两个未完成的备选：一个更短（稳）、一个更长（搏）。
 * 返回按字母数升序的数组；主词永远在内。 */
export function offerWords(run, main, prevWord, size = OFFER_SIZE) {
  if (!main) return [];
  const mainKey = keyOf(main.w);
  const prevKey = prevWord ? keyOf(prevWord.w) : null;
  let others = pendingWords(run).filter(w => keyOf(w.w) !== mainKey);
  const notPrev = others.filter(w => keyOf(w.w) !== prevKey);
  if (notPrev.length) others = notPrev;
  if (!others.length || size <= 1) return [main];
  others.sort((a, b) => lenOf(a) - lenOf(b) || (a.d - b.d) || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
  const seed = hashStr(mainKey + '|' + ((run && run.done && run.done.size) | 0));
  const pickFrom = (list, salt) => list[(seed + salt) % list.length];
  const mainLen = lenOf(main);
  const shorter = others.filter(w => lenOf(w) < mainLen);
  const longer = others.filter(w => lenOf(w) > mainLen);
  const third = Math.max(1, Math.ceil(others.length / 3));
  const out = [main];
  const add = w => { if (w && out.length < size && !out.some(x => keyOf(x.w) === keyOf(w.w))) out.push(w); };
  // 短的从「更短的那一截」里挑，长的从「更长的那一截」里挑；没有就退到整池两端。
  add(shorter.length ? pickFrom(shorter.slice(0, third), 0) : pickFrom(others.slice(0, third), 0));
  add(longer.length ? pickFrom(longer.slice(-third), 7) : pickFrom(others.slice(-third), 7));
  // 两端撞到同一个词（小词池）时，用剩下的任意一个补满。
  for (let i = 0; out.length < size && i < others.length; i++) add(others[(seed + i) % others.length]);
  return out.sort((a, b) => lenOf(a) - lenOf(b) || (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
}

/* 拼完这个词大约能打多少：逐字母模拟连击增长（与 combat.pressKey 同序：
 * 先 combo++，再按 hitDmg 结算），最后一击按 wordDmg。只读战斗、不改战斗。 */
export function estimateWordDamage(run, battle, word) {
  const sim = {
    combo: battle.combo | 0, dmgBonus: battle.dmgBonus | 0, rageLeft: battle.rageLeft | 0,
    freezeWord: !!battle.freezeWord, wordStreak: battle.wordStreak | 0, foe: battle.foe,
    chainNext: !!battle.chainNext, wordsDone: battle.wordsDone | 0,
  };
  const focus = !!(run && run.relics && run.relics.indexOf('focus') >= 0);
  // The selected card estimates damage still to come, including retyped
  // positions that cannot deal damage or increase combo a second time.
  const current = battle.word && keyOf(battle.word.w) === keyOf(word.w);
  const start = current ? (battle.input || []).length : 0;
  const rewarded = current ? (battle.letterProgress ?? start) : 0;
  let letters = 0;
  for (let i = start, n = lenOf(word); i < n; i++) {
    if (i < rewarded) continue;
    sim.combo++;
    if (sim.combo > 1 && sim.combo % 5 === 0) sim.dmgBonus += 5 * Math.ceil(sim.combo / 5);
    letters += hitDmg(run, sim);
    // 末字母和它触发的整词大招共用最后一份怒火；大招后才消耗。
    if (sim.rageLeft > 0 && i < n - 1) sim.rageLeft--;
    // 连锁闪电：与 combat.pressKey 同序 —— 命中之后连击 +3、增伤 +8（只触发一次）。
    if (sim.chainNext) { sim.chainNext = false; sim.combo += 3; sim.dmgBonus += 8; }
    if (focus && sim.combo > 0 && sim.combo % 6 === 0) sim.dmgBonus += 5;
  }
  const finisher = wordDmg(run, sim);
  return { letters, finisher, total: letters + finisher };
}

/* 只有「这个词还没被动过」才能换：任何作答痕迹都会锁定它。
 * 开场自动揭示（先知卡 / 学者之书）记在 autoHint 里，不算玩家动过。 */
export function canSwitchWord(battle) {
  if (!battle || battle.over) return false;
  if (!Array.isArray(battle.offer) || battle.offer.length < 2) return false;
  // wordLocked：本词有过任何被接受的字母尝试（伤害已结算），退格清空 input 也不解锁。
  if (battle.wordLocked || (battle.input || []).length) return false;
  const q = battle.wordQ || {};
  if ((q.wrong | 0) > 0 || (q.listen | 0) > 0) return false;
  return (battle.hintTotal | 0) <= (battle.autoHint | 0);
}
