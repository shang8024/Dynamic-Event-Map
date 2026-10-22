import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/hooks/useNotificationAutoDismiss.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function');
function banner({notification = {type: 'info'}, enabled = true, paused = false, hidden = false} = {}) {
  const document = new EventTarget();document.hidden = hidden;
  let cleanup, dismissed = 0;
  vm.runInNewContext(source + '\nuseNotificationAutoDismiss(notification, enabled, dismiss, paused);', {
    document, notification, enabled, paused, setTimeout, clearTimeout,
    dismiss: () => dismissed++, useEffect: effect => {cleanup = effect();},
  });
  return {document, stop: () => cleanup?.(), dismissed: () => dismissed};
}

test('automatic dismissal is opt-in and important or actionable messages remain', context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const fixtures = [banner({enabled: false}), ...[
    {type: 'warning'}, {type: 'error'}, {type: 'info', action: {label: 'View'}},
    {type: 'success', stickyKey: 'today'}, {type: 'info', autoCloseMs: 0},
  ].map(notification => banner({notification}))];
  context.mock.timers.tick(60000);
  for (const fixture of fixtures) {assert.equal(fixture.dismissed(), 0);fixture.stop();}
});

test('routine updates have at least eight seconds to read', context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const fixture = banner({notification: {type: 'success', autoCloseMs: 2500}});
  context.mock.timers.tick(7999);assert.equal(fixture.dismissed(), 0);
  context.mock.timers.tick(1);assert.equal(fixture.dismissed(), 1);fixture.stop();
});

test('switching tabs stops the countdown and returning gives a fresh reading interval', context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const fixture = banner();
  context.mock.timers.tick(7000);
  fixture.document.hidden = true;fixture.document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(60000);assert.equal(fixture.dismissed(), 0);
  fixture.document.hidden = false;fixture.document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(7999);assert.equal(fixture.dismissed(), 0);
  context.mock.timers.tick(1);assert.equal(fixture.dismissed(), 1);fixture.stop();
});

test('interacting with a card and loading a page in a hidden tab do not start timers', context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const paused = banner({paused: true}), hidden = banner({hidden: true});
  context.mock.timers.tick(60000);
  assert.equal(paused.dismissed(), 0);assert.equal(hidden.dismissed(), 0);
  paused.stop();hidden.stop();
});

test('a covered or manually dismissed card cannot expire later; a revealed card gets a fresh interval', context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const old = banner();context.mock.timers.tick(7000);old.stop();
  context.mock.timers.tick(60000);assert.equal(old.dismissed(), 0);
  const revealed = banner();
  old.document.dispatchEvent(new Event('visibilitychange'));
  context.mock.timers.tick(7999);assert.equal(revealed.dismissed(), 0);assert.equal(old.dismissed(), 0);
  context.mock.timers.tick(1);assert.equal(revealed.dismissed(), 1);revealed.stop();
});
