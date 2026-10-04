import { fleeGoldCost } from '../../domain/battle-rules.js';
/* 战斗页渲染：HUD（两条血条）、敌人形象、词信息、槽位、字母盘、道具栏、按钮状态。
 *
 * 契约：
 *  - 状态只从 getRun() / getBattle() / getDB() 取，绝不偷读模块级 DB/G/B。
 *  - 只画不结算：伤害、掌握、连击、背包消耗都在父层；这里只读快照 + 发回调。
 *  - renderFight 可写 B.keyEls（字母索引 → DOM 按钮的视觉缓存），供父层做动画定位。
 *  - onPress(i) 由父层负责设置 B.sel 再判定；本模块只把索引交出去。
 *
 * bankCols / bankRows / bankPosOf 住在 src/domain/letter-bank.js（纯规则、无 DOM）。
 * 这里只做 re-export，让战斗页的调用点不必知道它住在哪一层；
 * 「字母索引 ↔ 视觉行列」永远只有一份实现，渲染与键盘导航不会各算各的。
 */
export { bankCols, bankRows, bankPosOf } from '../../domain/letter-bank.js';
import { bankCols, bankRows } from '../../domain/letter-bank.js';
import { ITEMS } from '../../data/items.js';
import { clamp } from '../../domain/math.js';
import { norm, wordGapBefore } from '../../domain/text.js';
import { comboRate as calculateComboRate } from '../../domain/damage.js';
import { foeTraits } from '../../domain/foe-traits.js';
import { pixelMonsterSVG, pixelIconSVG } from '../components/pixel-art.js';
import { SKIP_HP_COST } from '../../data/balance.js';
import { HERO_DEFAULT, heroById } from '../components/hero.js';
import { paintHpBar } from '../components/hp-bar.js';
import { fitPhraseSlots } from '../components/phrase-slots.js';
import { createEquipmentPanel } from '../components/equipment-panel.js';
import { createBattleDetails } from '../components/battle-details.js';
import { createFoeAttackMeter } from '../components/foe-attack-meter.js';
import { createComboMilestoneTrack } from '../components/combo-milestones.js';
import { createWordOffer } from '../components/word-offer.js';
import { estimateWordDamage, canSwitchWord } from '../../domain/word-choice.js';
import { FOE_ART_SCALE_MAX } from '../../data/balance.js';

const itemById = id => ITEMS.filter(x => x.id === id)[0];

