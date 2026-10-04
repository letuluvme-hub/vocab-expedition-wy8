import {WHET_MAX_PER_RUN, WHET_MAX_PER_MAP} from '../data/balance.js';
// 旧局没有地图明细时保守占用一次，不能靠更新或刷新再买一块。
export const whetMapUsed = run => run.whetMapBuys ?? Math.min(WHET_MAX_PER_MAP, run.whetBuys || 0);
export function whetRemaining(run) {
  return Math.max(0, Math.min(WHET_MAX_PER_MAP - whetMapUsed(run), WHET_MAX_PER_RUN - (run.whetBuys || 0)));
}
