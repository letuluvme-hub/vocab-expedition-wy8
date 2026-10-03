import { createDictationAttempt, applyDictationInput, markDictationAssistance, creditDictation, dictationWordKey } from '../domain/dictation.js';
import { selectDailyWords, createDailySession, restoreDailySession, dailySummary, DAILY_TIME_BUDGET_MS } from '../domain/daily-session.js';
import { drawLetters } from '../domain/letter-bank.js';
import { parseCustomWords } from '../domain/custom-words.js';

// Ports are invoked before the one persistence commit for each completed action.
// All dates and session ids derive from injected now/random; no timer lives here.
export function createDailyDictationController({ getDB, getWords, getDueWords = () => [],
  persist = () => false, now = Date.now, random = Math.random, onChange = () => {},
  onAttempt = () => {}, onComplete = () => {}, onStart = () => {}, onTiming = () => {},
  onFailure = () => {}, onWordStart = () => {}, onPractice = () => {} } = {}) {
  let source = getDB().dailySession;
  let session = source ? restoreDailySession(source) : null;
  let saved = null, bank = null;
  const db = () => getDB();
  const blocked = () => !session || session.paused || session.phase === 'completed';
  function syncSource() {
    if (db().dailySession === source) return;
    source = db().dailySession; session = source ? restoreDailySession(source) : null; bank = null;
  }
  function recordTime() {
    if (!session || session.paused || session.activeSince === null) return;
    const stamp = now(); const delta = Math.max(0, stamp - session.activeSince);
    session.elapsedMs += delta; session.activeSince = stamp;
    if (delta) onTiming({ session, deltaMs: delta, at: stamp, db: db() });
  }
  function publish() {
    source = session; db().dailySession = session;
    try { const result = persist(db()); saved = result === true || result?.ok === true; } catch { saved = false; }
    onChange(session, { saved });
  }
  function review() {
    const a = session.attempt;
    if (a.phase !== 'formal') return;
    if (!Array.isArray(db().reviewQueue)) db().reviewQueue = [];
    if (!db().reviewQueue.some(w => dictationWordKey(w) === a.target)) db().reviewQueue.push(a.target);
    onFailure({ session, attempt: a, word: session.words[session.index], db: db(), at: now() });
  }
  function setAttempt() {
    const word = session.words[session.index];
    session.attempt = createDictationAttempt(session.phase === 'warmup'
      ? { ...word, w: word.w.toLowerCase().replace(/[^a-z]/g, '') } : word,
    { phase: session.phase === 'warmup' ? 'warmup' : 'formal' });
    bank = null;
    onWordStart({ session, attempt: session.attempt, word, db: db(), at: now() });
  }
  function completeWord() {
    const a = session.attempt; if (!a.completed || a.credited) return;
    const word = session.words[session.index]; const key = dictationWordKey(word);
    if (session.phase === 'warmup') {
      a.credited = true;
      if (!session.warmupDone.includes(key)) session.warmupDone.push(key);
      if (!Array.isArray(db().mastered)) db().mastered = [];
      if (!db().mastered.some(w => dictationWordKey(w) === key)) db().mastered.push(word.w);
      return;
    }
    const credit = creditDictation(db(), a);
    const result = { key, word: { ...word }, eligible: credit.eligible, completed: true, errors: a.errors,
      hints: a.hints, reveals: a.reveals, assistance: [...a.assistance], completedAt: now() };
    session.results.push(result);
    onAttempt({ session, attempt: a, result, db: db(), at: now() });
  }
  function close(reason) {
    if (!session || session.phase === 'completed') return false;
    recordTime(); session.paused = true; session.activeSince = null;
    session.phase = 'completed'; session.reason = reason;
    if (!session.completionNotified) { session.completionNotified = true; onComplete({ session, summary: dailySummary(session, now()), db: db(), at: now() }); }
    publish(); return true;
  }
  function checkTime() {
    if (blocked()) return false;
    recordTime();
    if (session.elapsedMs < session.nextCheckpointMs) return false;
    session.paused = true; session.activeSince = null; session.pauseReason = 'time-budget';
    publish(); return true;
  }
  function start({ unit = 1, limit } = {}) {
    syncSource();
    if ((source && !session) || (session && session.phase !== 'completed')) return false;
    const rawWords = unit === 0 ? db().custom || [] : getWords(unit);
    const carry = session && session.unit === unit && session.reason !== 'pool-exhausted'
      ? session.words.filter(w => !session.results.some(r => r.key === dictationWordKey(w))) : [];
    const cursors = db().dailyCursor && typeof db().dailyCursor === 'object' ? db().dailyCursor : {};
    const selection = selectDailyWords({ words: rawWords, dueWords: getDueWords({ db: db(), at: now(), unit }),
      mastered: db().dictationMastered, cursor: cursors[unit] || 0, carry, limit });
    const stamp = now();
    session = createDailySession(selection, { unit, now: stamp, id: `${stamp}-${Math.floor(random() * 0x100000000).toString(16)}` });
    if (!session) return false;
    db().dailyCursor = { ...cursors, [unit]: selection.nextCursor };
    onStart({ session, db: db(), at: stamp });
    onWordStart({ session, attempt: session.attempt, word: session.words[0], db: db(), at: stamp });
    publish(); return true;
  }
  function input(key) {
    if (blocked() || !['warmup','formal'].includes(session.phase) || session.attempt.completed) return false;
    if (checkTime()) return false;
    const a = session.attempt, old = JSON.stringify(a);
    if (session.phase === 'warmup' && key !== 'Backspace') {
      const b = letters(), index = b.letters.findIndex((ch, i) => ch === String(key).toLowerCase() && !b.used[i]);
      if (index < 0) return false;
      applyDictationInput(a, key);
      if (a.input.length > JSON.parse(old).input.length) b.used[index] = true;
    } else {
      applyDictationInput(a, key);
      if (key === 'Backspace' && session.phase === 'warmup') bank = null;
    }
    if (old === JSON.stringify(a)) return false;
    if (key !== 'Backspace') onPractice({ session, attempt: a, word: session.words[session.index], key, db: db(), at: now() });
    if (a.phase === 'formal' && a.errors > JSON.parse(old).errors) review();
    completeWord(); publish(); return true;
  }
  function assist(kind) {
    if (blocked() || session.phase !== 'formal' || session.attempt.completed || checkTime()) return false;
    if (!['hint','prophecy','vision'].includes(kind)) return false;
    markDictationAssistance(session.attempt, kind); review(); publish(); return true;
  }
  function hint() {
    if (!assist('hint')) return false;
    // Evidence has already been marked and persisted before any answer is shown.
    return session.attempt.target[session.attempt.input.length] || '';
  }
  function advanceWord() {
    session.index++;
    if (session.index >= session.words.length) {
      if (session.phase === 'warmup') { session.phase = 'formal-ready'; session.index = 0; session.attempt = null; }
      else return close('pool-exhausted');
    } else setAttempt();
    publish(); return true;
  }
  function next() {
    if (blocked() || !['warmup','formal'].includes(session.phase) || !session.attempt.completed || checkTime()) return false;
    return advanceWord();
  }
  function defer() {
    if (blocked() || session.phase !== 'formal' || session.attempt.completed ||
      !(session.attempt.errors || session.attempt.hints || session.attempt.reveals) || checkTime()) return false;
    const a = session.attempt, word = session.words[session.index], key = dictationWordKey(word);
    // No complete-word credit. onAttempt resolves the failed assessment and
    // catches legacy unassessed evidence; dated failures do not replay today.
    if (!Array.isArray(db().reviewQueue)) db().reviewQueue = [];
    if (!db().reviewQueue.some(w => dictationWordKey(w) === key)) db().reviewQueue.push(key);
    const result = { key, word: { ...word }, eligible: false, completed: false, deferred: true,
      input: a.input, errors: a.errors, hints: a.hints, reveals: a.reveals,
      assistance: [...a.assistance], deferredAt: now() };
    session.results.push(result);
    onAttempt({ session, attempt: a, result, db: db(), at: now() });
    return advanceWord();
  }
  function beginFormal() {
    if (blocked() || session.phase !== 'formal-ready' || checkTime()) return false;
    session.phase = 'formal'; session.index = 0; setAttempt(); publish(); return true;
  }
  function pause(reason = 'manual') {
    if (blocked()) return false;
    recordTime(); session.paused = true; session.pauseReason = reason; session.activeSince = null;
    publish(); return true;
  }
  function resume() {
    syncSource(); if (!session || !session.paused || session.phase === 'completed' || session.pauseReason === 'time-budget') return false;
    session.paused = false; session.activeSince = now();
    session.pauseReason = null; publish(); return true;
  }
  function letters() {
    if (!session || session.phase !== 'warmup') return null;
    if (!bank) {
      bank = drawLetters({ floor: 1 }, null, session.words[session.index], random);
      // Rebuild letter-instance consumption from durable spelling input.
      for (const ch of session.attempt.input) { const i = bank.letters.findIndex((x, i) => x === ch && !bank.used[i]); if (i >= 0) bank.used[i] = true; }
    }
    return bank;
  }
  function importWords(text) {
    const result = parseCustomWords(String(text));
    if (result.words.length) { db().custom = result.words; try { const r = persist(db()); saved = r === true || r?.ok === true; } catch { saved = false; } }
    return result;
  }
  function discard() { db().dailySession = null; source = null; session = null; bank = null; try { const r = persist(db()); saved = r === true || r?.ok === true; } catch { saved = false; } onChange(null,{ saved }); }
  return { start, input, assist, hint, next, defer, beginFormal, pause, resume, checkTime, letters, importWords, discard,
    customWords: () => Array.isArray(db().custom) ? db().custom : [],
    finish: () => close(session?.pauseReason === 'time-budget' ? 'time-budget' : 'stopped'),
    state: () => { syncSource(); return session; }, summary: () => dailySummary(session, now()), saved: () => saved,
    invalid: () => { syncSource(); return !!source && !session; } };
}
