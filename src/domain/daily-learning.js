// Shanghai calendar, spaced review and bounded parent records. Explicit inputs only.
import { learningKey, evidenceForWord, knownBookId } from './learning-identity.js';
export const REVIEW_INTERVALS = Object.freeze([1, 2, 4, 7, 15]);
export const REPORT_DAYS = 30;
const DAY_MS = 86400000, SHANGHAI_OFFSET = 8 * 3600000;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;
const put = (map, key, value) => Object.defineProperty(map, key, { value, enumerable: true, configurable: true, writable: true });
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}
export function shanghaiDate(at) {
  if (!Number.isFinite(at)) throw new TypeError('A finite injected timestamp is required');
  return new Date(at + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}
export function addDays(date, days) {
  if (!validDate(date) || !Number.isInteger(days)) throw new TypeError('A valid date and integer days are required');
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
export function splitActiveTime(at, deltaMs) {
  if (!Number.isFinite(at) || !Number.isFinite(deltaMs) || deltaMs <= 0) return [];
  const parts = []; let start = at - deltaMs;
  while (start < at) {
    const date = shanghaiDate(start), boundary = Date.parse(`${addDays(date, 1)}T00:00:00Z`) - SHANGHAI_OFFSET;
    const end = Math.min(boundary, at); parts.push({ date, ms: end - start }); start = end;
  }
  return parts;
}
function wordCopy(word) {
  const key = learningKey(word);
  if (typeof word === 'object' && typeof word?.z === 'string') return { ...word };
  const colon = key.indexOf(':');
  return colon > 0 && knownBookId(key.slice(0, colon))
    ? { w: key.slice(colon + 1), z: '旧记录未保存释义', bookId: key.slice(0, colon) }
    : { w: key, z: '旧记录未保存释义' };
}
function fields(db) {
  if (!object(db.reviewSchedule)) db.reviewSchedule = {};
  if (!Array.isArray(db.reviewQueue)) db.reviewQueue = [];
  if (!Array.isArray(db.dictationMastered)) db.dictationMastered = [];
  if (!object(db.wordExposure)) db.wordExposure = {};
  if (!object(db.dailyReports)) db.dailyReports = {};
  const reports = db.dailyReports;
  reports.schemaVersion = 1;
  if (!object(reports.days)) reports.days = {};
  if (!object(reports.summary)) reports.summary = {};
  for (const key of ['days', 'activeMs', 'practicedWords', 'formalAttempts', 'firstTry', 'failedAttempts', 'sessionsCompleted']) {
    reports.summary[key] = number(reports.summary[key]);
  }
  return reports;
}
export function initializeLearning(db, words, at) {
  fields(db); const date = shanghaiDate(at), catalog = new Map();
  for (const word of [...(Array.isArray(words) ? words : []), ...(Array.isArray(db.custom) ? db.custom : []), ...(Array.isArray(db.dailySession?.words) ? db.dailySession.words : [])]) {
    const key = learningKey(word); if (key && !catalog.has(key)) catalog.set(key, wordCopy(word));
  }
  for (const entry of [...db.reviewQueue, ...db.dictationMastered]) {
    const key = learningKey(entry); if (!key) continue;
    const previous = own(db.reviewSchedule, key);
    if (object(previous) && validDate(previous.dueDate) && Number.isInteger(previous.intervalIndex) && previous.intervalIndex >= -1 && previous.intervalIndex < REVIEW_INTERVALS.length) continue;
    put(db.reviewSchedule, key, { ...(object(previous) ? previous : {}), word: catalog.get(key) || wordCopy(entry),
      intervalIndex: -1, dueDate: date, stable: false, pendingFailure: false, origin: 'undated-legacy' });
  }
  pruneDailyReports(db, at); return db;
}
function schedule(db, word) {
  fields(db); const key = learningKey(word); if (!key) return null;
  const previous = own(db.reviewSchedule, key);
  const value = object(previous) ? previous : { word: wordCopy(word), intervalIndex: -1, stable: false };
  value.word = { ...(object(value.word) ? value.word : {}), ...wordCopy(word) }; put(db.reviewSchedule, key, value); return { key, value };
}
export function recordReviewFailure(db, { word, at, token }) {
  const record = schedule(db, word); if (!record) return false;
  const { key, value } = record;
  if (token && value.lastFailureToken === token) return false;
  value.intervalIndex = 0; value.dueDate = addDays(shanghaiDate(at), 1); value.stable = false;
  value.pendingFailure = true; value.lastFailureDate = shanghaiDate(at); value.lastFailureToken = token;
  db.dictationMastered = db.dictationMastered.filter(w => learningKey(w) !== key);
  if (!db.reviewQueue.some(w => learningKey(w) === key)) db.reviewQueue.push(evidenceForWord(word));
  return true;
}
export function recordReviewSuccess(db, { word, at, token }) {
  const record = schedule(db, word); if (!record) return false;
  const { key, value } = record, date = shanghaiDate(at);
  if (token && value.lastSuccessToken === token) return false;
  const previous = Number.isInteger(value.intervalIndex) ? value.intervalIndex : -1;
  const due = validDate(value.dueDate) && value.dueDate <= date;
  if (!validDate(value.dueDate) || value.pendingFailure) {
    value.intervalIndex = 0; value.dueDate = addDays(date, 1); value.stable = false;
  } else if (due) {
    value.intervalIndex = Math.min(REVIEW_INTERVALS.length - 1, Math.max(-1, previous) + 1);
    if (previous === REVIEW_INTERVALS.length - 1) value.stable = true;
    value.dueDate = addDays(date, REVIEW_INTERVALS[value.intervalIndex]);
  }
  value.pendingFailure = false; value.lastSuccessDate = date; value.lastSuccessToken = token;
  if (due || previous < 0 || value.intervalIndex === 0) db.reviewQueue = db.reviewQueue.filter(w => learningKey(w) !== key);
  return true;
}
export function dueReviewWords(db, at) {
  const date = shanghaiDate(at);
  return Object.values(object(db.reviewSchedule) ? db.reviewSchedule : {})
    .filter(r => object(r) && validDate(r.dueDate) && r.dueDate <= date && learningKey(r.word))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || learningKey(a.word).localeCompare(learningKey(b.word)))
    .map(r => wordCopy(r.word));
}
function ensureDay(db, date) {
  const reports = fields(db);
  if (validDate(reports.cutoffDate) && date < reports.cutoffDate) return null;
  let day = own(reports.days, date);
  if (!object(day)) { day = { date, activeMs: 0, words: {}, sessionsCompleted: 0 }; put(reports.days, date, day); }
  if (!object(day.words)) day.words = {};
  return day;
}
function dayWord(day, word) {
  const key = learningKey(word); if (!key) return null;
  let record = own(day.words, key);
  if (!object(record)) { record = { word: wordCopy(word), practiced: false, formalAttempts: 0, firstTry: 0, wrong: false }; put(day.words, key, record); }
  return record;
}
export function recordExposure(db, word, practiced = false) {
  fields(db); const key = learningKey(word); if (!key) return;
  const previous = own(db.wordExposure, key);
  put(db.wordExposure, key, { ...(object(previous) ? previous : {}), word: { ...(object(previous?.word) ? previous.word : {}), ...wordCopy(word) }, seen: true,
    practiced: practiced || previous?.practiced === true });
}
export function recordPractice(db, word, at) {
  recordExposure(db, word, true); pruneDailyReports(db, at);
  const day = ensureDay(db, shanghaiDate(at)); if (day) { const value = dayWord(day, word); if (value) value.practiced = true; }
}
export function recordWrongWord(db, word, at) {
  recordPractice(db, word, at); const day = ensureDay(db, shanghaiDate(at)); if (day) { const value = dayWord(day, word); if (value) value.wrong = true; }
}
export function recordAssessment(db, { word, eligible, at }) {
  recordPractice(db, word, at); const day = ensureDay(db, shanghaiDate(at)); if (!day) return;
  const value = dayWord(day, word); if (!value) return;
  value.formalAttempts = number(value.formalAttempts) + 1;
  value.firstTry = number(value.firstTry) + (eligible ? 1 : 0); if (!eligible) value.wrong = true;
}
export function recordActiveTime(db, at, deltaMs) {
  pruneDailyReports(db, at);
  for (const { date, ms } of splitActiveTime(at, deltaMs)) { const day = ensureDay(db, date); if (day) day.activeMs = number(day.activeMs) + ms; }
}
export function recordSessionComplete(db, at) {
  pruneDailyReports(db, at); const day = ensureDay(db, shanghaiDate(at)); if (day) day.sessionsCompleted = number(day.sessionsCompleted) + 1;
}
function summarizeDay(day) {
  const words = Object.values(object(day?.words) ? day.words : {}).filter(object);
  const formalAttempts = words.reduce((sum, word) => sum + number(word.formalAttempts), 0);
  const firstTry = words.reduce((sum, word) => sum + number(word.firstTry), 0);
  return { date: day?.date, activeMs: number(day?.activeMs), practicedWords: words.filter(w => w.practiced).length,
    formalAttempts, firstTry, failedAttempts: Math.max(0, formalAttempts - firstTry),
    firstTryRate: formalAttempts ? Math.round(100 * firstTry / formalAttempts) : null,
    wrongWords: words.filter(w => w.wrong).map(w => wordCopy(w.word)), sessionsCompleted: number(day?.sessionsCompleted) };
}
export function pruneDailyReports(db, at) {
  const reports = fields(db), cutoff = addDays(shanghaiDate(at), 1 - REPORT_DAYS);
  reports.cutoffDate = validDate(reports.cutoffDate) && reports.cutoffDate > cutoff ? reports.cutoffDate : cutoff;
  for (const date of Object.keys(reports.days).sort()) {
    if (!validDate(date) || date >= reports.cutoffDate) continue;
    const day = summarizeDay(reports.days[date]); reports.summary.days++;
    for (const key of ['activeMs', 'practicedWords', 'formalAttempts', 'firstTry', 'failedAttempts', 'sessionsCompleted']) reports.summary[key] += day[key];
    reports.summary.throughDate = !validDate(reports.summary.throughDate) || date > reports.summary.throughDate ? date : reports.summary.throughDate;
    delete reports.days[date];
  }
  return reports;
}
export function todayReport(db, at) {
  const date = shanghaiDate(at); const day = object(db.dailyReports?.days) ? own(db.dailyReports.days, date) : undefined;
  return { ...summarizeDay(day), date, archive: object(db.dailyReports?.summary) ? { ...db.dailyReports.summary } : {} };
}
export function durationText(ms) {
  const seconds = Math.floor(number(ms) / 1000); return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}
export function reportText(report) {
  const rate = report.formalAttempts ? `${report.firstTryRate}%（${report.firstTry}/${report.formalAttempts}）` : '暂无正式尝试';
  return [`词汇远征 · 今日记录 ${report.date}`, `练习时长：${durationText(report.activeMs)}`, `练习词数：${report.practicedWords}（当天去重，含热身）`,
    `一次拼对率：${rate}`, '统计口径：正式完整尝试或已出错/使用帮助的中断尝试；热身不计正确率。',
    '今日错词／辅助词：', ...(report.wrongWords.length ? report.wrongWords.map(w => `${w.w} · ${w.z}`) : ['无'])].join('\n');
}
