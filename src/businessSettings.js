import { getTimeMinutes } from './scheduling.js';

export const BUSINESS_WEEKDAYS = Object.freeze([
  Object.freeze({ key: 'monday', label: 'Monday', shortLabel: 'Mon', dayIndex: 1 }),
  Object.freeze({ key: 'tuesday', label: 'Tuesday', shortLabel: 'Tue', dayIndex: 2 }),
  Object.freeze({ key: 'wednesday', label: 'Wednesday', shortLabel: 'Wed', dayIndex: 3 }),
  Object.freeze({ key: 'thursday', label: 'Thursday', shortLabel: 'Thu', dayIndex: 4 }),
  Object.freeze({ key: 'friday', label: 'Friday', shortLabel: 'Fri', dayIndex: 5 }),
  Object.freeze({ key: 'saturday', label: 'Saturday', shortLabel: 'Sat', dayIndex: 6 }),
  Object.freeze({ key: 'sunday', label: 'Sunday', shortLabel: 'Sun', dayIndex: 0 }),
]);

const DEFAULT_WEEKLY_HOURS = Object.freeze(Object.fromEntries(BUSINESS_WEEKDAYS.map((day) => [
  day.key,
  Object.freeze({ open: day.key !== 'sunday', openTime: '09:00', closeTime: day.key === 'saturday' ? '17:00' : '18:00' }),
])));

const DEFAULT_ONLINE_HOURS = Object.freeze(Object.fromEntries(BUSINESS_WEEKDAYS.map((day) => [
  day.key,
  Object.freeze({ open: day.key !== 'sunday', openTime: '09:00', closeTime: '16:00' }),
])));

export const DEFAULT_NAIL_ART_ELIGIBLE_SERVICE_IDS = Object.freeze([
  'gel-manicure',
  'biab-structured-gel',
  'soft-gel-extensions',
]);

export const DEFAULT_BUSINESS_SETTINGS = Object.freeze({
  businessName: 'Luxe Nails by Piya',
  phone: '',
  email: '',
  address: '',
  facebookUrl: '',
  instagramUrl: '',
  tagline: '',
  timezone: 'Asia/Manila',
  businessHours: DEFAULT_WEEKLY_HOURS,
  onlineBookingHours: DEFAULT_ONLINE_HOURS,
  blackoutDates: Object.freeze({}),
  bookingInterval: 30,
  minimumNoticeHours: 2,
  maximumAdvanceDays: 60,
  allowSameDayBooking: true,
  appointmentBufferMinutes: 0,
  maximumAppointmentsPerDay: 8,
  allowCustomerCancellation: false,
  requireAdminApprovalForCancellation: true,
  cancellationDeadlineHours: 12,
  allowCustomerReschedule: false,
  rescheduleDeadlineHours: 12,
  nailArtPricePerNail: 49,
  maximumNailArtQuantity: 10,
  nailArtEligibleServiceIds: DEFAULT_NAIL_ART_ELIGIBLE_SERVICE_IDS,
  allowReferencePhoto: true,
  cancellationPolicy: '',
  lateArrivalPolicy: '',
  noShowPolicy: '',
  appointmentPreparationNote: '',
  reminder24hEnabled: true,
  reminder12hEnabled: true,
  inAppReminderEnabled: true,
  bookingConfirmationNotificationEnabled: true,
  cancellationNotificationEnabled: true,
  rescheduleNotificationEnabled: true,
});

