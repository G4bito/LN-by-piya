import { SERVICES } from './constants/services.js';

export const SCHEDULE_CONFLICT_CODE = 'schedule/conflict';
export const PENDING_SLOT_HOLD_MS = 2 * 60 * 1000;
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;

export class ScheduleConflictError extends Error {
  constructor(message = 'Sorry, this date and time has already been booked. Please choose another available time.') {
    super(message);
    this.name = 'ScheduleConflictError';
    this.code = SCHEDULE_CONFLICT_CODE;
  }
}

export function getTimeMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (!period && hour > 0 && hour < 9) hour += 12;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return (hour * 60) + minute;
}

export function getServiceDurationMinutes(service) {
  const explicitDuration = Number(service?.durationMinutes);
  if (Number.isFinite(explicitDuration) && explicitDuration > 0) return explicitDuration;

  const durationValues = String(service?.duration || '').match(/\d+/g)?.map(Number).filter(Number.isFinite) || [];
  return durationValues.length > 0
    ? Math.max(...durationValues)
    : DEFAULT_APPOINTMENT_DURATION_MINUTES;
}

export function getAppointmentDurationMinutes(appointment) {
  const savedDuration = Number(appointment?.durationMinutes);
  if (Number.isFinite(savedDuration) && savedDuration > 0) return savedDuration;
  const service = SERVICES.find((item) => item.id === appointment?.service);
  return getServiceDurationMinutes(service);
}

export function getAppointmentInterval(appointment) {
  const startMinutes = Number.isFinite(Number(appointment?.startMinutes))
    ? Number(appointment.startMinutes)
    : getTimeMinutes(appointment?.time);
  if (startMinutes == null) return null;
  const durationMinutes = getAppointmentDurationMinutes(appointment);
  const savedEnd = Number(appointment?.endMinutes);
  const endMinutes = Number.isFinite(savedEnd) && savedEnd > startMinutes
    ? savedEnd
    : startMinutes + durationMinutes;
  return { startMinutes, endMinutes, durationMinutes };
}

export function intervalsOverlap(left, right) {
  return left.startMinutes < right.endMinutes && left.endMinutes > right.startMinutes;
}

export function isConfirmedScheduleStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'confirmed' || normalized === 'accepted';
}

export function isPendingScheduleHold(entry, now = Date.now()) {
  const status = String(entry?.status || '').trim().toLowerCase();
  return status === 'pending' && Number(entry?.expiresAt) > now;
}

export function isBlockingScheduleEntry(entry, { includePendingHolds = true, now = Date.now() } = {}) {
  return isConfirmedScheduleStatus(entry?.status) || (includePendingHolds && isPendingScheduleHold(entry, now));
}

export function createScheduleEntry(booking, status = 'Pending', expiresAt) {
  const interval = getAppointmentInterval(booking);
  if (!booking?.id || !booking?.uid || !booking?.date || !booking?.time || !interval) return null;
  return {
    bookingId: booking.id,
    ownerUid: booking.uid,
    date: booking.date,
    time: booking.time,
    serviceId: booking.service || '',
    durationMinutes: interval.durationMinutes,
    startMinutes: interval.startMinutes,
    endMinutes: interval.endMinutes,
    status,
    ...(expiresAt ? { expiresAt } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function hasScheduleConflict(request, entries = [], options = {}) {
  const requestInterval = getAppointmentInterval(request);
  if (!request?.date || !requestInterval) return false;
  const excludeBookingId = options.excludeBookingId || request.id;

  return entries.some((entry) => {
    const entryBookingId = entry?.bookingId || entry?.id;
    if (!entry || entryBookingId === excludeBookingId || entry.date !== request.date) return false;
    if (!isBlockingScheduleEntry(entry, options)) return false;
    const entryInterval = getAppointmentInterval(entry);
    return Boolean(entryInterval && intervalsOverlap(requestInterval, entryInterval));
  });
}

export function getUnavailableTimeSlots(timeSlots, date, service, entries = [], options = {}) {
  if (!date || !service) return new Set();
  return new Set(timeSlots.filter((time) => hasScheduleConflict({
    date,
    time,
    service: service.id,
    durationMinutes: getServiceDurationMinutes(service),
  }, entries, options)));
}

export function findConfirmedAppointmentConflicts(bookings = []) {
  const confirmed = bookings.filter((booking) => isConfirmedScheduleStatus(booking?.status));
  const conflicts = [];

  confirmed.forEach((booking, index) => {
    const interval = getAppointmentInterval(booking);
    if (!booking?.date || !interval) return;
    for (let otherIndex = index + 1; otherIndex < confirmed.length; otherIndex += 1) {
      const other = confirmed[otherIndex];
      if (other?.date !== booking.date) continue;
      const otherInterval = getAppointmentInterval(other);
      if (otherInterval && intervalsOverlap(interval, otherInterval)) {
        conflicts.push({
          key: `${booking.id}|${other.id}`,
          date: booking.date,
          time: booking.time,
          appointments: [booking, other],
        });
      }
    }
  });

  return conflicts;
}
