import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getDatabase as getAdminDatabase } from 'firebase-admin/database';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectDatabaseEmulator, get, getDatabase, goOffline, ref, set } from 'firebase/database';
import { createBookingAvailabilityService } from '../../functions/bookingAvailabilityService.js';
import { addDaysToDateKey, getBookableTimeSlots, getDateKeyInTimeZone } from '../../src/businessSettings.js';

// This suite must never run against production, even if ambient credentials exist.
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(emulatorHost || '')) throw new Error('Run npm run test:emulator using the local demo database.');
const projectId = 'demo-luxe-availability';
const adminApp = initializeAdminApp({ projectId, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` }, 'availability-tests');
const database = getAdminDatabase(adminApp);
const service = createBookingAvailabilityService(database);
const date = addDaysToDateKey(getDateKeyInTimeZone(new Date()), 2);
const customer = { uid: 'customer-one', token: { email: 'one@example.test' } };
const other = { uid: 'customer-two', token: { email: 'two@example.test' } };
const admin = { uid: 'salon-admin', token: { email: 'admin@example.test' } };
const request = (id = 'booking-a', time = '10:00', auth = customer) => ({ auth, data: {
  id, date, time, service: 'soft-gel-extensions', name: 'Test Client', phone: '09171234567', address: 'Emulator only',
} });
const clientApps = [];
function clientDb(uid, email) {
  const app = initializeApp({ projectId, databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` }, `client-${clientApps.length}`);
  const db = getDatabase(app);
  const [host, port] = emulatorHost.split(':');
  connectDatabaseEmulator(db, host, Number(port), { mockUserToken: { sub: uid, email } });
  clientApps.push({ app, db });
  return db;
}
beforeEach(async () => {
  await database.ref().set({
    admins: { 'salon-admin': { uid: 'salon-admin', email: 'admin@example.test', status: 'active' } },
    users: {
      'customer-one': { uid: 'customer-one', email: 'one@example.test', status: 'active' },
      'customer-two': { uid: 'customer-two', email: 'two@example.test', status: 'active' },
    },
    settings: { business: { phone: 'existing-phone', timezone: 'Asia/Manila', minimumNoticeHours: 0, bookingInterval: 30, nailArtPricePerNail: 49, tagline: 'Existing tagline', blackoutDates: { [addDaysToDateKey(date, 1)]: { date: addDaysToDateKey(date, 1), reason: 'Existing holiday' } } } },
  });
});
after(async () => {
  for (const { app, db } of clientApps) { goOffline(db); await deleteApp(app); }
  await deleteAdminApp(adminApp);
});

test('close, reopen, custom hours, blocked hours, and reset persist without overwriting settings', async () => {
  const save = (override) => service.saveAvailability({ auth: admin, data: { date, override } });
  await save({ status: 'closed' });
  await assert.rejects(service.submitBooking(request()), { code: 'failed-precondition' });
  await save({ status: 'open' });
  assert.equal((await database.ref(`settings/business/dateOverrides/${date}/status`).get()).val(), 'open');
  await save({ status: 'custom', availableRanges: [{ start: '10:00', end: '12:00' }, { start: '14:00', end: '17:00' }], blockedRanges: [{ start: '15:00', end: '16:00' }] });
  const reloaded = (await database.ref('settings/business').get()).val();
  assert.deepEqual(getBookableTimeSlots(date, 60, reloaded), ['10:00', '10:30', '11:00', '14:00', '16:00']);
  await assert.rejects(service.submitBooking(request('blocked', '14:00')), { code: 'failed-precondition' });
  await save(null);
  assert.equal((await database.ref(`settings/business/dateOverrides/${date}`).get()).exists(), false);
  assert.equal((await database.ref('settings/business/phone').get()).val(), 'existing-phone');
  assert.equal((await database.ref('settings/business/tagline').get()).val(), 'Existing tagline');
  assert.equal((await database.ref('settings/business/nailArtPricePerNail').get()).val(), 49);
});

test('existing blackout dates remain stored and work with explicit reopen and reset', async () => {
  const closedDate = addDaysToDateKey(date, 1);
  const original = (await database.ref('settings/business/blackoutDates').get()).val();
  const currentSettings = async () => (await database.ref('settings/business').get()).val();
  assert.deepEqual(getBookableTimeSlots(closedDate, 60, await currentSettings()), []);
  await service.saveAvailability({ auth: admin, data: { date: closedDate, override: { status: 'open' } } });
  assert.ok(getBookableTimeSlots(closedDate, 60, await currentSettings()).length);
  await service.saveAvailability({ auth: admin, data: { date: closedDate, override: null } });
  assert.deepEqual(getBookableTimeSlots(closedDate, 60, await currentSettings()), []);
  assert.deepEqual((await database.ref('settings/business/blackoutDates').get()).val(), original);
});

