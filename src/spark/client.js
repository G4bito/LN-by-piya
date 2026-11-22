import { ref, get, set, update, runTransaction, onValue, query, orderByChild, equalTo } from 'firebase/database';
import { compilePolicy, compileCalendar, initialState, reserve, parseJournal, adminTransition, rebuild, clean, isBlocking, DAY } from './engine.js';
import { createServicePricingFields } from '../../functions/shared/bookingPricing.js';
import { SERVICES } from '../../functions/shared/constants/services.js';
import { getTimeMinutes } from '../../functions/shared/scheduling.js';
import { getDateKeyInTimeZone, getAppointmentTimestamp } from '../../functions/shared/businessSettings.js';
import { getAffectedAppointments } from '../../functions/shared/availability.js';

const value = async (db, path) => (await get(ref(db, path))).val();
const unavailable = () => Object.assign(new Error('Online booking is temporarily unavailable. Please contact the salon or try again later.'), { code: 'booking/unavailable' });
const sorted = (rows) => rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
export async function submitSparkBooking(db, user, payload, photo = '') {
  if (!user?.uid) throw Object.assign(new Error('Please sign in before booking.'), { code: 'booking/unauthenticated' });
  let operation = 'load-spark-policy';
  try {
    const existing = await value(db, `sparkBookingDetails/${payload.id}`);
    if (existing?.uid === user.uid) {
      const committed = parseJournal(await value(db, 'sparkSchedule/journal'))[payload.id];
      if (committed) return { ...existing, ...committed, customerName: existing.name, customerPhone: existing.phone, replayed: true };
    }
    const [control, policy, calendar, raw] = await Promise.all([
      value(db, 'sparkBookingControl'), value(db, 'sparkBookingPolicy'), value(db, `sparkBookingCalendar/${payload.date}`),
      value(db, 'settings/business'),
    ]);
    if (control?.phase !== 'ready' || (control.windowEnds && getAppointmentTimestamp(payload.date, '00:00', 'Asia/Manila') >= control.windowEnds) || !policy || !calendar) throw unavailable();
    const service = SERVICES.find((s) => s.id === payload.service);
    if (!service) throw new Error('Please choose a valid service.');
    const { catalog } = compilePolicy(raw || {});
    const pricing = createServicePricingFields(service, payload.nailQuantity, payload.nailArt, raw || {});
    const details = existing || clean({ id: payload.id, uid: user.uid, service: service.id, date: payload.date, time: payload.time,
      startMinutes: getTimeMinutes(payload.time), durationMinutes: catalog[service.id].durationMinutes,
      basePrice: pricing.basePrice, baseTotal: pricing.baseTotal, totalPrice: pricing.totalPrice, estimatedTotal: pricing.estimatedTotal,
      nailQuantity: pricing.nailQuantity || 1, nailArt: pricing.nailArt, status: 'Draft', createdAt: new Date().toISOString(),
      name: String(payload.name || payload.customerName || '').slice(0, 500), phone: String(payload.phone || payload.customerPhone || '').slice(0, 40),
      address: String(payload.address || '').slice(0, 500), email: user.email || '', notes: String(payload.notes || '').slice(0, 2000), referenceImageUrl: policy.allowPhoto ? photo : '',
    });
    if (details.uid !== user.uid || ['date','time','service'].some((k) => details[k] !== payload[k])
      || details.totalPrice !== pricing.totalPrice || details.nailArt.quantity !== pricing.nailArt.quantity) throw new Error('This booking attempt has changed. Please select your service and time again.');
    operation = 'prepare-private-booking-details';
    if (!existing) await set(ref(db, `sparkBookingDetails/${payload.id}`), details);
    operation = 'commit-atomic-spark-reservation';
    // Prime the transaction cache; rules still revalidate the full transition.
    await get(ref(db, 'sparkSchedule'));
    let conflict;
    const result = await runTransaction(ref(db, 'sparkSchedule'), (state) => {
      try { conflict = null; return reserve(state, details, calendar, policy); }
      catch (error) { conflict = error; return undefined; }
    }, { applyLocally: false });
    if (conflict) throw conflict;
    const saved = parseJournal(result.snapshot.val()?.journal)[payload.id];
    if (!saved) throw unavailable();
    return { ...details, ...saved, customerName: details.name, customerPhone: details.phone, uid: user.uid };
  } catch (error) {
    // Never log payloads, URLs, names, UID, email, or SDK messages containing paths.
    console.error('Booking submission failed.', { operation, code: /^[a-zA-Z0-9_/-]{1,80}$/.test(error?.code || '') ? error.code : 'booking/failed' });
    if (error?.code === 'PERMISSION_DENIED' || error?.code === 'permission-denied') throw Object.assign(new Error('Your booking could not be reserved. Refresh availability and try again, or contact the salon.'), { code: 'booking/permission-denied' });
    throw error;
  }
}

