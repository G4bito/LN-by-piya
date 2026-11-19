import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getBookingRuntime } from '../functions/bookingRuntime.js';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, deleteApp, getApps } = require('firebase-admin/app');

test('managed booking runtime reuses one Admin app without reading a private key', async () => {
  const saved = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = 'ln-by-piya';
  const app = initializeApp({ projectId: 'ln-by-piya', databaseURL: 'https://ln-by-piya-default-rtdb.asia-southeast1.firebasedatabase.app', credential: { getAccessToken: async () => ({ access_token: 'synthetic', expires_in: 3600 }) } });
  try {
    const first = getBookingRuntime(), second = getBookingRuntime();
    assert.equal(typeof first.verifyIdToken, 'function');
    assert.equal(typeof second.service.submitBooking, 'function');
    assert.equal(getApps().length, 1);
  } finally { await deleteApp(app); saved === undefined ? delete process.env.GCLOUD_PROJECT : process.env.GCLOUD_PROJECT = saved; }
});

test('managed production runtime rejects emulator configuration and mismatched projects', () => {
  const keys = ['GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_DATABASE_EMULATOR_HOST'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.GCLOUD_PROJECT = 'another-project';
    assert.throws(() => getBookingRuntime(), { code: 'server/configuration' });
    process.env.GCLOUD_PROJECT = 'ln-by-piya'; process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
    assert.throws(() => getBookingRuntime(), { code: 'server/configuration' });
  } finally { for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value; }
});

test('booking deployment exports only two callables with scale-to-zero defaults', async () => {
  const entry = await import('../functions/booking.js');
  assert.deepEqual(Object.keys(entry).sort(), ['saveBookingAvailability', 'submitBooking']);
  for (const handler of Object.values(entry)) {
    assert.equal(handler.__endpoint.platform, 'gcfv2');
    assert.equal(handler.__endpoint.minInstances, 0);
    assert.equal(handler.__endpoint.maxInstances, 2);
    assert.deepEqual(handler.__endpoint.region, ['asia-southeast1']);
    assert.deepEqual(handler.__endpoint.secretEnvironmentVariables || [], []);
  }
});
