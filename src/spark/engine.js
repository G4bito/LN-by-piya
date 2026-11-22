// Spark booking: private immutable details + one atomic, rule-checked schedule.
// The journal contains scheduling metadata only, never customer contact details.
import { SERVICES } from '../../functions/shared/constants/services.js';
import { normalizeBusinessSettings, getDateKeyInTimeZone, addDaysToDateKey, getAppointmentTimestamp } from '../../functions/shared/businessSettings.js';
import { getDayAvailableRanges, fitsDateAvailability } from '../../functions/shared/dateOverrides.js';
import { getTimeMinutes, getServiceDurationMinutes, getAppointmentDurationMinutes, ScheduleConflictError } from '../../functions/shared/scheduling.js';

export const DAY = 86400000;
export const MINUTES = 1440;
export const CAPACITY = 100;
export const MAX_JOURNAL = 4_000_000;
export const isBlocking = (status) => !['completed', 'cancelled', 'canceled', 'declined', 'no show', 'no-show'].includes(String(status).trim().toLowerCase());
export const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const fail = (message) => { throw new ScheduleConflictError(message); };
export const clean = (value) => JSON.parse(JSON.stringify(value));
export function line(booking) {
  const fields = ['B', booking.id, booking.date, booking.time, booking.service, booking.startMinutes, booking.durationMinutes, booking.totalPrice, booking.status, booking.createdAt];
  if (fields.some((v) => v == null || /[|\n\r]/.test(String(v)))) throw new Error('An appointment has unsupported scheduling metadata. Review migration.');
  return `${fields.join('|')}\n`;
}
export function parseJournal(journal = '') {
  const records = Object.create(null);
  for (const row of journal.split('\n')) {
    if (!row) continue;
    const [kind, id, ...f] = row.split('|');
    if (kind === 'B') records[id] = { id, bookingId: id, date: f[0], time: f[1], service: f[2], startMinutes: +f[3], durationMinutes: +f[4], totalPrice: +f[5], estimatedTotal: +f[5], status: f[6], createdAt: f[7], endMinutes: +f[3] + +f[4] };
    if (kind === 'S' && records[id]) Object.assign(records[id], { status: f[0], updatedAt: f[1] });
    if (kind === 'R' && records[id]) Object.assign(records[id], { date: f[0], time: f[1], startMinutes: +f[2], endMinutes: +f[2] + records[id].durationMinutes, updatedAt: f[3] });
  }
  return records;
}
export function compilePolicy(raw = {}) {
  const s = normalizeBusinessSettings(raw);
  if ((raw.timezone && raw.timezone !== 'Asia/Manila') || s.timezone !== 'Asia/Manila') throw new Error('Spark scheduling currently requires the Asia/Manila timezone. Existing settings were preserved.');
  if ((Array.isArray(raw.blackoutDates) && raw.blackoutDates.length) || (raw.blackoutDates && typeof raw.blackoutDates !== 'object')) throw new Error('Legacy blackout dates need administrator review before publishing. Existing dates were preserved.');
  for (const key of ['bookingInterval', 'appointmentBufferMinutes', 'maximumAppointmentsPerDay', 'maximumAdvanceDays']) {
    if ((raw[key] != null && !Number.isInteger(Number(raw[key]))) || !Number.isInteger(s[key])) throw new Error(`${key} must use whole numbers for secure Spark scheduling.`);
  }
  const catalog = Object.fromEntries(SERVICES.map((service) => [service.id, {
    title: service.title, price: service.price, durationMinutes: getServiceDurationMinutes(service), perNail: service.pricingUnit === 'nail',
    nailArt: Boolean(service.nailArtEligible && s.nailArtEligibleServiceIds.includes(service.id)),
  }]));
  return { settings: s, policy: {
    buffer: s.appointmentBufferMinutes, capacity: s.maximumAppointmentsPerDay, notice: s.minimumNoticeHours,
    advance: s.maximumAdvanceDays, sameDay: s.allowSameDayBooking, nailArtPrice: s.nailArtPricePerNail,
    nailArtMaximum: s.maximumNailArtQuantity, allowPhoto: s.allowReferencePhoto,
  }, catalog };
}
export function compileCalendar(settings, origin, days) {
  const result = {};
  const first = getDateKeyInTimeZone(new Date(origin), 'Asia/Manila');
  for (let d = 0; d < days; d++) {
    const date = addDaysToDateKey(first, d), allowed = Array(MINUTES).fill('0'), starts = {}, limits = {};
    for (const range of getDayAvailableRanges(date, settings)) {
      for (let m = getTimeMinutes(range.start); m < getTimeMinutes(range.end); m += settings.bookingInterval) {
        starts[clock(m)] = m;
        limits[clock(m)] = Math.max(limits[clock(m)] || 0, getTimeMinutes(range.end) - m);
      }
    }
    // Claim [start,end+buffer); blocks claim [start,end+buffer) as well.
    for (let m = 0; m < MINUTES; m++) {
      const unbuffered = { ...settings, appointmentBufferMinutes: 0 };
      if (fitsDateAvailability({ date, time: clock(m), startMinutes: m, durationMinutes: 1 }, unbuffered)) allowed[m] = '1';
    }
    const blocked = settings.dateOverrides[date]?.blockedRanges || [];
    for (const range of blocked) {
      for (let m = getTimeMinutes(range.start); m < Math.min(MINUTES, getTimeMinutes(range.end) + settings.appointmentBufferMinutes); m++) allowed[m] = '0';
    }
    result[date] = { dayStart: origin + d * DAY, allowed: allowed.join(''), starts: Object.keys(starts).length ? starts : { closed: -1 }, limits: Object.keys(limits).length ? limits : { closed: 0 } };
  }
  return result;
}
export function initialState(settings, bookings = [], now = Date.now(), legacyBlocks = []) {
  const origin = getAppointmentTimestamp(getDateKeyInTimeZone(new Date(now), 'Asia/Manila'), '00:00', 'Asia/Manila');
  const days = settings.maximumAdvanceDays + 32;
  let journal = '\n';
  for (const booking of bookings) {
    const startMinutes = getTimeMinutes(booking.time), durationMinutes = getAppointmentDurationMinutes(booking);
    if (!booking.date || startMinutes == null || !Number.isInteger(durationMinutes) || durationMinutes < 1 || startMinutes + durationMinutes > MINUTES) throw new Error('An existing appointment needs scheduling review before migration.');
    journal += line({ ...booking, startMinutes, durationMinutes, totalPrice: Number(booking.totalPrice ?? booking.estimatedTotal ?? 0), createdAt: booking.createdAt || new Date(now).toISOString() });
  }
  const state = { version: 1, origin, days, buffer: settings.appointmentBufferMinutes, journal, legacyBlocks: JSON.stringify(legacyBlocks), legacyHoldUntil: 0 };
  return rebuild(state);
}
export function rebuild(state) {
  const occupied = Array(state.days * MINUTES).fill('0'), capacity = Array(state.days * CAPACITY).fill('0');
  const claims = [...Object.values(parseJournal(state.journal)).filter((b) => isBlocking(b.status)), ...JSON.parse(state.legacyBlocks || '[]')];
  for (const b of claims) {
    const day = (getAppointmentTimestamp(b.date, '00:00', 'Asia/Manila') - state.origin) / DAY;
    if (day < 0 || day >= state.days) continue;
    const start = b.startMinutes ?? getTimeMinutes(b.time), duration = b.durationMinutes;
    if (!Number.isInteger(start) || !Number.isInteger(duration) || start < 0 || start + duration > MINUTES) throw new Error('An existing reservation needs review.');
    for (let m = start; m < Math.min(MINUTES, start + duration + state.buffer); m++) occupied[day * MINUTES + m] = '1';
    const index = capacity.indexOf('0', day * CAPACITY);
    if (index >= 0 && index < (day + 1) * CAPACITY) capacity[index] = '1';
  }
  return { ...state, occupied: occupied.join(''), capacity: capacity.join(''), lastEvent: { type: 'admin' }, proof: { admin: true } };
}
export function reserve(state, details, calendar, policy, now = Date.now()) {
  if (!state) return state; // A cold SDK transaction must retry after its server read.
  if (parseJournal(state.journal)[details.id]) return; // Caller handles an idempotent replay.
  if (state.journal.length > MAX_JOURNAL - 1000) throw Object.assign(new Error('Booking maintenance is required. Please contact the salon.'), { code: 'booking/maintenance' });
  const start = details.startMinutes, length = details.durationMinutes + state.buffer;
  const day = (calendar.dayStart - state.origin) / DAY, offset = day * MINUTES + start;
  const today = now - ((now + 28800000) % DAY);
  if (calendar.dayStart < today || calendar.dayStart > today + policy.advance * DAY || (!policy.sameDay && calendar.dayStart === today)
    || calendar.dayStart + start * 60000 < now + policy.notice * 3600000 || now < state.legacyHoldUntil
    || day < 0 || day >= state.days || calendar.starts[details.time] !== start || length > calendar.limits[details.time] || start + length > MINUTES
    || !/^1+$/.test(calendar.allowed.slice(start, start + length)) || !/^0+$/.test(state.occupied.slice(offset, offset + length))) fail('This time is no longer available. Please choose another time.');
  const token = state.capacity.indexOf('0', day * CAPACITY);
  if (token < 0 || token >= day * CAPACITY + policy.capacity) fail('This date is fully booked. Please choose another date.');
  const event = { type: 'book', id: details.id, date: details.date, time: details.time, service: details.service,
    start, duration: details.durationMinutes, price: details.totalPrice, token, createdAt: details.createdAt, committedAt: now };
  const proof = {
    before: state.occupied.slice(0, offset), free: '0'.repeat(length), claim: '1'.repeat(length), after: state.occupied.slice(offset + length),
    capacityBefore: state.capacity.slice(0, token), capacityAfter: state.capacity.slice(token + 1),
    availableBefore: calendar.allowed.slice(0, start), availableAfter: calendar.allowed.slice(start + length),
  };
  return { ...state, journal: state.journal + line({ ...details, status: 'Pending Confirmation' }), lastEvent: event, proof,
    occupied: proof.before + proof.claim + proof.after, capacity: proof.capacityBefore + '1' + proof.capacityAfter };
}
export function adminTransition(state, id, status, move, calendar, policy, now = Date.now()) {
  const records = parseJournal(state.journal), booking = records[id];
  if (!booking) throw new Error('The selected appointment is not in the canonical schedule. Refresh availability first.');
  const candidate = { ...booking, ...(move || {}), status: status || booking.status };
  if (move) candidate.startMinutes = getTimeMinutes(move.time);
  if (isBlocking(candidate.status) && (move || !isBlocking(booking.status) || (['Confirmed', 'Accepted'].includes(status) && !['Confirmed', 'Accepted'].includes(booking.status)))) {
    const without = rebuild({ ...state, journal: state.journal + `S|${id}|Cancelled|${new Date(now).toISOString()}\n` });
    // Temporarily remove the old ID only for validation. The real journal remains append-only.
    const fakeId = `validation_${now}_${id}`, details = { ...candidate, id: fakeId };
    if (!reserve(without, details, calendar, { ...policy, notice: 0, sameDay: true }, now)) throw new Error('Appointment validation must be retried.');
  }
  let journal = state.journal;
  const timestamp = new Date(now).toISOString();
  if (move) journal += `R|${id}|${move.date}|${move.time}|${candidate.startMinutes}|${timestamp}\n`;
  if (status) journal += `S|${id}|${status}|${timestamp}\n`;
  return rebuild({ ...state, journal });
}
