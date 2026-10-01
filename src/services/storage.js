export const STORAGE_KEY = 'wy8a_rogue_v1';

// Keep the original in-place initialization: this is not a schema migration.
export function initializeDB(db) {
  db = db || { runs: 0, wins: 0, mastered: [], best: 0, custom: [] };
  db.mastered = db.mastered || [];
  db.custom = db.custom || [];
  db.rewards = Array.isArray(db.rewards) ? db.rewards : [];
  db.kbMode = !!db.kbMode;
  db.kbUpper = !!db.kbUpper;
  db.voice = db.voice === undefined ? true : !!db.voice;
  return db;
}

export function resolveStorage(scope = globalThis) {
  try {
    return scope.localStorage || null;
  } catch {
    return null;
  }
}

export function createStorage(storageLike) {
  // Resolve inside a guard, never through a localStorage default argument.
  if (storageLike === undefined) storageLike = resolveStorage();
  return {
    // Whether a real Storage-like object exists. Callers use it to tell
    // "this device cannot persist" apart from "this write failed" so the
    // player is told the truth instead of a generic save error.
    get available() { return !!storageLike; },
    load() {
      try {
        return JSON.parse(storageLike.getItem(STORAGE_KEY)) || null;
      } catch {
        return null;
      }
    },
    save(db) {
      try {
        storageLike.setItem(STORAGE_KEY, JSON.stringify(db));
        return true;
      } catch {
        return false;
      }
    },
  };
}
