/* runtime 的轮次接线（docs/feature-rounds.md）。
 *
 * 两件事，都只在这里接线，规则本身都在 domain 里：
 *  1) 新开一轮时注入一个**持久**的 roundId（crypto.randomUUID）。它是应用层的能力，
 *     纯 domain 只接收显式事实 —— 不生成 id，也不猜。没有 crypto 时退回带时间戳的
 *     随机串：身份必须存在，形状由 runtime 负责。
 *  2) 「本轮整词完成」的证据只有两条真实路径：词池抽干（showLearningComplete）与
 *     跨单元过渡成功（nextUnit）。走到某个单元、打过 BOSS、跳过节点都不是证据。
 *
 * 不做：按卡片数量/wins 猜轮次编号（编号由 registerRunStart 从 DB.runs 取），
 * 从旧恢复补填轮次事实，不改任何战斗数值。
 */
import { recordRoundUnitComplete } from '../domain/campaign.js';

export const newRoundId = () => {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && typeof c.randomUUID === 'function') {
    try { return c.randomUUID(); } catch { /* 某些环境在非安全上下文里抛错 */ }
  }
  // 兜底：仍然是一个进程外不会重复的串（时间戳 + 随机数），不是 run.id 那种进程内自增。
  return 'r-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0x100000000).toString(36);
};

/* 记一次「本轮这个单元的目标词真的全部整词完成了」。幂等，返回是否新记。 */
export function noteRoundUnitComplete(run) {
  if (!run) return false;
  return recordRoundUnitComplete(run, run.unit);
}
