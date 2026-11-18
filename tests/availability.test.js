import test from 'node:test';
import assert from 'node:assert/strict';
import { getBookableTimeSlots, getBookingDateRestriction, normalizeBusinessSettings, getBusinessSettingsPatch } from '../src/businessSettings.js';
import { validateDateOverride, getDateAvailability, getAffectedAppointments, isAppointmentWithinAvailability } from '../functions/shared/availability.js';

const day = '2026-11-21';
const now = new Date('2026-11-18T00:00:00+08:00');
const custom = { status: 'custom', availableRanges: [{ start: '10:00', end: '12:00' }, { start: '14:00', end: '17:00' }], blockedRanges: [] };
const settings = (override) => ({ bookingInterval: 30, dateOverrides: { [day]: override } });

test('closing, reopening, and resetting a date use the existing business settings', () => {
  assert.equal(getBookingDateRestriction(day, settings({ status: 'closed' }), now), 'Closed');
  assert.deepEqual(getBookableTimeSlots(day, 60, settings({ status: 'closed' }), now), []);
  assert.equal(getBookableTimeSlots(day, 60, settings({ status: 'open' }), now)[0], '10:00');
  assert.equal(getBookableTimeSlots(day, 60, {}, now).at(-1), '21:00');
  const normalized = normalizeBusinessSettings(settings(custom));
  assert.equal(normalized.dateOverrides[day].status, 'custom');
  assert.deepEqual(getBusinessSettingsPatch(normalized, { ...normalized, phone: '09170000000' }), { phone: '09170000000' });
});

test('custom hours allow only complete appointments within each separate range', () => {
  assert.deepEqual(getBookableTimeSlots(day, 90, settings(custom), now), ['10:00', '10:30', '14:00', '14:30', '15:00', '15:30']);
  assert.equal(isAppointmentWithinAvailability({ date: day, time: '11:00', durationMinutes: 90 }, settings(custom)), false);
});

test('blocked hours and appointment buffers exclude any overlapping interval', () => {
  const config = { ...settings({ status: 'open', blockedRanges: [{ start: '13:00', end: '15:00' }] }), appointmentBufferMinutes: 15 };
  const slots = getBookableTimeSlots(day, 60, config, now);
  for (const time of ['12:00', '12:30', '13:00', '14:30', '15:00']) assert.equal(slots.includes(time), false, time);
  assert.equal(slots.includes('11:30'), true);
  assert.equal(slots.includes('15:30'), true);
  assert.equal(slots.includes('21:00'), false);
});

test('an override opens a normally closed weekday without bypassing the booking window or notice', () => {
  const config = { ...settings(custom), businessHours: { saturday: { open: false, openTime: '10:00', closeTime: '22:00' } }, maximumAdvanceDays: 1 };
  assert.equal(getBookingDateRestriction(day, config, now), 'Outside booking window');
  const opened = { ...config, maximumAdvanceDays: 60 };
  assert.equal(getBookingDateRestriction(day, opened, now), '');
  assert.deepEqual(getBookableTimeSlots(day, 90, opened, new Date('2026-11-21T16:00:00+08:00')), []);
});

test('invalid dates, duplicate, overlapping, reversed, and invalid time ranges are rejected', () => {
  for (const date of ['2026-02-30', '2026-13-01', '2026-1-01']) assert.ok(validateDateOverride(date, custom).length);
  for (const ranges of [
    [{ start: '12:00', end: '10:00' }],
    [{ start: '25:00', end: '26:00' }],
    [{ start: '10:00', end: '12:00' }, { start: '11:00', end: '13:00' }],
    [{ start: '10:00', end: '12:00' }, { start: '10:00', end: '12:00' }],
    [],
  ]) assert.ok(validateDateOverride(day, { ...custom, availableRanges: ranges }).length);
  assert.deepEqual(validateDateOverride(day, custom), []);
});

test('malformed saved date overrides fail closed instead of reopening a date', () => {
  assert.equal(getBookingDateRestriction(day, settings({ status: 'custom', availableRanges: [] }), now), 'Closed');
});

test('availability changes identify affected saved appointments without altering any record', () => {
  const bookings = [
    { id: 'a', date: day, time: '11:00', durationMinutes: 90, status: 'Confirmed', createdAt: 'original' },
    { id: 'b', date: day, time: '14:00', durationMinutes: 60, status: 'Pending Confirmation' },
    { id: 'c', date: day, time: '11:00', durationMinutes: 90, status: 'Cancelled' },
  ];
  const before = structuredClone(bookings);
  assert.deepEqual(getAffectedAppointments(day, settings(custom), bookings).map((b) => b.id), ['a']);
  assert.deepEqual(getAffectedAppointments(day, settings({ status: 'closed' }), bookings).map((b) => b.id), ['a', 'b']);
  assert.deepEqual(bookings, before);
});

test('Overview and manager share open, closed, custom, and capacity indicators', () => {
  assert.equal(getDateAvailability(day, {}, [], now).status, 'open');
  assert.equal(getDateAvailability(day, settings({ status: 'closed' }), [], now).status, 'closed');
  assert.equal(getDateAvailability(day, settings(custom), [], now).status, 'custom');
  const entry = { id: 'a', date: day, time: '10:00', durationMinutes: 60, status: 'Confirmed' };
  assert.equal(getDateAvailability(day, { maximumAppointmentsPerDay: 1 }, [entry], now).status, 'full');
  assert.equal(getDateAvailability(day, { maximumAppointmentsPerDay: 1 }, [{ ...entry, status: 'Cancelled' }], now).status, 'open');
});