export const BUSINESS_SETTINGS_FIELDS = Object.freeze([
  'businessName', 'phone', 'email', 'address', 'facebookUrl', 'instagramUrl', 'tagline', 'timezone',
  'businessHours', 'onlineBookingHours', 'blackoutDates', 'bookingInterval', 'minimumNoticeHours',
  'maximumAdvanceDays', 'allowSameDayBooking', 'appointmentBufferMinutes', 'maximumAppointmentsPerDay',
  'allowCustomerCancellation', 'requireAdminApprovalForCancellation', 'cancellationDeadlineHours', 'allowCustomerReschedule',
  'rescheduleDeadlineHours', 'nailArtPricePerNail', 'maximumNailArtQuantity',
  'nailArtEligibleServiceIds', 'allowReferencePhoto', 'cancellationPolicy', 'lateArrivalPolicy',
  'noShowPolicy', 'appointmentPreparationNote', 'reminder24hEnabled', 'reminder12hEnabled',
  'inAppReminderEnabled', 'bookingConfirmationNotificationEnabled', 'cancellationNotificationEnabled',
  'rescheduleNotificationEnabled',
]);

function toBoundedNumber(value, fallback, minimum, maximum, integer = true) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) return fallback;
  return integer ? Math.round(number) : number;
}

function normalizeTime(value, fallback) {
  const time = String(value || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallback;
}

function normalizeWeeklyHours(value, fallback) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(BUSINESS_WEEKDAYS.map((day) => {
    const fallbackDay = fallback[day.key];
    const incoming = source[day.key] && typeof source[day.key] === 'object' ? source[day.key] : {};
    return [day.key, {
      open: incoming.open == null ? fallbackDay.open : incoming.open === true,
      openTime: normalizeTime(incoming.openTime, fallbackDay.openTime),
      closeTime: normalizeTime(incoming.closeTime, fallbackDay.closeTime),
    }];
  }));
}

function normalizeBlackoutDates(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(source).flatMap(([key, entry]) => {
    const date = String(entry?.date || key).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    return [[date, { date, reason: String(entry?.reason || '').trim().slice(0, 120) }]];
  }));
}

function normalizeServiceIds(value) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, item]) => item === true ? [key] : [item])
      : DEFAULT_NAIL_ART_ELIGIBLE_SERVICE_IDS;
  const normalized = [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
  return normalized.length ? normalized : [...DEFAULT_NAIL_ART_ELIGIBLE_SERVICE_IDS];
}

export function getBusinessSettingsPatch(currentValue, draftValue) {
  const current = normalizeBusinessSettings(currentValue);
  const draft = normalizeBusinessSettings(draftValue);
  return Object.fromEntries(BUSINESS_SETTINGS_FIELDS.flatMap((field) => (
    JSON.stringify(current[field]) === JSON.stringify(draft[field]) ? [] : [[field, draft[field]]]
  )));
}

