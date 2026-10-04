// 角色解锁看累计统计，所有角色的进度都一直显示。越靠后的角色门槛越高，
// 以完整拼词为主线大致每隔一两个单元开一位，避免短时间里一下解锁好几个。
// 同一张卡上的条件必须全部满足。学者是初始角色。
export const HERO_UNLOCK_ORDER = ['scholar','scout','warrior','lucky','healer','ranger','berserker','pyromancer','assassin'];
export const HERO_UNLOCKS = {
 scholar: [], scout: [['words',20]], warrior: [['words',50],['kills',3]], lucky: [['words',100]],
 healer: [['words',150],['healing',80]], ranger: [['words',220],['healing',160]],
 berserker: [['words',300],['damage',14000],['kills',15]],
 pyromancer: [['words',400],['damage',18000]], assassin: [['words',500],['cleanWords',80],['kills',25]],
};
// 旧版门槛。只在第一次读到没有 heroUnlocks 的老存档时用一次：已经解锁的角色保留，不收回。
export const LEGACY_HERO_UNLOCKS = {
 scholar: [], scout: [['words',12]], warrior: [['kills',5]], lucky: [['words',30]],
 healer: [['healing',60]], ranger: [['words',60],['healing',120]],
 berserker: [['damage',4000],['kills',15]],
 pyromancer: [['words',100],['damage',6000]], assassin: [['cleanWords',80],['kills',30]],
};
export const HERO_METRIC_LABELS = {words:'完整拼词',cleanWords:'无错无帮助拼词',kills:'击败怪物',damage:'实际伤害',healing:'实际回血'};
