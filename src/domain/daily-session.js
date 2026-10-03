// Daily learning state and selection. Explicit, serializable inputs; no platform IO.
import { dictationWordKey, createDictationAttempt } from './dictation.js';
export const DAILY_WORD_LIMIT = 16;
export const DAILY_TIME_BUDGET_MS = 15 * 60 * 1000;
export const DAILY_SESSION_VERSION = 1;
const phases = new Set(['warmup', 'formal-ready', 'formal', 'completed']);
const unique = words => {
  const keys = new Set();
  return (Array.isArray(words) ? words : []).filter(w => {
    const key = dictationWordKey(w);
    if (!key || keys.has(key) || !w || typeof w.w !== 'string' || typeof w.z !== 'string') return false;
    keys.add(key); return true;
  }).map(w => ({ ...w }));
};
export function selectDailyWords({ words = [], dueWords = [], mastered = [], cursor = 0, limit = DAILY_WORD_LIMIT, carry = [] } = {}) {
  const pool = unique(words);
  const cap = Math.max(1, Math.min(DAILY_WORD_LIMIT, Math.floor(limit) || DAILY_WORD_LIMIT));
  const due = unique(dueWords);
  const masteredKeys = new Set((Array.isArray(mastered) ? mastered : []).map(dictationWordKey));
  const at = pool.length ? ((Math.floor(cursor) || 0) % pool.length + pool.length) % pool.length : 0;
  const rotated = pool.slice(at).concat(pool.slice(0, at));
  const priority = unique(carry).filter(w => pool.some(p => dictationWordKey(p) === dictationWordKey(w)));
  const candidates = unique([...priority, ...rotated.filter(w => !masteredKeys.has(dictationWordKey(w))), ...rotated]);
  // Quota is based on the final unique pool, including overlap and tiny lists.
  let reviews = [], fresh = [];
  for (let quota = Math.min(Math.floor(cap / 2), due.length, pool.length); quota >= 0; quota--) {
    reviews = due.slice(0, quota);
    const reviewKeys = new Set(reviews.map(dictationWordKey));
    fresh = candidates.filter(w => !reviewKeys.has(dictationWordKey(w))).slice(0, cap - quota);
    if (quota <= Math.floor((quota + fresh.length) / 2)) break;
  }
  const taken = new Set(reviews.map(dictationWordKey));
  const selected = [...reviews, ...fresh];
  const selectedKeys = new Set(selected.map(dictationWordKey));
  return { words: selected, reviewKeys: [...taken], reviewCount: reviews.length,
    remaining: pool.filter(w => !selectedKeys.has(dictationWordKey(w))).length,
    nextCursor: pool.length ? (at + fresh.length) % pool.length : 0, total: pool.length };
}
export function dailyEncounters(count) {
  const n = Math.max(0, Math.floor(count));
  const rounds = Math.min(4, n), result = [];
  for (let i = 0, start = 0; i < rounds; i++) {
    const size = Math.floor(n / rounds) + (i < n % rounds ? 1 : 0);
    result.push({ index: i, start, count: size, end: start + size, boss: i === rounds - 1 }); start += size;
  }
  return result;
}
export function createDailySession(selection, { id, unit, now } = {}) {
  const words = unique(selection.words);
  if (!words.length) return null;
  return { schemaVersion: DAILY_SESSION_VERSION, id: String(id), unit, createdAt: now,
    words, reviewKeys: selection.reviewKeys || [], remaining: selection.remaining || 0,
    phase: 'warmup', index: 0, attempt: createDictationAttempt({ ...words[0], w: words[0].w.toLowerCase().replace(/[^a-z]/g, '') }, { phase: 'warmup' }),
    warmupDone: [], results: [], encounters: dailyEncounters(words.length),
    paused: false, pauseReason: null, elapsedMs: 0, activeSince: now,
    nextCheckpointMs: DAILY_TIME_BUDGET_MS, completionNotified: false, reason: null };
}
export function restoreDailySession(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== DAILY_SESSION_VERSION || !phases.has(raw.phase)) return null;
  if (typeof raw.id !== 'string' || !raw.id || !Array.isArray(raw.words) || !raw.words.length || raw.words.length > DAILY_WORD_LIMIT || unique(raw.words).length !== raw.words.length) return null;
  if (!Number.isInteger(raw.index) || raw.index < 0 || raw.index > raw.words.length || !Array.isArray(raw.warmupDone) || !Array.isArray(raw.results) || !Number.isFinite(raw.elapsedMs) || raw.elapsedMs < 0) return null;
  if (!Array.isArray(raw.encounters) || !Number.isFinite(raw.nextCheckpointMs) || raw.nextCheckpointMs < 0) return null;
  const wordKeys = new Set(raw.words.map(dictationWordKey));
  if (raw.warmupDone.some(w => !wordKeys.has(dictationWordKey(w))) || new Set(raw.warmupDone).size !== raw.warmupDone.length) return null;
  const resultKeys = new Set();
  for (const r of raw.results) {
    if (!r || typeof r.key !== 'string' || !wordKeys.has(r.key) || resultKeys.has(r.key) || typeof r.eligible !== 'boolean') return null;
    resultKeys.add(r.key);
  }
  if (raw.phase === 'warmup' || raw.phase === 'formal') {
    if (raw.index >= raw.words.length) return null;
    const target = raw.phase === 'warmup' ? raw.words[raw.index].w.toLowerCase().replace(/[^a-z]/g, '') : dictationWordKey(raw.words[raw.index]);
    const a = raw.attempt;
    if (!a || a.target !== target || a.phase !== (raw.phase === 'formal' ? 'formal' : 'warmup') || typeof a.input !== 'string' || !target.startsWith(a.input) || ![a.errors, a.hints, a.reveals].every(n => Number.isInteger(n) && n >= 0) || !Array.isArray(a.assistance) || typeof a.completed !== 'boolean' || typeof a.credited !== 'boolean' || a.completed !== (a.input === target)) return null;
    if (a.phase === 'formal' && a.credited && !resultKeys.has(target)) return null;
  }
  const session = JSON.parse(JSON.stringify(raw));
  session.activeSince = null;
  if (session.phase !== 'completed') { session.paused = true; session.pauseReason = session.elapsedMs >= session.nextCheckpointMs ? 'time-budget' : 'restored'; }
  return session;
}
export function dailySummary(session, now) {
  if (!session) return null;
  const active = !session.paused && session.activeSince !== null ? Math.max(0, now - session.activeSince) : 0;
  const wrong = session.results.filter(r => !r.eligible).map(r => ({ ...r.word }));
  const a = session.attempt;
  if (a?.phase === 'formal' && (a.errors || a.hints || a.reveals)) {
    const word = session.words[session.index];
    if (word && !wrong.some(w => dictationWordKey(w) === dictationWordKey(word))) wrong.push({ ...word });
  }
  return { id: session.id, unit: session.unit, createdAt: session.createdAt,
    elapsedMs: session.elapsedMs + active, planned: session.words.length,
    completed: session.results.length, warmup: session.warmupDone.length,
    firstTry: session.results.filter(r => r.eligible).length,
    wrong,
    reason: session.reason, finished: session.phase === 'completed' };
}
