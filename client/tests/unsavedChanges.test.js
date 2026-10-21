import test from 'node:test';
import assert from 'node:assert/strict';
import {blocksUnsavedNavigation,pendingUnsavedChanges} from '../src/utils/unsavedChanges.js';

const map={pathname:'/',search:'?event=1',hash:''};

test('changing the event query protects drafts even while the map route stays mounted',()=>{
  const guards=new Map([['photo',{dirty:true,busy:false}]]);
  assert.equal(blocksUnsavedNavigation(guards,map,{...map,search:'?event=2'}),true);
  assert.equal(blocksUnsavedNavigation(guards,map,{pathname:'/bookmarks',search:''}),true);
  assert.equal(blocksUnsavedNavigation(guards,map,{...map,hash:'#comments'}),false);
});

test('a successful form save only bypasses its own guard, preserving another photo draft',()=>{
  const guards=new Map([['event',{dirty:true,busy:true}],['photo',{dirty:true,busy:false}]]);
  assert.equal(blocksUnsavedNavigation(guards,map,{...map,search:'?event=2'},new Set(['event'])),true);
  guards.delete('photo');
  assert.equal(blocksUnsavedNavigation(guards,map,{...map,search:'?event=2'},new Set(['event'])),false);
});

test('saving is protected even after input becomes clean, and unmount removes that guard',()=>{
  const saving={dirty:false,busy:true},guards=new Map([['settings',saving],['clean',{dirty:false,busy:false}]]);
  assert.deepEqual(pendingUnsavedChanges(guards),[saving]);
  assert.equal(blocksUnsavedNavigation(guards,map,{pathname:'/recommendations',search:''}),true);
  guards.delete('settings');
  assert.equal(blocksUnsavedNavigation(guards,map,{pathname:'/recommendations',search:''}),false);
});
