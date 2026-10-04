import {test,expect,openPracticePanel} from './game-harness.js';

test('lower-book daily spelling earns scoped evidence and remains frozen across home book switch and reload',async({game,page},info)=>{
  test.skip(info.project.metadata.target==='legacy','Book-scoped daily learning');
  test.setTimeout(45_000);
  await page.clock.install({time:new Date('2026-10-04T04:00:00Z')});
  await game.open({saved:{mastered:['self-expression']}});
  await page.locator('#textbookSelect').selectOption('wy8b');
  await openPracticePanel(page);await page.locator('#dailyOpen').click();
  await page.locator('#dailyUnit').selectOption('1');await page.locator('#dailyStart').click();
  const words=(await game.saved()).dailySession.words;
  expect(words).toHaveLength(16);expect(words[0].w).toBe('self-expression');
  expect(words.every(word=>word.bookId==='wy8b')).toBe(true);
  for(const word of words){await page.keyboard.type(word.w.toLowerCase().replace(/[^a-z]/g,''));await page.locator('#dailyNext').click();}
  await page.locator('#dailyFormal').click();await page.keyboard.type('self-expression');
  await expect(page.locator('#dailyInput')).toHaveText('self-expression');
  await page.locator('#dailyNext').click();
  const earned=await game.saved();expect(earned.dailySession.results[0].key).toBe('wy8b:self-expression');
  expect(earned.dictationMastered).toEqual([words[0]]);
  expect(earned.mastered).toContain('self-expression');
  expect(earned.mastered).toContainEqual(words[0]);
  await page.locator('#dailyPause').click();await page.locator('#dailyHome').click();
  await page.locator('#textbookSelect').selectOption('wy8a');
  const frozen=(await game.saved()).dailySession;
  expect(frozen.bookId).toBe('wy8b');expect(frozen.words).toEqual(words);expect(frozen.index).toBe(1);
  await game.reload();await expect(page.locator('#textbookSelect')).toHaveValue('wy8a');
  await openPracticePanel(page);await page.locator('#dailyOpen').click();await page.locator('#dailyResume').click();
  await page.keyboard.type(words[1].w.toLowerCase());await page.locator('#dailyNext').click();
  const resumed=await game.saved();expect(resumed.dailySession.bookId).toBe('wy8b');
  expect(resumed.dailySession.words).toEqual(words);
  expect(resumed.dailySession.results.map(result=>result.key)).toEqual(['wy8b:self-expression',`wy8b:${words[1].w.toLowerCase()}`]);
  expect(resumed.dictationMastered).toEqual(words.slice(0,2));
});
