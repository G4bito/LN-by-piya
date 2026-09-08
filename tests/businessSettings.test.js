import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageAppointmentOnline,
  formatWeeklyBusinessHours,
  getBookableTimeSlots,
  getBookingDateRestriction,
  getBusinessSettingsPatch,
  hasReachedDailyAppointmentLimit,
  normalizeBusinessSettings,
  validateBusinessSettingsPatch,
} from '../src/businessSettings.js';

test('settings saves produce a targeted patch without frontend-only metadata', () => {
  const current = normalizeBusinessSettings({ phone: '09170000000', bookingInterval: 30 });
  const patch = getBusinessSettingsPatch(current, { ...current, bookingInterval: '45' });
  assert.deepEqual(patch, { bookingInterval: 45 });
  assert.equal(Object.hasOwn(patch, 'businessHoursConfigured'), false);
});

test('missing settings use safe operational defaults without mutating the source', () => {
  const source = { phone: '09170000000' };
  const settings = normalizeBusinessSettings(source);
  assert.equal(settings.phone, source.phone);
  assert.equal(settings.timezone, 'Asia/Manila');
  assert.equal(settings.businessHours.sunday.open, false);
  assert.equal(settings.requireAdminApprovalForCancellation, true);
  assert.equal(source.businessHours, undefined);
});

test('structured hours format cleanly and closed days block the calendar', () => {
  const settings = normalizeBusinessSettings({
    businessHours: {
      sunday: { open: false, openTime: '09:00', closeTime: '18:00' },
    },
  });
  const rows = formatWeeklyBusinessHours(settings.businessHours);
  assert.equal(rows.at(-1).label, 'Sunday');
  assert.equal(rows.at(-1).value, 'Closed');
  assert.equal(getBookingDateRestriction('2026-09-13', settings, new Date('2026-09-07T00:00:00Z')), 'Closed');
});

test('blackout dates block booking and become available after removal', () => {
  const now = new Date('2026-09-07T00:00:00Z');
  const blocked = normalizeBusinessSettings({ blackoutDates: { '2026-09-21': { date: '2026-09-21', reason: 'Private event' } } });
  assert.equal(getBookingDateRestriction('2026-09-21', blocked, now), 'Private event');
  assert.equal(getBookingDateRestriction('2026-09-21', { ...blocked, blackoutDates: {} }, now), '');
});

test('booking interval, online hours, notice, and service duration drive generated slots', () => {
  const settings = normalizeBusinessSettings({
    timezone: 'Asia/Manila',
    bookingInterval: 60,
    minimumNoticeHours: 2,
    businessHours: { monday: { open: true, openTime: '09:00', closeTime: '18:00' } },
    onlineBookingHours: { monday: { open: true, openTime: '10:00', closeTime: '17:00' } },
  });
  const slots = getBookableTimeSlots('2026-09-14', 60, settings, new Date('2026-09-07T00:00:00Z'));
  assert.deepEqual(slots, ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00']);
});

test('same-day and maximum advance controls block invalid dates', () => {
  const now = new Date('2026-09-07T02:00:00Z');
  const settings = normalizeBusinessSettings({ allowSameDayBooking: false, maximumAdvanceDays: 60 });
  assert.equal(getBookingDateRestriction('2026-09-07', settings, now), 'Same-day booking unavailable');
  assert.equal(getBookingDateRestriction('2026-11-07', settings, now), 'Outside booking window');
});

test('daily appointment limit counts only active schedule entries', () => {
  const now = Date.parse('2026-09-07T00:00:00Z');
  const entries = [
    { date: '2026-09-20', status: 'Confirmed' },
    { date: '2026-09-20', status: 'Pending', expiresAt: now + 1000 },
    { date: '2026-09-20', status: 'Pending', expiresAt: now - 1000 },
    { date: '2026-09-20', status: 'Cancelled' },
  ];
  assert.equal(hasReachedDailyAppointmentLimit(entries, '2026-09-20', { maximumAppointmentsPerDay: 2 }, now), true);
});

test('appointment change deadlines use the configured salon timezone', () => {
  const booking = { status: 'Confirmed', date: '2026-09-08', time: '10:00' };
  const settings = { allowCustomerCancellation: true, cancellationDeadlineHours: 12, timezone: 'Asia/Manila' };
  assert.equal(canManageAppointmentOnline(booking, 'cancel', settings, new Date('2026-09-07T12:00:00Z')).allowed, true);
  assert.equal(canManageAppointmentOnline(booking, 'cancel', settings, new Date('2026-09-07T23:00:00Z')).allowed, false);
});

test('settings validation rejects malformed hours, URLs, and numeric limits', () => {
  const errors = validateBusinessSettingsPatch({
    facebookUrl: 'javascript:alert(1)',
    bookingInterval: 0,
    businessHours: { monday: { open: true, openTime: '18:00', closeTime: '09:00' } },
  });
  assert.equal(errors.length, 3);
});