test('closing an occupied date requires confirmation and preserves the exact appointment', async () => {
  const booking = await service.submitBooking(request());
  const change = { auth: admin, data: { date, override: { status: 'closed' } } };
  const warning = await service.saveAvailability(change);
  assert.equal(warning.requiresConfirmation, true);
  assert.equal(warning.affectedCount, 1);
  assert.equal((await database.ref(`settings/business/dateOverrides/${date}`).get()).exists(), false);
  await service.saveAvailability({ ...change, data: { ...change.data, acknowledgedAppointmentIds: warning.affectedAppointmentIds } });
  assert.deepEqual((await database.ref(`bookings/${booking.id}`).get()).val(), booking);
  await assert.rejects(service.submitBooking(request('new-booking', '14:00')), { code: 'failed-precondition' });
});

test('two simultaneous overlapping bookings produce exactly one saved reservation', async () => {
  const results = await Promise.allSettled([service.submitBooking(request('a', '10:00')), service.submitBooking(request('b', '11:00', other))]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
  const reservations = (await database.ref(`scheduleSlots/${date}`).get()).val();
  assert.equal(Object.keys(reservations).length, 1);
  assert.equal(Object.values(reservations)[0].status, 'Pending Confirmation');
});

test('simultaneous retries with the same intent return the same saved appointment', async () => {
  const results = await Promise.all([service.submitBooking(request()), service.submitBooking(request())]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
  await assert.rejects(service.submitBooking(request('booking-a', '14:00')), { code: 'already-exists' });
});

test('daily capacity and buffers remain enforced with concurrent submissions', async () => {
  await database.ref('settings/business').update({ appointmentBufferMinutes: 30, maximumAppointmentsPerDay: 1 });
  const results = await Promise.allSettled([service.submitBooking(request('a', '10:00')), service.submitBooking(request('b', '15:00', other))]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});

test('reusing one intent ID across different dates cannot overwrite a saved booking', async () => {
  const first = request('shared-intent');
  const second = request('shared-intent', '10:00', other);
  second.data.date = addDaysToDateKey(date, 2);
  const results = await Promise.allSettled([service.submitBooking(first), service.submitBooking(second)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const saved = (await database.ref('bookings/shared-intent').get()).val();
  assert.equal(saved.uid, results.find((result) => result.status === 'fulfilled').value.uid);
  const slots = (await database.ref('scheduleSlots').get()).val();
  assert.equal(Object.values(slots).flatMap(Object.values).length, 1);
});

test('backend ignores forged duration and price and rejects another customer UID', async () => {
  const input = request();
  input.data.durationMinutes = 1;
  input.data.totalPrice = 0;
  const booking = await service.submitBooking(input);
  assert.equal(booking.durationMinutes, 120);
  assert.equal(booking.totalPrice, 499);
  const forged = request('forged', '15:00');
  forged.data.uid = other.uid;
  await assert.rejects(service.submitBooking(forged), { code: 'permission-denied' });
});

test('invalid and overlapping ranges fail at the server boundary', async () => {
  await assert.rejects(service.saveAvailability({ auth: admin, data: { date, override: { status: 'custom', availableRanges: [{ start: '10:00', end: '12:00' }, { start: '11:00', end: '13:00' }] } } }), { code: 'invalid-argument' });
  await assert.rejects(service.saveAvailability({ auth: customer, data: { date, override: { status: 'closed' } } }), { code: 'permission-denied' });
});

test('database rules deny customer availability edits and direct booking/slot writes', async () => {
  const db = clientDb(customer.uid, customer.token.email);
  assert.equal((await get(ref(db, 'settings/business/timezone'))).val(), 'Asia/Manila');
  for (const [path, value] of [
    ['settings/business/phone', 'unauthorized-change'],
    [`settings/business/dateOverrides/${date}`, { status: 'closed', updatedAt: Date.now() }],
    ['bookings/forged', { uid: customer.uid, email: customer.token.email, status: 'Pending Confirmation', seenByAdmin: false, createdAt: new Date().toISOString() }],
    [`scheduleSlots/${date}/forged`, { ownerUid: customer.uid }],
    [`scheduleMutexes/${date}`, { ownerUid: customer.uid, token: 'forged', expiresAt: Date.now() + 1000 }],
  ]) await assert.rejects(set(ref(db, path), value), /permission_denied/i);
});

test('authorized administrator date writes work and inactive administrators are denied', async () => {
  const db = clientDb(admin.uid, admin.token.email);
  await set(ref(db, `settings/business/dateOverrides/${date}`), { status: 'closed', updatedAt: Date.now() });
  assert.equal((await get(ref(db, `settings/business/dateOverrides/${date}/status`))).val(), 'closed');
  await database.ref(`admins/${admin.uid}/status`).set('inactive');
  await assert.rejects(service.saveAvailability({ auth: admin, data: { date, override: null } }), { code: 'permission-denied' });
});

function failingDatabase(mode) {
  let lockCalls = 0;
  return { ref(path) {
    const target = database.ref(path);
    return new Proxy(target, { get(reference, key) {
      if (key === 'update' && !path) return async updates => {
        if (mode === 'notification' && Object.keys(updates).some(item => item.startsWith('adminNotifications/'))) throw Object.assign(new Error('demo notification outage'), { code: 'unavailable' });
        if (mode === 'commit') throw Object.assign(new Error('demo write outage'), { code: 'unavailable' });
        const result = await reference.update(updates);
        if (mode === 'lost-response') throw Object.assign(new Error('demo lost response'), { code: 'unavailable' });
        return result;
      };
      if (key === 'transaction' && path?.startsWith('adminNotifications/') && mode === 'notification') return async () => { throw Object.assign(new Error('demo notification outage'), { code: 'unavailable' }); };
      if (key === 'transaction' && path?.startsWith('scheduleMutexes/') && mode === 'release') return (...args) => {
        if (++lockCalls > 1) throw Object.assign(new Error('demo release outage'), { code: 'unavailable' });
        return reference.transaction(...args);
      };
      const value = reference[key]; return typeof value === 'function' ? value.bind(reference) : value;
    } });
  } };
}

test('optional notification failure cannot roll back a successfully reserved appointment', async () => {
  const logs = [];
  const isolated = createBookingAvailabilityService(failingDatabase('notification'), { log: value => logs.push(value) });
  const booking = await isolated.submitBooking(request());
  assert.equal((await database.ref(`bookings/${booking.id}`).get()).val().status, 'Pending Confirmation');
  assert.equal((await database.ref(`scheduleSlots/${date}/${booking.id}`).get()).val().status, 'Pending Confirmation');
  assert.equal((await database.ref(`adminNotifications/${booking.id}`).get()).exists(), false);
  assert.equal(logs[0].operation, 'create-admin-notification');
  await service.submitBooking(request());
  assert.equal((await database.ref(`adminNotifications/${booking.id}`).get()).exists(), true);
});

test('failed atomic booking write releases the provisional reservation and retries safely', async () => {
  const isolated = createBookingAvailabilityService(failingDatabase('commit'));
  await assert.rejects(isolated.submitBooking(request()));
  assert.equal((await database.ref('bookings').get()).exists(), false);
  assert.equal((await database.ref(`scheduleSlots/${date}`).get()).exists(), false);
  assert.equal((await database.ref(`scheduleMutexes/${date}`).get()).exists(), false);
  await service.submitBooking(request());
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
});

test('lost commit response replays the saved booking without freeing its reservation', async () => {
  const isolated = createBookingAvailabilityService(failingDatabase('lost-response'));
  const booking = await isolated.submitBooking(request());
  const retry = await service.submitBooking(request());
  assert.equal(booking.id, retry.id);
  assert.equal((await database.ref(`scheduleSlots/${date}/${booking.id}/status`).get()).val(), 'Pending Confirmation');
  assert.equal(Object.keys((await database.ref('bookings').get()).val()).length, 1);
});

test('a mutex-release outage does not report a committed booking as failed', async () => {
  const logs = [];
  const isolated = createBookingAvailabilityService(failingDatabase('release'), { log: value => logs.push(value) });
  const booking = await isolated.submitBooking(request());
  assert.equal((await database.ref(`bookings/${booking.id}`).get()).val().id, booking.id);
  assert.equal(logs[0].operation, 'release-date-lock');
});
