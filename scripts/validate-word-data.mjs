import { pathToFileURL } from 'node:url';

const LEGACY_UNITS = { 1: 45, 2: 55, 3: 29, 4: 50, 5: 41, 6: 39 };

function validateBookRecords(words, expectedUnits) {
  if (!Array.isArray(words)) throw new Error('Words must be an array');
  const units = Object.fromEntries(Object.keys(expectedUnits).map(unit => [unit, 0]));
  const maximumUnit = Object.keys(units).length;
  const seen = new Map();
  for (const [index, word] of words.entries()) {
    if (!word || typeof word !== 'object' || Array.isArray(word)) {
      throw new Error(`Invalid word record at index ${index}: expected an object`);
    }
    for (const field of ['w', 'z', 'th']) {
      if (typeof word[field] !== 'string') {
        throw new Error(`Word at index ${index}: ${field} must be a string`);
      }
    }
    for (const [field, maximum] of [['u', maximumUnit], ['d', 3]]) {
      if (!Number.isInteger(word[field]) || word[field] < 1 || word[field] > maximum) {
        throw new Error(`Word at index ${index}: ${field} must be an integer from 1 to ${maximum}`);
      }
    }
    const normalized = word.w.toLowerCase().replace(/[^a-z]/g, '');
    if (!normalized) {
      throw new Error(`Word at index ${index}: w normalized spelling must not be empty`);
    }
    if (seen.has(normalized)) {
      throw new Error(`Duplicate word "${word.w}" (normalized "${normalized}") at indices ${seen.get(normalized)} and ${index}`);
    }
    seen.set(normalized, index);
    units[word.u] += 1;
  }
  const expectedTotal = Object.values(expectedUnits).reduce((sum, count) => sum + count, 0);
  if (words.length !== expectedTotal) {
    throw new Error(`Total word count must be ${expectedTotal}; got ${words.length}`);
  }
  for (const [unit, count] of Object.entries(expectedUnits)) {
    if (units[unit] !== count) {
      throw new Error(`Unit ${unit} must contain ${count} words; got ${units[unit]}`);
    }
  }
  return { total: words.length, units };
}

// No options: this entry point always retains the frozen WY8A distribution.
export function validateWords(words) {
  return validateBookRecords(words, LEGACY_UNITS);
}

export function validateBook(words, { expectedUnits } = {}) {
  if (!expectedUnits || typeof expectedUnits !== 'object' || Array.isArray(expectedUnits)) {
    throw new Error('expectedUnits must declare textbook source unit counts');
  }
  const entries = Object.entries(expectedUnits);
  if (!entries.length || entries.some(([unit, count], index) =>
    unit !== String(index + 1) || !Number.isSafeInteger(count) || count <= 0)
    || !Number.isSafeInteger(entries.reduce((sum, [, count]) => sum + count, 0))) {
    throw new Error('expectedUnits must contain consecutive units from 1 with positive integer counts');
  }
  return validateBookRecords(words, expectedUnits);
}

export function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || !catalog.length) throw new Error('Catalog must be a nonempty array');
  const seen = new Set(), summaries = [];
  for (const book of catalog) {
    if (!book || typeof book.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(book.id)) {
      throw new Error('Catalog book must have a stable lowercase id');
    }
    if (seen.has(book.id)) throw new Error(`Duplicate catalog book id ${book.id}`);
    seen.add(book.id);
    // Registration metadata can never relax the existing 259-word contract.
    if (book.id === 'wy8a') validateWords(book.words);
    summaries.push([book.id, validateBook(book.words, { expectedUnits: book.expectedUnits })]);
  }
  if (!seen.has('wy8a')) throw new Error('Catalog must retain the frozen wy8a registration');
  return { total: summaries.reduce((sum, [, book]) => sum + book.total, 0), books: Object.fromEntries(summaries) };
}

// Keep imports usable in tests without loading the runtime data or executing CLI output.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { BOOKS } = await import('../src/data/books.js');
  console.log(JSON.stringify(validateCatalog(BOOKS)));
}
