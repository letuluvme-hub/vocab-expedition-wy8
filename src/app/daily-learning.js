import { learningKey } from '../domain/learning-identity.js';
import { initializeLearning, dueReviewWords, recordReviewFailure, recordReviewSuccess,
  recordExposure, recordPractice, recordWrongWord, recordAssessment, recordActiveTime,
  recordSessionComplete, todayReport } from '../domain/daily-learning.js';

// Coordinates facts within the daily controller's single persistence transaction.
export function createDailyLearning({ getDB, getWords, now = Date.now } = {}) {
  const migrate = at => initializeLearning(getDB(), getWords(), at);
  migrate(now());
  function ledger(session) {
    if (!session.learning || session.learning.schemaVersion !== 1) session.learning = { ...session.learning, schemaVersion: 1 };
    const state = session.learning;
    if (!Array.isArray(state.assessedTokens)) state.assessedTokens = typeof state.assessmentToken === 'string' ? [state.assessmentToken] : [];
    return state;
  }
  function token(session, word) {
    const index = session.words.findIndex(w => learningKey(w) === learningKey(word));
    return `${session.id}:formal:${index}`;
  }
  function failure({ session, word, db, at }) {
    const state = ledger(session), id = token(session, word);
    recordWrongWord(db, word, at);
    if (state.assessedTokens.includes(id)) return;
    state.failureToken = id;
    recordReviewFailure(db, { word, at, token: id });
    recordAssessment(db, { word, eligible: false, at }); state.assessmentToken = id; state.assessedTokens.push(id);
  }
  return { report: () => todayReport(getDB(), now()),
    ports: {
      getDueWords: ({ at }) => { migrate(at); return dueReviewWords(getDB(), at); },
      onStart: ({ session, at }) => { migrate(at); ledger(session); },
      onWordStart: ({ word, db }) => recordExposure(db, word),
      onPractice: payload => {
        const { session, attempt, word, db, at } = payload;
        recordPractice(db, word, at);
        // Undated pre-PR3 partial attempts are accounted only when resumed now.
        if (attempt.phase === 'formal' && (attempt.errors || attempt.hints || attempt.reveals) && !ledger(session).assessedTokens.includes(token(session, word))) failure({ session, word, db, at });
      },
      onFailure: failure,
      onAttempt: ({ session, result, db, at }) => {
        const state = ledger(session), id = token(session, result.word);
        if (state.assessedTokens.includes(id)) return;
        if (!result.eligible) { failure({ session, word: result.word, db, at }); return; }
        recordReviewSuccess(db, { word: result.word, at, token: id });
        recordAssessment(db, { word: result.word, eligible: true, at }); state.assessmentToken = id; state.assessedTokens.push(id);
      },
      onTiming: ({ db, at, deltaMs }) => recordActiveTime(db, at, deltaMs),
      onComplete: ({ session, db, at }) => {
        const state = ledger(session); if (state.completed) return;
        const attempt = session.attempt, word = session.words[session.index];
        if (word && attempt?.phase === 'formal' && !attempt.completed && !attempt.credited && (attempt.errors || attempt.hints || attempt.reveals) && !state.assessedTokens.includes(token(session, word))) failure({ session, word, db, at });
        state.completed = true; recordSessionComplete(db, at);
      },
    },
  };
}
