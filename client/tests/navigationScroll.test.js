import test from 'node:test';
import assert from 'node:assert/strict';
import {canCollapseNavigation,createNavigationScrollTracker} from '../src/utils/navigationScroll.js';

test('short content cannot collapse into a page with no way to scroll upward',()=>{
  assert.equal(canCollapseNavigation({scrollHeight:600,clientHeight:540},69),false);
  assert.equal(canCollapseNavigation({scrollHeight:617,clientHeight:540},69),false);
  assert.equal(canCollapseNavigation({scrollHeight:900,clientHeight:540},69),true);
});

test('navigation hides after deliberate downward travel and returns after a smaller upward movement',()=>{
  const track=createNavigationScrollTracker();
  assert.equal(track.update(20),null);assert.equal(track.update(47),null);assert.equal(track.update(60),true);
  assert.equal(track.update(100,true),null);assert.equal(track.update(90,true),null);assert.equal(track.update(83,true),false);
});
test('small direction reversals do not accumulate into unwanted visibility changes',()=>{
  const track=createNavigationScrollTracker({initial:100});
  for(const position of [103,99,105,101,110,104,100]) assert.equal(track.update(position,true),null);
  assert.equal(track.update(83,true),false);
});
test('the top always reveals navigation and negative overscroll is harmless',()=>{
  const track=createNavigationScrollTracker({initial:100});
  assert.equal(track.update(6,true),false);assert.equal(track.update(-30,true),false);
  assert.equal(track.update(20),null);assert.equal(track.update(55),true);
});
test('resetting the baseline ignores layout clamping without losing the next user scroll direction',()=>{
  const track=createNavigationScrollTracker({initial:300});
  assert.equal(track.update(360),true);
  track.reset(260);
  assert.equal(track.update(255,true),null);assert.equal(track.update(240,true),false);
});
