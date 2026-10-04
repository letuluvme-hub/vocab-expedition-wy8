// P0 observations only. No damage, rewards, hint allowance or learning decisions.
import { norm } from './text.js';
import { bookUnits } from '../data/books.js';
import { knownBookId, DEFAULT_BOOK_ID } from './learning-identity.js';

const WORD_FIELDS = ['wrong', 'hint', 'listen', 'revealed'];
const STAT_FIELDS = ['words', 'perfect', 'good', 'rescue', 'hintsUsed', 'wrongLetters', 'listenUsed'];
const plain = v => !!v && typeof v === 'object'
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const counters = (v, fields) => plain(v)
  && fields.every(k => Number.isSafeInteger(v[k]) && v[k] >= 0);
const copy = (v, fields) => Object.fromEntries(fields.map(k => [k, v[k]]));

export const createWordQ = () => ({ wrong: 0, hint: 0, listen: 0, revealed: 0 });
export const createQStats = () => ({ words: 0, perfect: 0, good: 0, rescue: 0,
  hintsUsed: 0, wrongLetters: 0, listenUsed: 0 });

// Missing optional facts are omitted on encode. Invalid values are never normalized into facts.
export function encodeWordQ(value) {
  return counters(value, WORD_FIELDS) ? copy(value, WORD_FIELDS) : undefined;
}
export function encodeQStats(value) {
  return counters(value, STAT_FIELDS) && value.words === value.perfect + value.good + value.rescue
    ? copy(value, STAT_FIELDS) : undefined;
}
export function decodeWordQ(value) {
  // An older snapshot has no evidence that the current word was clean.
  return value == null ? { ...createWordQ(), wrong: 1 } : encodeWordQ(value);
}
export function decodeQStats(value) {
  return value == null ? createQStats() : encodeQStats(value);
}

export function classifyWordQuality(word, quality) {
  const q = decodeWordQ(quality);
  if (!q) throw new TypeError('Invalid word quality');
  if (q.wrong === 0 && q.hint === 0 && q.listen === 0) return 'perfect';
  return q.revealed >= Math.ceil(norm(word).length / 2) ? 'rescue' : 'good';
}

// Caller publishes exactly once at the existing whole-word completion branch.
export function completeWordStats(stats, word, quality) {
  const out = decodeQStats(stats), q = decodeWordQ(quality);
  if (!out || !q) throw new TypeError('Invalid quality statistics');
  out.words++;
  out[classifyWordQuality(word, q)]++;
  out.hintsUsed += q.hint;
  out.wrongLetters += q.wrong;
  out.listenUsed += q.listen;
  return out;
}

function playRecord(value) {
  if (!plain(value) || typeof value.endedAt !== 'string' || !value.endedAt
    || typeof value.hero !== 'string' || !value.hero
    || !Number.isSafeInteger(value.unit) || !bookUnits(value.bookId).some(u => u.n === value.unit)
    || value.bookId !== undefined && !knownBookId(value.bookId)
    || typeof value.win !== 'boolean') return null;
  const qStats = decodeQStats(value.qStats);
  if (!qStats) return null;
  // Copy only plain facts, including old records: no live references or Sets escape.
  return { endedAt: value.endedAt, hero: value.hero, unit: value.unit, qStats, win: value.win,
    ...(value.bookId !== undefined && value.bookId !== DEFAULT_BOOK_ID ? {bookId:value.bookId} : {}) };
}
export function appendPlayLog(log, record) {
  const history = Array.isArray(log) ? log.slice(-20).map(playRecord).filter(Boolean) : [];
  const entry = playRecord(record);
  if (entry) history.push(entry);
  return history.slice(-20);
}
