export const HEROES=[
 {id:'scholar', n:'学者',   tag:'读万卷书', d:'出手前多想一步：每场战斗多 1 次提示，但生命上限 -10。',
  mod:{hp:-10, hint:+1}, voice:{rate:0.85, pitch:1.05, prefer:'female'}},
 {id:'warrior', n:'战士',   tag:'一人成军', d:'用身体硬吃伤害：生命上限 +15，但每场战斗少 1 次提示。',
  mod:{hp:+15, hint:-1}, voice:{rate:1.0,  pitch:0.6,  prefer:'male'}},
 {id:'scout',   n:'探险家', tag:'不走弯路', d:'摸清地形再下手：干扰字母 -1（字母盘更好选），开局护盾 +10。',
  mod:{noise:-1, shield:+10}, voice:{rate:1.05, pitch:1.25, prefer:'female'}},
 {id:'lucky',   n:'幸运儿', tag:'随性而为', d:'钱袋鼓鼓：开局多 15 金币，但连击加成 -10%（连击更钝）。',
  mod:{gold:+15, combo:0.9}, voice:{rate:1.1,  pitch:1.35, prefer:'female'}},
 {id:'healer',  n:'治愈师', tag:'边打边治', d:'每场战斗开场自动回复 6 点生命，但生命上限 -5。',
  mod:{hp:-5, regen:6}, voice:{rate:0.8,  pitch:1.15, prefer:'female'}},
 {id:'ranger',  n:'游侠',   tag:'一击脱离', d:'每答对一个字母回复 1 点生命，但生命上限 -8。',
  mod:{hp:-8, leech:1}, voice:{rate:1.15, pitch:0.85, prefer:'male'}}
];
