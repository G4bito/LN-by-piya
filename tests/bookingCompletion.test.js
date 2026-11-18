import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let updateBookingStatus;
let records;

const snapshot = (value) => ({
  exists: () => value != null,
  val: () => structuredClone(value ?? null),
});
const read = (path) => path.split('/').filter(Boolean).reduce((value, key) => value?.[key], records) ?? null;
function write(path, value) {
  const keys = path.split('/').filter(Boolean);
  const key = keys.pop();
  const parent = keys.reduce((value, part) => (value[part] ??= {}), records);
  if (value == null) delete parent[key];
  else parent[key] = structuredClone(value);
}

before(async () => {
  // Import the actual application module through Vite, replacing only Firebase's
  // external boundary. No credentials, network requests, or live data are used.
  server = await createServer({
    configFile: false,
    envDir: false,
    cacheDir: 'node_modules/.cache/loyalty-test-vite',
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: [{ find: /^firebase\//, replacement: 'fixture:firebase/' }] },
    plugins: [{
      name: 'booking-completion-firebase-fixture',
      enforce: 'pre',
      configResolved(config) {
        for (const key of ['API_KEY', 'AUTH_DOMAIN', 'DATABASE_URL', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
          config.env[`VITE_FIREBASE_${key}`] = 'demo-loyalty';
        }
      },
      resolveId(id) { if (id.startsWith('fixture:firebase/')) return `\0${id}`; },
      load(id) {
        if (id === '\0fixture:firebase/app') return 'export const getApps = () => []; export const initializeApp = () => ({});';
        if (id === '\0fixture:firebase/auth') return 'export const getAuth = () => ({ currentUser: { uid: "salon-admin" } }); export class GoogleAuthProvider { setCustomParameters() {} }';
        if (id === '\0fixture:firebase/storage') return 'export const getStorage = () => ({});';
        if (id === '\0fixture:firebase/functions') return 'export const getFunctions = () => ({}); export const httpsCallable = () => { throw new Error("Unexpected callable in completion test"); };';
        if (id === '\0fixture:firebase/database') {
          return 'export const getDatabase = () => ({});\n' + ['ref', 'get', 'set', 'update', 'remove', 'runTransaction']
            .map((name) => `export const ${name} = (...args) => globalThis.__loyaltyDatabaseFixture.${name}(...args);`).join('\n');
        }
      },
    }],
  });
  const firebase = await server.ssrLoadModule('/src/firebase.js');
  assert.equal(firebase.firebaseConfig.projectId, 'demo-loyalty');
  firebase.initFirebase();
  updateBookingStatus = firebase.updateBookingStatus;
});

after(async () => {
  await server?.close();
  delete globalThis.__loyaltyDatabaseFixture;
});

beforeEach(() => {
  const cachedPaths = new Set();
  records = {
    users: {
      client: { uid: 'client', email: 'client@example.com', status: 'active', loyaltyPoints: 2, completedVisits: 2 },
      other: { uid: 'other', email: 'other@example.com', status: 'active', loyaltyPoints: 7, completedVisits: 7 },
    },
    bookings: { appointment: { uid: 'client', email: 'client@example.com', status: 'Confirmed', date: '2026-11-18', time: '2:00 PM' } },
  };
  globalThis.__loyaltyDatabaseFixture = {
    ref: (_, path = '') => path,
    get: async (path) => snapshot(read(path)),
    set: async (path, value) => write(path, value),
    update: async (path, patch) => {
      for (const [key, value] of Object.entries(patch)) write([path, key].filter(Boolean).join('/'), value);
    },
    remove: async (path) => write(path, null),
    runTransaction: async (path, updater) => {
      // Firebase calls an updater with null on a cold cache. Returning undefined
      // aborts immediately; returning a value lets the server retry with its data.
      let value = updater(cachedPaths.has(path) ? read(path) : null);
      if (value === undefined) return { committed: false, snapshot: snapshot(read(path)) };
      if (read(path) != null) value = updater(read(path));
      if (value === undefined) return { committed: false, snapshot: snapshot(read(path)) };
      write(path, value);
      cachedPaths.add(path);
      return { committed: true, snapshot: snapshot(read(path)) };
    },
  };
});

test('completing an appointment from a cold cache awards one point to its client only', async () => {
  const other = structuredClone(records.users.other);
  const result = await updateBookingStatus('appointment', 'Completed');
  assert.equal(result.rewardGiven, true);
  assert.equal(records.bookings.appointment.status, 'Completed');
  assert.equal(records.bookings.appointment.rewardGiven, true);
  assert.equal(records.users.client.loyaltyPoints, 3);
  assert.equal(records.users.client.completedVisits, 3);
  assert.ok(records.users.client.loyalty.awardedBookings.appointment);
  assert.deepEqual(records.users.other, other);
  assert.equal(records.users['salon-admin'], undefined);
});

test('retrying a completed appointment cannot award another point', async () => {
  await updateBookingStatus('appointment', 'Completed');
  await updateBookingStatus('appointment', 'Completed');
  assert.equal(records.users.client.loyaltyPoints, 3);
});

test('two different completed appointments award two points to the same client', async () => {
  records.bookings.second = { ...records.bookings.appointment };
  await updateBookingStatus('appointment', 'Completed');
  await updateBookingStatus('second', 'Completed');
  assert.equal(records.users.client.loyaltyPoints, 4);
  assert.equal(records.users.client.completedVisits, 4);
  assert.equal(Object.keys(records.users.client.loyalty.awardedBookings).length, 2);
});

test('completion does not silently succeed without a linked client account', async () => {
  delete records.bookings.appointment.uid;
  await assert.rejects(updateBookingStatus('appointment', 'Completed'), /not linked to a customer account/);
  assert.equal(records.bookings.appointment.status, 'Confirmed');
  assert.equal(records.users.client.loyaltyPoints, 2);
});

for (const field of ['userId', 'customerUid']) {
  test(`completion credits the client identified by the legacy ${field} field`, async () => {
    delete records.bookings.appointment.uid;
    records.bookings.appointment[field] = 'client';
    await updateBookingStatus('appointment', 'Completed');
    assert.equal(records.users.client.loyaltyPoints, 3);
    assert.equal(records.bookings.appointment.rewardGiven, true);
    assert.equal(records.users.other.loyaltyPoints, 7);
  });
}

test('retry after a missing booking reward flag cannot duplicate the client award', async () => {
  await updateBookingStatus('appointment', 'Completed');
  delete records.bookings.appointment.rewardGiven;
  await updateBookingStatus('appointment', 'Completed');
  assert.equal(records.users.client.loyaltyPoints, 3);
  assert.equal(records.bookings.appointment.rewardGiven, true);
});

test('a missing client profile is not treated as a successful loyalty award', async () => {
  delete records.users.client;
  await assert.rejects(updateBookingStatus('appointment', 'Completed'), /loyalty record could not be updated/);
  assert.equal(records.bookings.appointment.rewardGiven, undefined);
  assert.equal(records.users.client, undefined);
});

test('changing an appointment to No Show does not award a loyalty point', async () => {
  await updateBookingStatus('appointment', 'No Show');
  assert.equal(records.users.client.loyaltyPoints, 2);
  assert.equal(records.bookings.appointment.rewardGiven, undefined);
});

test('returning an appointment to pending keeps its durable schedule reservation', async () => {
  await updateBookingStatus('appointment', 'Pending Confirmation');
  assert.equal(records.bookings.appointment.status, 'Pending Confirmation');
  assert.equal(records.scheduleSlots['2026-11-18'].appointment.status, 'Pending Confirmation');
  assert.equal(records.users.client.loyaltyPoints, 2);
});
