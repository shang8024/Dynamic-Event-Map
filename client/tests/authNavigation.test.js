import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnTo,authPath,returnWithoutAction,authIntent,eventPageId} from '../src/services/authNavigation.js';
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

test('event pages survive sign-in while actions stay bound to the same event',()=>{
  assert.equal(eventPageId('/events/296'),296);
  assert.equal(safeReturnTo('/events/296#comments'),'/events/296#comments');
  const route=new URL(authPath('signin','join this conversation','/events/296#comments'),'https://eventmap.invalid');
  assert.equal(route.searchParams.get('returnTo'),'/events/296#comments');
  assert.deepEqual(authIntent({kind:'comment',eventId:296},'/events/296#comments'),{kind:'comment',eventId:296});
  assert.deepEqual(authIntent({kind:'save',eventId:296},'/events/296'),{kind:'save',eventId:296});
  assert.equal(authIntent({kind:'save',eventId:297},'/events/296?event=297'),null);
  assert.equal(authIntent({kind:'create'},'/events/296'),null);
  for(const value of ['/events/0','/events/-1','/events/01','/events/2147483648','/events/296/extra','/events/296%2fextra']) {
    assert.equal(eventPageId(value),null);assert.equal(safeReturnTo(value),'/');
  }
});

test('creation and contribution pages return after sign-in without accepting arbitrary event subroutes',()=>{
  for(const path of ['/events/new','/events/296/suggest','/contributions?request=7']) assert.equal(safeReturnTo(path),path);
  for(const path of ['/events/0/suggest','/events/01/suggest','/events/2147483648/suggest','/events/296/delete']) assert.equal(safeReturnTo(path),'/');
});