export function normalizeBusinessSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const structuredBusinessHours = source.businessHours && typeof source.businessHours === 'object';
  return {
    ...DEFAULT_BUSINESS_SETTINGS,
    businessName: String(source.businessName ?? DEFAULT_BUSINESS_SETTINGS.businessName).trim().slice(0, 100),
    phone: String(source.phone || '').trim().slice(0, 40),
    email: String(source.email || '').trim().slice(0, 160),
    address: String(source.address || '').trim().slice(0, 300),
    facebookUrl: String(source.facebookUrl || '').trim().slice(0, 500),
    instagramUrl: String(source.instagramUrl || '').trim().slice(0, 500),
    tagline: String(source.tagline || source.description || '').trim().slice(0, 240),
    timezone: String(source.timezone || DEFAULT_BUSINESS_SETTINGS.timezone).trim().slice(0, 80),
    businessHours: normalizeWeeklyHours(source.businessHours, DEFAULT_WEEKLY_HOURS),
    businessHoursConfigured: structuredBusinessHours,
    legacyBusinessHoursText: typeof source.businessHours === 'string' ? source.businessHours.trim().slice(0, 500) : '',
    onlineBookingHours: normalizeWeeklyHours(source.onlineBookingHours, DEFAULT_ONLINE_HOURS),
    blackoutDates: normalizeBlackoutDates(source.blackoutDates),
    bookingInterval: toBoundedNumber(source.bookingInterval, DEFAULT_BUSINESS_SETTINGS.bookingInterval, 5, 240),
    minimumNoticeHours: toBoundedNumber(source.minimumNoticeHours, DEFAULT_BUSINESS_SETTINGS.minimumNoticeHours, 0, 720, false),
    maximumAdvanceDays: toBoundedNumber(source.maximumAdvanceDays, DEFAULT_BUSINESS_SETTINGS.maximumAdvanceDays, 1, 730),
    allowSameDayBooking: source.allowSameDayBooking !== false,
    appointmentBufferMinutes: toBoundedNumber(source.appointmentBufferMinutes, DEFAULT_BUSINESS_SETTINGS.appointmentBufferMinutes, 0, 240),
    maximumAppointmentsPerDay: toBoundedNumber(source.maximumAppointmentsPerDay, DEFAULT_BUSINESS_SETTINGS.maximumAppointmentsPerDay, 1, 100),
    allowCustomerCancellation: source.allowCustomerCancellation === true,
    requireAdminApprovalForCancellation: source.requireAdminApprovalForCancellation !== false,
    cancellationDeadlineHours: toBoundedNumber(source.cancellationDeadlineHours, DEFAULT_BUSINESS_SETTINGS.cancellationDeadlineHours, 0, 720, false),
    allowCustomerReschedule: source.allowCustomerReschedule === true,
    rescheduleDeadlineHours: toBoundedNumber(source.rescheduleDeadlineHours, DEFAULT_BUSINESS_SETTINGS.rescheduleDeadlineHours, 0, 720, false),
    nailArtPricePerNail: toBoundedNumber(source.nailArtPricePerNail, DEFAULT_BUSINESS_SETTINGS.nailArtPricePerNail, 0, 10000, false),
    maximumNailArtQuantity: toBoundedNumber(source.maximumNailArtQuantity, DEFAULT_BUSINESS_SETTINGS.maximumNailArtQuantity, 1, 10),
    nailArtEligibleServiceIds: normalizeServiceIds(source.nailArtEligibleServiceIds),
    allowReferencePhoto: source.allowReferencePhoto !== false,
    cancellationPolicy: String(source.cancellationPolicy || '').trim().slice(0, 2000),
    lateArrivalPolicy: String(source.lateArrivalPolicy || '').trim().slice(0, 2000),
    noShowPolicy: String(source.noShowPolicy || '').trim().slice(0, 2000),
    appointmentPreparationNote: String(source.appointmentPreparationNote || '').trim().slice(0, 2000),
    reminder24hEnabled: source.reminder24hEnabled !== false,
    reminder12hEnabled: source.reminder12hEnabled !== false,
    inAppReminderEnabled: source.inAppReminderEnabled !== false,
    bookingConfirmationNotificationEnabled: source.bookingConfirmationNotificationEnabled !== false,
    cancellationNotificationEnabled: source.cancellationNotificationEnabled !== false,
    rescheduleNotificationEnabled: source.rescheduleNotificationEnabled !== false,
    updatedAt: String(source.updatedAt || ''),
  };
}

