import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createViteServer } from 'vite';
import { initializeApp, deleteApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getDatabase as getAdminDatabase } from 'firebase-admin/database';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { deleteApp as deleteWebApp } from 'firebase/app';
import { connectDatabaseEmulator, getDatabase, goOffline, get, ref, query, orderByChild, equalTo, set } from 'firebase/database';
import { addDaysToDateKey, getDateKeyInTimeZone } from '../../src/businessSettings.js';
const projectId = 'demo-luxe-availability';
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST, authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (![databaseHost, authHost].every(host => /^127\.0\.0\.1:\d+$/.test(host || ''))) throw new Error('Booking tests require local Functions, Auth and Database emulators.');
process.env.FIREBASE_PROJECT_ID = projectId;
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const adminApp = initializeApp({ projectId, databaseURL }, 'booking-http-tests');
const database = getAdminDatabase(adminApp), adminAuth = getAdminAuth(adminApp);
const today = getDateKeyInTimeZone(new Date(), 'Asia/Manila');
const date = today < '2026-11-26' ? '2026-11-26' : addDaysToDateKey(today, 2);
const profile = uid => ({ uid, email: `${uid}@example.test`, status: 'active', fullName: 'Demo Customer', phone: '09123456789', address: 'Demo Address' });
const booking = (id = 'stable-intent', time = '10:00') => ({ id, service: 'gel-manicure', date, time, name: 'Demo Customer', phone: '09123456789', address: 'Demo Address', nailArt: { enabled: false, quantity: 1 } });
let vite, firebase, webApp, auth, db;
const originalFetch = globalThis.fetch;
const password = 'Demo-Only-Password-24!';
const apiCall = async (token, data, operation = 'submit') => {
  const name = operation === 'submit' ? 'submitBooking' : 'saveBookingAvailability';
  const response = await originalFetch(`http://127.0.0.1:5001/${projectId}/asia-southeast1/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
  return { status: response.status, body: await response.json() };
};
const signIn = async (uid = 'client') => firebase.signInWithEmail(`${uid}@example.test`, password, false);
before(async () => {
  const reset = await originalFetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  assert.equal(reset.status, 200);
  for (const uid of ['client', 'other', 'admin']) await adminAuth.createUser({ uid, email: `${uid}@example.test`, password });
  vite = await createViteServer({ configFile: false, envDir: false, cacheDir: 'node_modules/.cache/booking-http-tests', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{ name: 'demo-booking-config', configResolved(config) { Object.assign(config.env, { VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, VITE_FIREBASE_DATABASE_URL: databaseURL, VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: '123456', VITE_FIREBASE_APP_ID: 'demo-app' }); } }] });
  firebase = await vite.ssrLoadModule('/src/firebase.js');
  assert.equal(firebase.firebaseConfig.projectId, projectId);
  webApp = firebase.initFirebase(); auth = getAuth(webApp); db = getDatabase(webApp, databaseURL);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const [hostname, port] = databaseHost.split(':'); connectDatabaseEmulator(db, hostname, Number(port));
  connectFunctionsEmulator(getFunctions(webApp, 'asia-southeast1'), '127.0.0.1', 5001);
});
beforeEach(async () => {
  await firebase.logOut();
  const hours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { open: true, openTime: '10:00', closeTime: '22:00' }]));
  await database.ref().set({ users: { client: { ...profile('client'), completedVisits: 1, loyaltyPoints: 1, loyalty: { completedVisits: 1, awardedBookings: { existing: '2026-11-01T00:00:00Z' } } }, other: profile('other') }, admins: { admin: { uid: 'admin', email: 'admin@example.test', status: 'active' } }, settings: { business: { timezone: 'Asia/Manila', minimumNoticeHours: 0, maximumAdvanceDays: 365, bookingInterval: 60, businessHours: hours, onlineBookingHours: hours } } });
});
after(async () => {
  globalThis.fetch = originalFetch;
  await firebase?.logOut(); if (db) goOffline(db); if (webApp) await deleteWebApp(webApp); await vite?.close();
  for (const app of getApps()) await deleteApp(app);
});
test('actual customer save reaches the Functions emulator, reserves Gel Manicure, and preserves loyalty', async () => {
  const before = (await database.ref('users/client').get()).val();
  await signIn(); const result = await firebase.saveBooking(booking());
  assert.equal(result.totalPrice, 299); assert.equal(result.durationMinutes, 75); assert.equal(result.status, 'Pending Confirmation');
  assert.equal((await database.ref(`scheduleSlots/${date}/${result.id}/status`).get()).val(), 'Pending Confirmation');
  assert.deepEqual((await database.ref('users/client').get()).val(), before);
  const history = await get(query(ref(db, 'bookings'), orderByChild('uid'), equalTo('client')));
  assert.equal(Object.keys(history.val()).length, 1);
  await assert.rejects(get(ref(db, 'bookings')), /permission.denied/i);
  await firebase.logOut(); await signIn('admin');
  assert.equal(Object.keys((await get(ref(db, 'bookings'))).val()).length, 1);
});
test('customer with no loyalty can submit without earning a visit or creating loyalty data', async () => {
  await signIn('other'); const result = await firebase.saveBooking(booking());
  assert.equal(result.uid, 'other'); assert.equal((await database.ref('users/other/loyalty').get()).exists(), false);
  assert.equal((await database.ref('users/other/completedVisits').get()).exists(), false);
});
test('server rejects closed and blocked hours even when called outside the frontend', async () => {
  const user = await signIn(), token = await user.getIdToken();
  await database.ref(`settings/business/dateOverrides/${date}`).set({ status: 'closed', updatedAt: Date.now() });
  assert.equal((await apiCall(token, booking())).status, 400);
  await database.ref(`settings/business/dateOverrides/${date}`).set({ status: 'custom', availableRanges: [{ start: '10:00', end: '18:00' }], blockedRanges: [{ start: '10:30', end: '11:00' }], updatedAt: Date.now() });
  assert.equal((await apiCall(token, booking())).status, 400);
  assert.equal((await database.ref('bookings').get()).exists(), false);
});
test('two simultaneous callable submissions for overlapping times produce only one booking', async () => {
  const first = await signIn(), tokenOne = await first.getIdToken(); await firebase.logOut();
  const second = await signIn('other'), tokenTwo = await second.getIdToken();
  const results = await Promise.all([apiCall(tokenOne, booking('one')), apiCall(tokenTwo, booking('two', '11:00'))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
});
test('callable retry with the same intent replays one booking and preserves notification state', async () => {
  await signIn(); const first = await firebase.saveBooking(booking());
  await database.ref(`adminNotifications/${first.id}/read`).set(true);
  const retry = await firebase.saveBooking(booking()); assert.equal(retry.id, first.id);
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
  assert.equal((await database.ref(`adminNotifications/${first.id}/read`).get()).val(), true);
});
test('failed validation leaves no appointment, provisional slot, mutex, or notification', async () => {
  const user = await signIn(), token = await user.getIdToken();
  assert.equal((await apiCall(token, { ...booking(), phone: 'invalid' })).status, 400);
  for (const root of ['bookings', 'scheduleSlots', 'scheduleMutexes', 'adminNotifications']) assert.equal((await database.ref(root).get()).exists(), false);
  assert.equal((await apiCall(token, booking())).status, 200);
});
test('API rejects forged tokens, foreign customer ownership, and customer availability writes', async () => {
  assert.equal((await apiCall('forged-token', booking())).status, 401);
  const user = await signIn(), token = await user.getIdToken();
  assert.equal((await apiCall(token, { ...booking(), uid: 'other' })).status, 403);
  assert.equal((await apiCall(token, { date, override: { status: 'closed' } }, 'availability')).status, 403);
  await assert.rejects(set(ref(db, 'bookings/forged'), { uid: 'client' }), /permission.denied/i);
});

test('callable enforces canonical price and full duration despite a forged payload', async () => {
  const user = await signIn();
  const response = await apiCall(await user.getIdToken(), { ...booking(), totalPrice: 0, durationMinutes: 1 });
  assert.equal(response.status, 200);
  const saved = response.body.result || response.body.data;
  assert.equal(saved.totalPrice, 299); assert.equal(saved.durationMinutes, 75);
});

test('callable preserves Nail Art selection and trusted add-on pricing', async () => {
  await signIn();
  const saved = await firebase.saveBooking({ ...booking(), nailArt: { enabled: true, quantity: 3 } });
  assert.equal(saved.totalPrice, 446); assert.equal(saved.nailArt.quantity, 3);
});

test('notice, advance window, interval, and full-duration closing bounds cannot be bypassed', async () => {
  const user = await signIn(), token = await user.getIdToken();
  for (const time of ['10:15', '21:00']) assert.equal((await apiCall(token, booking('invalid-start', time))).status, 400);
  await database.ref('settings/business/minimumNoticeHours').set(720);
  assert.equal((await apiCall(token, booking())).status, 400);
  await database.ref('settings/business').update({ minimumNoticeHours: 0, maximumAdvanceDays: 1 });
  assert.equal((await apiCall(token, booking())).status, 400);
  assert.equal((await database.ref('bookings').get()).exists(), false);
});

test('appointment buffers protect otherwise nonoverlapping starts', async () => {
  await database.ref('settings/business').update({ bookingInterval: 15, appointmentBufferMinutes: 30 });
  const user = await signIn(), token = await user.getIdToken();
  assert.equal((await apiCall(token, booking('first'))).status, 200);
  assert.equal((await apiCall(token, booking('buffer-conflict', '11:30'))).status, 409);
  assert.equal((await apiCall(token, booking('after-buffer', '12:00'))).status, 200);
});

test('daily capacity rejects an additional nonoverlapping appointment', async () => {
  await database.ref('settings/business/maximumAppointmentsPerDay').set(1);
  const user = await signIn(), token = await user.getIdToken();
  assert.equal((await apiCall(token, booking('first'))).status, 200);
  assert.equal((await apiCall(token, booking('over-capacity', '14:00'))).status, 409);
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
});

test('legacy appointments without slot records still block conflicts and remain unchanged', async () => {
  const legacy = { ...booking('legacy'), uid: 'other', email: 'other@example.test', status: 'Confirmed', durationMinutes: 75, createdAt: '2026-11-01T00:00:00Z' };
  await database.ref('bookings/legacy').set(legacy);
  const user = await signIn(), token = await user.getIdToken();
  assert.equal((await apiCall(token, booking('conflict', '11:00'))).status, 409);
  assert.equal((await apiCall(token, booking('available', '12:00'))).status, 200);
  assert.deepEqual((await database.ref('bookings/legacy').get()).val(), legacy);
});

test('administrator availability callable warns before closure and preserves the occupied booking', async () => {
  await signIn(); const saved = await firebase.saveBooking(booking());
  const original = (await database.ref(`bookings/${saved.id}`).get()).val();
  await firebase.logOut(); await signIn('admin');
  const warning = await firebase.saveBookingAvailability(date, { status: 'closed' });
  assert.equal(warning.requiresConfirmation, true); assert.deepEqual(warning.affectedAppointmentIds, [saved.id]);
  const changed = await firebase.saveBookingAvailability(date, { status: 'closed' }, warning.affectedAppointmentIds);
  assert.equal(changed.requiresConfirmation, false);
  assert.deepEqual((await database.ref(`bookings/${saved.id}`).get()).val(), original);
  await database.ref('admins/admin/status').set('inactive');
  await assert.rejects(firebase.saveBookingAvailability(date, null), { code: 'booking/permission-denied' });
});

test('valid-shaped direct customer booking, lock, private intent, and trusted audit writes remain denied', async () => {
  await signIn();
  for (const [path, value] of [
    ['bookings/direct', { ...booking('direct'), uid: 'client', email: 'client@example.test', status: 'Pending Confirmation', seenByAdmin: false, createdAt: new Date().toISOString() }],
    [`scheduleSlots/${date}/direct`, { bookingId: 'direct', ownerUid: 'client', status: 'Pending' }],
    [`scheduleMutexes/${date}`, { ownerUid: 'client', token: 'direct', expiresAt: Date.now() + 10000 }],
    ['serverOnly/bookingIntents/direct', { uid: 'client' }],
    ['auditLogs/forged', { event: 'booking_accepted', trusted: true }],
  ]) await assert.rejects(set(ref(db, path), value), /permission.denied/i);
});

test('inactive, disabled, and revoked customer sessions cannot submit through the callable', async () => {
  const user = await signIn(), token = await user.getIdToken();
  await database.ref('users/client/status').set('inactive');
  assert.equal((await apiCall(token, booking())).status, 403);
  await database.ref('users/client/status').set('active');
  await adminAuth.updateUser('client', { disabled: true });
  try { assert.equal((await apiCall(token, booking())).status, 401); }
  finally { await adminAuth.updateUser('client', { disabled: false }); }
  await new Promise(resolve => setTimeout(resolve, 1100));
  await adminAuth.revokeRefreshTokens('client');
  assert.equal((await apiCall(token, booking())).status, 401);
  assert.equal((await database.ref('bookings').get()).exists(), false);
});