export function mergeBookings(legacy = {}, details = {}, journal = '', metadata = {}) {
  const canonical = parseJournal(journal), all = Object.assign(Object.create(null), legacy);
  for (const [id, detail] of Object.entries(details)) if (canonical[id]) all[id] = detail;
  return sorted(Object.entries(all).map(([id, b]) => ({ ...b, id, ...(canonical[id] || {}), ...(metadata[id] || {}),
    customerName: b.customerName || b.name, customerPhone: b.customerPhone || b.phone, serviceName: b.serviceName || SERVICES.find((s) => s.id === b.service)?.title,
  })));
}
export function listenSparkBookings(db, uid, callback, onError) {
  const values = {}, loaded = new Set();
  const emit = () => { if (loaded.size === 4) callback(mergeBookings(values.legacy, values.details, values.journal, values.metadata)); };
  const owned = (path) => uid ? query(ref(db, path), orderByChild('uid'), equalTo(uid)) : ref(db, path);
  const sources = { legacy: owned('bookings'), details: owned('sparkBookingDetails'), journal: ref(db, 'sparkSchedule/journal'), metadata: uid ? null : ref(db, 'sparkBookingAdmin') };
  // Customer metadata has UID-specific read rules; subscribe to individual records.
  let metadataStops = [];
  const subscribeMetadata = () => {
    metadataStops.forEach((stop) => stop());
    const ids = Object.keys({ ...(values.legacy || {}), ...(values.details || {}) });
    metadataStops = ids.map((id) => onValue(ref(db, `sparkBookingAdmin/${id}`), (s) => { values.metadata = { ...values.metadata, [id]: s.val() || {} }; emit(); }, onError));
  };
  if (uid) { loaded.add('metadata'); values.metadata = {}; }
  const stops = Object.entries(sources).filter(([, source]) => source).map(([key, source]) => onValue(source, (s) => {
    values[key] = s.val() || (key === 'journal' ? '' : {}); loaded.add(key);
    if (uid && (key === 'legacy' || key === 'details')) subscribeMetadata();
    emit();
  }, onError));
  return () => { stops.forEach((stop) => stop()); metadataStops.forEach((stop) => stop()); };
}
export async function readSparkBookings(db, uid) {
  const own = (path) => uid ? query(ref(db, path), orderByChild('uid'), equalTo(uid)) : ref(db, path);
  const [legacy, details, journal] = await Promise.all([get(own('bookings')), get(own('sparkBookingDetails')), get(ref(db, 'sparkSchedule/journal'))]);
  const rows = mergeBookings(legacy.val() || {}, details.val() || {}, journal.val() || '');
  const metadata = await Promise.all(rows.map((b) => value(db, `sparkBookingAdmin/${b.id}`)));
  return rows.map((b, i) => ({ ...b, ...(metadata[i] || {}) }));
}
export function listenSparkSchedule(db, predicate, callback, onError) {
  let journal = '', legacy = '[]', loaded = 0;
  const emit = () => {
    if (loaded !== 3) return;
    const entries = Object.values(parseJournal(journal)).filter((b) => isBlocking(b.status) && predicate(b.date));
    const blocks = JSON.parse(legacy).filter((b) => predicate(b.date)).map((b, i) => ({ ...b, id: `legacy-block-${i}`, status: 'Confirmed' }));
    callback([...entries, ...blocks]);
  };
  const stops = [onValue(ref(db, 'sparkSchedule/journal'), (s) => { journal = s.val() || ''; loaded |= 1; emit(); }, onError),
    onValue(ref(db, 'sparkSchedule/legacyBlocks'), (s) => { legacy = s.val() || '[]'; loaded |= 2; emit(); }, onError)];
  return () => stops.forEach((stop) => stop());
}
export async function changeSparkBooking(db, id, status, move, request) {
  if (request && !/^[A-Za-z0-9_-]{1,180}$/.test(request.id)) throw new Error('This request identifier needs administrator review.');
  if ((await value(db, 'sparkBookingControl'))?.phase !== 'ready') throw new Error('Availability is paused. Finish publishing before changing appointments.');
  const policy = await value(db, 'sparkBookingPolicy');
  const core = await value(db, 'sparkSchedule');
  const booking = parseJournal(core?.journal)[id];
  if (!booking) throw new Error('Refresh the availability schedule before changing this appointment.');
  const calendar = await value(db, `sparkBookingCalendar/${move?.date || booking.date}`);
  let conflict;
  const result = await runTransaction(ref(db, 'sparkSchedule'), (state) => {
    if (!state) return state;
    try {
      conflict = null;
      if (request) {
        const prior = state.journal.split('\n').find((row) => row.startsWith(`D|${request.id}|`));
        if (prior) {
          if (prior.split('|')[2] !== request.decision) throw new Error('This request already has a different decision. Refresh appointments.');
          return undefined;
        }
        if (request.decision === 'Approved' && !['Confirmed', 'Accepted'].includes(parseJournal(state.journal)[id]?.status)) throw new Error('Only a confirmed appointment can be changed.');
      }
      const next = request?.decision === 'Declined' ? { ...state } : adminTransition(state, id, status, move, calendar, policy);
      if (request) next.journal += `D|${request.id}|${request.decision}|${new Date().toISOString()}\n`;
      next.lastEvent = { type: 'admin' };
      return next;
    }
    catch (error) { conflict = error; return undefined; }
  }, { applyLocally: false });
  if (conflict) throw conflict;
  if (!result.committed && !request) throw new Error('The appointment change was not saved. Refresh and retry.');
  // Canonical status/schedule is saved. Optional display metadata may be retried.
  await update(ref(db, `sparkBookingAdmin/${id}`), { seenByAdmin: true, updatedAt: new Date().toISOString() }).catch(() => {});
  return parseJournal(result.snapshot.val().journal)[id];
}

