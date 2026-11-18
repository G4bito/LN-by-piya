import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnavailableTimeSlots } from '../src/scheduling.js';
import {
  BUSINESS_WEEKDAYS,
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
  assert.equal(settings.businessHours.sunday.open, true);
  assert.equal(settings.onlineBookingHours.sunday.open, true);
  assert.equal(settings.requireAdminApprovalForCancellation, true);
  assert.equal(source.businessHours, undefined);
});

test('default salon and online booking hours are 10 AM to 10 PM every day', () => {
  const settings = normalizeBusinessSettings();
  const now = new Date('2026-09-06T00:00:00Z');

  BUSINESS_WEEKDAYS.forEach((weekday, index) => {
    const dateKey = `2026-09-${String(7 + index).padStart(2, '0')}`;
    const businessHours = settings.businessHours[weekday.key];
    const onlineHours = settings.onlineBookingHours[weekday.key];
    const slots = getBookableTimeSlots(dateKey, 60, settings, now);

    assert.deepEqual(businessHours, { open: true, openTime: '10:00', closeTime: '22:00' });
    assert.deepEqual(onlineHours, { open: true, openTime: '10:00', closeTime: '22:00' });
    assert.equal(slots[0], '10:00');
    assert.equal(slots.at(-1), '21:00');
    assert.equal(slots.length, 23);
  });
});

test('previously saved default hours migrate to the new 10 AM to 10 PM schedule', () => {
  const legacyBusinessHours = Object.fromEntries(BUSINESS_WEEKDAYS.map((day) => [
    day.key,
    {
      open: day.key !== 'sunday',
      openTime: '09:00',
      closeTime: day.key === 'saturday' ? '17:00' : '18:00',
    },
  ]));
  const legacyOnlineHours = Object.fromEntries(BUSINESS_WEEKDAYS.map((day) => [
    day.key,
    { open: day.key !== 'sunday', openTime: '09:00', closeTime: '16:00' },
  ]));
  const settings = normalizeBusinessSettings({
    businessHours: legacyBusinessHours,
    onlineBookingHours: legacyOnlineHours,
  });
  const sundaySlots = getBookableTimeSlots('2026-09-13', 60, settings, new Date('2026-09-06T00:00:00Z'));

  BUSINESS_WEEKDAYS.forEach((day) => {
    assert.deepEqual(settings.businessHours[day.key], { open: true, openTime: '10:00', closeTime: '22:00' });
    assert.deepEqual(settings.onlineBookingHours[day.key], { open: true, openTime: '10:00', closeTime: '22:00' });
  });
  assert.equal(sundaySlots[0], '10:00');
  assert.equal(sundaySlots.at(-1), '21:00');
});

test('a manually opened Sunday with old saved hours gets the new booking window', () => {
  const settings = normalizeBusinessSettings({
    businessHours: {
      sunday: { open: true, openTime: '09:00', closeTime: '18:00' },
    },
    onlineBookingHours: {
      sunday: { open: true, openTime: '09:00', closeTime: '16:00' },
    },
  });
  const slots = getBookableTimeSlots('2026-11-15', 75, settings, new Date('2026-11-15T10:21:55Z'));

  assert.deepEqual(settings.businessHours.sunday, { open: true, openTime: '10:00', closeTime: '22:00' });
  assert.deepEqual(settings.onlineBookingHours.sunday, { open: true, openTime: '10:00', closeTime: '22:00' });
  assert.deepEqual(slots, ['20:30']);
});

test('structured closed hours still block the calendar', () => {
  const settings = normalizeBusinessSettings({
    businessHours: {
      sunday: { open: false, openTime: '08:00', closeTime: '17:00' },
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

test('booking interval and online hours limit appointment start times', () => {
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

test('90-minute appointments finish within the 10 AM to 10 PM hours every day', () => {
  const now = new Date('2026-11-15T18:27:00+08:00');
  const settings = { bookingInterval: 60, minimumNoticeHours: 2 };
  for (let day = 16; day <= 22; day += 1) {
    const slots = getBookableTimeSlots(`2026-11-${day}`, 90, settings, now);
    assert.equal(slots[0], '10:00');
    assert.deepEqual(slots.slice(-2), ['19:00', '20:00']);
    assert.equal(slots.length, 11);
  }
});

test('late appointment starts still require the full two-hour advance notice', () => {
  const settings = { bookingInterval: 60, minimumNoticeHours: 2 };
  assert.deepEqual(getBookableTimeSlots('2026-11-16', 90, settings, new Date('2026-11-16T17:59:00+08:00')), ['20:00']);
  assert.deepEqual(getBookableTimeSlots('2026-11-16', 90, settings, new Date('2026-11-16T18:00:00+08:00')), ['20:00']);
  assert.deepEqual(getBookableTimeSlots('2026-11-16', 90, settings, new Date('2026-11-16T18:00:01+08:00')), []);
});

test('the former late-start exception cannot bypass full-duration hours or notice', () => {
  const settings = { bookingInterval: 30, minimumNoticeHours: 2 };
  assert.deepEqual(getBookableTimeSlots('2026-11-15', 90, settings, new Date('2026-11-15T20:15:00+08:00')), []);
  assert.deepEqual(getBookableTimeSlots('2026-11-15', 90, settings, new Date('2026-11-15T21:30:00+08:00')), []);
  assert.deepEqual(getBookableTimeSlots('2026-11-15', 90, settings, new Date('2026-11-15T22:00:01+08:00')), []);
  assert.deepEqual(getBookableTimeSlots('2026-11-16', 90, settings, new Date('2026-11-16T21:30:00+08:00')), []);
});

test('late starts still block appointments that overlap an existing evening booking', () => {
  const date = '2026-11-16';
  const slots = getBookableTimeSlots(date, 90, { bookingInterval: 60 }, new Date('2026-11-15T18:27:00+08:00'));
  const unavailable = getUnavailableTimeSlots(slots, date, { id: 'biab-structured-gel', durationMinutes: 90 }, [
    { bookingId: 'evening-booking', date, time: '19:30', durationMinutes: 90, status: 'Confirmed' },
  ]);
  assert.equal(unavailable.has('18:00'), false);
  assert.equal(unavailable.has('19:00'), true);
  assert.equal(unavailable.has('20:00'), true);
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
