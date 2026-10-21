const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual middleware/controllers with isolated identity and DB adapters.
// These tests need neither real Firebase credentials nor a running database.
function load(relativePath, dependencies) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    console: { log() {}, warn() {}, error() {} },
  }, { filename });
  return module.exports;
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const verified = { uid: 'user-a', email: 'alice@example.test', email_verified: true, name: 'Alice' };

function middleware(claims, users) {
  return load('middleware/auth.js', {
    '../config/firebaseAdmin': { auth: () => ({ verifyIdToken: async () => claims }) },
    '../models/user': users,
    'node:crypto': require('node:crypto'),
    './rateLimit': { authenticated: async () => true },
  });
}

test('an unverified token cannot create or select a database profile', async () => {
  const handler = middleware({ ...verified, email_verified: false }, {
    findOne() { assert.fail('unverified identity reached the database'); },
  });
  const res = response();
  await handler({ headers: { authorization: 'Bearer example' } }, res, () => assert.fail('authenticated'));
  assert.equal(res.statusCode, 403);
});

test('email equality never links a different Firebase UID or a legacy account', async () => {
  for (const existingUid of ['another-user', null]) {
    let lookups = 0;
    const existing = { id: 9, google_id: existingUid, save() { assert.fail('account changed'); } };
    const handler = middleware(verified, {
      async findOne({ where }) {
        lookups++;
        if (where.google_id) return null;
        assert.equal(where.email, verified.email);
        return existing;
      },
      create() { assert.fail('duplicate identity created'); },
    });
    const res = response();
    await handler({ headers: { authorization: 'Bearer example' } }, res, () => assert.fail('linked by email'));
    assert.equal(res.statusCode, 409);
    assert.equal(lookups, 2);
    assert.equal(existing.google_id, existingUid);
  }
});

test('a verified existing UID remains authenticated without rewriting its profile', async () => {
  let saved = false;
  const existing = { id: 7, google_id: verified.uid, username: 'Existing unique name', async save() { saved = true; } };
  const handler = middleware(verified, { async findOne({ where }) {
    assert.equal(where.google_id, verified.uid);
    return existing;
  } });
  const req = { headers: { authorization: 'Bearer example' } };
  let nextCalled = false;
  await handler(req, response(), () => { nextCalled = true; });
  assert.equal(req.user.id, 7);
  assert.equal(req.firebase.uid, verified.uid);
  assert.equal(req.user.username, 'Existing unique name');
  assert.equal(saved, false);
  assert.equal(nextCalled, true);
});

test('a new verified identity is created from signed claims', async () => {
  let created;
  const handler = middleware(verified, {
    async findOne() { return null; },
    async create(data) { created = data; return { id: 8, ...data }; },
  });
  const req = { headers: { authorization: 'Bearer example' } };
  await handler(req, response(), () => {});
  assert.equal(created.google_id, verified.uid);
  assert.equal(created.email, verified.email);
  assert.equal(req.user.id, 8);
});

test('profile mutations and reads cannot target another UID', async () => {
  const controllers = load('controllers/profilesController.js', {
    '../config/db': { query() { assert.fail('cross-user request reached the database'); } },
  });
  const mutateResponse = response();
  await controllers.addUser({ firebase: verified, body: { uid: 'victim', email: 'forged@example.test' } }, mutateResponse);
  assert.equal(mutateResponse.statusCode, 403);
  const readResponse = response();
  await controllers.getUserByUid({ firebase: verified, params: { uid: 'victim' } }, readResponse);
  assert.equal(readResponse.statusCode, 403);
});

