import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/constants/services.js';
import { filterBookingServices, getCalendarCells, getDatesWithoutBookableTimes, isDateFullyBooked } from '../src/bookingUi.js';
import { getBookableTimeSlots } from '../src/businessSettings.js';

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
  assert.equal(slots.at(-1), '22:00');
});

test('same-day Sunday stays available until the notice deadline for the last start', () => {
  const month = new Date(2026, 10, 1);
  const settings = { bookingInterval: 60, minimumNoticeHours: 2 };
  assert.equal(getDatesWithoutBookableTimes(month, 90, settings, new Date('2026-11-22T18:27:00+08:00')).has('2026-11-22'), false);
  assert.equal(getDatesWithoutBookableTimes(month, 90, settings, new Date('2026-11-22T20:00:00+08:00')).has('2026-11-22'), false);
  assert.equal(getDatesWithoutBookableTimes(month, 90, settings, new Date('2026-11-22T20:00:01+08:00')).has('2026-11-22'), true);
});

test('November 15 stays selectable for its approved 10 PM exception', () => {
  const noAvailableTimesDates = getDatesWithoutBookableTimes(new Date(2026, 10, 1), 90,
    { bookingInterval: 60, minimumNoticeHours: 2 }, new Date('2026-11-15T21:30:00+08:00'));
  const today = getCalendarCells(new Date(2026, 10, 1), {
    todayKey: '2026-11-15', noAvailableTimesDates,
  }).find((cell) => cell?.key === '2026-11-15');
  assert.equal(today.hasNoAvailableTimes, false);
  assert.equal(today.disabled, false);
});

test('closed and past dates keep their own calendar reasons', () => {
  const dates = getDatesWithoutBookableTimes(new Date(2026, 10, 1), 75, {
    blackoutDates: { '2026-11-22': { reason: 'Private event' } },
  }, new Date('2026-11-15T18:27:00+08:00'));
  assert.equal(dates.has('2026-11-14'), false);
  assert.equal(dates.has('2026-11-22'), false);
});
