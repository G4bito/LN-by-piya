import { createHash, randomUUID } from 'node:crypto';
import { SERVICES } from './shared/constants/services.js';
import { createServicePricingFields } from './shared/bookingPricing.js';
import { getBookableTimeSlots, hasReachedDailyAppointmentLimit, normalizeBusinessSettings } from './shared/businessSettings.js';
import { createScheduleEntry, getServiceDurationMinutes, hasScheduleConflict, PENDING_SLOT_HOLD_MS } from './shared/scheduling.js';
import { getAffectedAppointments, isValidDateKey, normalizeDateOverride, validateDateOverride } from './shared/availability.js';
import { bookingDiagnostic } from './shared/bookingErrors.js';

export class AvailabilityError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new AvailabilityError(code, message); };
const entries = (value) => Object.entries(value || {}).map(([id, record]) => ({ id, ...record }));
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
async function perform(operation, action) {
  try { return await action(); }
  catch (error) {
    if (error && typeof error === 'object' && !error.bookingOperation) error.bookingOperation = operation;
    throw error;
  }
}

async function optionalOperation(operation, action, log) {
  let timer;
  try {
    await Promise.race([action(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Optional operation timed out.'), { code: 'deadline-exceeded' })), 1500);
    })]);
  } catch (error) {
    try { log(bookingDiagnostic(error, operation)); }
    catch { /* Optional diagnostics cannot reject an already committed appointment. */ }
  }
  finally { clearTimeout(timer); }
}

// Reuses the date mutex used by the existing admin confirmation/reschedule flow.
// The lease exceeds the callable's 30-second timeout; release is token-checked.
async function withDateLock(database, date, ownerUid, action, log) {
  const lockRef = database.ref(`scheduleMutexes/${date}`);
  const token = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const now = Date.now();
    const result = await perform('acquire-date-lock', () => lockRef.transaction((current) => {
      if (current && current.expiresAt > now) return;
      return { ownerUid, token, expiresAt: now + 60000 };
    }, undefined, false));
    if (result.committed) { acquired = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!acquired) fail('aborted', 'This date is being updated. Please try again.');
  try { return await action(); }
  finally {
    // A saved booking remains successful. The token-owned lease expires in 60s.
    await optionalOperation('release-date-lock', () => lockRef.transaction((current) => current === null || current.token === token ? null : undefined, undefined, false), log);
  }
}

