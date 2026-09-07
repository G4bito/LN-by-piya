export const SERVICE_FILTERS = Object.freeze(['All', 'Manicure', 'Extensions', 'Removal', 'Repair']);

const SERVICE_GROUPS = Object.freeze({
  Manicure: new Set(['gel-manicure', 'biab-structured-gel']),
  Extensions: new Set(['soft-gel-extensions', 'refill-for-extension']),
  Removal: new Set(['gel-removal', 'biab-removal', 'soft-gel-extension-removal']),
  Repair: new Set(['repair']),
});

export function filterBookingServices(services, filter = 'All') {
  if (filter === 'All') return services;
  const serviceIds = SERVICE_GROUPS[filter];
  return serviceIds ? services.filter((service) => serviceIds.has(service.id)) : services;
}

export function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCalendarCells(monthDate, options = {}) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const todayKey = options.todayKey || toLocalDateKey(new Date());
  const closedWeekdays = new Set(options.closedWeekdays || []);
  const fullyBookedDates = options.fullyBookedDates || new Set();
  const blackoutDates = options.blackoutDates || new Set();
  const maximumDateKey = options.maximumDateKey || '';
  const allowSameDayBooking = options.allowSameDayBooking !== false;
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstWeekday }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = new Date(year, month, day);
    const key = toLocalDateKey(value);
    const isPast = key < todayKey;
    const isSameDayUnavailable = !allowSameDayBooking && key === todayKey;
    const isBeyondAdvanceWindow = Boolean(maximumDateKey && key > maximumDateKey);
    const isClosed = closedWeekdays.has(value.getDay());
    const isBlackout = blackoutDates.has(key);
    const isFullyBooked = fullyBookedDates.has(key);
    cells.push({
      day,
      key,
      isPast,
      isClosed: isClosed || isBlackout,
      isBlackout,
      isSameDayUnavailable,
      isBeyondAdvanceWindow,
      isFullyBooked,
      disabled: isPast || isSameDayUnavailable || isBeyondAdvanceWindow || isClosed || isBlackout || isFullyBooked,
    });
  }

  return cells;
}
