/* 完整词连胜：分层反馈的**纯规则**（docs/feature-word-streak.md）。
 *
 * 契约（逐条核对，全部有单测）：
 *  1) **「学会」必须同时 complete:true 且 correct:true（严格布尔 true）**。
 *     字母级完成（complete:false）不增长、也**不消耗 eventId** —— 半词不算学会，
 *     后面真正的整词事件还能用同一个 id 记上。
 *     correct 缺失 / 1 / 'yes' → reason 'not-correct'：既不增长也**不清零**
 *     （默认当成学会会让漏发的标志凭空长一级；凭说不清的事件毁掉连胜同样是谎报）。
 *  2) **身份是显式注入的 eventId，不是单词**。同一个词在一轮里出现两次
 *     （payload 完全一样）只要 id 不同就各记一次；只按 word 去重会把
 *     「本轮第二次遇到同一个词」误判成重复，白白吞掉一次连胜。
 *     身份**按字面**使用：只拿 trim() 判空，存储与比较都用原样 token。
 *     ★ id 必须跨战斗唯一：用持久化的 run 级自增序号，**不要**用
 *     `${roundId}:${wordsDone}`（wordsDone 每战归零 → 跨战撞 id）。
 *     本模块不生成、不猜、不改写：身份由父层（战斗接线）注入。
 *  3) **只对最近一次的 eventId 去重**（单槽）：紧挨着的重复投递幂等 ——
 *     count 不变、不再产生播报。更早的 id 再次出现会被当成新事实再计一次，
 *     这是真实边界，不是「任意旧的重复都挡得住」。
 *     缺 eventId 时一律不增长（无法去重就不记），宁可少一次也不重复喊。
 *  4) **实际打错（correct:false）把 count 清 0**；新轮也清 0（controller.newRun）。
 *  5) **台阶 1..8**，首次到达才播报，文案按用户给的规范拼写：
 *     First Blood / Double Kill / Triple Kill / Quadra Kill / Penta Kill /
 *     Rampage / Unstoppable / Godlike。
 *  6) **第 8 级之后饱和**：count 停在 8，继续完成词不再产生任何新播报。
 *     免得每拼一个词就狂喊一遍 Godlike，把真正的里程碑变成噪音。
 *     count 是纯数字（0..8），不进文案，所以不需要显示"x8 连胜"这种会
 *     一直变的数字。
 *  7) **纯函数**：不改传入的 state（返回新对象），不碰 DOM / window /
 *     localStorage / 存档 / run / 战斗。
 *  8) 坏 state 显式降级：非对象 → count 0 / lastEventId null；count 非有限数
 *     → 0；count > 8 → 8。这条给「从旧存档恢复」用：协议没接上时父层拿到的
 *     永远是 0，而不是 NaN 或 undefined 混进 UI。
 */
export const STREAK_STAGE_LIMIT = 8;

/* 台阶表：stage 与 count 一一对应（1..8），文案即规范原文，不本地化、不缩写。 */
export const STREAK_STAGES = Object.freeze([
  Object.freeze({ stage: 1, count: 1, label: 'First Blood' }),
  Object.freeze({ stage: 2, count: 2, label: 'Double Kill' }),
  Object.freeze({ stage: 3, count: 3, label: 'Triple Kill' }),
  Object.freeze({ stage: 4, count: 4, label: 'Quadra Kill' }),
  Object.freeze({ stage: 5, count: 5, label: 'Penta Kill' }),
  Object.freeze({ stage: 6, count: 6, label: 'Rampage' }),
  Object.freeze({ stage: 7, count: 7, label: 'Unstoppable' }),
  Object.freeze({ stage: 8, count: 8, label: 'Godlike' }),
]);

/* count → 台阶对象。越界 / 非整数 / 非数字一律 null（绝不返回半个台阶）。 */
export function streakStageFor(count) {
  if (typeof count !== 'number' || !Number.isInteger(count)) return null;
  if (count < 1 || count > STREAK_STAGE_LIMIT) return null;
  return STREAK_STAGES[count - 1];
}

