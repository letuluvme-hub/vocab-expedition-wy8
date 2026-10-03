// Formal dictation evidence. Explicit serializable state; no DOM, storage or clock.
// Spaces/hyphens/apostrophes remain part of a word's identity and spelling.
export const dictationWordKey = word => String(word && typeof word === 'object' ? word.w ?? '' : word ?? '').trim().toLowerCase();

export function createDictationAttempt(word, { phase = 'formal' } = {}) {
  const target = dictationWordKey(word);
  return {
    word: typeof word === 'object' && word ? { ...word } : { w: target },
    target, phase, input: '', errors: 0, hints: 0, reveals: 0,
    assistance: [], completed: false, credited: false, feedback: '',
  };
}

export function applyDictationInput(attempt, key) {
  if (!attempt || attempt.completed || attempt.credited) return attempt;
  if (key === 'Backspace') {
    attempt.input = attempt.input.slice(0, -1);
    attempt.feedback = '';
    return attempt;
  }
  let ch = String(key ?? '').toLowerCase();
  if (!/^[a-z '’-]$/.test(ch) || !attempt.target) return attempt;
  const expected = attempt.target[attempt.input.length];
  // The ordinary apostrophe key also types typographic apostrophes supported by
  // custom lists; preserve the target's punctuation and its original identity.
  if ((ch === "'" || ch === '’') && (expected === "'" || expected === '’')) ch = expected;
  if (ch !== expected) {
    attempt.errors += 1;
    // Wrong order and absent letters deliberately give identical feedback.
    attempt.feedback = '不对';
    return attempt;
  }
  attempt.input += ch;
  attempt.feedback = '';
  attempt.completed = attempt.input === attempt.target;
  return attempt;
}

export function markDictationAssistance(attempt, kind) {
  if (!attempt || attempt.completed || attempt.credited) return attempt;
  if (kind === 'hint') attempt.hints += 1;
  else if (kind === 'prophecy' || kind === 'vision') attempt.reveals += 1;
  else return attempt;
  attempt.assistance.push(kind);
  return attempt;
}

export function dictationEligible(attempt) {
  return !!(attempt && attempt.phase === 'formal' && attempt.target
    && attempt.completed === true && attempt.input === attempt.target
    && attempt.errors === 0 && attempt.hints === 0 && attempt.reveals === 0);
}

// The caller owns the single persistence transaction. An unfinished word has no
// credit side effect. Failure survives later successful practice in reviewQueue;
// the spaced-review scheduler, rather than practice, owns its eventual retirement.
export function creditDictation(db, attempt) {
  const eligible = dictationEligible(attempt);
  const result = { eligible, added: false, reviewed: false, ignored: false };
  if (!db || !attempt || attempt.credited || !attempt.completed || !attempt.target) {
    result.ignored = true;
    return result;
  }
  attempt.credited = true;
  if (attempt.phase !== 'formal') return result;
  if (!Array.isArray(db.dictationMastered)) db.dictationMastered = [];
  if (!Array.isArray(db.reviewQueue)) db.reviewQueue = [];
  if (eligible) {
    if (!db.dictationMastered.some(w => dictationWordKey(w) === attempt.target)) {
      db.dictationMastered.push(attempt.target);
      result.added = true;
    }
  } else {
    if (!db.reviewQueue.some(w => dictationWordKey(w) === attempt.target)) db.reviewQueue.push(attempt.target);
    result.reviewed = true;
  }
  return result;
}
