import { pathToFileURL } from 'node:url';

export function validateWords(words) {
  if (!Array.isArray(words)) throw new Error('Words must be an array');
  const units = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
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
    for (const [field, maximum] of [['u', 6], ['d', 3]]) {
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
  if (words.length !== 259) {
    throw new Error(`Total word count must be 259; got ${words.length}`);
  }
  const expectedUnits = { 1: 45, 2: 55, 3: 29, 4: 50, 5: 41, 6: 39 };
  for (const [unit, count] of Object.entries(expectedUnits)) {
    if (units[unit] !== count) {
      throw new Error(`Unit ${unit} must contain ${count} words; got ${units[unit]}`);
    }
  }
  return { total: words.length, units };
}

// Keep imports usable in tests without loading the runtime data or executing CLI output.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { WORDS } = await import('../src/data/words.js');
  console.log(JSON.stringify(validateWords(WORDS)));
}
