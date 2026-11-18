import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingApi } from '../server/bookingApi.js';
import { requestBookingOperation } from '../src/bookingApi.js';
import { getBookingRuntime } from '../server/firebaseAdmin.js';
const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
const request = (overrides = {}) => ({ method: 'POST', headers: { authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: { operation: 'submit', data: { id: 'intent-one' } }, ...overrides });
test('API verifies a Firebase token with revocation checks and delegates the same intent', async () => {
  const seen = [], res = response();
  const handler = createBookingApi({ getRuntime: () => ({ verifyIdToken: async (...args) => { seen.push(args); return { uid: 'customer', email: 'demo@example.test' }; }, service: { submitBooking: async value => { seen.push(value); return { id: value.data.id, uid: value.auth.uid }; } } }), log: () => {} });
  await handler(request(), res);
  assert.deepEqual(seen[0], ['demo-token', true]);
  assert.equal(seen[1].auth.uid, 'customer'); assert.equal(res.body.data.id, 'intent-one'); assert.equal(res.headers['Cache-Control'], 'no-store');
});
test('API rejects missing authentication before initializing private credentials', async () => {
  const handler = createBookingApi({ getRuntime: () => { throw new Error('must not initialize'); }, log: () => {} }), res = response();
  await handler(request({ headers: { 'content-type': 'application/json' } }), res);
  assert.equal(res.statusCode, 401); assert.equal(res.body.error.code, 'booking/unauthenticated');
});
test('API does not expose private error details or customer payloads in logs', async () => {
  const logs = [], res = response();
  const handler = createBookingApi({ getRuntime: () => { throw Object.assign(new Error('PRIVATE KEY, customer@example.test'), { code: 'server/configuration' }); }, log: value => logs.push(value) });
  await handler(request(), res);
  assert.equal(res.statusCode, 503); assert.doesNotMatch(JSON.stringify([res.body, logs]), /PRIVATE KEY|customer@example.test|demo-token/);
  assert.equal(logs[0].operation, 'initialize-booking-server');
});
test('client calls a same-origin API using the Firebase ID token and stable booking ID', async () => {
  let call;
  const result = await requestBookingOperation({ uid: 'customer', getIdToken: async () => 'demo-token' }, 'submit', { id: 'stable-intent' }, { fetchImpl: async (...args) => { call = args; return { ok: true, json: async () => ({ data: { id: 'stable-intent', uid: 'customer' } }) }; } });
  assert.equal(call[0], '/api/booking'); assert.equal(call[1].headers.Authorization, 'Bearer demo-token');
  assert.equal(JSON.parse(call[1].body).data.id, 'stable-intent'); assert.equal(result.id, 'stable-intent');
});
test('client rejects missing APIs and malformed successful HTML responses safely', async () => {
  for (const ok of [true, false]) {
    await assert.rejects(requestBookingOperation({ uid: 'customer', getIdToken: async () => 'token' }, 'submit', { id: 'intent' }, { fetchImpl: async () => ({ ok, json: async () => { throw new Error('Vercel HTML'); } }) }), { code: 'booking/unavailable' });
  }
});

test('deployed server refuses emulator tokens even if emulator environment variables are supplied', () => {
  const changes = { VERCEL: '1', FIREBASE_PROJECT_ID: 'demo-luxe-availability', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000' };
  const original = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, changes);
    assert.throws(() => getBookingRuntime(), { code: 'server/configuration' });
  } finally {
    for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test('API rejects unsupported methods, malformed JSON, expired tokens, and oversized requests', async () => {
  const handler = createBookingApi({ getRuntime: () => ({ verifyIdToken: async () => { throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }); } }), log: () => {} });
  for (const [overrides, expected] of [[{ method: 'GET' }, 405], [{ body: '{' }, 400], [{ body: { operation: 'unknown', data: {} } }, 400], [{ body: { operation: 'submit', data: { notes: 'x'.repeat(33000) } } }, 400], [{}, 401]]) {
    const res = response(); await handler(request(overrides), res); assert.equal(res.statusCode, expected);
  }
});
