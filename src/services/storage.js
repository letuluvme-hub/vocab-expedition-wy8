export const STORAGE_KEY = 'wy8a_rogue_v1';

// Keep the original in-place initialization: this is not a schema migration.
export function initializeDB(db) {
  db = db || { runs: 0, wins: 0, mastered: [], best: 0, custom: [] };
  db.mastered = db.mastered || [];
  db.custom = db.custom || [];
  db.rewards = Array.isArray(db.rewards) ? db.rewards : [];
  // kbMode defaults to the QWERTY keyboard layout for new / field-less saves.
  // An explicit boolean (including a player-chosen false) is kept as is, and
  // legacy non-boolean values still go through the original !! coercion.
  db.kbMode = db.kbMode === undefined ? true : !!db.kbMode;
  db.kbUpper = !!db.kbUpper;
  db.voice = db.voice === undefined ? true : !!db.voice;
  // keyboardTipSeen：主页那条「建议用电脑键盘」的一次性提示看没看过。
  //   旧档没有这个键 —— 按「还没看过」处理，让老玩家也见一次。
  //   这是**一次性说明**，不是数据损坏，所以默认 false 而不是 fail closed。
  db.keyboardTipSeen = !!db.keyboardTipSeen;
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