export async function publishSparkAvailability(db, uid, patch = {}, { date, acknowledgedAppointmentIds = [] } = {}) {
  const token = globalThis.crypto.randomUUID();
  const controlRef = ref(db, 'sparkBookingControl');
  await get(controlRef);
  const lock = await runTransaction(controlRef, (current) => current?.phase === 'publishing' ? undefined : { phase: 'publishing', owner: uid, token, startedAt: Date.now() }, { applyLocally: false });
  if (!lock.committed) throw new Error('Availability publishing is already in progress or was interrupted. An administrator must review and resume it.');
  let changed = false;
  try {
    const [raw, core, legacy, oldSlots] = await Promise.all([value(db, 'settings/business'), value(db, 'sparkSchedule'), value(db, 'bookings'), value(db, 'scheduleSlots')]);
    const changes = typeof patch === 'function' ? patch(raw || {}) : patch;
    const updated = { ...(raw || {}), ...changes }, compiled = compilePolicy(updated);
    const records = core ? Object.values(parseJournal(core.journal)) : Object.entries(legacy || {}).map(([id, b]) => ({ ...b, id }));
    const affected = date ? getAffectedAppointments(date, compiled.settings, records) : records.filter((b) => isBlocking(b.status) && getAffectedAppointments(b.date, compiled.settings, [b]).length);
    if (affected.some((b) => !acknowledgedAppointmentIds.includes(b.id))) {
      await runTransaction(controlRef, (current) => current === null ? null : current.token === token ? { phase: core ? 'ready' : 'uninitialized', ...(core ? { windowEnds: core.origin + core.days * DAY } : {}) } : undefined, { applyLocally: false });
      return { requiresConfirmation: true, affectedCount: affected.length, affectedAppointmentIds: affected.map((b) => b.id) };
    }
    let state;
    if (core) {
      const today = getDateKeyInTimeZone(new Date(), 'Asia/Manila');
      state = rebuild({ ...core, origin: getAppointmentTimestamp(today, '00:00', 'Asia/Manila'), days: compiled.settings.maximumAdvanceDays + 32, buffer: compiled.policy.buffer });
    } else {
      const blocks = []; let holdUntil = 0;
      for (const [key, slots] of Object.entries(oldSlots || {})) for (const [id, slot] of Object.entries(slots)) {
        if (String(slot.status).toLowerCase() === 'pending') {
          if (!Number.isFinite(slot.expiresAt)) throw new Error('A legacy reservation has no expiry. Review it before migration.');
          holdUntil = Math.max(holdUntil, slot.expiresAt); continue;
        }
        if (!legacy?.[id] && isBlocking(slot.status)) blocks.push({ date: key, time: slot.time, startMinutes: slot.startMinutes ?? getTimeMinutes(slot.time), durationMinutes: slot.durationMinutes });
      }
      if (holdUntil > Date.now() + DAY) throw new Error('A legacy hold has an unusually long expiry. Review migration.');
      state = initialState(compiled.settings, records, Date.now(), blocks);
      state.legacyHoldUntil = Math.max(0, holdUntil);
    }
    const calendar = compileCalendar(compiled.settings, state.origin, state.days);
    // Phase is frozen before these reads. Scheduling mutations also reject publishing.
    // A single update commits policy, calendar, reservations and settings together.
    changed = true;
    state.publicationToken = token;
    state.lastEvent = { type: 'publish' };
    const settingsUpdates = {};
    for (const [key, entry] of Object.entries(changes)) {
      if (key === 'dateOverrides') {
        for (const dateKey of new Set([...Object.keys(raw?.dateOverrides || {}), ...Object.keys(entry || {})])) {
          if (JSON.stringify(raw?.dateOverrides?.[dateKey]) !== JSON.stringify(entry?.[dateKey])) {
            const override = entry?.[dateKey] ? { ...entry[dateKey], updatedAt: Date.now() } : null;
            settingsUpdates[`settings/business/dateOverrides/${dateKey}`] = override;
            if (override) updated.dateOverrides[dateKey] = override;
          }
        }
      } else settingsUpdates[`settings/business/${key}`] = entry;
    }
    await update(ref(db), { sparkSchedule: state, sparkBookingCalendar: calendar, sparkBookingPolicy: compiled.policy,
      sparkBookingCatalog: compiled.catalog, ...settingsUpdates });
    const released = await runTransaction(controlRef, (current) => current === null ? null : current.token === token ? { phase: 'ready', publishedAt: Date.now(), windowEnds: state.origin + state.days * DAY, holdUntil: state.legacyHoldUntil } : undefined, { applyLocally: false });
    if (!released.committed || released.snapshot.val()?.phase !== 'ready') throw new Error('Publishing needs administrator review before booking can resume.');
    return { override: date ? updated.dateOverrides?.[date] || null : null, publishedUntil: state.origin + state.days * DAY };
  } catch (error) {
    // Once a write may have reached Firebase, stay paused. Never unfreeze uncertain state.
    if (!changed) await runTransaction(controlRef, (current) => current === null ? null : current.token === token ? { phase: 'paused', owner: uid, token } : undefined, { applyLocally: false }).catch(() => {});
    throw error;
  }
}
