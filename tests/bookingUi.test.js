import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/constants/services.js';
import { filterBookingServices, getCalendarCells, getDatesWithoutBookableTimes, getNoBookableTimesReason, isDateFullyBooked } from '../src/bookingUi.js';
import { getBookableTimeSlots } from '../src/businessSettings.js';
import { compileCalendar, compilePolicy, initialState, reserve } from '../src/spark/engine.js';
import { getUnavailableTimeSlots } from '../src/scheduling.js';

test('booking service filters return only services in the selected group', () => {
  assert.deepEqual(
    filterBookingServices(SERVICES, 'Removal').map((service) => service.id),
    ['gel-removal', 'biab-removal', 'soft-gel-extension-removal']
  );
  assert.deepEqual(filterBookingServices(SERVICES, 'Repair').map((service) => service.id), ['repair']);
  assert.equal(filterBookingServices(SERVICES, 'All').length, SERVICES.length);
});

test('calendar disables past, closed, and fully booked dates', () => {
  const cells = getCalendarCells(new Date(2026, 8, 1), {
    todayKey: '2026-09-03',
    closedWeekdays: [0],
    fullyBookedDates: new Set(['2026-09-05']),
  }).filter(Boolean);

  assert.equal(cells.find((cell) => cell.key === '2026-09-02').isPast, true);
  assert.equal(cells.find((cell) => cell.key === '2026-09-05').isFullyBooked, true);
  assert.equal(cells.find((cell) => cell.key === '2026-09-06').isClosed, true);
  assert.equal(cells.find((cell) => cell.key === '2026-09-07').disabled, false);
});

test('calendar applies same-day, maximum advance, and blackout settings', () => {
  const cells = getCalendarCells(new Date(2026, 8, 1), {
    todayKey: '2026-09-03',
    allowSameDayBooking: false,
    maximumDateKey: '2026-09-20',
    blackoutDates: new Set(['2026-09-10']),
  }).filter(Boolean);

  assert.equal(cells.find((cell) => cell.key === '2026-09-03').isSameDayUnavailable, true);
  assert.equal(cells.find((cell) => cell.key === '2026-09-10').isBlackout, true);
  assert.equal(cells.find((cell) => cell.key === '2026-09-21').isBeyondAdvanceWindow, true);
});

test('an explicit open date overrides recurring closure without bypassing the booking window', () => {
  const cells = getCalendarCells(new Date(2026, 10, 1), {
    todayKey: '2026-11-18', maximumDateKey: '2026-11-24', closedWeekdays: [6],
    dateOverrides: { '2026-11-21': { status: 'open' }, '2026-11-28': { status: 'open' } },
  });
  assert.equal(cells.find((cell) => cell?.key === '2026-11-21').disabled, false);
  assert.equal(cells.find((cell) => cell?.key === '2026-11-28').isBeyondAdvanceWindow, true);
  assert.equal(cells.find((cell) => cell?.key === '2026-11-28').disabled, true);
});

test('calendar does not mark a date full when no bookable slots remain but no bookings fill the day', () => {
  assert.equal(isDateFullyBooked([], new Set()), false);
  assert.equal(isDateFullyBooked([], new Set(), true), true);
  assert.equal(isDateFullyBooked(['10:00', '10:30'], new Set(['10:00', '10:30'])), true);
  assert.equal(isDateFullyBooked(['10:00', '10:30'], new Set(['10:00'])), false);
});

test('Sunday with no remaining starts is unavailable while future Sundays stay bookable', () => {
  const now = new Date('2026-11-22T20:27:00+08:00');
  const settings = { bookingInterval: 60, minimumNoticeHours: 2 };
  const noAvailableTimesDates = getDatesWithoutBookableTimes(new Date(2026, 10, 1), 75, settings, now);
  const cells = getCalendarCells(new Date(2026, 10, 1), {
    todayKey: '2026-11-22',
    noAvailableTimesDates,
  }).filter(Boolean);
  const today = cells.find((cell) => cell.key === '2026-11-22');
  const nextSunday = cells.find((cell) => cell.key === '2026-11-29');

  assert.equal(today.hasNoAvailableTimes, true);
  assert.equal(today.disabled, true);
  assert.equal(today.isFullyBooked, false);
  assert.equal(nextSunday.hasNoAvailableTimes, false);
  assert.equal(nextSunday.disabled, false);
  const slots = getBookableTimeSlots(nextSunday.key, 75, settings, now);
  assert.equal(slots[0], '10:00');
  assert.equal(slots.at(-1), '20:00');
});