export function validateBusinessSettingsPatch(patch = {}) {
  const errors = [];
  const urlFields = [['facebookUrl', 'Facebook URL'], ['instagramUrl', 'Instagram URL']];
  urlFields.forEach(([key, label]) => {
    const value = String(patch[key] || '').trim();
    if (!value) return;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    } catch {
      errors.push(`${label} must be a valid http or https URL.`);
    }
  });
  if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(patch.email).trim())) {
    errors.push('Business email must be valid.');
  }
  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone }).format(new Date());
    } catch {
      errors.push('Business timezone must be a valid IANA timezone, such as Asia/Manila.');
    }
  }
  const numericFields = [
    ['bookingInterval', 5, 240, 'Booking interval'],
    ['minimumNoticeHours', 0, 720, 'Minimum booking notice'],
    ['maximumAdvanceDays', 1, 730, 'Maximum advance booking'],
    ['appointmentBufferMinutes', 0, 240, 'Appointment buffer'],
    ['maximumAppointmentsPerDay', 1, 100, 'Maximum appointments per day'],
    ['cancellationDeadlineHours', 0, 720, 'Cancellation deadline'],
    ['rescheduleDeadlineHours', 0, 720, 'Reschedule deadline'],
    ['nailArtPricePerNail', 0, 10000, 'Nail Art price'],
    ['maximumNailArtQuantity', 1, 10, 'Maximum Nail Art quantity'],
  ];
  numericFields.forEach(([key, minimum, maximum, label]) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      errors.push(`${label} must be between ${minimum} and ${maximum}.`);
    }
  });
  ['businessHours', 'onlineBookingHours'].forEach((field) => {
    if (!patch[field]) return;
    BUSINESS_WEEKDAYS.forEach((day) => {
      const hours = patch[field][day.key];
      if (!hours?.open) return;
      if (getTimeMinutes(hours.openTime) == null || getTimeMinutes(hours.closeTime) == null) {
        errors.push(`${day.label} has an invalid time.`);
      } else if (getTimeMinutes(hours.closeTime) <= getTimeMinutes(hours.openTime)) {
        errors.push(`${day.label} closing time must be after opening time.`);
      }
    });
  });
  return errors;
}

export function getWeekdayForDateKey(dateKey) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return BUSINESS_WEEKDAYS.find((day) => day.dayIndex === date.getDay()) || null;
}

export function getDateKeyInTimeZone(value = new Date(), timeZone = 'Asia/Manila') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return getDateKeyInTimeZone(date, 'Asia/Manila');
  }
}

export function addDaysToDateKey(dateKey, days) {
  const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getTimeZoneOffsetMs(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second')) - timestamp;
}

export function getAppointmentTimestamp(dateKey, timeValue, timeZone = 'Asia/Manila') {
  const dateMatch = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const minutes = getTimeMinutes(timeValue);
  if (!dateMatch || minutes == null) return null;
  const utcGuess = Date.UTC(
    Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
    Math.floor(minutes / 60), minutes % 60,
  );
  try {
    let timestamp = utcGuess - getTimeZoneOffsetMs(utcGuess, timeZone);
    timestamp = utcGuess - getTimeZoneOffsetMs(timestamp, timeZone);
    return timestamp;
  } catch {
    return getAppointmentTimestamp(dateKey, timeValue, 'Asia/Manila');
  }
}

export function getBookingDateRestriction(dateKey, settingsValue, now = new Date()) {
  const settings = normalizeBusinessSettings(settingsValue);
  const weekday = getWeekdayForDateKey(dateKey);
  if (!weekday) return 'Invalid date';
  const todayKey = getDateKeyInTimeZone(now, settings.timezone);
  if (dateKey < todayKey) return 'Past date';
  if (!settings.allowSameDayBooking && dateKey === todayKey) return 'Same-day booking unavailable';
  if (dateKey > addDaysToDateKey(todayKey, settings.maximumAdvanceDays)) return 'Outside booking window';
  if (settings.blackoutDates[dateKey]) return settings.blackoutDates[dateKey].reason || 'Closed';
  if (!settings.businessHours[weekday.key]?.open || !settings.onlineBookingHours[weekday.key]?.open) return 'Closed';
  return '';
}

export function getBookableTimeSlots(dateKey, serviceDurationMinutes, settingsValue, now = new Date()) {
  const settings = normalizeBusinessSettings(settingsValue);
  if (getBookingDateRestriction(dateKey, settings, now)) return [];
  const weekday = getWeekdayForDateKey(dateKey);
  const businessHours = settings.businessHours[weekday.key];
  const onlineHours = settings.onlineBookingHours[weekday.key];
  const start = Math.max(getTimeMinutes(businessHours.openTime), getTimeMinutes(onlineHours.openTime));
  const close = Math.min(getTimeMinutes(businessHours.closeTime), getTimeMinutes(onlineHours.closeTime));
  const duration = Math.max(1, Number(serviceDurationMinutes) || 60);
  const interval = settings.bookingInterval;
  const minimumTimestamp = now.getTime() + settings.minimumNoticeHours * 60 * 60 * 1000;
  const slots = [];
  for (let minutes = start; minutes + duration <= close; minutes += interval) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const timestamp = getAppointmentTimestamp(dateKey, value, settings.timezone);
    if (timestamp != null && timestamp >= minimumTimestamp) slots.push(value);
  }
  return slots;
}