test('legacy profile sync preserves the allocated username and ignores body identity fields', async () => {
  const controllers = load('controllers/profilesController.js', {
    '../config/db': { query() { assert.fail('legacy sync attempted to rewrite a profile'); } },
  });
  const existing = { id: 7, google_id: verified.uid, username: 'Alice-allocated', email: verified.email };
  const res = response();
  await controllers.addUser({
    firebase: { ...verified, picture: 'https://example.test/verified.png' },
    user: existing,
    body: { uid: verified.uid, email: 'forged@example.test', displayName: 'Forged', photoURL: 'https://example.test/forged.png' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user, existing);
  assert.equal(res.body.user.username, 'Alice-allocated');
});

function uniqueConflict(field, value) {
  return Object.assign(new Error('Unique constraint violated'), {
    name: 'SequelizeUniqueConstraintError', fields: { [field]: value },
  });
}

function profileStore(initial = []) {
  const rows = [...initial];
  let creates = 0;
  return {
    rows,
    get creates() { return creates; },
    async findOne({ where }) {
      return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) || null;
    },
    async create(data) {
      creates++;
      for (const field of ['google_id', 'email', 'username']) {
        if (rows.some((row) => row[field] === data[field])) throw uniqueConflict(field, data[field]);
      }
      const row = { id: rows.length + 1, ...data };
      rows.push(row);
      return row;
    },
  };
}

async function authenticate(claims, store) {
  const req = { headers: { authorization: 'Bearer example' } };
  const res = response();
  let nextCalled = false;
  await middleware(claims, store)(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

test('different UIDs with the same display name or email prefix onboard concurrently', async () => {
  for (const name of ['Shared name', undefined, '🎵'.repeat(80)]) {
    const store = profileStore();
    const outcomes = await Promise.all([
      authenticate({ ...verified, uid: 'first-user', email: 'shared@one.test', name }, store),
      authenticate({ ...verified, uid: 'second-user', email: 'shared@two.test', name }, store),
    ]);
    assert.ok(outcomes.every((outcome) => outcome.nextCalled));
    assert.equal(store.rows.length, 2);
    assert.notEqual(store.rows[0].username, store.rows[1].username);
    assert.ok(store.rows.every((row) => Array.from(row.username).length <= 50));
    const again = await authenticate({ ...verified, uid: 'second-user', email: 'shared@two.test', name: 'Changed name' }, store);
    assert.equal(again.req.user.id, outcomes[1].req.user.id);
    assert.equal(again.req.user.username, outcomes[1].req.user.username);
  }
});

test('concurrent first requests for the same UID recover the same database profile', async () => {
  const store = profileStore();
  const outcomes = await Promise.all([authenticate(verified, store), authenticate(verified, store)]);
  assert.equal(store.creates, 2, 'both requests attempted creation, exercising the unique-conflict recovery');
  assert.equal(store.rows.length, 1);
  assert.ok(outcomes.every((outcome) => outcome.nextCalled));
  assert.equal(outcomes[0].req.user.id, outcomes[1].req.user.id);
});

test('the same UID appearing between identity and email lookups is safe to reuse', async () => {
  const row = { id: 9, google_id: verified.uid, email: verified.email, username: 'Existing name' };
  const result = await authenticate(verified, {
    async findOne({ where }) { return where.google_id ? null : row; },
    create() { assert.fail('a concurrently created identity was recreated'); },
  });
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.user, row);
});

test('concurrent different UIDs sharing an email never link to the winning profile', async () => {
  const store = profileStore();
  const outcomes = await Promise.all([
    authenticate(verified, store),
    authenticate({ ...verified, uid: 'different-user' }, store),
  ]);
  assert.equal(store.rows.length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.nextCalled).length, 1);
  const rejected = outcomes.find((outcome) => !outcome.nextCalled);
  assert.equal(rejected.res.statusCode, 409);
  assert.equal(rejected.req.user, undefined);
});

test('a database failure is retryable and does not masquerade as an invalid token', async () => {
  const outcome = await authenticate(verified, {
    async findOne() { throw new Error('database unavailable'); },
  });
  assert.equal(outcome.res.statusCode, 503);
  assert.equal(outcome.nextCalled, false);
});

function events(create) {
  return load('controllers/eventsController.js', {
    '../models/eventModel': { create },
    '../services/eventPermissions': require('../services/eventPermissions'),
    '../config/redis': {},
    '../socket': { getIO: () => ({ emit() {} }) },
    '../config/db': { query() { assert.fail('system identity lookup attempted'); } },
    './statsController': { async bumpEventCount() {} },
  });
}

const eventBody = {
  title: 'Community event', description: 'Description', latitude: 43.65, longitude: -79.38,
  location_address: 'Toronto', starts_at: '2026-11-01T14:00:00Z', ends_at: '2026-11-01T15:00:00Z',
};

test('a logged-in user cannot impersonate the external-event importer', async () => {
  const controllers = events(() => assert.fail('external event inserted'));
  const res = response();
  await controllers.createEvent({ user: { id: 7 }, body: { ...eventBody, source: 'external' } }, res);
  assert.equal(res.statusCode, 403);
});

test('an ordinary event is owned by the authenticated user, ignoring body.user_id', async () => {
  let inserted;
  const controllers = events(async (data) => { inserted = data; return { rows: [{ id: 42 }] }; });
  const res = response();
  await controllers.createEvent({ user: { id: 7 }, body: { ...eventBody, user_id: 1 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(inserted.user_id, 7);
  assert.equal(inserted.source, 'internal');
});