test('same-day Sunday stays available until the notice deadline for the last start', () => {
  const month = new Date(2026, 10, 1);
  const settings = { bookingInterval: 60, minimumNoticeHours: 2 };
  assert.equal(getDatesWithoutBookableTimes(month, 90, settings, new Date('2026-11-22T17:59:00+08:00')).has('2026-11-22'), false);
  assert.equal(getDatesWithoutBookableTimes(month, 90, settings, new Date('2026-11-22T18:00:00+08:00')).has('2026-11-22'), false);
  assert.equal(getDatesWithoutBookableTimes(month, 90, settings, new Date('2026-11-22T18:00:01+08:00')).has('2026-11-22'), true);
});

test('9 PM to 11 PM custom hours explain when notice removes all starts and do not offer the range end', () => {
  const date = '2026-11-22';
  const settings = {
    timezone: 'Asia/Manila', bookingInterval: 60, minimumNoticeHours: 2,
    dateOverrides: { [date]: { status: 'custom', availableRanges: [{ start: '21:00', end: '23:00' }], blockedRanges: [] } },
  };
  const beforeNoticeDeadline = new Date('2026-11-22T19:00:00+08:00');
  const afterNoticeDeadline = new Date('2026-11-22T20:50:00+08:00');

  assert.deepEqual(getBookableTimeSlots(date, 60, settings, beforeNoticeDeadline), ['21:00', '22:00']);
  assert.deepEqual(getBookableTimeSlots(date, 60, { ...settings, minimumNoticeHours: 0 }, beforeNoticeDeadline), ['21:00', '22:00']);
  assert.equal(getBookableTimeSlots(date, 60, settings, afterNoticeDeadline).length, 0);

  const reason = getNoBookableTimesReason(date, 60, settings, afterNoticeDeadline);
  assert.equal(reason.type, 'minimum-notice');
  assert.match(reason.message, /2-hour minimum booking notice/);
  assert.match(reason.message, /11:00 PM.*closing boundary/);
  assert.equal(getNoBookableTimesReason(date, 60, settings, new Date('2026-11-22T23:01:00+08:00')).type, 'elapsed');

  const noAvailableTimesDates = getDatesWithoutBookableTimes(new Date(2026, 10, 1), 60, settings, afterNoticeDeadline);
  const cell = getCalendarCells(new Date(2026, 10, 1), {
    todayKey: date, noAvailableTimesDates, noAvailableTimesReasons: { [date]: reason },
  }).find((item) => item?.key === date);
  assert.equal(cell.disabled, true);
  assert.equal(cell.noAvailableTimesReason.type, 'minimum-notice');

  const eligibleCell = getCalendarCells(new Date(2026, 10, 1), {
    todayKey: date,
    noAvailableTimesDates: getDatesWithoutBookableTimes(new Date(2026, 10, 1), 60, settings, beforeNoticeDeadline),
  }).find((item) => item?.key === date);
  assert.equal(eligibleCell.disabled, false);

  const nextDaySlots = getBookableTimeSlots('2026-11-23', 60, settings, afterNoticeDeadline);
  assert.ok(nextDaySlots.includes('10:00'));
  const oneSlotSettings = {
    ...settings,
    dateOverrides: { [date]: { status: 'custom', availableRanges: [{ start: '21:00', end: '22:00' }], blockedRanges: [] } },
  };
  assert.deepEqual(getBookableTimeSlots(date, 60, oneSlotSettings, beforeNoticeDeadline), ['21:00']);
  assert.equal(getDatesWithoutBookableTimes(new Date(2026, 10, 1), 60, oneSlotSettings, beforeNoticeDeadline).has(date), false);
});

