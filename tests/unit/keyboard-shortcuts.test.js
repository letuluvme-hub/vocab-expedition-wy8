import test from 'node:test';
import assert from 'node:assert/strict';
import {isTextEntry,shortcutToken} from '../../src/ui/keyboard-shortcuts.js';
test('browser modifiers, composition and editable inputs are never game commands',()=>{
  for(const modifier of ['ctrlKey','altKey','metaKey','isComposing','defaultPrevented']) assert.equal(shortcutToken({key:'F2',[modifier]:true}),null);
  assert.equal(shortcutToken({key:'a',keyCode:229}),null);
  for(const target of [{tagName:'INPUT'},{tagName:'TEXTAREA'},{tagName:'SELECT'},{isContentEditable:true}]){
    assert.equal(isTextEntry(target),true);assert.equal(shortcutToken({key:'Enter',target}),null);
  }
});
test('shift-number card selection stays distinct from item numbers and ordinary uppercase letters',()=>{
  assert.equal(shortcutToken({key:'1',code:'Digit1'}),'1');
  assert.equal(shortcutToken({key:'!',code:'Digit1',shiftKey:true}),'Shift+1');
  assert.equal(shortcutToken({key:'@',code:'Digit2',shiftKey:true}),'Shift+2');
  assert.equal(shortcutToken({key:'A',code:'KeyA',shiftKey:true}),'Shift+A');
  assert.equal(isTextEntry({tagName:'BUTTON'}),false);
});
