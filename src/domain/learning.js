import { norm } from './text.js';

export function wordComplete(battle) {
  return !!(battle && battle.word) && battle.input.length >= norm(battle.word.w).length;
}

// The caller owns persistence; the return value says whether mastery was added.
export function creditWordProgress(db, run, word) {
  const added = db.mastered.indexOf(word) < 0;
  if (added) db.mastered.push(word);
  run.done.add(word);
  // A corrected practice word keeps its failure evidence for later review.
  return added;
}

export function onWordWrongProgress(run, word) {
  if (run.wrong.indexOf(word) < 0) run.wrong.push(word);
  run.done.delete(word);
}
