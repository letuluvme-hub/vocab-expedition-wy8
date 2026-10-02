export const ENEMIES=[
 {ic:'👾', n:'词灵',     base:3,  tint:'#8b5cf6'},
 {ic:'🕷️', n:'语素蛛',   base:4,  tint:'#ef4444'},
 {ic:'🗿',  n:'石化词素', base:5,  tint:'#78716c'},
 {ic:'🐙',  n:'歧义章鱼', base:5,  tint:'#a855f7'},
 {ic:'👻',  n:'拼写幽灵', base:4,  tint:'#64748b'},
 {ic:'🦂',  n:'单复数蝎', base:5,  tint:'#f59e0b'},
 {ic:'🧊', n:'冰封词灵', base:6,  tint:'#06b6d4'},
 {ic:'🌪️', n:'词形旋风', base:6,  tint:'#8b5cf6'}
];
/* base 是「怪种强度档位」，不是绝对血量：3 最软、6 最硬。
 * ★ 它曾经是死字段（全项目零引用），血量只由楼层决定 —— 8 种怪在规则上完全等价。
 *   现在它经 domain/foe-stats.js 的 foeHpMax() 真正接进普通怪的血量：
 *   倍率 = 1 + (base - mean) * per（见 data/balance.js 的 FOE_HP_SCALE），
 *   以 8 种怪的**平均倍率恰好为 1** 为准绳 —— 这次改动不抬整体难度，只做分层。
 * ★ 只对**普通怪**生效（elite / boss 的倍率恒为 1）：精英与首领各有自己的难度口径，
 *   叠上怪种倍率会让「精英比首领还硬」在深层成立。
 * ★ 本数组被 tests/unit/extraction.test.js 逐字段钉死与旧版一致：
 *   只能加注释，绝不能给条目加字段（机制一律在 data/balance.js 的 FOE_TRAITS，
 *   且按 n 索引 —— 存档里 foe 只落 {n,ic,tint}，见 domain/foe-traits.js）。 */
export const BOSS={ic:'👑',n:'词汇之王',tint:'#ffce4d'};
