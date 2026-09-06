export const DEFAULT_SALON_TIME_ZONE = 'Asia/Manila';
export const REMINDER_WINDOW_MS = 90 * 60 * 1000;
export const REMINDER_DEFINITIONS = Object.freeze({
  reminder24h: Object.freeze({ hoursBefore: 24, label: '24-hour reminder' }),
  reminder12h: Object.freeze({ hoursBefore: 12, label: '12-hour reminder' }),
});

function parseTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();
  if (period && (hour < 1 || hour > 12)) return null;
  if (!period && (hour < 0 || hour > 23)) return null;
  if (minute < 0 || minute > 59) return null;
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (!period && hour > 0 && hour < 9) hour += 12;

  return { hour, minute };
}

function getTimeZoneOffsetMs(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return representedAsUtc - timestamp;
}

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function parseAppointmentDateTime(dateValue, timeValue, timeZone = DEFAULT_SALON_TIME_ZONE) {
  const dateMatch = String(dateValue || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = parseTime(timeValue);
  if (!dateMatch || !time || !isValidTimeZone(timeZone)) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const utcGuess = Date.UTC(year, month - 1, day, time.hour, time.minute, 0);
  if (
    new Date(utcGuess).getUTCFullYear() !== year
    || new Date(utcGuess).getUTCMonth() !== month - 1
    || new Date(utcGuess).getUTCDate() !== day
  ) return null;

  let appointmentAt = utcGuess - getTimeZoneOffsetMs(utcGuess, timeZone);
  appointmentAt = utcGuess - getTimeZoneOffsetMs(appointmentAt, timeZone);
  return appointmentAt;
}

export function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function humanizeServiceName(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Nail Service';
  return normalized
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bBiab\b/g, 'BIAB');
}

export function getBookingServiceName(booking) {
  return humanizeServiceName(booking?.serviceName || booking?.serviceTitle || booking?.service);
}

export function getReminderEligibility(
  booking,
  reminderType,
  now = Date.now(),
  timeZone = DEFAULT_SALON_TIME_ZONE,
  windowMs = REMINDER_WINDOW_MS
) {
  const definition = REMINDER_DEFINITIONS[reminderType];
  if (!definition) return { eligible: false, reason: 'unknown-reminder' };
  if (String(booking?.status || '').trim().toLowerCase() !== 'confirmed') {
    return { eligible: false, reason: 'not-confirmed' };
  }

  const appointmentAt = parseAppointmentDateTime(booking?.date, booking?.time, timeZone);
  if (!appointmentAt) return { eligible: false, reason: 'invalid-appointment-time' };

  const thresholdMs = definition.hoursBefore * 60 * 60 * 1000;
  const dueAt = appointmentAt - thresholdMs;
  const latestEligibleAt = dueAt + Math.max(0, Number(windowMs) || 0);
  if (now < dueAt) return { eligible: false, reason: 'too-early', appointmentAt, dueAt };
  if (now > latestEligibleAt) return { eligible: false, reason: 'window-missed', appointmentAt, dueAt };

  const confirmedAt = toTimestamp(booking?.confirmedAt || booking?.createdAt);
  if (!confirmedAt) return { eligible: false, reason: 'missing-confirmed-time', appointmentAt, dueAt };
  if (confirmedAt > dueAt) return { eligible: false, reason: 'confirmed-too-late', appointmentAt, dueAt };

  return {
    eligible: true,
    reason: 'due',
    appointmentAt,
    dueAt,
    appointmentKey: `${booking.date}|${booking.time}|${timeZone}`,
    hoursBefore: definition.hoursBefore,
  };
}

export function getReminderClaimDecision(
  reminders,
  reminderType,
  appointmentKey,
  now = Date.now(),
  { lockMs = 10 * 60 * 1000, maxAttempts = 3 } = {}
) {
  const state = reminders && typeof reminders === 'object' ? reminders : {};
  const existing = state[reminderType] && typeof state[reminderType] === 'object'
    ? state[reminderType]
    : {};
  if (existing.status === 'sent' || state[`${reminderType}Sent`] === true) {
    return { claim: false, reason: 'already-sent', existing, sameAppointment: true };
  }

  const sameAppointment = existing.appointmentKey === appointmentKey;
  if (
    sameAppointment
    && existing.status === 'processing'
    && now - Number(existing.lockedAt || 0) < lockMs
  ) {
    return { claim: false, reason: 'already-processing', existing, sameAppointment };
  }

  const previousAttempts = sameAppointment ? Number(existing.attemptCount || 0) : 0;
  if (previousAttempts >= maxAttempts) {
    return { claim: false, reason: 'attempt-limit-reached', existing, sameAppointment, previousAttempts };
  }

  return { claim: true, reason: 'claimable', existing, sameAppointment, previousAttempts };
}

export function formatAppointmentDate(appointmentAt, timeZone = DEFAULT_SALON_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(appointmentAt));
}

export function formatAppointmentTime(appointmentAt, timeZone = DEFAULT_SALON_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(appointmentAt));
}

export function buildAppointmentReminderContent({ booking, profile, reminderType, appointmentAt, timeZone }) {
  const definition = REMINDER_DEFINITIONS[reminderType];
  if (!definition) throw new Error('Unknown appointment reminder type.');

  const serviceName = getBookingServiceName(booking);
  const customerName = String(
    profile?.fullName || profile?.name || booking?.customerName || booking?.name || 'there'
  ).trim().split(/\s+/)[0];
  const date = formatAppointmentDate(appointmentAt, timeZone);
  const time = formatAppointmentTime(appointmentAt, timeZone);
  const nailArtQuantity = Number(booking?.nailArtQuantity || booking?.nailArt?.quantity || 0);
  const hasNailArt = booking?.nailArtEnabled === true || booking?.nailArt?.enabled === true || nailArtQuantity > 0;
  const hasReference = Boolean(booking?.referenceImageUrl || booking?.referencePhotoUrl);
  const isTomorrow = reminderType === 'reminder24h';
  const subject = isTomorrow
    ? 'Reminder: Your Luxe Nails appointment is tomorrow'
    : 'Your Luxe Nails appointment is coming up';
  const intro = isTomorrow
    ? 'Your Luxe Nails appointment is coming up tomorrow.'
    : 'Just a reminder that your Luxe Nails appointment is coming up in approximately 12 hours.';
  const message = isTomorrow
    ? `Your ${serviceName} appointment is tomorrow at ${time}.`
    : `Reminder: Your ${serviceName} appointment is coming up at ${time}.`;

  return {
    subject,
    intro,
    message,
    title: 'Appointment Reminder',
    customerName,
    serviceName,
    date,
    time,
    nailArt: hasNailArt ? `${Math.max(1, nailArtQuantity)} ${Math.max(1, nailArtQuantity) === 1 ? 'nail' : 'nails'}` : 'None',
    referencePhoto: hasReference ? 'Included with your booking' : 'None',
  };
}
