import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bankCols,bankRows,bankPosOf} from '../../src/domain/letter-bank.js';
test('the full alphabet occupies three A-Z rows and navigation uses those same rows',()=>{
 const letters=[...'zyxwvutsrqponmlkjihgfedcba'];
 assert.equal(bankCols(26),9);
 const rows=bankRows(letters,false);assert.equal(rows.length,3);
 assert.deepEqual(rows.map(row=>row.map(i=>letters[i]).join('')),['abcdefghi','jklmnopqr','stuvwxyz']);
 for(let i=0;i<letters.length;i++){
  const position=bankPosOf(letters,false,i);assert.equal(rows[position.row][position.col],i);assert.equal(position.rows,3);
 }
});
