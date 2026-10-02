/* 战斗页的「战意」条（docs/feature-combo-milestones.md）。
 *
 * 纯展示：只读 (combo, run.milestones) 两个事实，算出该画什么。
 * 它**不发放**任何东西 —— 发放在 app/combat.js，规则在 domain/combo-milestones.js。
 * 渲染之前、渲染之后，G / B 必须逐字段不变（渲染里补发里程碑就是作弊）。
 *
 * 为什么值得占一行：目标是可见才有追求。连击平时只是一行「连击 7 ✦ 伤害 ×1.7」，
 * 玩家不知道再答对几个字母能换到东西。把三阶摆出来，「还差 3 个字母 +8 护盾」
 * 才是一个玩家真的会去追的目标。
 *
 * ── 与蓄力条（foe-attack-meter）同一套约定 ──
 *   1) 容器缺席（未接线 / 测试台）时安静返回 null，绝不抛错把整屏渲染带崩。
 *      战斗页的其余部分照常画出来 —— 这一条是被测试强制的。
 *   2) 全部 textContent 落屏：门槛数字来自存档/词库，拼进 innerHTML 就是注入面。
 *   3) 只重画自己那块，不碰 #fCombo / #fTags / 字母盘。
 */
import { comboProgress, comboMilestoneLadder } from '../../domain/combo-milestones.js';

export const COMBO_MS_ID = 'fComboMs';
export const COMBO_MS_TITLE = '战意 · 连击里程碑';

export function createComboMilestoneTrack({ $ = id => document.getElementById(id), doc } = {}) {
  const D = () => doc || (typeof document !== 'undefined' ? document : null);

  /* 事实 → 文案/档位。纯函数，抽出来是为了能单独断言「到账 0 时的诚实说法」。 */
  function view(combo, fired) {
    const p = comboProgress(combo, fired);
    const txt = p.done
      ? ('战意 ' + p.unlocked + '/' + p.total + ' · 全部达成')
      : ('战意 ' + p.unlocked + '/' + p.total + ' · 下一个 ' + p.next.combo + ' 连击 · ' + p.next.n);
    return { text: txt, total: p.total, unlocked: p.unlocked, done: p.done, next: p.next };
  }

  function paint(combo, fired) {
    const box = $(COMBO_MS_ID);
    if (!box) return null;                    // 容器缺席：安静返回，不弄崩整屏
    const d = D();
    if (!d) return null;
    const v = view(combo, fired);
    const ladder = comboMilestoneLadder();
    box.className = 'comboMs' + (v.done ? ' done' : '');
    box.innerHTML = '';
    const pips = d.createElement('span');
    pips.className = 'comboMsPips';
    for (let i = 0; i < ladder.length; i++) {
      const pip = d.createElement('i');
      pip.className = 'comboMsPip' + (i < v.unlocked ? ' on' : '');
      pips.appendChild(pip);
    }
    box.appendChild(pips);
    const txt = d.createElement('span');
    txt.className = 'comboMsTxt';
    txt.textContent = v.text;                // textContent，绝不 innerHTML
    box.appendChild(txt);
    box.title = ladder.map(m => m.blurb).join('　');
    return v;
  }

  return { paint, view };
}