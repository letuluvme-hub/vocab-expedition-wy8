// 字母盘：生成 + 两种布局（A–Z 网格 / QWERTY 键盘模式）。
// 搬自 runtime.js 的 drawLetters / bankCols / bankRows / bankPosOf，纯规则、无 DOM。
import { clamp } from './math.js';
import { norm } from './text.js';

const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('');
const QWERTY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
// 每个小写字母在 QWERTY 上的 {行, 列}
const QWERTY_POS = (() => {
  const m = {};
  QWERTY_ROWS.forEach((r, ri) => { for (let i = 0; i < r.length; i++) m[r[i]] = { row: ri, col: i }; });
  return m;
})();

// 生成字母盘：答案字母 + 干扰字母（精英 +3，探险家 hnoise=-1，层数递增，上限 10）
export function drawLetters(run, battle, qword, random = Math.random) {
  const rnd = n => Math.floor(random() * n);
  const pick = a => a[rnd(a.length)];
  const shuffle = a => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  const letters = norm(qword.w).split('');
  const cnt = {};
  letters.forEach(ch => cnt[ch] = (cnt[ch] || 0) + 1);
  const uniq = [];
  Object.keys(cnt).forEach(ch => { for (let i = 0; i < cnt[ch]; i++) uniq.push(ch); });
  const noise = clamp(3 + Math.floor(run.floor / 2) + (battle && battle.elite ? 3 : 0) + (run.hnoise || 0), 2, 10);
  for (let i = 0; i < noise; i++) {
    let ch = pick(ALPHA), guard = 0;
    // 干扰字母必须不在答案里
    while (uniq.indexOf(ch) >= 0 && guard++ < 20) ch = pick(ALPHA);
    if (uniq.indexOf(ch) < 0) uniq.push(ch);
  }
  return { letters: shuffle(uniq), used: new Array(uniq.length).fill(false) };
}

// 列数：唯一来源，渲染与导航共用
export function bankCols(n) {
  return n <= 6 ? 3 : n <= 9 ? 4 : n <= 12 ? 4 : n <= 16 ? 5 : 6;
}

// 把 letters 算成 [[行内字母索引,...], ...]，行内顺序 = 视觉从左到右
// kbMode=false：字母序网格（行优先）；kbMode=true：按真实 QWERTY 行分桶，空行不输出
export function bankRows(letters, kbMode) {
  const n = letters.length, rows = [];
  if (!kbMode) {
    const cols = bankCols(n);
    const indices = letters.map((_,i)=>i).sort((a,b)=>letters[a].localeCompare(letters[b]) || a-b);
    indices.forEach((index,i)=>{ const r=(i/cols)|0; (rows[r]=rows[r]||[]).push(index) });
    return rows;
  }
  const bucket = [[], [], []];
  for (let i = 0; i < n; i++) { const p = QWERTY_POS[letters[i]]; if (p) bucket[p.row].push({ i, col: p.col }); }
  for (const b of bucket) {
    if (!b.length) continue;
    b.sort((x, y) => x.col - y.col);
    rows.push(b.map(o => o.i));
  }
  return rows.length ? rows : [[0]];   // 极端兜底：至少渲染一行
}

// 某个字母实例在当前布局下的视觉位置；找不到返回 null
export function bankPosOf(letters, kbMode, i) {
  const rows = bankRows(letters, kbMode);
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(i);
    if (c >= 0) return { row: r, col: c, rows: rows.length };
  }
  return null;
}