test('9 PM to 11 PM frontend slots match the Spark reservation policy and overlap protection', () => {
  const date = '2026-11-22';
  const raw = {
    timezone: 'Asia/Manila', bookingInterval: 60,
    dateOverrides: { [date]: { status: 'custom', availableRanges: [{ start: '21:00', end: '23:00' }], blockedRanges: [] } },
  };
  const { settings, policy } = compilePolicy(raw);
  const justBeforeEligible = new Date('2026-11-22T19:00:00+08:00');
  const atTwentyFifty = new Date('2026-11-22T20:50:00+08:00');

  assert.equal(settings.minimumNoticeHours, 2);
  assert.deepEqual(getBookableTimeSlots(date, 75, settings, justBeforeEligible), ['21:00']);
  assert.deepEqual(getBookableTimeSlots(date, 60, settings, atTwentyFifty), []);
  const stateAtTwentyFifty = initialState(settings, [], atTwentyFifty.getTime());
  const calendarAtTwentyFifty = compileCalendar(settings, stateAtTwentyFifty.origin, stateAtTwentyFifty.days)[date];
  assert.throws(() => reserve(stateAtTwentyFifty, {
    id: 'too-soon', date, time: '21:00', service: 'gel-manicure', startMinutes: 1260, durationMinutes: 60, totalPrice: 299, createdAt: atTwentyFifty.toISOString(),
  }, calendarAtTwentyFifty, policy, atTwentyFifty.getTime()), /no longer available/i);

  const starts = getBookableTimeSlots(date, 60, settings, justBeforeEligible);
  assert.deepEqual(starts, ['21:00', '22:00']);
  const stateBefore = initialState(settings, [], justBeforeEligible.getTime());
  const calendarBefore = compileCalendar(settings, stateBefore.origin, stateBefore.days)[date];
  const firstBooking = { id: 'first-start', date, time: starts[0], service: 'gel-manicure', startMinutes: 1260, durationMinutes: 60, totalPrice: 299, createdAt: justBeforeEligible.toISOString() };
  const occupied = reserve(stateBefore, firstBooking, calendarBefore, policy, justBeforeEligible.getTime());
  assert.ok(occupied);
  const unavailable = getUnavailableTimeSlots(starts, date, { id: 'gel-manicure', durationMinutes: 60 }, [{
    bookingId: firstBooking.id, id: firstBooking.id, date, time: firstBooking.time, durationMinutes: firstBooking.durationMinutes, status: 'Pending Confirmation',
  }], { includePendingHolds: true, now: justBeforeEligible.getTime() });
  assert.equal(unavailable.has('21:00'), true);
  assert.equal(unavailable.has('22:00'), false);
  assert.throws(() => reserve(occupied, { ...firstBooking, id: 'duplicate-start' }, calendarBefore, policy, justBeforeEligible.getTime()), /no longer available/i);
  assert.ok(reserve(occupied, { ...firstBooking, id: 'remaining-start', time: starts[1], startMinutes: 1320 }, calendarBefore, policy, justBeforeEligible.getTime()));
});

test('a late start that cannot finish inside available hours stays unavailable', () => {
  const noAvailableTimesDates = getDatesWithoutBookableTimes(new Date(2026, 10, 1), 90,
    { bookingInterval: 60, minimumNoticeHours: 2 }, new Date('2026-11-15T21:30:00+08:00'));
  const today = getCalendarCells(new Date(2026, 10, 1), {
    todayKey: '2026-11-15', noAvailableTimesDates,
  }).find((cell) => cell?.key === '2026-11-15');
  assert.equal(today.hasNoAvailableTimes, true);
  assert.equal(today.disabled, true);
});

test('closed and past dates keep their own calendar reasons', () => {
  const dates = getDatesWithoutBookableTimes(new Date(2026, 10, 1), 75, {
    blackoutDates: { '2026-11-22': { reason: 'Private event' } },
  }, new Date('2026-11-15T18:27:00+08:00'));
  assert.equal(dates.has('2026-11-14'), false);
  assert.equal(dates.has('2026-11-22'), false);
});
