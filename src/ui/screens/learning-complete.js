/* 「本单元词汇已全部完成」检查点屏。
 *
 * 这个屏存在的唯一理由是**诚实**：词池抽干了，但那只怪还没被打死。
 * 所以这里不许出现「通关 / 击败 BOSS / 解锁下一单元」任何一种说法 ——
 * 那是别的功能的语义，在词汇全部完成时一律是谎话。
 *
 * 本模块只画、只交回调，不碰任何游戏状态（冻结与相位都在 progress/runtime）。
 * 下一单元的衔接是后续功能：这里只能说「本单元完成」，不许预告解锁。
 */
import { learningCounts } from '../../domain/word-selection.js';

export function createLearningCompleteScreen({ getRun, getBattle, onHome, onQuit } = {}) {
  const $ = id => document.getElementById(id);
  const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

  function render() {
    const run = getRun ? getRun() : null;
    const battle = getBattle ? getBattle() : null;
    const c = learningCounts(run);

    setText('lcTitle', '本单元词汇已全部完成');
    setText('lcCount', c.total
      ? '已完成 ' + c.done + ' / ' + c.total + ' 个词'
      : '本单元没有可练习的词');

    // 怪物还活着这件事必须说出来：血量条不是 0 就不算击杀。
    // 最后一词真的打死了它的话，战斗本身会先走既有胜利奖励；
    // 但「领奖后推进」也可能到达这里（那时 enHp<=0）—— 那就如实说已经打完了，
    // 绝不能反过来说「它还没被打倒」。两种情况都必须和真实血量一致。
    const alive = battle && typeof battle.enHp === 'number' && battle.enHp > 0;
    let mon;
    if (alive) {
      mon = '这只怪物还没有被打倒，本轮不算通关。'
        + '它还剩 ' + Math.max(0, Math.round(battle.enHp)) + ' / ' + Math.round(battle.enMax) + ' 点生命。'
        + (battle.boss ? '（这是首领战）' : '');
    } else if (battle) {
      mon = '这一场已经打完了，但整条远征还没有结束。';
    } else {
      mon = '本轮没有进行中的战斗。';
    }
    setText('lcMon', mon);

    // 只讲玩家现在能做的两件事。这个屏是给玩家看的，不放任何面向开发者的
    // 功能说明（「下一单元是之后的功能」这类话对玩家没有意义，只是噪声）。
    setText('lcText', '本单元词汇练习已完成。可以保存进度返回主页，或结束本轮学习。'
      + '词汇完成不等于击败首领。');

    const home = $('lcBtnHome'), quit = $('lcBtnQuit');
    if (home) {
      home.textContent = '保存并返回主页';
      home.title = '保留这次远征（已完成的词与进度会存好）并回到主页';
      home.onclick = () => { if (onHome) onHome(); };
    }
    if (quit) {
      quit.textContent = '结束本轮学习';
      // ★ 实际行为是 abandonRun()：丢掉这一局，**不做战败结算**。
      //   所以 tooltip 说的是「结束 + 已掌握的词保留」，绝不能说「结算」——
      //   那是战败结算才有的语义，而这一局不是被打败的。
      quit.title = '结束这次学习并清掉这一局；已掌握的词与记录会保留，不算战败';
      quit.onclick = () => { if (onQuit) onQuit(); };
    }
    return { counts: c };
  }

  return { render };
}
