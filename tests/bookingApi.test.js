import test from 'node:test';
import assert from 'node:assert/strict';
import { requestBookingOperation } from '../src/bookingApi.js';
const user = { uid: 'customer', getIdToken: async () => 'synthetic-token' };

test('customer transport calls submitBooking with the stable intent and validates its owner', async () => {
  let invocation;
  const result = await requestBookingOperation(user, 'submit', { id: 'stable-intent' }, { call: async (...args) => { invocation = args; return { data: { id: 'stable-intent', uid: user.uid } }; } });
  assert.deepEqual(invocation, ['submitBooking', { id: 'stable-intent' }]);
  assert.equal(result.id, 'stable-intent');
});

test('availability uses its separate trusted callable and preserves conflict warnings', async () => {
  let name;
  const result = await requestBookingOperation(user, 'availability', { date: '2026-11-26' }, { call: async value => { name = value; return { data: { requiresConfirmation: true, affectedAppointmentIds: ['existing'] } }; } });
  assert.equal(name, 'saveBookingAvailability'); assert.equal(result.requiresConfirmation, true);
});

test('transport rejects missing sessions and unknown operations before invoking a backend', async () => {
  const call = async () => { throw new Error('must not invoke'); };
  await assert.rejects(requestBookingOperation(null, 'submit', {}, { call }), { code: 'booking/unauthenticated' });
  await assert.rejects(requestBookingOperation(user, 'other', {}, { call }), { code: 'booking/invalid-argument' });
});

test('transport rejects malformed success, foreign ownership, and mismatched intent responses', async () => {
  for (const data of [null, [], {}, { id: 'different', uid: user.uid }, { id: 'intent', uid: 'other' }]) {
    await assert.rejects(requestBookingOperation(user, 'submit', { id: 'intent' }, { call: async () => ({ data }) }), { code: 'booking/unavailable' });
  }
});

test('callable failures use safe booking codes without leaking backend details', async () => {
  for (const [code, expected] of [['functions/failed-precondition', 'booking/failed-precondition'], ['functions/already-exists', 'booking/already-exists'], ['functions/permission-denied', 'booking/permission-denied'], ['functions/unauthenticated', 'booking/unauthenticated'], ['functions/deadline-exceeded', 'booking/deadline-exceeded'], ['functions/internal', 'booking/unavailable'], ['functions/not-found', 'booking/unavailable']]) {
    await assert.rejects(requestBookingOperation(user, 'submit', { id: 'intent' }, { call: async () => { throw Object.assign(new Error('PRIVATE KEY customer@example.test'), { code }); } }), error => error.code === expected && !/PRIVATE|customer@example/.test(error.message));
  }
});

test('an expired local Firebase session requests sign-in instead of calling the backend', async () => {
  let called = false;
  const expired = { uid: 'customer', getIdToken: async () => { throw Object.assign(new Error('private session details'), { code: 'auth/user-token-expired' }); } };
  await assert.rejects(requestBookingOperation(expired, 'submit', {}, { call: async () => { called = true; } }), { code: 'booking/unauthenticated' });
  assert.equal(called, false);
});