export function groupBookingTimeSlots(slots = []) {
  const groups = [
    { label: 'Morning', slots: [] },
    { label: 'Afternoon', slots: [] },
    { label: 'Evening', slots: [] },
  ];
  slots.forEach((slot) => {
    const minutes = getTimeMinutes(slot);
    if (minutes == null) return;
    const group = minutes < 12 * 60 ? groups[0] : minutes < 17 * 60 ? groups[1] : groups[2];
    group.slots.push(slot);
  });
  return groups.filter((group) => group.slots.length);
}

export function hasReachedDailyAppointmentLimit(entries = [], dateKey, settingsValue, now = Date.now(), excludeBookingId = '') {
  const settings = normalizeBusinessSettings(settingsValue);
  const activeCount = entries.filter((entry) => {
    if (entry?.date !== dateKey) return false;
    if (excludeBookingId && (entry?.bookingId || entry?.id) === excludeBookingId) return false;
    const status = String(entry?.status || '').toLowerCase();
    return status === 'confirmed' || (status === 'pending' && Number(entry.expiresAt) > now);
  }).length;
  return activeCount >= settings.maximumAppointmentsPerDay;
}

export function formatWeeklyBusinessHours(hoursValue) {
  const hours = normalizeWeeklyHours(hoursValue, DEFAULT_WEEKLY_HOURS);
  const rows = BUSINESS_WEEKDAYS.map((day) => {
    const dayHours = hours[day.key];
    return {
      day,
      signature: dayHours.open ? `${dayHours.openTime}-${dayHours.closeTime}` : 'closed',
      value: dayHours.open ? `${formatClockTime(dayHours.openTime)} – ${formatClockTime(dayHours.closeTime)}` : 'Closed',
    };
  });
  const groups = [];
  rows.forEach((row) => {
    const previous = groups.at(-1);
    if (previous?.signature === row.signature) {
      previous.end = row.day;
    } else {
      groups.push({ start: row.day, end: row.day, signature: row.signature, value: row.value });
    }
  });
  return groups.map((group) => ({
    label: group.start.key === group.end.key ? group.start.label : `${group.start.shortLabel} – ${group.end.shortLabel}`,
    value: group.value,
  }));
}

export function formatClockTime(value) {
  const minutes = getTimeMinutes(value);
  if (minutes == null) return String(value || '');
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function canManageAppointmentOnline(booking, action, settingsValue, now = new Date()) {
  const settings = normalizeBusinessSettings(settingsValue);
  const status = String(booking?.status || '').trim().toLowerCase();
  if (status !== 'confirmed') return { allowed: false, reason: 'Only confirmed appointments can be changed online.' };
  const isCancellation = action === 'cancel';
  const enabled = isCancellation ? settings.allowCustomerCancellation : settings.allowCustomerReschedule;
  if (!enabled) return { allowed: false, reason: `${isCancellation ? 'Cancellation' : 'Rescheduling'} is not available online.` };
  const deadlineHours = isCancellation ? settings.cancellationDeadlineHours : settings.rescheduleDeadlineHours;
  const appointmentAt = getAppointmentTimestamp(booking.date, booking.time, settings.timezone);
  if (appointmentAt == null) return { allowed: false, reason: 'The appointment time could not be verified.' };
  if (appointmentAt - now.getTime() < deadlineHours * 60 * 60 * 1000) {
    return {
      allowed: false,
      reason: isCancellation
        ? 'Online cancellation requests are no longer available for this appointment. Please contact the salon directly.'
        : 'This appointment can no longer be rescheduled online.',
    };
  }
  return { allowed: true, reason: '' };
}
