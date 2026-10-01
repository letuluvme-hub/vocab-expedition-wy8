// 按难度抽词：纯规则，只读 run（远征状态）与 battle（当前战斗，可能为 null）。
// G/B 是参数，随机源可注入以便对照测试。
//
// 三条不能破的契约（见 docs/feature-word-queue.md）：
//  1) 本轮已完成的词（run.done）**绝不**作为候选返回，即使只剩 1、2 个候选。
//     小词池不许回灌整池 —— 回灌会让「本单元词汇已全部完成」永远无法成立。
//  2) 同一个词条（trim+lower 相同）只保留第一条作为候选（不改编排词库、不删自定义词）。
//     ★ 身份只做 trim + lowerCase：空格/连字符/撇号是拼写的一部分，剥掉就吞词。
//     「重复字母」不算重复词条：banana / keep an eye on 都各是一个词条。
//  3) 抽词是纯函数：池穷尽时返回 null（不是 undefined），run.done 绝不重置。
//
// 「尽量不重复」不是「跳过未完成词」：只剩一个未完成词时它必须还能出现，
// 否则玩家永远无法完成这一单元。
const rnd = (n, random) => Math.floor(random() * n);
const pick = (a, random) => a[rnd(a.length, random)];
const shuffle = (a, random) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1, random); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
};

// 词条身份 = trim + lowerCase。**只**做这两件事。
// ★ 绝不能用 norm()：它把非字母全剥掉，于是 ice cream / icecream / ice-cream
//   会折叠成同一个 key，三个不同的词被吞成一个，短语词再也练不到。
//   空格、连字符、撇号都是**拼写的一部分**，去掉就把不同的词合并了。
// 大小写与首尾空白不是：CAT / cat / ' Cat ' 说的是同一个词，必须共用一条退休记录。
const keyOf = w => String(w == null ? '' : w).trim().toLowerCase();

/* run.done 以原始字符串记账（存档与掌握记录都不能被改写），
 * 但比较一律走身份：doneKeys 是「已完成身份」的集合。 */
const doneKeysOf = run => new Set(Array.from((run && run.done) || [], keyOf));

/* 本局唯一词条：同一条目（trim+lower 相同）只保留**第一条**作为 canonical。
 * 纯派生，不改 run.pool 的内容与顺序。 */
function uniquePool(run) {
  const pool = (run && Array.isArray(run.pool)) ? run.pool : [];
  const seen = new Set();
  const out = [];
  for (const w of pool) {
    if (!w || typeof w.w !== 'string') continue;      // 空/非法词条不纳入任何口径
    const k = keyOf(w.w);
    if (!k || seen.has(k)) continue;                  // seen 先登记：重复条目只留第一条
    seen.add(k);
    out.push(w);
  }
  return out;
}

/* 本局仍可出题的词：唯一词条里，身份未出现在 doneKeys 的那些。
 * pendingWords 与 learningCounts 必须共用这一个派生 —— 否则计数说「剩 0」
 * 而抽词还在吐词，两个口径永久分叉。 */
export function pendingWords(run) {
  const doneKeys = doneKeysOf(run);
  return uniquePool(run).filter(w => !doneKeys.has(keyOf(w.w)));
}

/* 本单元词汇是否已全部完成。检查点（learning-complete）由它推导，
 * 所以不需要在 run 上新增任何字段 —— 恢复时从 done 一算就得到同一结论。 */
export function isPoolComplete(run) {
  return pendingWords(run).length === 0;
}

/* 给 UI 与检查点用的纯计数。与 pendingWords 共用 uniquePool + doneKeys，
 * 所以 `remaining === pendingWords(run).length` 恒成立（不是两条独立算出来的巧合）。 */
export function learningCounts(run) {
  const pending = pendingWords(run);
  const uniq = uniquePool(run);
  const doneKeys = doneKeysOf(run);
  const total = uniq.length;
  const remaining = pending.length;
  const finished = total - remaining;
  // 错词去重，且只算仍然未完成的（已完成的词不再算待复习）。
  const pendingKeys = new Set(pending.map(w => keyOf(w.w)));
  const wrongSeen = new Set();
  for (const raw of ((run && run.wrong) || [])) {
    const k = keyOf(raw);
    if (!k || wrongSeen.has(k)) continue;
    if (doneKeys.has(k)) continue;                     // 已完成的不再算待复习
    if (!pendingKeys.has(k)) continue;                 // 压根不在本局候选里
    wrongSeen.add(k);
  }
  return { total, done: finished, remaining, wrong: wrongSeen.size };
}

/* 按难度抽一个未完成词。返回词条或 null（池穷尽）。 */
export function drawWord(run, battle, budget, random = Math.random) {
  const all = pendingWords(run);
  if (!all.length) return null;                    // 穷尽：交回调用方显示完成检查点
  // 避免立刻重复上一个词。**在难度分池之前**剔除：旧顺序是先按难度分池再剔除，
  // 于是「唯一另一个候选恰好在别的难度档」时剔除后为空，只能认命重复。
  // 真的只剩上一个词时保留它 —— 未完成词不能被跳过（「尽量」不是「跳过」）。
  const prevKey = battle && battle.word ? keyOf(battle.word.w) : null;
  const alt = prevKey ? all.filter(w => keyOf(w.w) !== prevKey) : all;
  const pool = alt.length ? alt : all;
  // 答错过的词优先复习（最多占一半，且 fresh 至少留一半 —— 不许 fresh 饿死）
  const due = [];
  const dueSeen = new Set();
  for (const raw of ((run && run.wrong) || [])) {
    const k = keyOf(raw);
    if (!k || dueSeen.has(k)) continue;             // 错词队列去重
    const hit = pool.filter(x => keyOf(x.w) === k)[0];
    if (!hit) continue;                             // 必须仍是未完成词
    dueSeen.add(k); due.push(hit);
  }
  const fresh = pool.filter(w => !dueSeen.has(keyOf(w.w)));
  let candidates = pool;
  if (due.length && fresh.length) {
    const fromDue = Math.min(due.length, 1 + Math.floor(due.length / 2));
    const fromFresh = Math.min(fresh.length, 1 + Math.floor(fresh.length / 2));
    candidates = shuffle(due, random).slice(0, fromDue)
      .concat(shuffle(fresh, random).slice(0, fromFresh));
  } else {
    candidates = shuffle(pool, random);
  }
  const exact = candidates.filter(w => w.d === budget);
  const harder = candidates.filter(w => w.d > budget);
  const softer = candidates.filter(w => w.d < budget);
  let src = exact;
  if (src.length < 3) src = src.concat(harder);
  if (src.length < 3) src = src.concat(softer);
  if (!src.length) src = candidates;
  return pick(src, random);
}
