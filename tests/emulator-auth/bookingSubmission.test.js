import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { initializeApp, deleteApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getDatabase as getAdminDatabase } from 'firebase-admin/database';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { deleteApp as deleteWebApp } from 'firebase/app';
import { connectDatabaseEmulator, getDatabase, goOffline, get, ref, query, orderByChild, equalTo, set } from 'firebase/database';
import bookingApi from '../../api/booking.js';
import { addDaysToDateKey, getDateKeyInTimeZone } from '../../src/businessSettings.js';
const projectId = 'demo-luxe-availability';
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST, authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (![databaseHost, authHost].every(host => /^127\.0\.0\.1:\d+$/.test(host || ''))) throw new Error('Booking HTTP tests require local Auth and Database emulators.');
process.env.FIREBASE_PROJECT_ID = projectId;
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const adminApp = initializeApp({ projectId, databaseURL }, 'booking-http-tests');
const database = getAdminDatabase(adminApp), adminAuth = getAdminAuth(adminApp);
const today = getDateKeyInTimeZone(new Date(), 'Asia/Manila');
const date = today < '2026-11-26' ? '2026-11-26' : addDaysToDateKey(today, 2);
const profile = uid => ({ uid, email: `${uid}@example.test`, status: 'active', fullName: 'Demo Customer', phone: '09123456789', address: 'Demo Address' });
const booking = (id = 'stable-intent', time = '10:00') => ({ id, service: 'gel-manicure', date, time, name: 'Demo Customer', phone: '09123456789', address: 'Demo Address', nailArt: { enabled: false, quantity: 1 } });
let vite, http, firebase, webApp, auth, db, baseUrl;
const originalFetch = globalThis.fetch;
const password = 'Demo-Only-Password-24!';
const apiCall = async (token, data, operation = 'submit') => {
  const response = await originalFetch(`${baseUrl}/api/booking`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, data }) });
  return { status: response.status, body: await response.json() };
};
const signIn = async (uid = 'client') => firebase.signInWithEmail(`${uid}@example.test`, password, false);
before(async () => {
  const reset = await originalFetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  assert.equal(reset.status, 200);
  for (const uid of ['client', 'other', 'admin']) await adminAuth.createUser({ uid, email: `${uid}@example.test`, password });
  http = createHttpServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    request.body = Buffer.concat(chunks).toString();
    response.status = code => { response.statusCode = code; return response; };
    response.json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    await bookingApi(request, response);
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve)); baseUrl = `http://127.0.0.1:${http.address().port}`;
  globalThis.fetch = (url, options) => originalFetch(url === '/api/booking' ? `${baseUrl}/api/booking` : url, options);
  vite = await createViteServer({ configFile: false, envDir: false, cacheDir: 'node_modules/.cache/booking-http-tests', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{ name: 'demo-booking-config', configResolved(config) { Object.assign(config.env, { VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, VITE_FIREBASE_DATABASE_URL: databaseURL, VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: '123456', VITE_FIREBASE_APP_ID: 'demo-app' }); } }] });
  firebase = await vite.ssrLoadModule('/src/firebase.js');
  assert.equal(firebase.firebaseConfig.projectId, projectId);
  webApp = firebase.initFirebase(); auth = getAuth(webApp); db = getDatabase(webApp, databaseURL);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const [hostname, port] = databaseHost.split(':'); connectDatabaseEmulator(db, hostname, Number(port));
});
beforeEach(async () => {
  await firebase.logOut();
  const hours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { open: true, openTime: '10:00', closeTime: '22:00' }]));
  await database.ref().set({ users: { client: { ...profile('client'), completedVisits: 1, loyaltyPoints: 1, loyalty: { completedVisits: 1, awardedBookings: { existing: '2026-11-01T00:00:00Z' } } }, other: profile('other') }, admins: { admin: { uid: 'admin', email: 'admin@example.test', status: 'active' } }, settings: { business: { timezone: 'Asia/Manila', minimumNoticeHours: 0, maximumAdvanceBookingDays: 365, bookingInterval: 60, businessHours: hours, onlineBookingHours: hours } } });
});
after(async () => {
  globalThis.fetch = originalFetch;
  await firebase?.logOut(); if (db) goOffline(db); if (webApp) await deleteWebApp(webApp); await vite?.close();
  if (http) await new Promise(resolve => http.close(resolve));
  for (const app of getApps()) await deleteApp(app);
});
test('actual customer save reaches the HTTP API, reserves Gel Manicure, and preserves loyalty', async () => {
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
  assert.equal((await apiCall(token, booking())).status, 409);
  await database.ref(`settings/business/dateOverrides/${date}`).set({ status: 'custom', availableRanges: [{ start: '10:00', end: '18:00' }], blockedRanges: [{ start: '10:30', end: '11:00' }], updatedAt: Date.now() });
  assert.equal((await apiCall(token, booking())).status, 409);
  assert.equal((await database.ref('bookings').get()).exists(), false);
});
test('two simultaneous HTTP submissions for overlapping times produce only one booking', async () => {
  const first = await signIn(), tokenOne = await first.getIdToken(); await firebase.logOut();
  const second = await signIn('other'), tokenTwo = await second.getIdToken();
  const results = await Promise.all([apiCall(tokenOne, booking('one')), apiCall(tokenTwo, booking('two', '11:00'))]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
});
test('HTTP retry with the same intent replays one booking and preserves notification state', async () => {
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