export function createFightScreen({ getRun, getBattle, getDB, onPress, onUseItem, paintSayBtn, getFoeAttackWindow, getFoeAttackFact, onChooseWord, onOpenDetails, onCloseDetails }) {
  const $ = id => document.getElementById(id);
  const isKbMode = () => !!getDB().kbMode;
  const isKbUpper = () => !!getDB().kbUpper;
  const hasR = id => getRun().relics.indexOf(id) >= 0;
  const comboRate = () => calculateComboRate(getRun());
  // 「装备与能力」只读面板：挂在道具栏后面，自己在 #fItems 旁边建 <details>。
  // 它读的是同一批 G/B 快照，不做任何结算；这里每帧调用也不会重复生效。
  const details = createBattleDetails({getRun,getBattle,onOpen:onOpenDetails,onClose:onCloseDetails});
  const equipmentPanel = createEquipmentPanel({ getRun, getBattle, getMount:details.getMount });
  // 蓄力条（清单 13）：只读 battle.foeAttack 这个事实，自己不排期、不改状态。
  const foeAttackMeter = createFoeAttackMeter({ $, compact:true });
  // 战意条：只读 run.milestones 与 battle.combo，自己不发放任何奖励。
  // 容器缺席时组件安静返回 null（未接线的测试台 / 旧页面），不影响其余渲染。
  const comboTrack = createComboMilestoneTrack({ $ });
  // 选词条：只读 battle.offer 并算预估伤害（不改战斗），点卡交回索引。
  const wordOffer = createWordOffer({ $ });
  function paintOffer() {
    const G = getRun(), B = getBattle();
    const offer = Array.isArray(B.offer) ? B.offer : [];
    wordOffer.paint({
      offer, current: B.word, canSwitch: canSwitchWord(B),
      cards: offer.map(w => {
        const est = estimateWordDamage(G, B, w);
        return { letters: norm(w.w).length, total: est.total, lethal: est.total >= B.enHp };
      }),
      onPick: i => { if (onChooseWord) onChooseWord(i); },
    });
  }
  // 怪物放大（清单 13）：只改 #fAv 自己的尺寸变量，上限由数据层钉死（≤1.2 倍）。
  // ★ 绝不碰 .avatar 的既有形状/动画/滤镜 —— 玩家已经认可那些形象与特效。
  //   放大走 inline style 而不是新样式表：这样 styles.test.js 那条
  //   「新增表只允许作用于自己的容器」的断言继续成立，也就不会回退线上外观。
  // ★ 基准尺寸必须取**样式表**的 --avatar，不能读 #fAv 自己的 computed width：
  //   那个值已经含了上一次写的 inline width，每帧乘一次就会指数放大成巨型怪物。
  //   --avatar 由 responsive.css 按屏幕高度切换，所以窄屏自动跟着变小。
  // ★ 基准尺寸取 **#fAv 自己的** --avatar，不读 #fAv 的 computed width：
  //   那个值已经含了上一次写的 inline width，每帧乘一次就会指数放大成巨型怪物。
  //   --avatar 由样式表按屏幕高度切换，所以窄屏自动跟着变小；读到 88px 这种值时
  //   乘出来正好和角色同宽（1.2 × 88 ≈ 106 ≈ 角色的 104）。
  //   2026-10-02 起这个变量改由 #fAv 自己声明（styles/foe-avatar.css）——
  //   combat.css / responsive.css 是与归档逐字相同的冻结表，不许再动，
  //   而 #fAv 的尺寸正是「新增覆盖」该待的地方。@media 里的规则同样以 #fAv 打头。
  function paintFoeScale() {
    const av = $('fAv');
    if (!av) return;
    // Node 测试台里没有 getComputedStyle：读不到就退回改动前的 64（×1.2 = 76.8），
    // 也就是「样式表缺席」时的老尺寸。守卫不能省 —— 直接调用会让每个渲染战斗页的
    // 单测在 getComputedStyle 上抛 ReferenceError。
    const view = typeof getComputedStyle === 'function' ? getComputedStyle(av) : null;
    const declared = view ? view.getPropertyValue('--avatar') : '';
    const base = parseFloat(declared) || 64;
    const size = Math.round(base * FOE_ART_SCALE_MAX);
    av.style.width = size + 'px';
    av.style.height = size + 'px';
    av.style.fontSize = Math.round(size * 0.53) + 'px';   // 与 .avatar 的 .53 比例一致
  }

  /* 渲染道具栏：只显示玩家真正持有的道具，并标出快捷键 */
  function renderItems() {
    const G = getRun(), B = getBattle();
    const box = $('fItems'); if (!box) return;
    box.innerHTML = ''; box._kids = [];
    const held = Object.keys(G.bag || {}).filter(id => (G.bag[id] | 0) > 0);
    if (!held.length) {
      box.innerHTML = '<div class="none">🎒 背包是空的 —— 商店和精英战会掉落道具</div>';
      return;
    }
    held.forEach((id, idx) => {
      const it = itemById(id); if (!it) return;
      const left = G.bag[id] | 0;
      const usedInFight = (B.usedThisFight[id] | 0);
      const capped = usedInFight >= it.max;
      const b = document.createElement('button');
      b.className = 'item' + (left <= 0 || capped ? ' off' : '') + (B.rageLeft > 0 && id === 'rage' ? ' fire' : '');
      b.title = it.d + '\n' + it.tip + (capped ? '\n（本场已用满 ' + it.max + ' 次）' : '');
      // 像素图标优先；认不出的 id 回落到数据层自带的 emoji（两者都是我们自己表里的内容，
      // 绝不含玩家或存档写入的字符串）。
      const icon = pixelIconSVG(id) || it.ic;
      b.innerHTML = '<span class="kb">' + (idx + 1) + '</span><span class="ct">×' + left + '</span>' +
        '<span class="ic">' + icon + '</span><span class="nm">' + it.n + '</span>';
      if (!capped) b.onclick = () => onUseItem(id);
      box.appendChild(b);
    });
  }

  // 同步字母盘模式按钮的高亮状态与文案（renderFight 每次都会调）
  function syncBankBar() {
    const mb = $('tBankMode'), cb = $('tBankCase'), mv = $('tBankModeV'), cv = $('tBankCaseV');
    if (mb) mb.className = 'bkbtn' + (isKbMode() ? ' on' : '');
    if (cb) cb.className = 'bkbtn' + (isKbUpper() ? ' on' : '');
    if (mv) mv.textContent = isKbMode() ? 'QWERTY' : '字母序';
    if (cv) cv.textContent = isKbUpper() ? '开' : '关';
    try { paintSayBtn(); } catch (e) { }     // 语音按钮状态跟着战斗渲染一起刷新
  }

  let portraitHost = null, portraitMarkup = null;
  function renderFight() {
    const G = getRun(), B = getBattle(), DB = getDB();
    const enPct = clamp(B.enHp / B.enMax * 100, 0, 100);
    $('fEn').style.width = enPct + '%';
    $('fEnT').textContent = B.boss ? ('词汇之王 ' + Math.max(0, B.enHp) + '/' + B.enMax) : (Math.max(0, B.enHp) + '/' + B.enMax);
    paintHpBar('fMy', 'fMyS', 'fMyT', B.myHp, B.shield, G.maxhp);
    // 角色形象：只更新外形数据属性 + 名字（血条统一由上面的 HUD 负责）
    const H = heroById(G.heroId || HERO_DEFAULT), pc = $('fPc');
    if (pc) pc.dataset.h = H.id;
    const nm = $('fMyName'); if (nm) nm.textContent = H.n;
    const avatar = $('fAv'), art = pixelMonsterSVG(B.foe, B.boss, B.elite);
    if (avatar !== portraitHost || art !== portraitMarkup) {
      avatar.innerHTML = art; portraitHost = avatar; portraitMarkup = art;
    }
    paintFoeScale();
    // 蓄力条：数据由 app/foe-attacks.js 挂在 B.foeAttack 上（可能还没有 → 组件隐藏自己）。
    const attackFact = getFoeAttackFact ? getFoeAttackFact() : B.foeAttack;
    foeAttackMeter.paint(attackFact, getFoeAttackWindow ? getFoeAttackWindow() : null);
    $('fName').textContent = B.foe.n + (B.boss ? '（首领）' : B.elite ? '（精英）' : '');
    paintOffer();
    $('fZh').textContent = B.word.z;
    // Long meanings stay complete; only their mobile typography changes.
    // Clear the flag when selecting a shorter word so its usual size returns.
    if (Array.from(String(B.word.z || '')).length > 24) $('fZh').dataset.dense = 'true';
    else delete $('fZh').dataset.dense;
    // 字符数按 norm() 的字母数算（否则 keep an eye on 会显示「14 字符」，
    // 而槽位只有 11 个，对不上）；词组额外标一个「词组」标签。
    // ★ 长度与 isPhrase 都先算成局部变量再拼进文案：信息栏绝不能回显单词本身。
    const nLetters = norm(B.word.w).length;
    const isPhrase = /\s/.test(String(B.word.w || ''));
    $('fCat').textContent = 'Unit ' + B.word.u + ' · ' + nLetters + ' 字符' + (isPhrase ? ' · 词组' : '') + (B.word.d >= 3 ? ' · 困难' : '');
    // tags
    const tg = $('fTags'); tg.innerHTML = '';
    const add = (txt, cls) => { const s = document.createElement('span'); s.className = 'tg ' + (cls || ''); s.textContent = txt; tg.appendChild(s); };
    if (B.combo > 0) add('连击 ' + B.combo, 'ok');
    if (B.dmgBonus > 0) add('增伤 +' + B.dmgBonus + '%', 'ok');
    if (B.hintTotal > 0) add('已用提示 ' + B.hintTotal, 'bad');
    if (B.boss) add('首领', 'bad');
    // 怪种机制（石化词素等）：必须让玩家**看得见**才谈得上「针对性应对」。
    // 只读 foe.n 解析（domain/foe-traits.js），没登记的怪不占位、不改布局。
    const trait = foeTraits(B.foe);
    if (trait) add(trait.tag, 'bad');
    // slots
    const sl = $('fSlots'); sl.innerHTML = '';
    const tgt = norm(B.word.w);
    // 词组：单词边界表。gapBefore[i]=true 表示第 i 个字母是一个新单词的首字母
    //（也就是它前面在原文里是个空格）。判定完全不看这张表 —— 仍只用 norm() 的 tgt。
    const gapBefore = wordGapBefore(B.word.w, tgt.length);
    // 提示窗口是「相对当前位置」的：从当前进度往后 hintUsed 个字母。
    const absFrom = B.input.length;
    const absTo = Math.min(absFrom + Math.max(0, B.hintUsed), tgt.length);
    for (let i = 0; i < tgt.length; i++) {
      // 空格分隔：画在【前一个单词的最后一个字母之后】。
      // 用 i>0 && gapBefore[i] 触发，保证不会多出一个头部间隔。
      if (i > 0 && gapBefore[i]) {
        const sep = document.createElement('div');
        sep.className = 'slotsep';           // 故意不带 'slot'：不进索引、不参与判定
        sep.setAttribute('aria-hidden', 'true');
        sl.appendChild(sep);
      }
      const d = document.createElement('div');
      let cls = 'slot';
      if (i < absFrom) cls += B.input[i] === tgt[i] ? ' f' : ' w';
      else if (i < absTo) cls += ' hint';
      d.className = cls;
      d.textContent = (i < absFrom) ? B.input[i] : (i < absTo ? tgt[i] : '');
      sl.appendChild(d);
    }
    fitPhraseSlots(sl, gapBefore);
    // bank —— 两种排布共用同一份数据（used/bad/sel 全在 B 上，切模式不会丢进度）
    const bank = $('fBank');
    const n = B.letters.length;
    const kb = isKbMode(), upper = isKbUpper();
    const rows = bankRows(B.letters, kb);   // 视觉行：键盘模式=qwer 三行，字母盘模式=原 grid 分行
    bank.className = 'bank ' + (kb ? 'kb' : 'grid');
    if (kb) {
      // 键宽自适应：让「最长行」正好塞进容器宽，绝不溢出、也尽量不缩得太小。
      // 行宽 = 行内键数×键宽 + (n-1)×间距，而阶梯缩进 padding-left 也会吃掉一点宽度，
      // 所以要解 kw = (可用宽 - (n-1)×间距) / (n + 阶梯系数)，多行取最小值。
      const GAP = 7, STAIR = [0, .42, .84];        // 与 CSS 里 .kbrow.r1/.r2 的 padding 保持一致
      const pe = bank.parentElement;
      const availW = bank.clientWidth || (pe && pe.clientWidth) || (typeof innerWidth === 'number' && innerWidth) || 390;
      let kw = 52;
      rows.forEach((row, ri) => {
        const n2 = row.length || 1, k = STAIR[ri] !== undefined ? STAIR[ri] : .84;
        kw = Math.min(kw, Math.floor((availW - (n2 - 1) * GAP) / (n2 + k)));
      });
      kw = Math.max(20, Math.min(52, kw || 44));   // 最坏情况（320px + 满行 qwerty）也不会溢出
      bank.style.setProperty('--kbw', kw + 'px');
      bank.style.gridTemplateColumns = '';    // 键盘模式不用 grid，避免与 CSS 的 flex 打架
      bank.style.maxWidth = '';
    } else {
      // 列数随字母数增加，但限制最多 6 列，窄屏才不会挤
      const cols = bankCols(n);
      bank.style.gridTemplateColumns = 'repeat(' + cols + ',minmax(0,1fr))';
      bank.style.maxWidth = (cols * 66) + 'px';
    }
    bank.innerHTML = '';
    const keyEls = B.keyEls = [];             // 字母索引 → DOM 按钮（键盘模式 children 是行，索引对不上）
    const mkKey = (ch, i) => {
      const b = document.createElement('button');
      let cls = 'key';
      if (B.used[i]) cls += ' gone';
      else if (B.bad[i]) cls += ' bad';
      if (upper) cls += ' uc';
      b.className = cls;
      b.textContent = upper ? ch.toUpperCase() : ch;   // 纯显示层；判定仍读小写的 B.letters[i]
      b.disabled = B.used[i];
      b.title = B.used[i] ? '已填入' : B.bad[i] ? '已试过，不是这个字母' : '';
      b.onclick = () => onPress(i);
      keyEls[i] = b;
      return b;
    };
    if (kb) {
      rows.forEach((row, ri) => {           // 每行一个 .kbrow，行内居中 + 阶梯缩进（r0/r1/r2）
        const r = document.createElement('div');
        r.className = 'kbrow r' + ri;
        row.forEach(i => r.appendChild(mkKey(B.letters[i], i)));
        bank.appendChild(r);
      });
    } else {
      rows.forEach(row => row.forEach(i => bank.appendChild(mkKey(B.letters[i], i))));
    }
    syncBankBar();
    $('tHintN').textContent = B.hints + ' 次';
    const shared=$('fHintShared');
    if(shared) shared.textContent='听读音 / 提示共用：剩余 ' + B.hints + ' 次';
    $('tHint').disabled = B.hints <= 0;
    // 跳过按钮：innerHTML 而不是 textContent —— textContent 会抹掉 <small> 里的代价说明。
    // ★ 影分身额度是 run 级（G.ghostUsed），不是本场（B 上没有任何 ghost 状态）：
    //   可用 → 「影分身 · 本轮仅剩 1 次」；用完 → 回到普通跳过并写明已用完与固定代价。
    //   只读 G，所以换战斗/重复拿到影分身都不会把按钮错误地显示成免费。
    const ghostLeft = hasR('ghost') && !G.ghostUsed;
    $('tSkip').innerHTML = ghostLeft
      ? '影分身<small>免费撤退 · 本轮仅剩 1 次</small>'
      : '跳过<small>损失 ' + SKIP_HP_COST + ' 生命</small>';
    $('tSkip').title = !hasR('ghost')
      ? '撤退：损失 ' + SKIP_HP_COST + ' 点生命（生命不足即战败）'
      : (ghostLeft
        ? '影分身：本轮远征唯一一次免费撤退，不计失败、不扣生命'
        : '影分身本轮已用完：撤退需要损失 ' + SKIP_HP_COST + ' 点生命');
    const fleeCost = fleeGoldCost(G.gold);
    $('tFlee').disabled = G.gold < fleeCost;
    $('tFlee').innerHTML = '逃跑<small>损失 ' + fleeCost + ' 金币</small>';
    $('tFlee').title = '损失一半金币，最低 50；不获得怪物奖励（余额不足不能逃跑）';
    $('fCombo').textContent = B.combo > 0 ? ('连击 ' + B.combo + '  ✦ 伤害 ×' + (1 + B.combo * comboRate()).toFixed(1)) : '';
    // 战意条紧挨着连击行：目标是可见才有追求。纯只读，绝不在这里发奖励。
    comboTrack.paint(B.combo, G.milestones);
    renderItems();
    equipmentPanel.renderEquipmentPanel();
    details.render();
    if(details.isOpen())foeAttackMeter.pause();
    return B.keyEls;
  }

  /* 蓄力条的**刷新**口（250ms UI 节拍走它）。
   * ★ 与 renderFight 分开是硬约束：节拍每 250ms 调一次，走整屏渲染会把字母盘
   *   重建 —— 玩家点一个字母点到一半按钮被换掉、键盘焦点丢失，每秒四次。
   *   这里只把事实交给 meter.paintLive（只改已有元素的宽度与文案）。
   *   组件还没有被 renderFight 画过时（首次刷新早于首屏渲染）自动退回整块 paint。 */
  function paintFoeAttack(fact) {
    return foeAttackMeter.paintLive(fact, getFoeAttackWindow ? getFoeAttackWindow() : null);
  }

  return { renderFight, renderItems, syncBankBar, paintFoeAttack, pauseFoeAttack: foeAttackMeter.pause,
    renderEquipmentPanel: equipmentPanel.renderEquipmentPanel };
}