/* 新一轮的初始状态。字段固定，父层可以直接 JSON 化存快照。 */
export function createWordStreakState() {
  return { count: 0, lastEventId: null };
}

/* 任意来源的 state → 规范形状。**显式**降级，绝不返回 NaN / undefined。 */
export function normalizeWordStreakState(raw) {
  const out = createWordStreakState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const n = Number(raw.count);
  if (Number.isFinite(n) && n > 0) {
    out.count = Math.min(STREAK_STAGE_LIMIT, Math.floor(n));
  }
  const id = raw.lastEventId;
  /* 身份按**字面**保留：只用 trim() 判「有没有身份」，不改写 token 本身。
     ' a ' 与 'a' 是父层的两个不同身份，本模块不替它合并。 */
  if (typeof id === 'string' && id.trim()) out.lastEventId = id;
  return out;
}

/* 事件身份：非字符串 / 只有空白 → ''（= 没有身份）。**原样返回**，不 trim：
   身份是父层注入的字面 token，本模块既不生成也不改写它（只拿 trim 判空）。
   绝不把对象转成 key，String({}) === '[object object]' 会让所有坏事件
   塌成「同一个词」。 */
function eventIdOf(event) {
  if (!event || typeof event !== 'object') return '';
  const id = event.eventId;
  if (typeof id !== 'string' || !id.trim()) return '';
  return id;
}

/* 记一次「一个词的处理结果」。
 *
 * 返回 { state, announcement, reason }：
 *   - state        新的规范 state（**新对象**，入参不变）
 *   - announcement 首次到达某一级台阶时的 {stage,count,label}；否则 null
 *   - reason       'grown' | 'duplicate' | 'saturated' | 'incomplete' |
 *                  'mistake' | 'not-correct' | 'no-event-id'
 *                  （供接线层与测试判断，不进 UI）
 *
 * 注意 mistake（correct:false）走的是「清零」分支而不是「不增长」分支：
 * 错误字母必须真的把连胜打断，否则玩家刚打错又连着算成 3 连胜。
 * complete 标志在这条分支上不重要 —— 错就是错。 */
export function recordWordCompletion(state, event) {
  const prev = normalizeWordStreakState(state);
  const id = eventIdOf(event);
  const ev = (event && typeof event === 'object') ? event : {};

  if (!id) {
    // 没有身份就没法幂等：宁可这一次不记，也不冒着重喊的风险。
    return { state: prev, announcement: null, reason: 'no-event-id' };
  }
  if (prev.lastEventId === id) {
    return { state: prev, announcement: null, reason: 'duplicate' };
  }
  if (ev.correct === false) {
    return { state: { count: 0, lastEventId: id }, announcement: null, reason: 'mistake' };
  }
  if (ev.complete !== true) {
    // 字母级 / 半词：不增长也不落身份，后面的整词事件仍可用同一个 id。
    return { state: prev, announcement: null, reason: 'incomplete' };
  }
  if (ev.correct !== true) {
    /* 「学会」必须**显式** correct:true。correct 缺失 / 写成 1 / 'yes' 一律
       不算成功：默认当成学会会让一个漏发的标志凭空长一级连胜。
       但也**不**清零 —— 没打错就是没打错，不能凭一个说不清的事件毁掉连胜。 */
    return { state: prev, announcement: null, reason: 'not-correct' };
  }
  if (prev.count >= STREAK_STAGE_LIMIT) {
    // 饱和：继续把 lastEventId 往前推（保持幂等），但不再有新播报。
    return { state: { count: STREAK_STAGE_LIMIT, lastEventId: id }, announcement: null, reason: 'saturated' };
  }
  const count = prev.count + 1;
  return { state: { count, lastEventId: id }, announcement: streakStageFor(count), reason: 'grown' };
}
