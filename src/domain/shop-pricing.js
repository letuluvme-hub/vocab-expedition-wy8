/* 商店定价随地图递增（纯规则：不读 DOM / 存储 / 全局状态）。
 *
 * 一次远征越往后金币越多，商店却一直是开局的价，后期几千金币没处花。
 * 这里按 run.campaign.segments（第几张地图）给基础价乘一个倍率：
 * 第 1 张图原价，之后每张 +SHOP_PRICE_STEP，封顶 SHOP_PRICE_MAX_STEPS 档。
 *
 * ★ 定价在**上架那一刻**算好并写进卡面（遗物 / 道具的价格还写进卡片 id），
 *   买的时候按卡面收钱。同一张图里 segments 不变，所以刷新恢复的商店价格不漂。
 * ★ 高价商品（提示宝典等）不乘倍率：它们本来就是给后期攒下的金币准备的定价。 */
import { SHOP_PRICE_STEP, SHOP_PRICE_MAX_STEPS } from '../data/balance.js';

const isInt = v => typeof v === 'number' && Number.isInteger(v);

export function shopPriceScale(segments) {
  const steps = isInt(segments) && segments > 1 ? Math.min(segments - 1, SHOP_PRICE_MAX_STEPS) : 0;
  return 1 + SHOP_PRICE_STEP * steps;
}

/* 基础价 × 倍率，按 5 金币取整（卡面上好读），最少就是基础价。 */
export function scaledPrice(base, segments) {
  if (!isInt(base) || base <= 0) return base;
  return Math.max(base, Math.round(base * shopPriceScale(segments) / 5) * 5);
}

export function runSegments(run) {
  return run && run.campaign && isInt(run.campaign.segments) ? run.campaign.segments : 1;
}
