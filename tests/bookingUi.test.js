import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from '../src/constants/services.js';
import { filterBookingServices, getCalendarCells } from '../src/bookingUi.js';

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
