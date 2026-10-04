import {WORDS} from './words.js';
import {UNITS} from './units.js';
import {WORDS_WY8B} from './words-wy8b.js';

export const DEFAULT_BOOK_ID = 'wy8a';
// 册 id 是学习与存档身份，增加教材时追加注册，不复用旧 id。
export const BOOKS = [
  {id:'wy8a',label:'八年级上册',short:'八上',publisher:'外研版（新标准）',words:WORDS,units:UNITS,
    expectedUnits:{1:45,2:55,3:29,4:50,5:41,6:39}},
  {id:'wy8b',label:'八年级下册',short:'八下',publisher:'外研版（新标准）',
    expectedUnits:{1:29,2:32,3:44,4:24,5:46,6:33},
    words:WORDS_WY8B.map(word=>({...word,bookId:'wy8b'})),
    units:[1,2,3,4,5,6].map(n=>({n,t:'Unit '+n})).concat({n:0,t:'我的词表'})},
];
export const bookById = id => BOOKS.find(book=>book.id===id) || BOOKS[0];
export const bookUnits = id => bookById(id).units;
export const bookWords = id => bookById(id).words;
export const wordsFor = (bookId,unit) => bookWords(bookId).filter(word=>word.u===unit);
export const allCatalogWords = () => BOOKS.flatMap(book=>book.words);
