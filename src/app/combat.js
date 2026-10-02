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
import { applyDamage, canFinishFight } from '../domain/battle-rules.js';
import { newlyReached, milestoneGrant, milestoneToast } from '../domain/combo-milestones.js';
import { synergyBonuses } from '../domain/relic-rules.js';

export function createCombatController({ state, ports }) {
  const { $, norm, clamp, rnd, hasR, itemById, hitDmg, wordDmg, wordComplete, creditWord,
    onWordWrong, centerOf, heroPoint, toast, sfx, TTS, burst, floatTxt, flash, ring, animHero,
    wordFinisher, foeCry, renderFight, nextWord, winFight, loseFight, finishNode, saveDB,
    scheduleBattle } = ports;

  /* winFight 的本地闸门。判据**只用** domain/battle-rules.js 的 canFinishFight ——
   * 不在这里另写一份 `B.over || B.finished`：本地判据一旦和 runtime 那份漂移，
   * 就会出现「这里放行、那里拒绝」或反过来的授权不一致。两处共用同一个函数，
   * 与 finishBattleNode 依赖的 battle.finished 标记自然对齐，防止同一场战斗重复发奖。 */
  const tryWin = () => {
    const B = state.B;
    if (!canFinishFight(B)) return false;
    winFight();
    return true;
  };

  // runtime 里这些是浏览器全局；Node 桩没有，必须退化成 0 而不是抛 ReferenceError。
  const vw = () => (typeof innerWidth === 'number' ? innerWidth : 0);
  const vh = () => (typeof innerHeight === 'number' ? innerHeight : 0);

  /* ---------- 伤害：敌人掉血 + 反馈包 ---------- */
  function dealDamage(d) {
    const B = state.B;
    // ★ 非完整词伤害：不传 allowFinish → 敌人永远留 1 血，单字母打不死。
    //   「最后一击必须拼完整词」这条规则的执行点就在这个默认参数上。
    const hit = applyDamage(B, d);
    animHero('atk');                                   // ← 角色追加：每个正确字母都挥一下
    const av = $('fAv');
    if (av) {
      av.classList.remove('hurt');
      void av.offsetWidth;
      av.classList.add('hurt');
    }
    const c = centerOf(av);
    burst(c.x, c.y, B.foe.tint, 20, 5);
    // 反馈展示**实际**扣掉的血：1 血地板生效时报的是真的掉了几点，
    // 不能报玩家按下去那个伤害值（否则会看到 -40 而敌人只掉了 3 点）。
    floatTxt(c.x, c.y, '-' + hit.dealt, B.foe.tint);
    // 角色出手的火花：从角色位置飞向敌人，形成「攻击」的视觉因果
    const hp = heroPoint();
    if (hp.x > 0 && hp.x < vw()) burst((hp.x + c.x) / 2, (hp.y + c.y) / 2, '#ffffff', 6, 4.5);
    sfx.hit();
    // 这里**不再**判胜负。整场战斗唯一的胜利来源是 pressKey 里的整词大招分支；
    // 单字母 / 荆棘即使把敌人压到 1 血也只继续战斗，不调 winFight。
  }

  /* ---------- 受伤：护盾 → 生命 → 荆棘 → 错词记录 ---------- */

  /* 预知残卷（传说）：答错时把当前这个词**剩下的全部字母**揭示出来。
   *
   * 为什么不是「揭示下一个字母」：那只是提示水晶的加强版，传说不该是加强版。
   * 全词揭示改的是玩家的**节奏**—— 一次失误直接换来「这个词我已经知道答案了」，
   * 于是「答错」从纯粹的惩罚变成一次买信息。代价是 1 点提示额度：
   * 提示是玩家唯一的应急按钮（不消耗任何资源就问答案），拿它换被动兜底，
   * 而且额度（每场基础 3 次）用完即止 —— 于是这是取舍，不是净增益。
   *
   * 返回是否真的揭示了。调用点只有 hurtPlayer 一处（答错路径）；
   * 自主攻击 enemyHit 绝不调它 —— 怪打人不是玩家的失误，不该奖励信息。
   */
  function prophecyReveal() {
    const B = state.B, G = state.G;
    if (!B || B.over || !G || !hasR('prophecy')) return false;
    // ★ 一轮远征只触发**一次**（G.prophecyUsed，跟着快照走）。
    //   早先它是「每次答错都揭示，代价 1 点额度」—— 而 B.hints 有 3-5 点底子
    //   （还有遗物与卷轴加成），于是实际是每局白嫖 3-5 次完整答案。
    //   在一个以「回忆拼写」为唯一学习动作的游戏里，那等于把这一局的教学价值抹掉。
    //   改成一次性之后，它仍然是「把答错这件事从惩罚变成信息」那件传说遗物，
    //   但不再摧毁后续每一个词的回忆过程。
    if (G.prophecyUsed) return false;
    if ((B.hints | 0) <= 0) return false;              // 额度用尽 → 彻底失效
    const tgt = norm(B.word.w);
    const pos = B.input.length;
    if (pos >= tgt.length) return false;               // 词已经填完，没什么可揭示
    // 把范围内所有被误标的正确字母解封：只解 pos 那一格不够，
    // 全词揭示之后玩家还要能逐个按下去，漏解一格就可能把词锁死。
    let freed = 0;
    for (let k = pos; k < tgt.length; k++) {
      for (let j = 0; j < B.letters.length; j++) {
        if (!B.used[j] && B.bad[j] && B.letters[j] === tgt[k]) { B.bad[j] = false; freed++; }
      }
    }
    B.hints = (B.hints | 0) - 1;
    B.hintTotal = (B.hintTotal | 0) + 1;
    B.hintUsed = tgt.length - pos;
    G.prophecyUsed = true;                             // 记账在 run 上：换战斗不重置
    toast('📜 预知残卷：' + B.hintUsed + ' 个字母全部揭示（提示 −1）'
      + (freed ? '，顺便解开了 ' + freed + ' 个误标字母' : '')
      + ' —— 本轮的这一次已用尽');
    return true;
  }
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
    // 荆棘护符：答错时反弹 5 血给敌人（只结算一次）。
    // ★ 反弹同样是非完整词伤害：可以削血，但永远打不死、也不触发胜负。
    //   玩家答错一次就把 BOSS 打死，等于绕过了「必须拼完整个词」这条底线。
    //   荆棘壁垒组合（护盾符文 + 荆棘护符）把反弹抬到 8，并把其中 4 点转成
    //   护盾 —— 挨打本身变成回盾的循环，这才叫组合而不是加法。
    if (hasR('thorn') && dmg > 0) {
      const tc = centerOf($('fAv'));
      const syn = synergyBonuses(G.relics);
      const reflect = syn.thornReflect || 5;
      const thorn = applyDamage(B, reflect);
      floatTxt(tc.x, tc.y, '荆棘 -' + thorn.dealt, '#3ddc84');
      if (syn.thornShield) {
        const gain = Math.min(syn.thornShield, Math.max(0, G.maxhp - B.shield));
        if (gain > 0) {
          B.shield += gain;
          floatTxt(vw() / 2, vh() * 0.35, '壁垒 +' + gain, '#22d3ee');
        }
      }
    }
    // 预知残卷（传说）：答错 → 把这个词剩下的字母全部揭示，代价是 1 点提示额度。
    //   ★ 它不免除任何惩罚：照常扣血、照常记错词、照常进复习队列 ——
    //     它买到的只是「信息」，不是「免责」。额度用完就彻底失效，
    //     所以这是有限资源决策，不是白捡的加强版。
    prophecyReveal();
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

  /* 通知「玩家刚做了一次有效字母尝试」→ 蓄力打断（清单 13）。
   * 只在 pressKey **真正接受**一次输入后调用；越界、已用、已试过、
   * 自动解锁、退格、提示都不算。没有这个端口（未接入战斗）时静默返回 false。 */
  function notifyAttempt() {
    if (typeof ports.notifyLetterAttempted !== 'function') return false;
    return ports.notifyLetterAttempted() === true;
  }

  /* ---------- 自主攻击：怪蓄满了打玩家一下（清单 13） ----------
   *
   * ★ 为什么必须独立于 hurtPlayer：hurtPlayer 是「玩家答错」的惩罚路径 ——
   *   它会把当前词记成错词、踢进本局复习队列、从 DB.mastered 里删掉，
   *   还要消耗幸运草 / 首领首击减半。自主攻击是**怪自己在打人**，
   *   走那条路径等于凭空把一个玩家根本没答错的词判成错词：直接破坏学习主线，
   *   而且 mastered / G.att 这类计数会被一只怪物悄悄改掉。
   *   所以这里只有「护盾 → 生命 → 判负」三步，别的什么都不碰。
   *   不触发荆棘反弹（那是答错的补偿）、不发假胜利、不动任何计数。
   */
  function enemyHit(d) {
    const B = state.B, G = state.G;
    if (!B || B.over || B.finished) return { dealt: 0, lost: false };
    let dmg = typeof d === 'number' && isFinite(d) && d > 0 ? d : 0;
    let absorbed = 0;
    if (dmg > 0 && B.shield > 0) {
      absorbed = Math.min(B.shield, dmg);
      B.shield -= absorbed;
      dmg -= absorbed;
      floatTxt(vw() / 2, vh() * 0.35, '护盾 -' + absorbed, '#22d3ee');
    }
    if (dmg > 0) {
      B.myHp -= dmg;
      animHero('hurt');
      centerOf($('fAv'));
      floatTxt(vw() / 2, vh() * 0.42, '-' + dmg, '#ff5470');
      flash('#ff54702e');
      sfx.hurt();
      if (G && B.myHp > 0 && B.myHp < G.maxhp * 0.3 && !B._lowSaid) {
        B._lowSaid = true;
        TTS.line('low', null, { force: true });
      } else if (G && B.myHp >= G.maxhp * 0.5) B._lowSaid = false;
    }
    const lost = B.myHp <= 0;
    if (lost) loseFight();
    return { dealt: absorbed + (dmg > 0 ? dmg : 0), absorbed, lost };
  }

  /* ---------- 战意·连击里程碑（docs/feature-combo-milestones.md） ----------
   *
   * 这是与「知识成长」**并存**的第二条成长线：知识线跨轮次、持久，
   * 奖励是下轮生命上限；战意线在本轮内，奖励是当轮的护盾 / 生命 / 提示。
   * 触发口径是 B.combo —— 也就是玩家**这一串字母答得多准**。
   *
   * 三条不能破的边界：
   *  1) **判据在规则层**：门槛、跨没跨过、到账多少，全由 domain/combo-milestones.js
   *     算完返回。这里只做「按返回值加到已有字段上」——
   *     绝不重新设计伤害 / 生命上限公式（那两条属于难度曲线）。
   *  2) **一轮一次**：记在 run.milestones 上而不是 battle 上。护盾会跨战斗结转，
   *     放 battle 上等于每场都发一轮 → 打得越多盾越厚的滚雪球。
   *  3) **增量都是夹好的非负数**：满血/满盾时到账 0，绝不越上限、绝不为负。
   *     文案由规则层生成，到账 0 时如实写「已满，未额外获得」，不谎报奖励。 */
  function fireComboMilestones(B, G) {
    if (!B || !G) return;
    // run.milestones 缺失（老内存态）或形状不对（外部输入）时先归一，
    // 否则下面 `G.milestones[m.id] = true` 会写到字符串的下标上，静默丢掉记账。
    if (!G.milestones || typeof G.milestones !== 'object' || Array.isArray(G.milestones)) {
      G.milestones = {};
    }
    const reached = newlyReached(B.combo, G.milestones);
    for (const m of reached) {
      const grant = milestoneGrant(m, { shield: B.shield, myHp: B.myHp, maxhp: G.maxhp });
      // 先记账再发放：万一发放过程抛错，同一阶也不会被重复发第二次。
      G.milestones[m.id] = true;
      if (grant.shield) B.shield += grant.shield;
      if (grant.heal) B.myHp = Math.min(G.maxhp, B.myHp + grant.heal);
      if (grant.hint) B.hints += grant.hint;
      toast(milestoneToast(m, grant));
      sfx.combo();
    }
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
        // ★ 代价：吃掉 1 点提示额度（与内置提示键同一个池子）。
        //   以前这里是纯白赚 —— 揭示 2 个字母且「不消耗提示次数」，于是它永远
        //   优于按提示键，道具就退化成了免费版按钮。现在它是一次取舍：
        //   你要信息，就得从应急预算里扣。
        B.hints = Math.max(0, (B.hints | 0) - 1);
        B.hintUsed = Math.max(B.hintUsed, 2);
        B.hintTotal = Math.max(B.hintTotal || 0, 2);
        {
          const rt = norm(B.word.w), rp = B.input.length;
          const need = Math.min(2, rt.length - rp);
          for (let j = 0; j < B.letters.length; j++) {
            if (!B.used[j] && B.bad[j] && B.letters[j] === rt[rp]) B.bad[j] = false;
          }
          msg = '👁️ 透视：已揭示接下来 ' + need + ' 个字母（消耗 1 次提示）';
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
      // ★ 有效字母尝试 → 通知蓄力打断（清单 13）。放在**判定之后**：
      //   只有真正被接受（不是 used / bad 重复 / 不在盘上）才算一次尝试，
      //   所以「一直按同一个错字母」不能维持永远安全。
      notifyAttempt();
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
      // 战意里程碑：放在连锁闪电**之后**（道具一次 +3 会把连击推过门槛，
      // 跨过同样算达成），放在 wordComplete **之前**（整词拼完会把 combo 清零）。
      fireComboMilestones(B, G);
      if (hasR('focus') && B.combo > 0 && B.combo % 6 === 0) B.dmgBonus += 5;
      if (B.word.d >= 3 && B.combo > 0 && rnd(6) === 0) toast('💡 记住这个词！');
      if (wordComplete()) {
        // ── 整词拼完：一次大招，也是全游戏唯一的致命伤害 ───────────────────
        // 判据用 wordComplete()（和 winFight 授权里同一个函数），不用裸 input.length 比较。
        // ★ allowFinish=true：只有这一处允许把 enHp 压到 <=0。
        //   dealDamage 里那个字母命中已经先把敌人扣到 1 血地板，所以这里
        //   「最后一个字母的普通 hit」绝不会抢先赢 —— 赢一定发生在大招上。
        const bonus = wordDmg();       // 大招伤害：≥ 单字母 ×3.2
        creditWord(B.word.w);          // 整词拼完 → 记为学会（掌握表 + 本局退休）
        B.wordsDone = (B.wordsDone || 0) + 1;
        B.wordStreak = (B.wordStreak || 0) + 1;   // 连续整词 → 下一次大招更强
        wordFinisher(B.word.w, bonus);
        sfx.word();
        foeCry('hit');
        TTS.word(B.word.w);
        if (hasR('battery') && B.wordsDone % 3 === 0) { B.myHp = Math.min(G.maxhp, B.myHp + 3); toast('🔋 永动电池：回复 3 生命'); }
        const fin = applyDamage(B, bonus, { allowFinish: true });
        if (fin.lethal) { renderFight(); foeCry('die'); tryWin(); return; }
        B.combo = 0;          // 换词时连击结算：防止伤害跨词无限叠加
        nextWord();
        return;
      }
      renderFight();
    } else {
      // ❌ 错误：区分「单词里根本没这个字母」和「字母对、只是顺序不对」
      const inWord = tgt.indexOf(ch) >= 0;
      // 有效尝试（清单 13）：错字母同样打断蓄力 —— 用户原意是「输入字母则可以
      // 打断」。但**打断与教学惩罚分开记**：下面的 12/6 点扣血、错词记录、
      // 复习队列一条都不少。打断只是额外多一个战术收益，绝不替代代价。
      notifyAttempt();
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
        // 连击共鸣（连击徽章 + 专注头环）：**保留下来的那部分连击不许白留**。
        //   没有这一步，组合技只是把「保留一半」念了两遍。转成本场增伤后，
        //   答错从纯损失变成「亏血换伤害」，失误的代价与收益第一次有了交叉。
        //   ★ 只读 B.combo 现有状态做换算，不新增任何连击触发的检查点 ——
        //   连击里程碑的判定是另一条并行任务的地盘。
        const perCombo = synergyBonuses(G.relics).resonancePerCombo;
        if (perCombo && B.combo > 0) {
          const gain = B.combo * perCombo;
          B.dmgBonus += gain;
          toast('⚡ 连击共鸣：保留 ' + B.combo + ' 连击，本场伤害 +' + gain + '%');
        }
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

  // 跳过 = 一次有代价的撤退。影分身额度是 **run 级**（G.ghostUsed），一轮远征只免费一次；
  // 用完之后回落到普通跳过（固定损失 SKIP_HP_COST 点生命），而不是拒绝、也不是永久禁用。
  // ★ 扣的是 B.myHp —— 扣 G.hhp 会被 finishNode 的结转覆盖掉。
  // ★ 固定点数而不是本场生命的百分比：百分比在低血时只会扣掉一点点，
  //   玩家可以反复撤退而不真正承担风险，跳过就变成了比打完更优的策略。
  function skipFight() {
    const B = state.B, G = state.G;
    if (!B || B.over) return false;
    // 额度判据只看 run 上的 G.ghostUsed —— 不看 B，所以换战斗、重复拿到影分身都不重置。
    // 缺字段（老存档/旧快照）按 falsy 处理，即仍可用一次。
    if (G && hasR('ghost') && !G.ghostUsed) {
      G.ghostUsed = true;
      // ★ 先置 B.over 再 finishNode：连点时第二次调用被开头的 `if (B.over) return` 挡住，
      //   不会重复结算。免费撤退也必须走 finishNode（BOSS 仍然是失败，只是免费）。
      B.over = true;
      toast('👻 影分身：免费撤退（本轮唯一一次），不计失败');
      finishNode();
      return true;
    }
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
    toast('跳过：损失 ' + SKIP_HP_COST + ' 点生命'
      + (hasR('ghost') ? '（影分身本轮已用完）' : ''));
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
  return { pressKey, useItem, dealDamage, hurtPlayer, enemyHit, typeLetter, requestHint, skipFight, fleeFight, undoLetter };
}

// runtime 的奖励面板会用到奖励卡渲染，这里重导出，方便调用方只依赖本模块。
export { pickCardHTML, CAT_LABEL };