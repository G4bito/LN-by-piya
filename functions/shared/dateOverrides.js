import { getAppointmentInterval, getTimeMinutes, intervalsOverlap } from './scheduling.js';

export const MAX_AVAILABILITY_RANGES = 8;
export function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));

export function validateDateOverride(date, value) {
  const errors = [];
  if (!isValidDateKey(date)) errors.push('Choose a valid calendar date.');
  if (value === null) return errors;
  if (!value || !['open', 'closed', 'custom'].includes(value.status)) errors.push('Choose open, closed, or custom hours.');
  for (const [key, label] of [['availableRanges', 'Available hours'], ['blockedRanges', 'Blocked hours']]) {
    const ranges = value?.[key] ?? [];
    if (!Array.isArray(ranges) || ranges.length > MAX_AVAILABILITY_RANGES) {
      errors.push(`${label} must contain at most ${MAX_AVAILABILITY_RANGES} ranges.`);
      continue;
    }
    if (key === 'availableRanges' && value?.status === 'custom' && !ranges.length) errors.push('Add at least one available time range.');
    const sorted = [...ranges].sort((a, b) => String(a?.start).localeCompare(String(b?.start)));
    sorted.forEach((range, index) => {
      if (!validTime(range?.start) || !validTime(range?.end) || range.end <= range.start) {
        errors.push(`${label}: the end must be later than the start, using valid times.`);
      }
      if (index && range?.start < sorted[index - 1]?.end) errors.push(`${label} cannot overlap or contain duplicate ranges.`);
    });
  }
  return [...new Set(errors)];
}

export function normalizeDateOverride(value) {
  if (!value) return null;
  const ranges = (key) => (Array.isArray(value[key]) ? value[key] : Object.values(value[key] || {}))
    .map(({ start, end }) => ({ start, end })).sort((a, b) => a.start.localeCompare(b.start));
  return {
    status: value.status,
    availableRanges: value.status === 'custom' ? ranges('availableRanges') : [],
    blockedRanges: ranges('blockedRanges'),
    updatedAt: Number(value.updatedAt) || 0,
  };
}

export function normalizeDateOverrides(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).flatMap(([date, entry]) => {
    if (!isValidDateKey(date)) return [];
    const closed = { status: 'closed', availableRanges: [], blockedRanges: [], updatedAt: 0 };
    try {
      const normalized = normalizeDateOverride(entry);
      return [[date, normalized && !validateDateOverride(date, normalized).length ? normalized : closed]];
    } catch { return [[date, closed]]; }
  }));
}

export function getDayAvailableRanges(date, settings) {
  if (!isValidDateKey(date)) return [];
  const override = settings.dateOverrides?.[date];
  if (override?.status === 'closed') return [];
  if (override?.status === 'custom') return override.availableRanges;
  const dayIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
  const key = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayIndex];
  const business = settings.businessHours[key], online = settings.onlineBookingHours[key];
  if (override?.status !== 'open' && (settings.blackoutDates[date] || !business.open || !online.open)) return [];
  const start = business.openTime > online.openTime ? business.openTime : online.openTime;
  const end = business.closeTime < online.closeTime ? business.closeTime : online.closeTime;
  return start < end ? [{ start, end }] : [];
}

export function fitsDateAvailability(appointment, settings) {
  const interval = getAppointmentInterval(appointment);
  if (!interval || !isValidDateKey(appointment.date)) return false;
  const buffer = settings.appointmentBufferMinutes;
  const fits = getDayAvailableRanges(appointment.date, settings).some((range) => (
    interval.startMinutes >= getTimeMinutes(range.start) && interval.endMinutes + buffer <= getTimeMinutes(range.end)
  ));
  return fits && !(settings.dateOverrides?.[appointment.date]?.blockedRanges || []).some((range) => intervalsOverlap(interval, {
    startMinutes: getTimeMinutes(range.start), endMinutes: getTimeMinutes(range.end),
  }, buffer));
}
