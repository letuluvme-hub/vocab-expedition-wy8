// Learning evidence and spelling are different identities. Legacy upper-book
// strings keep their exact namespace; newer books carry an explicit book id.
import { BOOKS, DEFAULT_BOOK_ID } from '../data/books.js';

export { DEFAULT_BOOK_ID };
export const knownBookId = id => typeof id === 'string' && BOOKS.some(book => book.id === id);
export const spellingKey = word => typeof word === 'string' ? word.trim().toLowerCase()
  : word && typeof word.w === 'string' ? word.w.trim().toLowerCase() : '';
export const wordBookId = word => word && typeof word === 'object' && word.bookId !== undefined
  ? word.bookId : DEFAULT_BOOK_ID;

export function learningKey(word, bookId) {
  if (typeof word === 'string') {
    const split = word.indexOf(':');
    if (split > 0 && knownBookId(word.slice(0, split))) return word.slice(0, split) + ':' + spellingKey(word.slice(split + 1));
  }
  const spelling = spellingKey(word);
  if (!spelling) return '';
  const selected = word && typeof word === 'object' && word.bookId !== undefined
    ? word.bookId : typeof bookId === 'string' ? bookId : DEFAULT_BOOK_ID;
  if (!knownBookId(selected)) return '';
  return selected === DEFAULT_BOOK_ID ? spelling : selected + ':' + spelling;
}

export function evidenceForWord(word, bookId) {
  const selected = word && typeof word === 'object' && word.bookId !== undefined
    ? word.bookId : typeof bookId === 'string' ? bookId : DEFAULT_BOOK_ID;
  if (!learningKey(word, selected)) return null;
  if (selected === DEFAULT_BOOK_ID) return typeof word === 'string' ? word : word.w;
  return typeof word === 'object' ? { ...word, bookId: selected } : { w: word, bookId: selected };
}
