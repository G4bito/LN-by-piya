import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppointmentReminderContent,
  getReminderClaimDecision,
  getReminderEligibility,
  getReminderRuntimeSettings,
  parseAppointmentDateTime,
} from '../functions/appointmentReminderCore.js';

test('runtime reminder settings respect Firebase toggles and timezone', () => {
  assert.deepEqual(getReminderRuntimeSettings({
    timezone: 'Asia/Manila',
    reminder24hEnabled: false,
    reminder12hEnabled: true,
    inAppReminderEnabled: false,
  }), {
    timeZone: 'Asia/Manila',
    businessName: 'Luxe Nails by Piya',
    reminderTypes: ['reminder12h'],
    inAppEnabled: false,
  });
});

const HOUR = 60 * 60 * 1000;

function confirmedBooking(overrides = {}) {
  return {
    status: 'Confirmed',
    date: '2026-09-10',
    time: '2:00 PM',
    service: 'gel-manicure',
    customerName: 'Zyrel Santos',
    createdAt: '2026-09-08T00:00:00.000Z',
    confirmedAt: '2026-09-08T01:00:00.000Z',
    ...overrides,
  };
}

test('appointment date and time are interpreted in the salon timezone', () => {
  assert.equal(
    parseAppointmentDateTime('2026-09-10', '2:00 PM', 'Asia/Manila'),
    Date.parse('2026-09-10T06:00:00.000Z')
  );
  assert.equal(
    parseAppointmentDateTime('2026-09-10', '09:00', 'Asia/Manila'),
    Date.parse('2026-09-10T01:00:00.000Z')
  );
  assert.equal(
    parseAppointmentDateTime('2026-09-10', '08:00', 'Asia/Manila'),
    Date.parse('2026-09-10T00:00:00.000Z')
  );
  assert.equal(
    parseAppointmentDateTime('2026-09-10', '2:00', 'Asia/Manila'),
    Date.parse('2026-09-10T06:00:00.000Z')
  );
});

test('a confirmed booking is eligible during the 24-hour reminder window', () => {
  const appointmentAt = parseAppointmentDateTime('2026-09-10', '2:00 PM', 'Asia/Manila');
  const result = getReminderEligibility(
    confirmedBooking(),
    'reminder24h',
    appointmentAt - (24 * HOUR) + (10 * 60 * 1000),
    'Asia/Manila'
  );
  assert.equal(result.eligible, true);
  assert.equal(result.hoursBefore, 24);
});

test('pending, cancelled, completed, and no-show bookings never qualify', () => {
  const appointmentAt = parseAppointmentDateTime('2026-09-10', '2:00 PM', 'Asia/Manila');
  const now = appointmentAt - (24 * HOUR);
  ['Pending Confirmation', 'Cancelled', 'Completed', 'No Show'].forEach((status) => {
    assert.equal(
      getReminderEligibility(confirmedBooking({ status }), 'reminder24h', now, 'Asia/Manila').eligible,
      false
    );
  });
});

test('late confirmation skips 24 hours but remains eligible for 12 hours', () => {
  const appointmentAt = parseAppointmentDateTime('2026-09-10', '2:00 PM', 'Asia/Manila');
  const booking = confirmedBooking({ confirmedAt: appointmentAt - (18 * HOUR) });
  assert.equal(
    getReminderEligibility(booking, 'reminder24h', appointmentAt - (17.9 * HOUR), 'Asia/Manila').reason,
    'window-missed'
  );
  assert.equal(
    getReminderEligibility(booking, 'reminder12h', appointmentAt - (11.9 * HOUR), 'Asia/Manila').eligible,
    true
  );
});

test('a booking confirmed less than 12 hours before skips both reminder milestones', () => {
  const appointmentAt = parseAppointmentDateTime('2026-09-10', '2:00 PM', 'Asia/Manila');
  const booking = confirmedBooking({ confirmedAt: appointmentAt - (6 * HOUR) });
  assert.equal(
    getReminderEligibility(booking, 'reminder24h', appointmentAt - (5.9 * HOUR), 'Asia/Manila').eligible,
    false
  );
  assert.equal(
    getReminderEligibility(booking, 'reminder12h', appointmentAt - (5.9 * HOUR), 'Asia/Manila').eligible,
    false
  );
});

test('the worker does not send a stale reminder after its safe window', () => {
  const appointmentAt = parseAppointmentDateTime('2026-09-10', '2:00 PM', 'Asia/Manila');
  const result = getReminderEligibility(
    confirmedBooking(),
    'reminder24h',
    appointmentAt - (22 * HOUR),
    'Asia/Manila'
  );
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'window-missed');
});

test('an already-sent reminder can never be claimed twice', () => {
  const decision = getReminderClaimDecision(
    { reminder24h: { status: 'sent', appointmentKey: '2026-09-10|2:00|Asia/Manila' } },
    'reminder24h',
    '2026-09-10|2:00|Asia/Manila',
    Date.now()
  );
  assert.equal(decision.claim, false);
  assert.equal(decision.reason, 'already-sent');
});

test('transaction claims block concurrent sends and allow only bounded stale retries', () => {
  const now = Date.now();
  const appointmentKey = '2026-09-10|2:00|Asia/Manila';
  const processing = {
    reminder12h: { status: 'processing', appointmentKey, lockedAt: now - 1000, attemptCount: 1 },
  };
  assert.equal(getReminderClaimDecision(processing, 'reminder12h', appointmentKey, now).reason, 'already-processing');

  const failed = {
    reminder12h: { status: 'failed', appointmentKey, attemptCount: 3 },
  };
  assert.equal(getReminderClaimDecision(failed, 'reminder12h', appointmentKey, now).reason, 'attempt-limit-reached');
  assert.equal(
    getReminderClaimDecision(failed, 'reminder12h', '2026-09-11|2:00|Asia/Manila', now).claim,
    true
  );
});

test('reminder content includes the real service, schedule, nail art, and reference state', () => {
  const appointmentAt = parseAppointmentDateTime('2026-09-10', '2:00 PM', 'Asia/Manila');
  const content = buildAppointmentReminderContent({
    booking: confirmedBooking({ nailArt: { enabled: true, quantity: 5 }, referenceImageUrl: 'https://example.test/photo.jpg' }),
    profile: { fullName: 'Zyrel Santos' },
    reminderType: 'reminder24h',
    appointmentAt,
    timeZone: 'Asia/Manila',
  });
  assert.match(content.subject, /tomorrow/i);
  assert.equal(content.serviceName, 'Gel Manicure');
  assert.equal(content.time, '2:00 PM');
  assert.equal(content.nailArt, '5 nails');
  assert.equal(content.referencePhoto, 'Included with your booking');
});
