import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/constants/services.js';
import {
  createScheduleEntry,
  getServiceDurationMinutes,
  getUnavailableTimeSlots,
  hasScheduleConflict,
  intervalsOverlap,
} from '../src/scheduling.js';

test('service duration uses the longest duration already configured for the service', () => {
  const gel = SERVICES.find((service) => service.id === 'gel-manicure');
  const extensions = SERVICES.find((service) => service.id === 'soft-gel-extensions');

  assert.equal(getServiceDurationMinutes(gel), 75);
  assert.equal(getServiceDurationMinutes(extensions), 120);
});

test('interval overlap uses end boundaries correctly', () => {
  assert.equal(intervalsOverlap({ startMinutes: 600, endMinutes: 720 }, { startMinutes: 660, endMinutes: 750 }), true);
  assert.equal(intervalsOverlap({ startMinutes: 600, endMinutes: 720 }, { startMinutes: 720, endMinutes: 780 }), false);
});

test('a confirmed two-hour appointment disables every overlapping start time', () => {
  const gel = SERVICES.find((service) => service.id === 'gel-manicure');
  const entries = [{
    bookingId: 'confirmed-1',
    date: '2026-09-10',
    time: '10:00',
    startMinutes: 600,
    endMinutes: 720,
    durationMinutes: 120,
    status: 'Confirmed',
  }];
  const unavailable = getUnavailableTimeSlots(
    ['09:00', '10:00', '11:00', '12:00', '1:00'],
    '2026-09-10',
    gel,
    entries
  );

  assert.deepEqual([...unavailable], ['09:00', '10:00', '11:00']);
  assert.equal(unavailable.has('12:00'), false);
});

test('pending claims block simultaneous submissions briefly but expire automatically', () => {
  const now = Date.now();
  const request = { date: '2026-09-10', time: '10:00', service: 'gel-manicure' };
  const pendingEntry = {
    bookingId: 'pending-1',
    date: '2026-09-10',
    time: '10:00',
    durationMinutes: 75,
    status: 'Pending',
    expiresAt: now + 1000,
  };

  assert.equal(hasScheduleConflict(request, [pendingEntry], { now, includePendingHolds: true }), true);
  assert.equal(hasScheduleConflict(request, [pendingEntry], { now: now + 2000, includePendingHolds: true }), false);
  assert.equal(hasScheduleConflict(request, [pendingEntry], { now, includePendingHolds: false }), false);
});

test('schedule entries store only scheduling metadata and calculated duration', () => {
  const entry = createScheduleEntry({
    id: 'booking-1',
    uid: 'customer-1',
    date: '2026-09-10',
    time: '2:00',
    service: 'biab-structured-gel',
  }, 'Confirmed');

  assert.equal(entry.startMinutes, 840);
  assert.equal(entry.durationMinutes, 90);
  assert.equal(entry.endMinutes, 930);
  assert.equal(entry.status, 'Confirmed');
  assert.equal(Object.hasOwn(entry, 'customerName'), false);
});
