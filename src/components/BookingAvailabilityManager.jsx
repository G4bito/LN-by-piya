import { useEffect, useMemo, useRef, useState } from 'react';
import { getDateKeyInTimeZone, normalizeBusinessSettings } from '../businessSettings';
import { getAffectedAppointments, getDateAvailability, isAppointmentWithinAvailability, MAX_AVAILABILITY_RANGES, validateDateOverride } from '../../functions/shared/availability.js';
import { getTimeMinutes } from '../scheduling';
import { getDayAvailableRanges } from '../../functions/shared/dateOverrides.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const emptyDraft = () => ({ status: 'default', availableRanges: [], blockedRanges: [] });
const formatDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const formatTime = (time) => {
  const minutes = getTimeMinutes(time);
  if (minutes === null) return 'Time unavailable';
  const hour = Math.floor(minutes / 60), minute = minutes % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
};

function RangeEditor({ title, ranges, onChange, disabled }) {
  return <fieldset className="adm-availability-ranges" disabled={disabled}>
    <legend>{title}</legend>
    {ranges.length === 0 ? <p className="adm-panel-subtitle">No {title.toLowerCase()} added.</p> : null}
    {ranges.map((range, index) => <div className="adm-availability-range" key={index}>
      <label className="adm-field"><span>Start</span><input type="time" required value={range.start} aria-label={`${title}, range ${index + 1} start`} onChange={(event) => onChange(ranges.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} /></label>
      <label className="adm-field"><span>End</span><input type="time" required value={range.end} aria-label={`${title}, range ${index + 1} end`} onChange={(event) => onChange(ranges.map((item, i) => i === index ? { ...item, end: event.target.value } : item))} /></label>
      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-label={`Remove ${title.toLowerCase()} range ${index + 1}`} onClick={() => onChange(ranges.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <button type="button" className="adm-text-btn" disabled={ranges.length >= MAX_AVAILABILITY_RANGES} onClick={() => onChange([...ranges, { start: '10:00', end: '12:00' }])}>+ Add time range</button>
  </fieldset>;
}

export default function BookingAvailabilityManager({ settings: settingsValue, bookings = [], selectedDate, onDateChange, onSave, onViewAppointment, loading = false, loadError = '' }) {
  const settings = useMemo(() => normalizeBusinessSettings(settingsValue), [settingsValue]);
  const date = selectedDate || getDateKeyInTimeZone(new Date(), settings.timezone);
  const [month, setMonth] = useState(date.slice(0, 7));
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const dialogRef = useRef(null);
  const savedSignature = JSON.stringify(settings.dateOverrides[date] || null);

  useEffect(() => {
    const saved = JSON.parse(savedSignature);
    setDraft(saved ? { ...saved } : emptyDraft());
    setError('');
  }, [date, savedSignature]);
  useEffect(() => { setMonth(date.slice(0, 7)); setMessage(''); }, [date]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (confirmation && !dialogRef.current.open) dialogRef.current.showModal();
    if (!confirmation && dialogRef.current.open) dialogRef.current.close();
  }, [confirmation]);

  const [year, monthNumber] = month.split('-').map(Number);
  const cells = useMemo(() => {
    const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)];
  }, [year, monthNumber, month]);
  const statuses = useMemo(() => Object.fromEntries(cells.filter(Boolean).map((key) => [key, getDateAvailability(key, settings, bookings, now)])), [cells, settings, bookings, now]);
  const override = draft.status === 'default' ? null : draft;
  const errors = validateDateOverride(date, override);
  const proposedSettings = { ...settings, dateOverrides: { ...settings.dateOverrides } };
  if (override) proposedSettings.dateOverrides[date] = override;
  else delete proposedSettings.dateOverrides[date];
  const affected = errors.length ? [] : getAffectedAppointments(date, proposedSettings, bookings);
  const dateBookings = bookings.filter((booking) => booking.date === date).sort((left, right) => getTimeMinutes(left.time) - getTimeMinutes(right.time));
  const baseSettings = { ...settings, dateOverrides: { ...settings.dateOverrides } };
  delete baseSettings.dateOverrides[date];
  const defaultRanges = getDayAvailableRanges(date, baseSettings);
  const disabled = loading || Boolean(loadError) || saving;

  function change(patch) { setDraft((current) => ({ ...current, ...patch })); setError(''); setMessage(''); }
  function changeMonth(offset) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
    setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  async function persist(value, acknowledgedAppointmentIds = []) {
    if (disabled) return;
    const validation = validateDateOverride(date, value);
    if (validation.length) { setError(validation[0]); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await onSave(date, value, acknowledgedAppointmentIds);
      if (result.requiresConfirmation) {
        setConfirmation({ value, ids: result.affectedAppointmentIds, count: result.affectedCount });
      } else {
        setConfirmation(null);
        setDraft(result.override || emptyDraft());
        setMessage(value ? `Availability saved for ${formatDate(date)}.` : `Default hours restored for ${formatDate(date)}.`);
      }
    } catch (saveError) {
      setError(saveError.availabilityOperation
        ? `Availability publishing failed during ${saveError.availabilityOperation} (${saveError.availabilityCode}). Booking stays paused. Review and resume the schedule before retrying.`
        : saveError.message || 'Availability could not be saved. Please try again.');
    }
    finally { setSaving(false); }
  }

  return <section className="adm-panel adm-availability" id="booking-availability" aria-labelledby="booking-availability-title" aria-busy={loading || saving}>
    <div className="adm-panel-head"><div><span className="adm-settings-kicker">Date & time controls</span><h2 id="booking-availability-title">Booking Availability</h2><p className="adm-panel-subtitle">Open a date, set custom hours, or reserve time for yourself.</p></div><small className="adm-availability-timezone">{settings.timezone}</small></div>
    {loading ? <p role="status">Loading availability…</p> : null}
    {loadError ? <p role="alert" className="adm-availability-error">{loadError} Reload to try again.</p> : null}
    <div className="adm-availability-layout">
      <div className="adm-availability-calendar">
        <div className="adm-availability-month"><button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-label="Previous availability month" disabled={saving} onClick={() => changeMonth(-1)}>←</button><h3>{new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3><button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" aria-label="Next availability month" disabled={saving} onClick={() => changeMonth(1)}>→</button></div>
        <div className="adm-availability-weekdays" aria-hidden="true">{WEEKDAYS.map((label) => <span key={label}>{label}</span>)}</div>
        <div className="adm-availability-grid" aria-label="Choose a date to manage">
          {cells.map((key, index) => key ? <button key={key} type="button" className={`adm-availability-date is-${statuses[key].status}${key === date ? ' is-selected' : ''}`} aria-pressed={key === date} aria-label={`${formatDate(key)}: ${statuses[key].label}`} disabled={disabled} onClick={() => onDateChange(key)}><span>{Number(key.slice(-2))}</span><i aria-hidden="true" /></button> : <span key={`empty-${index}`} />)}
        </div>
        <div className="adm-availability-legend">{[['open', 'Open'], ['closed', 'Closed'], ['custom', 'Custom hours'], ['full', 'Fully booked']].map(([key, label]) => <span className={`is-${key}`} key={key}><i aria-hidden="true" />{label}</span>)}</div>
        {Object.keys(settings.blackoutDates).length ? <details className="adm-settings-disclosure adm-availability-closures"><summary>Saved closures ({Object.keys(settings.blackoutDates).length})</summary><p className="adm-panel-subtitle">Select a closure to reopen it or change its hours.</p><ul>{Object.values(settings.blackoutDates).sort((a, b) => a.date.localeCompare(b.date)).map((entry) => <li key={entry.date}><button type="button" disabled={disabled} onClick={() => onDateChange(entry.date)}>{formatDate(entry.date)}<small>{entry.reason || 'Closed'}</small></button></li>)}</ul></details> : null}
      </div>
      <form className="adm-availability-editor" onSubmit={(event) => { event.preventDefault(); persist(override); }}>
        <h3>{formatDate(date)}</h3>
        <p className="adm-panel-subtitle">{dateBookings.length} saved appointment{dateBookings.length === 1 ? '' : 's'} · Normal hours: {defaultRanges.length ? defaultRanges.map((range) => `${formatTime(range.start)}–${formatTime(range.end)}`).join(', ') : 'Closed'}</p>
        <label className="adm-field"><span>Availability for this date</span><select value={draft.status} disabled={disabled} onChange={(event) => change({ status: event.target.value, availableRanges: event.target.value === 'custom' ? draft.availableRanges.length ? draft.availableRanges : [{ start: '10:00', end: '12:00' }] : [] })}><option value="default">Default business hours</option><option value="open">Open with normal hours</option><option value="closed">Closed all day</option><option value="custom">Custom available hours</option></select></label>
        {draft.status === 'custom' ? <RangeEditor title="Available hours" ranges={draft.availableRanges} disabled={disabled} onChange={(availableRanges) => change({ availableRanges })} /> : null}
        {['open', 'custom'].includes(draft.status) ? <RangeEditor title="Blocked hours" ranges={draft.blockedRanges || []} disabled={disabled} onChange={(blockedRanges) => change({ blockedRanges })} /> : null}
        {draft.status === 'closed' ? <p className="adm-availability-note">Customers cannot make new bookings on this date. Saved appointments stay unchanged.</p> : <p className="adm-availability-note">Appointments must fit completely inside available hours. Service length, buffers, notice, and daily limits still apply.</p>}
        {affected.length ? <p className="adm-availability-warning" role="status">{affected.length} existing appointment{affected.length === 1 ? '' : 's'} fall outside these hours. You’ll review this warning before saving.</p> : null}
        {error ? <p role="alert" className="adm-availability-error">{error}</p> : null}
        {message ? <p role="status" className="adm-availability-success">{message}</p> : null}
        <div className="adm-form-actions"><button type="submit" className="adm-btn adm-btn--primary" disabled={disabled}>{saving ? 'Saving…' : 'Save availability'}</button><button type="button" className="adm-btn adm-btn--ghost" disabled={disabled} onClick={() => persist(null)}>Restore defaults</button></div>
        <section className="adm-availability-appointments" aria-label="Appointments on selected date"><h4>Appointments on this date</h4>{dateBookings.length ? <ul>{dateBookings.map((booking) => <li key={booking.id}><div><strong>{booking.customerName || booking.name || 'Client'}</strong><span>{formatTime(booking.time)} · {booking.serviceName || booking.service || 'Appointment'}</span><small>{booking.status}</small>{['Confirmed', 'Accepted', 'Pending Confirmation'].includes(booking.status) && !isAppointmentWithinAvailability(booking, settings) ? <small className="adm-conflict-label">Outside available hours · Review needed</small> : null}</div>{onViewAppointment ? <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onViewAppointment(booking)}>Details</button> : null}</li>)}</ul> : <p className="adm-panel-subtitle">No saved appointments.</p>}</section>
      </form>
    </div>
    <dialog ref={dialogRef} className="adm-availability-dialog" aria-labelledby="availability-confirm-title" onCancel={(event) => { event.preventDefault(); if (!saving) setConfirmation(null); }}>
      <h3 id="availability-confirm-title">Review existing appointments</h3>
      <p>{confirmation?.count} appointment{confirmation?.count === 1 ? '' : 's'} on {formatDate(date)} would fall outside the updated hours. Saved appointments won’t be cancelled, rescheduled, or removed.</p>
      <div className="adm-form-actions"><button type="button" className="adm-btn adm-btn--ghost" disabled={saving} onClick={() => setConfirmation(null)}>Keep editing</button><button type="button" className="adm-btn adm-btn--primary" disabled={saving} onClick={() => persist(confirmation.value, confirmation.ids)}>{saving ? 'Saving…' : 'Save and keep appointments'}</button></div>
      {error ? <p role="alert" className="adm-availability-error">{error}</p> : null}
    </dialog>
  </section>;
}
