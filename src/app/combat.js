/* 战斗协调器：把 runtime.js 里的战斗输入/结算流程搬成可注入、可测的控制器。
 *
 * 设计约束（迁移期必须守住）：
 *   1) 只搬流程，不改教学文案、不改伤害数值、不改结算顺序；
 *   2) 每个入口函数进来先取一次 state 快照（DB/G/B），不长期缓存旧状态；
 *   3) 一切 DOM / 存档 / 远征副作用都走 ports，控制器自己不碰 window、localStorage；
 *   4) 「最后一击 → winFight」与「整词拼完 → wordDmg/creditWord/nextWord」的先后照旧。
 */
import { pickCardHTML, CAT_LABEL } from '../ui/components/pick-card.js';
import { SKIP_HP_COST } from '../data/balance.js';

export function createCombatController({ state, ports }) {
  const { $, norm, clamp, rnd, hasR, itemById, hitDmg, wordDmg, wordComplete, creditWord,
    onWordWrong, centerOf, heroPoint, toast, sfx, TTS, burst, floatTxt, flash, ring, animHero,
    wordFinisher, foeCry, renderFight, nextWord, winFight, loseFight, finishNode, saveDB,
    scheduleBattle } = ports;

  // runtime 里这些是浏览器全局；Node 桩没有，必须退化成 0 而不是抛 ReferenceError。
  const vw = () => (typeof innerWidth === 'number' ? innerWidth : 0);
  const vh = () => (typeof innerHeight === 'number' ? innerHeight : 0);

  /* ---------- 伤害：敌人掉血 + 反馈包 ---------- */
  function dealDamage(d) {
    const B = state.B;
    B.enHp -= d;
    animHero('atk');                                   // ← 角色追加：每个正确字母都挥一下
    const av = $('fAv');
    if (av) {
      av.classList.remove('hurt');
      void av.offsetWidth;
      av.classList.add('hurt');
    }
    const c = centerOf(av);
    burst(c.x, c.y, B.foe.tint, 20, 5);
    floatTxt(c.x, c.y, '-' + d, B.foe.tint);
    // 角色出手的火花：从角色位置飞向敌人，形成「攻击」的视觉因果
    const hp = heroPoint();
    if (hp.x > 0 && hp.x < vw()) burst((hp.x + c.x) / 2, (hp.y + c.y) / 2, '#ffffff', 6, 4.5);
    sfx.hit();
    if (B.enHp <= 0 && B.enHp > -40) flash('#ff547033');
    if (B.enHp <= 0) winFight();
  }

  /* ---------- 受伤：护盾 → 生命 → 荆棘 → 错词记录 ---------- */
  function hurtPlayer(d, wrongCh, rightCh, opt) {
    const B = state.B, G = state.G, DB = state.DB;
    // opt.soft = 「字母在单词里、只是顺序不对」这类非知识错误：
    //   照样扣血、照样可能致死，但**不**记错词、不动掌握表、不播「不在这个词里」的文案
    const soft = !!(opt && opt.soft);
    let dmg = d;
    if (B.lethUsed > 0) { B.lethUsed--; dmg = 0; toast('🍀 幸运草：免于本次惩罚'); }
    else if (B.firstWrong && B.boss) { B.firstWrong = false; dmg = Math.round(dmg / 2); toast('🛡️ 首领首击减半'); }
    if (dmg > 0) {
      if (B.shield > 0) {
        const a = Math.min(B.shield, dmg);
        B.shield -= a;
        dmg -= a;
        floatTxt(vw() / 2, vh() * 0.35, '护盾 -' + a, '#22d3ee');
      }
      if (dmg > 0) {
        B.myHp -= dmg;
        animHero('hurt');                               // ← 角色追加：受伤反应（抖动+变红）
        centerOf($('fAv'));
        floatTxt(vw() / 2, vh() * 0.42, '-' + dmg, '#ff5470');
        flash('#ff54702e');
        sfx.hurt();
        // 语音：低血量时角色担心/打气。只在跨过 30% 血线那一刻喊，
        // 每次受伤都喊会盖住单词朗读、也会吵到崩溃。
        if (B.myHp > 0 && B.myHp < G.maxhp * 0.3 && !B._lowSaid) {
          B._lowSaid = true;
          TTS.line('low', null, { force: true });
        } else if (B.myHp >= G.maxhp * 0.5) B._lowSaid = false;   // 回血后重置，下次濒死还能喊
      }
    }
    // 荆棘护符：答错时反弹 5 血给敌人（只结算一次，且不影响胜负判定）
    if (hasR('thorn') && dmg > 0) {
      B.enHp -= 5;
      const tc = centerOf($('fAv'));
      floatTxt(tc.x, tc.y, '荆棘 -5', '#3ddc84');
      if (B.enHp <= 0) winFight();
    }
    // 错词记录：进本局复习队列，下一场优先出现。soft（顺序错）不算。
    if (!soft) {
      if (!B.mistaken) B.mistaken = [];
      if (B.mistaken.indexOf(B.word.w) < 0) {
        B.mistaken.push(B.word.w);
        onWordWrong(B.word.w);
        const i = DB.mastered.indexOf(B.word.w);
        if (i >= 0) DB.mastered.splice(i, 1);
        saveDB();
      }
    }
    // ★ 不要在这里报出完整单词或下一个该填的字母 —— 错误提示剧透 = 直接给答案。
    if (!soft) toast('❌ 「' + wrongCh + '」不在这个词里，再想想');
    if (B.myHp <= 0) loseFight();
  }

  /* ---------- 道具 ---------- */
  function useItem(id) {
    const B = state.B, G = state.G;
    if (!B || B.over || !G) return;
    const it = itemById(id);
    if (!it) return;
    if ((G.bag[id] | 0) <= 0) { toast('🎒 没有' + it.n + '了'); return; }
    if ((B.usedThisFight[id] | 0) >= it.max) { toast('本场已用满 ' + it.n + '（上限 ' + it.max + ' 次）'); return; }
    let msg = '';
    switch (id) {
      case 'leech':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        B.myHp = Math.min(G.maxhp, B.myHp + 1);
        msg = '🩸 獠牙吸取了 1 点生命';
        break;
      case 'rage':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        B.rageLeft = 3; B.combo = 0;
        msg = '🔥 怒火点燃！接下来伤害 ×2.5（连击已清空）';
        break;
      case 'freeze':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        B.freezeWord = true;
        msg = '❄️ 敌人被冻住：这个词不扣血，但伤害减半';
        break;
      case 'chain':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        B.chainNext = true;
        msg = '⚡ 闪电蓄势：下一个正确字母额外 +3 连击';
        break;
      case 'reveal':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        B.hintUsed = Math.max(B.hintUsed, 2);
        B.hintTotal = Math.max(B.hintTotal || 0, 2);
        {
          const rt = norm(B.word.w), rp = B.input.length;
          const need = Math.min(2, rt.length - rp);
          for (let j = 0; j < B.letters.length; j++) {
            if (!B.used[j] && B.bad[j] && B.letters[j] === rt[rp]) B.bad[j] = false;
          }
          msg = '👁️ 透视：已揭示接下来 ' + need + ' 个字母（不消耗提示）';
        }
        break;
      case 'purge':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        let freed = 0;
        B.bad.forEach((b, j) => { if (b) { B.bad[j] = false; freed++; } });
        msg = '🧹 扫除 ' + freed + ' 个误标字母，重新可选';
        break;
      case 'greed':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        B.goldMult = 3;
        msg = '💰 本场金币 ×3';
        break;
      case 'stone':
        B.usedThisFight[id] = (B.usedThisFight[id] | 0) + 1; G.bag[id]--;
        // ★ 战斗中护盾存在 B.shield 上，不是 G.shield。
        B.shield = clamp((B.shield | 0) + 20, 0, G.maxhp);
        renderFight();
        msg = '🪨 获得 20 点护盾';
        break;
    }
    if (msg) {
      toast(msg);
      sfx.item(id);
      const av = centerOf($('fItems'));
      burst(av.x, av.y, it.tint || '#ffce4d', 16, 3.5);
    }
    renderFight();
  }

  /* ---------- 字母盘：点击 / 打字共用的唯一判定入口 ---------- */
  // idx：本次要按下的字母实例下标。省略时回落到 B.sel（点击路径就是这么调的）。
  function pressKey(idx) {
    const B = state.B, G = state.G;
    if (!B || B.over) return;
    const i = (idx === undefined || idx === null) ? B.sel : idx;
    if (i < 0 || i >= B.letters.length || B.used[i]) { sfx.bad(); return; }
    const ch = B.letters[i];
    const tgt = norm(B.word.w);
    const pos = B.input.length;
    const bank = $('fBank');
    const keyEl = (B.keyEls && B.keyEls[i]) || ((bank && bank.children || [])[i]);

    // 恢复：若当前位置所需的正确字母被误标为 bad，则自动解封
    // （否则手滑标错一个字母会让整个词永远拼不完）
    const needCh = tgt[pos];
    if (needCh && !B.letters.some((c, j) => c === needCh && !B.used[j] && !B.bad[j])) {
      let freed = false;
      for (let j = 0; j < B.letters.length; j++) {
        if (!B.used[j] && B.bad[j] && B.letters[j] === needCh) { B.bad[j] = false; freed = true; }
      }
      if (freed) { toast('已解开「' + needCh.toUpperCase() + '」，再试一次'); renderFight(); return; }
    }

    // 已标记为错：再点只抖动，不再扣血（惩罚已付过）
    if (B.bad[i]) {
      sfx.bad();
      if (keyEl) {
        keyEl.classList.add('flash');
        scheduleBattle(() => keyEl.classList.remove('flash'), 340);
      }
      toast('「' + ch.toUpperCase() + '」不在这个词里，换一个字母');
      return;
    }

    if (tgt[pos] === ch) {
      // ✅ 正确
      B.used[i] = true; B.input.push(ch);
      // 提示窗口锚在 input.length：进度 +1 会让窗口左边界右移一格，
      // 所以把已揭示数 -1 抵消掉，否则会「白赚」下一个字母的提示。
      if (B.hintUsed > 0) B.hintUsed--;
      G.att++; G.attOk++;
      sfx.good();
      if (keyEl) {
        keyEl.classList.add('good');
        const c = centerOf(keyEl);
        burst(c.x, c.y, '#3ddc84', 14, 4);
        floatTxt(c.x, c.y - 14, '+' + hitDmg(), '#3ddc84');
      }
      B.combo++;
      B.maxCombo = Math.max(B.maxCombo, B.combo);
      if (B.combo > 1) {
        const cb = $('fCombo');
        if (cb) { cb.classList.remove('hot'); void cb.offsetWidth; cb.classList.add('hot'); }
        if (B.combo % 5 === 0) {
          toast('🔥 ' + B.combo + ' 连击！伤害 +' + (5 * Math.ceil(B.combo / 5)) + '%');
          B.dmgBonus += 5 * Math.ceil(B.combo / 5);
          sfx.combo();
          TTS.line('combo');
        }
      }
      // 语音：攻击台词。普通字母命中概率很低，连击越高越爱喊。
      if (B.combo >= 3) TTS.line('atk', null, { p: .18 + Math.min(.42, B.combo * .05) });
      else TTS.line('atk', null, { p: .12 });
      dealDamage(hitDmg());
      if (B.rageLeft > 0) { B.rageLeft--; if (B.rageLeft === 0) toast('🔥 怒火熄灭了'); }
      // 吸血獠牙：答对就回血
      if ((G.bag.leech | 0) > 0 && (B.usedThisFight.leech | 0) < 6 && B.myHp < G.maxhp) {
        B.usedThisFight.leech = (B.usedThisFight.leech | 0) + 1;
        G.bag.leech--;
        B.myHp = Math.min(G.maxhp, B.myHp + 1);
        floatTxt(vw() / 2, vh() * 0.5, '+1', '#ff6b8a');
      }
      // 游侠特性：每个正确字母回 1 点血（不消耗道具背包，与吸血獠牙独立共存）
      if ((G.hleech | 0) > 0 && B.myHp < G.maxhp) {
        B.myHp = Math.min(G.maxhp, B.myHp + G.hleech);
        const hp2 = centerOf($('fMy'));
        floatTxt(hp2.x, hp2.y - 4, '+' + G.hleech, '#3ddc84');
      }
      // 连锁闪电：额外连击
      if (B.chainNext) { B.chainNext = false; B.combo += 3; B.dmgBonus += 8; toast('⚡ 连锁触发！连击 +3'); }
      if (hasR('focus') && B.combo > 0 && B.combo % 6 === 0) B.dmgBonus += 5;
      if (B.word.d >= 3 && B.combo > 0 && rnd(6) === 0) toast('💡 记住这个词！');
      if (wordComplete()) {
        // ── 整词拼完：一次大招 ─────────────────────────────────────────────
        // 判据用 wordComplete()（和掌握判定 winFight 里同一个函数），不用裸 input.length 比较。
        const bonus = wordDmg();       // 大招伤害：≥ 单字母 ×3.2
        creditWord(B.word.w);          // 整词拼完 → 记为学会（掌握表 + 本局退休）
        B.wordsDone = (B.wordsDone || 0) + 1;
        B.wordStreak = (B.wordStreak || 0) + 1;   // 连续整词 → 下一次大招更强
        wordFinisher(B.word.w, bonus);
        sfx.word();
        foeCry('hit');
        TTS.word(B.word.w);
        if (hasR('battery') && B.wordsDone % 3 === 0) { B.myHp = Math.min(G.maxhp, B.myHp + 3); toast('🔋 永动电池：回复 3 生命'); }
        B.enHp -= bonus;
        if (B.enHp <= 0) { renderFight(); foeCry('die'); winFight(); return; }
        B.combo = 0;          // 换词时连击结算：防止伤害跨词无限叠加
        nextWord();
        return;
      }
      renderFight();
      if (B.enHp <= 0) return winFight();
    } else {
      // ❌ 错误：区分「单词里根本没这个字母」和「字母对、只是顺序不对」
      const inWord = tgt.indexOf(ch) >= 0;
      sfx.bad();
      if (keyEl) {
        keyEl.classList.add('flash');
        const c = centerOf(keyEl);
        burst(c.x, c.y, inWord ? '#ffb020' : '#ff5470', 16, 4.5);
        scheduleBattle(() => keyEl.classList.remove('flash'), 340);
      }
      if (inWord) {
        // 字母在单词里、只是位置不对：扣 ORDER_DMG，但绝不标记 B.bad —— 会造成死局。
        // soft=true 让 hurtPlayer 跳过「错词记录」。
        G.att++;
        if (B.freezeWord) toast('❄️ 冰冻中：这次不扣血');
        else hurtPlayer(B.boss ? 8 : 6, ch, tgt[pos], { soft: true });
        B.combo = Math.max(0, B.combo - 1);
        B.wordStreak = 0;   // 同样是一次失手 → 连续整词计数清零
        toast('「' + ch.toUpperCase() + '」在这个单词里，但位置不对');
      } else {
        B.bad[i] = true;
        G.att++;
        if (B.freezeWord) toast('❄️ 冰冻中：这次不扣血');
        else hurtPlayer(B.boss ? 16 : 12, ch, tgt[pos]);
        // 专注头环：连击中断时保留一半，而不是清零
        B.combo = hasR('focus') ? Math.floor(B.combo / 2) : 0;
        B.wordStreak = 0;   // 真正答错 → 连续整词计数清零
      }
      renderFight();
    }
  }

  // 打字入口：把敲下的字符映射到字母盘上的一个字母实例，再走**和点击同一个** pressKey
  // 判定 —— 不经过 B.sel、不依赖任何光标。
  // 返回是否消费了这次输入（字母盘上没有这个字母时不消费）。
  function typeLetter(raw) {
    const B = state.B;
    if (!B || B.over) return false;
    const ch = String(raw || '').toLowerCase();
    if (ch.length !== 1 || ch < 'a' || ch > 'z') return false;
    const n = B.letters.length;
    // 优先挑「没被填过、也没被标错」的实例；重复字母出现多次也能对上正确的那个
    let pick = -1, fallback = -1;
    for (let i = 0; i < n; i++) {
      if (B.letters[i] !== ch || B.used[i]) continue;
      if (!B.bad[i]) { pick = i; break; }
      if (fallback < 0) fallback = i;      // 全被标错了：仍走 pressKey，由它给出「已试过」提示
    }
    if (pick < 0) pick = fallback;
    if (pick < 0) return false;            // 字母盘上根本没有这个字母 → 不当作输入
    B.sel = pick;
    pressKey(pick);
    return true;
  }

  // 退格：退回最后输入的字母，释放对应实例并清除其「已试过」标记。
  // 返回是否真的退了（空输入时为 false，交给调用方决定是否吞掉按键）。
  function undoLetter() {
    const B = state.B, G = state.G;
    if (!B || B.over || !B.input.length) return false;
    const ch = B.input.pop();
    for (let i = B.letters.length - 1; i >= 0; i--) {
      if (B.used[i] && B.letters[i] === ch) { B.used[i] = false; B.bad[i] = false; break; }
    }
    G.attOk = Math.max(0, G.attOk - 1);
    B.combo = Math.max(0, B.combo - 1);
    sfx.undo();
    renderFight();
    return true;
  }

  // 提示：揭示当前位置的下一个字母。剩下的字母已全揭示时不再白扣次数。
  function requestHint() {
    const B = state.B;
    if (!B || B.over || B.hints <= 0) return false;
    const tgt = norm(B.word.w);
    const pos = B.input.length;
    const left = tgt.length - pos;
    if (pos >= tgt.length || B.hintUsed >= left) {
      toast(pos >= tgt.length ? '这个词已经填完啦' : '剩余字母已经全部揭示');
      return false;
    }
    B.hints--; B.hintUsed++; B.hintTotal = (B.hintTotal || 0) + 1;
    // 提示同时解开被误标的字母，避免死局
    let freed = 0;
    for (let j = 0; j < B.letters.length; j++) {
      if (!B.used[j] && B.bad[j] && B.letters[j] === tgt[pos]) { B.bad[j] = false; freed++; }
    }
    sfx.hint();
    renderFight();
    const nextCh = tgt[pos] || '';
    const cat = $('fCat');
    if (cat) cat.textContent = '提示：第 ' + (pos + 1) + ' 个字母是 ' + nextCh.toUpperCase() +
      '（已揭示接下来 ' + Math.min(B.hintUsed, left) + ' / ' + left + ' 个）' +
      (freed ? ('（顺便解开了 ' + freed + ' 个误标字母）') : '');
    return true;
  }

  // 跳过 = 一次有代价的撤退。影分身（每场一次）仍然免费；否则固定损失
  // SKIP_HP_COST 点生命 —— 不走 hurtPlayer，所以护盾不吸收、幸运草不免伤。
  // ★ 扣的是 B.myHp —— 扣 G.hhp 会被 finishNode 的结转覆盖掉。
  // ★ 固定点数而不是本场生命的百分比：百分比在低血时只会扣掉一点点，
  //   玩家可以反复撤退而不真正承担风险，跳过就变成了比打完更优的策略。
  function skipFight() {
    const B = state.B, G = state.G;
    if (!B || B.over) return false;
    if (hasR('ghost') && !B.ghostUsed) {
      B.ghostUsed = true;
      toast('👻 影分身：免费撤退，不计失败');
      finishNode();
      return true;
    }
    if (hasR('ghost')) { toast('本场影分身已用完'); return false; }
    B.myHp -= SKIP_HP_COST;
    if (B.myHp <= 0) {
      // 付不起代价就是战败。★ 不要在这里先置 B.over：loseFight 开头就是
      // `if (B.over) return`，先置会让它直接返回，战斗永远不结算失败。
      // 也不调 finishNode —— 它的 clamp(myHp, 1, maxhp) 会把 0 血救成 1 血，
      // 那正是「跳过永远不会输」的旧 bug。
      B.myHp = 0;
      toast('跳过：生命耗尽（-' + SKIP_HP_COST + '），远征失败');
      loseFight();
      return true;
    }
    B.over = true;
    toast('跳过：损失 ' + SKIP_HP_COST + ' 点生命');
    finishNode();
    return true;
  }

  function fleeFight() {
    const B = state.B, G = state.G;
    if (!B || B.over || !G || G.gold < 10) return false;
    G.gold -= 10;
    B.over = true;
    toast('逃跑成功，损失 10 金币');
    sfx.flee();
    finishNode();
    return true;
  }

  // 与 winFight 的奖励面板共用同一套卡片渲染（此处导出以免 runtime 重复实现）
  return { pressKey, useItem, dealDamage, hurtPlayer, typeLetter, requestHint, skipFight, fleeFight, undoLetter };
}

// runtime 的奖励面板会用到奖励卡渲染，这里重导出，方便调用方只依赖本模块。
export { pickCardHTML, CAT_LABEL };