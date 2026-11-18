import { getBookableTimeSlots, getBookingDateRestriction, hasReachedDailyAppointmentLimit, normalizeBusinessSettings } from './businessSettings.js';
import { fitsDateAvailability } from './dateOverrides.js';
import { SERVICES } from './constants/services.js';
import { getServiceDurationMinutes, hasScheduleConflict } from './scheduling.js';
export { validateDateOverride, normalizeDateOverride, isValidDateKey, MAX_AVAILABILITY_RANGES } from './dateOverrides.js';

export function isAppointmentWithinAvailability(appointment, settings) {
  return fitsDateAvailability(appointment, normalizeBusinessSettings(settings));
}

export function getAffectedAppointments(date, settings, appointments = []) {
  return appointments.filter((booking) => booking.date === date
    && !['cancelled', 'canceled', 'declined', 'no show', 'no-show'].includes(String(booking.status).toLowerCase())
    && !isAppointmentWithinAvailability(booking, settings));
}

const minimumDuration = Math.min(...SERVICES.map(getServiceDurationMinutes));
export function getDateAvailability(date, settingsValue, entries = [], now = new Date(), duration = minimumDuration) {
  const settings = normalizeBusinessSettings(settingsValue);
  const reason = getBookingDateRestriction(date, settings, now);
  if (reason) return { status: 'closed', label: 'Closed', reason };
  const slots = getBookableTimeSlots(date, duration, settings, now);
  if (hasReachedDailyAppointmentLimit(entries, date, settings, now.getTime()) || !slots.some((time) => !hasScheduleConflict(
    { date, time, durationMinutes: duration }, entries, { bufferMinutes: settings.appointmentBufferMinutes, now: now.getTime() }
  ))) return { status: 'full', label: 'Fully booked' };
  const custom = settings.dateOverrides[date]?.status === 'custom' || settings.dateOverrides[date]?.blockedRanges.length;
  return custom ? { status: 'custom', label: 'Custom hours' } : { status: 'open', label: 'Open' };
}
