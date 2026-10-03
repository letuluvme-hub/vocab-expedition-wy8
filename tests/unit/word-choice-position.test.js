import test from 'node:test';
import assert from 'node:assert/strict';
import * as choice from '../../src/domain/word-choice.js';

const offer=[{w:'cat'},{w:'water'},{w:'mountain'}];
test('a remembered left, middle or right position chooses that position in the next offer',()=>{
  for(const index of [0,1,2]) assert.equal(choice.preferredOfferWord(offer,offer[1],index),offer[index]);
});
test('a smaller offer uses the nearest available position without altering the preference',()=>{
  const preferred=2;
  assert.equal(choice.preferredOfferWord(offer.slice(0,2),offer[0],preferred),offer[1]);
  assert.equal(choice.preferredOfferWord(offer.slice(0,1),offer[0],preferred),offer[0]);
  assert.equal(choice.preferredOfferWord(offer,offer[0],preferred),offer[2]);
});
test('missing or invalid old preferences retain the drawn word and do not mutate offers',()=>{
  const before=JSON.stringify(offer);
  for(const value of [undefined,null,-1,3,1.5,'2',NaN,{},true]) assert.equal(choice.preferredOfferWord(offer,offer[1],value),offer[1]);
  assert.equal(JSON.stringify(offer),before);
});