function cleanBooking(input, auth, settings) {
  const service = SERVICES.find((item) => item.id === input?.service);
  if (!service || !validId(input?.id) || !isValidDateKey(input?.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input?.time || '')) {
    fail('invalid-argument', 'Choose a valid service, date, and time.');
  }
  if (input.uid && input.uid !== auth.uid) fail('permission-denied', 'You may only book for your own account.');
  const name = String(input.customerName || input.name || '').trim().replace(/\s+/g, ' ');
  const phone = String(input.customerPhone || input.phone || '').replace(/\D/g, '');
  const address = String(input.address || '').trim();
  if (!/^[\p{L}' -]{2,60}$/u.test(name) || !/^\d{10,15}$/.test(phone) || !address || address.length > 500) {
    fail('invalid-argument', 'Enter your name, valid phone number, and address.');
  }
  const email = String(auth.token?.email || '').trim();
  if (!email) fail('failed-precondition', 'Your signed-in account needs an email address.');
  const durationMinutes = getServiceDurationMinutes(service);
  const pricing = createServicePricingFields(service, input.nailQuantity || input.repairNailsCount, input.nailArt, settings);
  const booking = {
    id: input.id, uid: auth.uid, email, customerEmail: email,
    name, customerName: name, phone, customerPhone: phone, address,
    notes: String(input.notes || '').trim().slice(0, 2000),
    service: service.id, ...pricing, durationMinutes, date: input.date, time: input.time,
    status: 'Pending Confirmation', seenByAdmin: false,
  };
  if (settings.allowReferencePhoto) {
    const storagePath = String(input.referenceImageStoragePath || '');
    if (storagePath && !storagePath.startsWith(`booking-references/${auth.uid}/${input.id}/`)) fail('permission-denied', 'Invalid reference photo owner.');
    const url = String(input.referenceImageUrl || '');
    if (url && (!url.startsWith('https://') || url.length > 3000)) fail('invalid-argument', 'Invalid reference photo URL.');
    if (url) booking.referenceImageUrl = url;
    if (storagePath) {
      booking.referenceImageStoragePath = storagePath;
      booking.referenceImageContentType = String(input.referenceImageContentType || '').slice(0, 100);
      booking.referenceImageOriginalFileName = String(input.referenceImageOriginalFileName || '').slice(0, 255);
      booking.referenceImageSize = Math.max(0, Number(input.referenceImageSize) || 0);
    }
  }
  return Object.fromEntries(Object.entries(booking).filter(([, value]) => value !== undefined));
}

export function createBookingAvailabilityService(database, { log = value => console.warn('Booking recovery notice.', value) } = {}) {
  async function notifyAdmin(booking) {
    await optionalOperation('create-admin-notification', async () => {
      const notification = {
        type: 'new_booking', title: 'New Booking', message: `${booking.customerName} booked ${booking.serviceName} on ${booking.date} at ${booking.time}.`,
        read: false, handled: false, createdAt: Date.parse(booking.createdAt), createdBy: booking.uid,
        targetType: 'booking', targetId: booking.id, bookingId: booking.id,
      };
      // Replays repair a missing notification without resetting read/handled state.
      await database.ref(`adminNotifications/${booking.id}`).transaction(current => current || notification, undefined, false);
    }, log);
  }
  return {
    async submitBooking({ auth, data }) {
      if (!auth?.uid) fail('unauthenticated', 'Please sign in before booking.');
      if (!isValidDateKey(data?.date)) fail('invalid-argument', 'Choose a valid date.');
      const profile = (await perform('read-customer-profile', () => database.ref(`users/${auth.uid}`).get())).val();
      if (profile?.status !== 'active') fail('permission-denied', 'An active customer account is required.');
      return withDateLock(database, data.date, auth.uid, async () => {
        const settings = normalizeBusinessSettings((await perform('read-business-settings', () => database.ref('settings/business').get())).val());
        const booking = cleanBooking(data, auth, settings);
        const requestHash = createHash('sha256').update(JSON.stringify({
          uid: auth.uid, date: booking.date, time: booking.time, service: booking.service,
          name: booking.name, phone: booking.phone, address: booking.address, notes: booking.notes,
          nailQuantity: Number(data.nailQuantity || data.repairNailsCount) || 1,
          nailArt: { enabled: data.nailArt?.enabled === true, quantity: Number(data.nailArt?.quantity) || 1 },
        })).digest('hex');
        const bookingRef = database.ref(`bookings/${booking.id}`);
        const existing = (await perform('read-booking-intent', () => bookingRef.get())).val();
        if (existing) {
          if (existing.uid !== auth.uid || existing.reservationRequestHash !== requestHash) fail('already-exists', 'This booking reference was already used.');
          await notifyAdmin(existing);
          return existing;
        }
        const now = new Date();
        if (!getBookableTimeSlots(booking.date, booking.durationMinutes, settings, now).includes(booking.time)) {
          fail('failed-precondition', 'This time is no longer available. Please choose another time.');
        }
        // Date locks cannot protect an intent ID reused across two different dates.
        // Bind each ID once in the existing private namespace before reserving it.
        const intent = await perform('bind-booking-intent', () => database.ref(`serverOnly/bookingIntents/${booking.id}`).transaction((current) => {
          if (current && (current.uid !== auth.uid || current.requestHash !== requestHash)) return;
          return current || { uid: auth.uid, requestHash, date: booking.date };
        }, undefined, false));
        if (!intent.committed) fail('already-exists', 'This booking reference was already used.');
        const legacy = entries((await perform('read-date-bookings', () => database.ref('bookings').orderByChild('date').equalTo(booking.date).get())).val());
        const slotsRef = database.ref(`scheduleSlots/${booking.date}`);
        const hold = createScheduleEntry(booking, 'Pending', now.getTime() + PENDING_SLOT_HOLD_MS);
        const result = await perform('reserve-appointment-slot', () => slotsRef.transaction((current) => {
          const byId = new Map(entries(current).map((entry) => [entry.id, entry]));
          legacy.forEach((entry) => byId.set(entry.id, entry));
          const all = [...byId.values()];
          if (hasReachedDailyAppointmentLimit(all, booking.date, settings, now.getTime(), booking.id)
            || hasScheduleConflict(booking, all, { now: now.getTime(), bufferMinutes: settings.appointmentBufferMinutes })) return;
          return { ...current, [booking.id]: hold };
        }, undefined, false));
        if (!result.committed) fail('already-exists', 'This time has just been reserved. Please choose another time.');
        const timestamp = now.toISOString();
        const saved = { ...booking, startMinutes: hold.startMinutes, endMinutes: hold.endMinutes, reservationRequestHash: requestHash, createdAt: timestamp, updatedAt: timestamp };
        try {
          // The appointment and durable reservation are one atomic critical write.
          await perform('commit-appointment', () => database.ref().update({
            [`bookings/${booking.id}`]: saved,
            [`scheduleSlots/${booking.date}/${booking.id}`]: createScheduleEntry(booking, 'Pending Confirmation'),
          }));
        } catch (error) {
          // A lost response may follow a successful write. Never free a saved booking.
          const committed = (await perform('verify-appointment-commit', () => bookingRef.get())).val();
          if (committed?.uid === auth.uid && committed.reservationRequestHash === requestHash) {
            await notifyAdmin(committed);
            return committed;
          }
          await perform('rollback-provisional-slot', () => slotsRef.child(booking.id).remove());
          throw error;
        }
        await notifyAdmin(saved);
        return saved;
      }, log);
    },

    async saveAvailability({ auth, data }) {
      if (!auth?.uid) fail('unauthenticated', 'Please sign in.');
      const admin = (await database.ref(`admins/${auth.uid}`).get()).val();
      if (!admin || admin.status === 'inactive') fail('permission-denied', 'Only an authorized administrator may change availability.');
      const errors = validateDateOverride(data?.date, data?.override);
      if (errors.length) fail('invalid-argument', errors.join(' '));
      return withDateLock(database, data.date, auth.uid, async () => {
        const [settingsSnapshot, bookingsSnapshot] = await Promise.all([
          database.ref('settings/business').get(), database.ref('bookings').orderByChild('date').equalTo(data.date).get(),
        ]);
        const settings = normalizeBusinessSettings(settingsSnapshot.val());
        const override = normalizeDateOverride(data.override);
        const proposed = { ...settings, dateOverrides: { ...settings.dateOverrides } };
        if (override) proposed.dateOverrides[data.date] = override;
        else delete proposed.dateOverrides[data.date];
        const affectedIds = getAffectedAppointments(data.date, proposed, entries(bookingsSnapshot.val())).map((booking) => booking.id).sort();
        if (affectedIds.length && JSON.stringify(affectedIds) !== JSON.stringify([...(data.acknowledgedAppointmentIds || [])].sort())) {
          return { requiresConfirmation: true, affectedAppointmentIds: affectedIds, affectedCount: affectedIds.length };
        }
        const updatedAt = Date.now();
        const saved = override ? { ...override, updatedAt } : null;
        await database.ref().update({
          [`settings/business/dateOverrides/${data.date}`]: saved,
          'settings/business/updatedAt': new Date(updatedAt).toISOString(),
        });
        return { requiresConfirmation: false, date: data.date, override: saved, affectedCount: affectedIds.length };
      }, log);
    },
  };
}
