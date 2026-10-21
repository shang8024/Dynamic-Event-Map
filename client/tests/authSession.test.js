import test from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage, passwordPolicyMessage, requestPasswordReset, resolveAuthSession } from '../src/services/authSession.js';

const verifiedAccount = (overrides = {}) => ({
  uid: 'firebase-account-id', email: 'reader@example.invalid', emailVerified: true,
  displayName: 'Reader', photoURL: null,
  getIdTokenResult: async () => ({ token: 'test-id-token', claims: { email_verified: true } }),
  ...overrides,
});

test('signed-out users have neither an account nor an authorized profile', async () => {
  assert.deepEqual(await resolveAuthSession(null, () => assert.fail('no API call expected')), { account: null, user: null });
});

test('unverified email signup does not obtain an API token or provision a profile', async () => {
  const pending = verifiedAccount({ emailVerified: false, getIdTokenResult: () => assert.fail('no token requested') });
  const session = await resolveAuthSession(pending, () => assert.fail('unverified signup must not reach backend'));
  assert.equal(session.account.email, pending.email);
  assert.equal(session.account.emailVerified, false);
  assert.equal(session.user, null);
});

test('a stale verified user property cannot bypass an unverified token claim', async () => {
  const pending = verifiedAccount({ getIdTokenResult: async () => ({ token: 'unverified-token', claims: { email_verified: false } }) });
  const session = await resolveAuthSession(pending, () => assert.fail('unverified claim must not reach backend'));
  assert.equal(session.user, null);
  assert.equal(session.account.emailVerified, false);
});

test('verified tokens provision once and use the backend profile ID', async () => {
  let calls = 0;
  const session = await resolveAuthSession(verifiedAccount(), async token => {
    calls++; assert.equal(token, 'test-id-token'); return { id: 42, username: 'reader-unique' };
  });
  assert.equal(calls, 1);
  assert.equal(session.user.id, 42);
  assert.equal(session.user.uid, 'firebase-account-id');
  assert.equal(session.user.displayName, 'Reader');
  assert.equal(Object.hasOwn(session.user, 'token'), false);
});

test('a backend outage or missing profile never produces an authorized user', async () => {
  await assert.rejects(() => resolveAuthSession(verifiedAccount(), async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(() => resolveAuthSession(verifiedAccount(), async () => null), { code: 'app/profile-unavailable' });
});

test('password reset returns indistinguishable success for missing and existing accounts', async () => {
  assert.equal(await requestPasswordReset(async email => assert.equal(email, 'reader@example.invalid'), ' reader@example.invalid '), undefined);
  assert.equal(await requestPasswordReset(async () => { throw { code: 'auth/user-not-found' }; }, 'missing@example.invalid'), undefined);
  await assert.rejects(() => requestPasswordReset(async () => { throw { code: 'auth/network-request-failed' }; }, 'reader@example.invalid'), { code: 'auth/network-request-failed' });
});

test('authentication errors do not expose account existence or raw service details', () => {
  assert.equal(authErrorMessage({ code: 'auth/user-not-found' }), authErrorMessage({ code: 'auth/wrong-password' }));
  assert.equal(authErrorMessage({ code: 'unknown', message: 'private service response' }).includes('private service response'), false);
});

test('password guidance reflects the configured Firebase policy', () => {
  const message = passwordPolicyMessage({ meetsMinPasswordLength: false, containsUppercaseLetter: false, containsNumericCharacter: false, passwordPolicy: { customStrengthOptions: { minPasswordLength: 12 } } });
  assert.equal(message, 'Your password needs at least 12 characters, an uppercase letter, a number.');
});
