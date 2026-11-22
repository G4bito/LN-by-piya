import { getAppointmentTimestamp, getBookableTimeSlots, getBookingDateRestriction, normalizeBusinessSettings } from './businessSettings.js';
import { getDayAvailableRanges } from '../functions/shared/dateOverrides.js';

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

export function isDateFullyBooked(timeSlots, unavailableTimeSlots, dailyLimitReached = false) {
  return dailyLimitReached || (timeSlots.length > 0 && unavailableTimeSlots.size === timeSlots.length);
}

export function getDatesWithoutBookableTimes(monthDate, durationMinutes, settingsValue, now = new Date()) {
  const settings = normalizeBusinessSettings(settingsValue);
  const dates = new Set();
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = toLocalDateKey(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
    if (!getBookingDateRestriction(key, settings, now)
      && getBookableTimeSlots(key, durationMinutes, settings, now).length === 0) dates.add(key);
  }
  return dates;
}

function formatClockTime(value) {
  const [hours, minutes] = value.split(':').map(Number);
  const period = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function getNoBookableTimesReason(dateKey, durationMinutes, settingsValue, now = new Date()) {
  const settings = normalizeBusinessSettings(settingsValue);
  if (getBookingDateRestriction(dateKey, settings, now)) return null;

  const eligibleStarts = getBookableTimeSlots(dateKey, durationMinutes, settings, now);
  if (eligibleStarts.length) return null;

  const startsBeforeNotice = getBookableTimeSlots(dateKey, durationMinutes, {
    ...settings,
    minimumNoticeHours: 0,
  }, now);
  if (settings.minimumNoticeHours > 0 && startsBeforeNotice.length) {
    const noticeHours = settings.minimumNoticeHours;
    const noticeLabel = `${noticeHours}-hour${noticeHours === 1 ? '' : ' minimum'} booking notice`;
    const endTimes = getDayAvailableRanges(dateKey, settings).map((range) => formatClockTime(range.end));
    const endsMessage = endTimes.length
      ? ` Available hours end at ${[...new Set(endTimes)].join(' and ')}; an end time is a closing boundary, not an appointment start.`
      : '';
    return {
      type: 'minimum-notice',
      label: 'Notice',
      message: `No start times remain outside the ${noticeLabel}.${endsMessage}`,
    };
  }

  const dayStart = getAppointmentTimestamp(dateKey, '00:00', settings.timezone);
  const startsToday = dayStart == null ? [] : getBookableTimeSlots(dateKey, durationMinutes, {
    ...settings,
    minimumNoticeHours: 0,
  }, new Date(dayStart));
  if (startsToday.length) {
    return {
      type: 'elapsed',
      label: 'Passed',
      message: 'All configured appointment start times have passed for this date.',
    };
  }

  return {
    type: 'duration-or-interval',
    label: 'No times',
    message: `No start time fits this ${durationMinutes}-minute service inside the configured hours at the ${settings.bookingInterval}-minute booking interval.`,
  };
}

export function getCalendarCells(monthDate, options = {}) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const todayKey = options.todayKey || toLocalDateKey(new Date());
  const closedWeekdays = new Set(options.closedWeekdays || []);
  const fullyBookedDates = options.fullyBookedDates || new Set();
  const noAvailableTimesDates = options.noAvailableTimesDates || new Set();
  const noAvailableTimesReasons = options.noAvailableTimesReasons || {};
  const blackoutDates = options.blackoutDates || new Set();
  const dateOverrides = options.dateOverrides || {};
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
    const override = dateOverrides[key];
    const isClosed = override ? override.status === 'closed' : closedWeekdays.has(value.getDay());
    const isBlackout = !override && blackoutDates.has(key);
    const isFullyBooked = fullyBookedDates.has(key);
    const hasNoAvailableTimes = noAvailableTimesDates.has(key);
    cells.push({
      day,
      key,
      isPast,
      isClosed: isClosed || isBlackout,
      isBlackout,
      isSameDayUnavailable,
      isBeyondAdvanceWindow,
      isFullyBooked,
      hasNoAvailableTimes,
      noAvailableTimesReason: noAvailableTimesReasons[key] || null,
      disabled: isPast || isSameDayUnavailable || isBeyondAdvanceWindow || isClosed || isBlackout || isFullyBooked || hasNoAvailableTimes,
    });
  }

  return cells;
}
