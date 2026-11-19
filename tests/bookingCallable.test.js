import test from 'node:test';
import assert from 'node:assert/strict';
import { createBookingCallableHandler } from '../functions/bookingCallable.js';
import { AvailabilityError } from '../functions/bookingAvailabilityService.js';

const claims = { uid: 'customer', email: 'verified@example.test', auth_time: 100 };
const request = (overrides = {}) => ({
  auth: { uid: 'customer', token: { uid: 'customer', email: 'forged@example.test', admin: true } },
  rawRequest: { headers: { authorization: 'Bearer private-bearer-token' } },
  data: { id: 'stable-intent', name: 'PRIVATE CUSTOMER', address: 'PRIVATE ADDRESS' },
  ...overrides,
});
const fixture = ({ operation = 'submit', verify = async () => claims, submit, availability, log } = {}) => {
  const contexts = [], logs = [], verifications = [];
  const handler = createBookingCallableHandler({
    operation,
    getRuntime: () => ({
      verifyIdToken: async (...args) => { verifications.push(args); return verify(...args); },
      service: {
        submitBooking: async context => { contexts.push(context); return submit ? submit(context) : { id: context.data.id, uid: context.auth.uid, status: 'Pending Confirmation' }; },
        saveAvailability: async context => { contexts.push(context); return availability ? availability(context) : { requiresConfirmation: false, date: context.data.date }; },
      },
    }),
    log: log || (value => logs.push(value)),
  });
  return { handler, contexts, logs, verifications };
};
const hasEvent = (logs, name) => logs.some(value => value?.event === name);
const privateValues = /private-bearer-token|verified@example\.test|forged@example\.test|PRIVATE CUSTOMER|PRIVATE ADDRESS/;

test('callable preserves revocation checking and derives authorization from verified Firebase claims', async () => {
  const { handler, contexts, logs, verifications } = fixture();
  const input = request();
  const result = await handler(input);
  assert.deepEqual(verifications, [['private-bearer-token', true]]);
  assert.deepEqual(contexts[0].auth, { uid: claims.uid, token: claims });
  assert.equal(contexts[0].data.id, 'stable-intent');
  assert.equal(result.id, 'stable-intent');
  assert.equal(result.status, 'Pending Confirmation');
  assert.equal(hasEvent(logs, 'booking_submitted'), true);
  assert.equal(hasEvent(logs, 'booking_accepted'), true);
  assert.doesNotMatch(JSON.stringify(logs), privateValues);
});

test('callable rejects missing callable authentication or bearer authentication before runtime initialization', async () => {
  let initialized = false;
  const handler = createBookingCallableHandler({ operation: 'submit', getRuntime: () => { initialized = true; throw new Error('must not initialize'); }, log: () => {} });
  for (const input of [request({ auth: undefined }), request({ rawRequest: { headers: {} } }), request({ rawRequest: { headers: { authorization: 'Bearer token with spaces' } } })]) {
    await assert.rejects(handler(input), { code: 'unauthenticated' });
  }
  assert.equal(initialized, false);
});

test('callable cannot use a mismatched platform UID to authorize the verified token owner', async () => {
  const { handler, contexts } = fixture({ verify: async () => ({ ...claims, uid: 'different-customer' }) });
  await assert.rejects(handler(request()), { code: 'unauthenticated' });
  assert.equal(contexts.length, 0);
});

test('callable rejects expired, revoked, disabled, malformed, and invalid customer credentials', async () => {
  for (const code of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/invalid-id-token', 'auth/argument-error']) {
    const { handler, contexts, logs } = fixture({ verify: async () => { throw Object.assign(new Error('private-bearer-token verified@example.test'), { code }); } });
    await assert.rejects(handler(request()), error => {
      assert.equal(error.code, 'unauthenticated');
      assert.doesNotMatch(error.message, privateValues);
      return true;
    });
    assert.equal(contexts.length, 0);
    assert.doesNotMatch(JSON.stringify(logs), privateValues);
  }
});

test('callable rejects non-object payloads and oversized UTF-8 payloads without booking writes', async () => {
  const { handler, contexts } = fixture();
  for (const data of [null, undefined, [], 'booking', 42, { notes: '💅'.repeat(9000) }]) {
    await assert.rejects(handler(request({ data })), { code: 'invalid-argument' });
  }
  assert.equal(contexts.length, 0);
});

test('callable keeps intentional availability and validation failures typed and logs their rejection', async () => {
  for (const code of ['invalid-argument', 'permission-denied', 'failed-precondition', 'already-exists', 'aborted']) {
    const message = 'Please choose another available appointment time.';
    const { handler, logs } = fixture({ submit: async () => { throw new AvailabilityError(code, message); } });
    await assert.rejects(handler(request()), { code, message });
    assert.equal(hasEvent(logs, 'booking_validation_rejected'), true);
    assert.equal(hasEvent(logs, 'booking_accepted'), false);
  }
});

test('unexpected booking failures expose a safe unavailable error and a sanitized failure audit event', async () => {
  const { handler, logs } = fixture({ submit: async () => { throw Object.assign(new Error('PRIVATE ADDRESS verified@example.test private-bearer-token'), { code: 'private-bearer-token verified@example.test' }); } });
  await assert.rejects(handler(request()), error => {
    assert.equal(error.code, 'unavailable');
    assert.doesNotMatch(error.message, privateValues);
    assert.equal(error.details, undefined);
    return true;
  });
  assert.equal(hasEvent(logs, 'booking_creation_failed'), true);
  assert.equal(hasEvent(logs, 'booking_accepted'), false);
  assert.doesNotMatch(JSON.stringify(logs), privateValues);
});

test('managed-runtime initialization failures remain unavailable and do not reach the booking engine', async () => {
  const logs = [];
  const handler = createBookingCallableHandler({ operation: 'submit', getRuntime: () => { throw Object.assign(new Error('PRIVATE ADDRESS'), { code: 'server/configuration' }); }, log: value => logs.push(value) });
  await assert.rejects(handler(request()), { code: 'unavailable' });
  assert.equal(hasEvent(logs, 'booking_creation_failed'), true);
  assert.doesNotMatch(JSON.stringify(logs), privateValues);
});

test('availability callable passes verified admin identity through the existing service and audits a completed save', async () => {
  const { handler, contexts, logs } = fixture({ operation: 'availability' });
  const data = { date: '2026-11-26', override: { status: 'closed' }, acknowledgedAppointmentIds: [] };
  const result = await handler(request({ data }));
  assert.equal(result.requiresConfirmation, false);
  assert.deepEqual(contexts[0], { auth: { uid: claims.uid, token: claims }, data });
  assert.equal(hasEvent(logs, 'availability_updated'), true);
  assert.equal(hasEvent(logs, 'booking_accepted'), false);
  assert.doesNotMatch(JSON.stringify(logs), privateValues);
});

test('availability warning preserves appointments and is not falsely audited as a completed update', async () => {
  const warning = { requiresConfirmation: true, affectedCount: 1, affectedAppointmentIds: ['existing-appointment'] };
  const { handler, logs } = fixture({ operation: 'availability', availability: async () => warning });
  assert.deepEqual(await handler(request({ data: { date: '2026-11-26', override: { status: 'closed' } } })), warning);
  assert.equal(hasEvent(logs, 'availability_updated'), false);
});

test('audit logger outage never turns an accepted appointment into a failed submission', async () => {
  const { handler, contexts } = fixture({ log: () => { throw new Error('synthetic logging outage'); } });
  const result = await handler(request());
  assert.equal(result.id, 'stable-intent');
  assert.equal(contexts.length, 1);
});
