// 按难度抽词：纯规则，只读 run（远征状态）与 battle（当前战斗，可能为 null）。
// 搬自 runtime.js 的 drawWord(budget)，G/B 换成参数，随机源可注入以便对照测试。
export function drawWord(run, battle, budget, random = Math.random) {
  const rnd = n => Math.floor(random() * n);
  const pick = a => a[rnd(a.length)];
  const shuffle = a => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  // 本局已答对的词不再出现；全答完则重置让整册循环巩固
  let pool = run.pool.filter(w => !run.done.has(w.w));
  if (pool.length < 3) pool = run.pool.slice();
  // 答错过的词优先复习（最多占一半）
  const due = run.wrong.map(w => pool.filter(x => x.w === w)[0]).filter(Boolean);
  const fresh = pool.filter(w => due.indexOf(w) < 0);
  if (due.length && fresh.length) {
    const fromDue = Math.min(due.length, 1 + Math.floor(due.length / 2));
    const fromFresh = Math.min(fresh.length, 1 + Math.floor(fresh.length / 2));
    pool = shuffle(due).slice(0, fromDue).concat(shuffle(fresh).slice(0, fromFresh));
  } else {
    pool = shuffle(pool);
  }
  const exact = pool.filter(w => w.d === budget);
  const harder = pool.filter(w => w.d > budget);
  const softer = pool.filter(w => w.d < budget);
  let src = exact;
  if (src.length < 3) src = src.concat(harder);
  if (src.length < 3) src = src.concat(softer);
  if (!src.length) src = pool;
  // 避免立刻重复上一个词（最多试 10 次，仍不满足就认命）
  for (let i = 0; i < 10; i++) {
    const c = pick(src);
    if (!battle || !battle.word || c.w !== battle.word.w) return c;
  }
  return pick(src);
}
