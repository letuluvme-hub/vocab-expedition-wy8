// All requirements on a card must be met. Scholar is the starting milestone.
export const HERO_UNLOCKS = {
 scholar: [], scout: [['words',12]], warrior: [['kills',5]], lucky: [['words',30]],
 healer: [['healing',60]], ranger: [['words',60],['healing',120]],
 berserker: [['damage',4000],['kills',15]],
 pyromancer: [['words',100],['damage',6000]], assassin: [['cleanWords',80],['kills',30]],
};
export const HERO_METRIC_LABELS = {words:'完整拼词',cleanWords:'无错无帮助拼词',kills:'击败怪物',damage:'实际伤害',healing:'实际回血'};
