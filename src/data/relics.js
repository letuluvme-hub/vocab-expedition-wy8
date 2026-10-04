/* 遗物表（纯数据：无 DOM、无状态、无存档）。
 *
 * 字段：
 *   id / ic / n / d —— 身份与展示文案。`d` 是**面板与卡面上逐字显示的那一句**，
 *   它必须和实际结算一致（见 ui/components/equipment-panel.js 的只读契约）。
 *   rarity —— 档位标签，取值只能是 balance.js 的 RELIC_RARITY_ORDER。
 *     ★ 这里**故意没有 price 字段**：定价的唯一来源是 balance.js 的档位表，
 *       遗物对象上再挂一份就是两处真相，改价时必然漂移。
 *     ★ rarity 同样不进存档。快照里的遗物永远是纯 id 数组
 *       （见 domain/run-snapshot.js 与 tests/unit/relic-save-compat.test.js），
 *       档位是**读的时候**从这张表现查的 —— 玩家中途退出、隔版本升级都不受影响。
 *
 * 定价：普通 80 / 稀有 150 / 传说 240（商店里再按地图递增）；权重：普通 62 / 稀有 30 / 传说 8
 * （全部数值见 src/data/balance.js）。新遗物只允许追加在末尾，
 * 既有 12 件的 id / 图标 / 名称与顺序不变；有意调整的规则文案
 * 在 tests/unit/extraction.test.js 逐项登记。
 */
export const RELICS=[
 {id:'hint',   ic:'🔮', n:'提示水晶', d:'每场战斗多 2 次提示', rarity:'common'},
 {id:'shield', ic:'🛡️', n:'护盾符文', d:'首次获得时增加 15 点护盾（先于生命消耗），之后不重复发放', rarity:'common'},
 // —— 稀有：改变某一整段玩法节奏，而不是把某个数字调大 ——
 {id:'combo',  ic:'⚔️', n:'连击徽章', d:'连击加成翻倍（更容易打出高伤害）', rarity:'rare'},
 {id:'purse',  ic:'💰', n:'聚宝盆',   d:'每场战斗胜利额外获得 25 金币', rarity:'common'},
 {id:'thorn',  ic:'🌵', n:'荆棘护符', d:'答错时反弹 5 点伤害给敌人', rarity:'common'},
 {id:'battery',ic:'🔋', n:'永动电池', d:'每通过一层回复 8 点生命', rarity:'common'},
 {id:'lucky',  ic:'🍀', n:'幸运草',   d:'每场战斗首次答错不掉血', rarity:'rare'},
 {id:'scholar',ic:'📘', n:'学者之书', d:'每场第二词自动揭示首字母；胜利时有 1/3 概率提供先知卡选项，与聚宝盆组合后必定提供', rarity:'common'},
 {id:'forge',  ic:'⚒️', n:'锻造台',   d:'营火休息改为回复 20 生命（原为 12）', rarity:'common'},
 {id:'ghost',  ic:'👻', n:'影分身',   d:'每轮远征可免费跳过一次，不计失败（用完后跳过仍需付代价）', rarity:'rare'},
 {id:'greed',  ic:'💎', n:'贪婪之眼', d:'所有金币收益 +50%', rarity:'rare'},
 {id:'focus',  ic:'🧠', n:'专注头环', d:'连击中断不清零，改为保留一半', rarity:'rare'},
 // 一轮仅触发一次；错误仍扣血并进入复习，额度由 run.prophecyUsed 保存。
 {id:'prophecy', ic:'📜', n:'预知残卷',
  d:'每轮远征仅 1 次：答错时消耗 1 次提示，揭示当前词剩余字母；没有提示额度时不触发',
  rarity:'legendary'},
];
