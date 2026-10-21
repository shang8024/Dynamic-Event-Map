import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnTo,authPath,returnWithoutAction,authIntent} from '../src/services/authNavigation.js';
test('sign-in destinations cannot redirect to other sites or another auth page',()=>{
  for(const destination of ['//evil.test','https://evil.test','/\\evil.test','/signin','/register?returnTo=/signin','/unknown','/\n/evil.test']) assert.equal(safeReturnTo(destination),'/');
  assert.equal(safeReturnTo('/?event=296&action=save'),'/?event=296');
  assert.equal(safeReturnTo('/bookmarks'),'/bookmarks');
});
test('separate auth pages preserve the return intent, while cancelling drops automatic actions',()=>{
  const path=authPath('register','save this event','/?event=296&action=save');
  const url=new URL(path,'https://eventmap.invalid');
  assert.equal(url.pathname,'/register');assert.equal(url.searchParams.get('returnTo'),'/?event=296');
  assert.equal(returnWithoutAction('/?event=296&action=save'),'/?event=296');
  assert.equal(returnWithoutAction('/?create=1'),'/');
});
test('resume actions are narrow navigation state, never commands taken from a public URL',()=>{
  assert.deepEqual(authIntent({kind:'save',eventId:296},'/?event=296'),{kind:'save',eventId:296});
  assert.equal(authIntent({kind:'save',eventId:297},'/?event=296'),null);
  assert.equal(authIntent({kind:'delete',eventId:296},'/?event=296'),null);
  assert.equal(authIntent({kind:'save',eventId:296},'/settings'),null);
});
