import {test} from 'node:test';
import assert from 'node:assert/strict';

test('word import parser preserves phrase apostrophe hyphen and comma formats',async()=>{
  const {parseCustomWords}=await import('../../src/domain/custom-words.js');
  assert.deepEqual(parseCustomWords("look up,查阅\nkeep an eye on 留意\ncan't 不能\nsuper-speed 超速\n123 bad\n"),{
    words:[{w:'look up',z:'查阅'},{w:'keep an eye on',z:'留意'},{w:"can't",z:'不能'},{w:'super-speed',z:'超速'}],bad:1
  });
  assert.deepEqual(parseCustomWords(' \n'),{words:[],bad:0});
});
