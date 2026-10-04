// 角色按 HERO_UNLOCK_ORDER 依次解锁：只有上一位解锁后，下一位才开始计数，
// 进度从上一位解锁那一刻的统计快照算起（增量），所以攒下的老进度不会一次连开好几位。
// 同一张卡上的条件必须全部满足。学者是初始角色。
export const HERO_UNLOCK_ORDER = ['scholar','scout','warrior','lucky','healer','ranger','berserker','pyromancer','assassin'];
export const HERO_UNLOCKS = {
 scholar: [], scout: [['words',20]], warrior: [['words',30],['kills',3]], lucky: [['words',45]],
 healer: [['words',50],['healing',60]], ranger: [['words',70],['healing',100]],
 berserker: [['damage',5000],['kills',6]],
 pyromancer: [['words',100],['damage',6000]], assassin: [['cleanWords',50],['kills',8]],
};
// 旧版累计门槛。只在第一次读到没有 heroUnlocks 的老存档时用一次：已经解锁的角色保留，不收回。
export const LEGACY_HERO_UNLOCKS = {
 scholar: [], scout: [['words',12]], warrior: [['kills',5]], lucky: [['words',30]],
 healer: [['healing',60]], ranger: [['words',60],['healing',120]],
 berserker: [['damage',4000],['kills',15]],
 pyromancer: [['words',100],['damage',6000]], assassin: [['cleanWords',80],['kills',30]],
};
export const HERO_METRIC_LABELS = {words:'完整拼词',cleanWords:'无错无帮助拼词',kills:'击败怪物',damage:'实际伤害',healing:'实际回血'};
