import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS } from '../../src/data/words.js';

const readBook = async () => (await import('../../src/data/words-wy8b.js')).WORDS_WY8B;
const expectedUnits = [
  ['self-expression', 'creativity', 'require', 'scissors', 'drama', 'acting', 'normal', 'prefer ... to', 'pottery', 'rather than', 'position', 'instrument', 'sculpture', 'sculptor', 'landscape', 'master', 'dynasty', 'paint', 'harmony', 'path', 'ahead', 'whoever', 'come across', 'scare', 'scared', 'vivid', 'east', 'west', 'peaceful'],
  ['discovery', 'ancient', 'BCE', 'exploration', 'wheel', 'CE', 'economy', 'material', 'fishnet', 'war', 'illness', 'socialism', 'habit', 'totally', 'tube', 'bone', 'X-ray', 'award', 'sir', 'by accident', 'to one’s surprise', 'turn ... into', 'life-saving', 'course', 'treat', 'serious', 'medical', 'light up', 'volunteer', 'herself', 'keep in touch', 'spare'],
  ['mall', 'sale', 'payment', 'cash', 'honey', 'assistant', 'deal', 'bill', 'donate', 'pound', 'cheap', 'chocolate', 'pocket', 'pocket money', 'expectation', 'budget', 'in short', 'independent', 'responsible', 'mess', 'mess up', 'responsibility', 'value', 'account', 'bank', 'economics', 'whatever', 'economist', 'society', 'trade', 'goods', 'exchange', 'sample', 'saying', 'cost', 'even if', 'might', 'complete', 'completely', 'valuable', 'pie', 'pie chart', 'percentage', 'account for'],
  ['fashion', 'trainers', 'decoration', 'afford', 'changeable', 'energetic', 'fashionable', 'flowery', 'outfit', 'narrow', 'baggy', 'advertising', 'a great deal of', 'advertisement', 'image', 'pioneer', 'influencer', 'jewellery', 'attract', 'fit', 'relaxed', 'mention', 'grade', 'interest'],
  ['disaster', 'flood', 'earthquake', 'terrible', 'force', 'injury', 'death', 'destroy', 'injure', 'effect', 'Rd', 'exam', 'typhoon', 'battery', 'case', 'in case', 'go off', 'pick up', 'lock', 'anyway', 'anybody', 'low-lying', 'cancel', 'necessary', 'electronic', 'sharp', 'bleed', 'survive', 'similar', 'rapid', 'rapidly', 'towards', 'hotel', 'nothing', 'whether', 'get away', 'guard', 'urge', 'super', 'seaside', 'thunder', 'coast', 'rise', 'injured', 'rescue', 'tent'],
  ['novel', 'magical', 'cheerful', 'bad-tempered', 'caring', 'doubtful', 'firm', 'tool', 'seed', 'knife', 'fork', 'packet', 'dead', 'cheerleader', 'yourself', 'hers', 'whenever', 'be mean to sb', 'hardly', 'stare', 'stare at', 'hang', 'hang out', 'dig', 'neither', 'as if', 'lie', 'ache', 'joke', 'terribly', 'finish', 'over the moon', 'especially'],
];

test('WY8B contains all 208 photographed entries in textbook unit and column order', async () => {
  const words = await readBook();
  assert.equal(words.length, 208);
  assert.deepEqual(expectedUnits.map((_, i) => words.filter(w => w.u === i + 1).length), [29, 32, 44, 24, 46, 33]);
  assert.deepEqual(words.map(w => w.w), expectedUnits.flat());
});

test('WY8B records use the established five-field vocabulary contract', async () => {
  const words = await readBook();
  for (const word of words) {
    assert.deepEqual(Object.keys(word).sort(), ['d', 'th', 'u', 'w', 'z']);
    assert.ok(Number.isInteger(word.u) && word.u >= 1 && word.u <= 6);
    assert.ok(Number.isInteger(word.d) && word.d >= 1 && word.d <= 3);
    for (const key of ['w', 'z', 'th']) assert.ok(typeof word[key] === 'string' && word[key].trim(), `${word.w}: ${key}`);
  }
});

test('WY8B difficulty is derived from alphabetic length, without rewriting textbook spelling', async () => {
  const words = await readBook();
  for (const word of words) {
    const length = word.w.replace(/[^a-z]/gi, '').length;
    assert.ok(length > 0, word.w);
    assert.equal(word.d, length <= 5 ? 1 : length <= 9 ? 2 : 3, word.w);
  }
});

test('WY8B has no normalized duplicates within this book', async () => {
  const words = await readBook();
  const keys = words.map(w => w.w.toLowerCase().replace(/[^a-z]/g, ''));
  assert.equal(new Set(keys).size, words.length);
});

test('WY8B preserves phrases, ellipses, capitalized abbreviations and textbook saying', async () => {
  const words = await readBook();
  for (const spelling of ['prefer ... to', 'turn ... into', 'to one’s surprise', 'BCE', 'CE', 'X-ray', 'Rd', 'saying', 'be mean to sb']) {
    assert.equal(words.filter(w => w.w === spelling).length, 1, spelling);
  }
  assert.equal(words.some(w => w.w === 'saving'), false);
  assert.equal(words.find(w => w.w === 'saying').z, '谚语；格言；警句');
});

test('WY8B preserves secondary meanings and US spelling notes without adding spurious spelling entries', async () => {
  const words = await readBook();
  const meaning = w => words.find(word => word.w === w).z;
  assert.equal(meaning('award'), '颁奖 / 奖；奖品');
  assert.equal(meaning('complete'), '（用以强调）完全的，彻底的 / 完成；使完整');
  assert.equal(meaning('ache'), '疼痛 / （身体某部位的）疼痛');
  assert.equal(meaning('jewellery'), '珠宝；首饰（美式拼写 jewelry）');
  assert.equal(meaning('towards'), '向；朝着；接近（美式拼写 toward）');
  assert.equal(words.some(w => w.w === 'jewelry' || w.w === 'toward'), false);
});

test('WY8B remains separate from the unchanged 259-word WY8A textbook', async () => {
  const lower = await readBook();
  assert.equal(WORDS.length, 259);
  assert.equal(WORDS[0].w, 'litre');
  assert.equal(lower[0].w, 'self-expression');
  assert.notEqual(lower, WORDS);
});
