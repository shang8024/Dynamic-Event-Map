const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

test('project-only configuration verifies signed tokens without resolving server credentials', async (t) => {
  const envNames = [
    'FIREBASE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_SERVICE_ACCOUNT',
    'FIREBASE_AUTH_EMULATOR_HOST',
  ];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  const projectId = 'eventmap-verification-test';
  process.env.FIREBASE_PROJECT_ID = projectId;
  const configPath = require.resolve('../config/firebaseAdmin');
  delete require.cache[configPath];
  const admin = require(configPath);
  const app = admin.app();
  t.after(async () => {
    await app.delete();
    delete require.cache[configPath];
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  assert.equal(app.options.projectId, projectId);

  // initializeApp constructs a lazy default credential. Prove that verification
  // never asks it for a project ID or an OAuth access token.
  const credential = app.options.credential;
  const accessToken = t.mock.method(credential, 'getAccessToken', async () => {
    throw new Error('test-credentials-required');
  });
  const discoverProject = t.mock.method(credential, 'getProjectId', async () => {
    throw new Error('ADC project discovery must not run');
  });

  // Generate an ephemeral signing pair entirely in memory. Mock the HTTPS
  // response carrying public certificates, not the SDK's token verification.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certificates = { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }) };
  const requests = [];
  t.mock.method(https, 'request', (options, callback) => {
    requests.push(options);
    assert.equal(options.hostname, 'www.googleapis.com');
    assert.equal(options.path, '/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    assert.equal(options.method, 'GET');
    assert.equal(Object.keys(options.headers || {}).some((name) => name.toLowerCase() === 'authorization'), false);
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.end = () => process.nextTick(() => {
      const res = Readable.from([Buffer.from(JSON.stringify(certificates))]);
      res.statusCode = 200;
      res.headers = { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' };
      callback(res);
    });
    return req;
  });

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: projectId, iss: `https://securetoken.google.com/${projectId}`,
    sub: 'verified-user', iat: now - 10, auth_time: now - 10, exp: now + 3600,
    email: 'test@example.test', email_verified: true,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  function token(overrides = {}) {
    const message = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })}.${encode({ ...claims, ...overrides })}`;
    const signature = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url');
    return `${message}.${signature}`;
  }

  const auth = admin.auth();
  const validToken = token();
  const decoded = await auth.verifyIdToken(validToken);
  assert.equal(decoded.uid, claims.sub);
  assert.equal(decoded.email_verified, true);
  assert.equal(requests.length, 1);
  await assert.rejects(auth.verifyIdToken(token({ aud: 'different-project' })), /aud.*audience/i);
  await assert.rejects(auth.verifyIdToken(token({ iss: 'https://attacker.example.test' })), /iss.*issuer/i);
  await assert.rejects(auth.verifyIdToken(token({ exp: now - 1 })), (error) => error.code === 'auth/id-token-expired');

  const [header, , signature] = validToken.split('.');
  const tampered = `${header}.${encode({ ...claims, sub: 'attacker-user' })}.${signature}`;
  await assert.rejects(auth.verifyIdToken(tampered), /invalid signature/i);
  const unsigned = `${encode({ alg: 'none', kid: 'test-key' })}.${encode(claims)}.`;
  await assert.rejects(auth.verifyIdToken(unsigned), /incorrect algorithm/i);
  assert.equal(accessToken.mock.callCount(), 0);
  assert.equal(discoverProject.mock.callCount(), 0);

  // The capability stops at signature/claims verification. Revocation checking
  // makes an authenticated user lookup and therefore needs server credentials.
  await assert.rejects(auth.verifyIdToken(validToken, true), /test-credentials-required/);
  assert.equal(accessToken.mock.callCount(), 1);
  assert.equal(requests.length, 1);
});
