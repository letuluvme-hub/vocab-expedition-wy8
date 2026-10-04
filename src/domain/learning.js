import { norm } from './text.js';
import { learningKey, evidenceForWord, spellingKey } from './learning-identity.js';

export function wordComplete(battle) {
  return !!(battle && battle.word) && battle.input.length >= norm(battle.word.w).length;
}

// The caller owns persistence; the return value says whether mastery was added.
export function creditWordProgress(db, run, word) {
  const entry = typeof word === 'string' && run.bookId
    ? run.pool.find(w => spellingKey(w) === spellingKey(word)) || { w: word, bookId: run.bookId } : word;
  const key = learningKey(entry);
  if (!key) return false;
  const added = !db.mastered.some(w => learningKey(w) === key);
  if (added) db.mastered.push(evidenceForWord(entry));
  run.done.add(typeof entry === 'string' ? entry : key);
  // A corrected practice word keeps its failure evidence for later review.
  return added;
}

export function onWordWrongProgress(run, word) {
  const entry = typeof word === 'string' && run.bookId
    ? run.pool.find(w => spellingKey(w) === spellingKey(word)) || { w: word, bookId: run.bookId } : word;
  const key = learningKey(entry);
  if (!key) return;
  if (!run.wrong.some(w => learningKey(w) === key)) run.wrong.push(typeof entry === 'string' ? entry : key);
  for (const done of run.done) if (learningKey(done) === key) run.done.delete(done);
}
