import { getBusinessSettingsPatch, BUSINESS_WEEKDAYS } from '../businessSettings';
import { SERVICES } from '../constants/services';

function HoursEditor({ title, field, value, onChange, disabled }) {
  return <details className="adm-settings-disclosure">
    <summary>{title}</summary>
    <div className="adm-compact-hours">
      {BUSINESS_WEEKDAYS.map((day) => {
        const hours = value[day.key];
        return <div className="adm-compact-hours-row" key={day.key}>
          <label className="adm-toggle-field"><input type="checkbox" checked={hours.open} disabled={disabled} onChange={(event) => onChange(field, day.key, 'open', event.target.checked)} /><span>{day.shortLabel}</span></label>
          <label className="adm-field"><span className="adm-sr-only">{title}, {day.label} opens</span><input type="time" aria-label={`${title}, ${day.label} opens`} value={hours.openTime} disabled={disabled || !hours.open} onChange={(event) => onChange(field, day.key, 'openTime', event.target.value)} /></label>
          <label className="adm-field"><span className="adm-sr-only">{title}, {day.label} closes</span><input type="time" aria-label={`${title}, ${day.label} closes`} value={hours.closeTime} disabled={disabled || !hours.open} onChange={(event) => onChange(field, day.key, 'closeTime', event.target.value)} /></label>
        </div>;
      })}
    </div>
  </details>;
}

export default function AdminSettings({ settings, draft, onFieldChange, onHoursChange, onNailArtChange, onSave, saving = false, status = '', loading = false, loadError = '' }) {
  const changes = Object.keys(getBusinessSettingsPatch(settings, draft)).length;
  const disabled = saving || loading || Boolean(loadError);
  const text = (field, label, options = {}) => <label className="adm-field" key={field}><span>{label}</span><input {...options} value={draft[field] ?? ''} disabled={disabled} onChange={(event) => onFieldChange(field, event.target.value)} /></label>;
  const number = (field, label, min, max, step = 1) => text(field, label, { type: 'number', min, max, step });
  const toggle = (field, label, extraDisabled = false) => <label className="adm-toggle-field" key={field}><input type="checkbox" checked={draft[field]} disabled={disabled || extraDisabled} onChange={(event) => onFieldChange(field, event.target.checked)} /><span>{label}</span></label>;

  return <form className="adm-settings-compact" onSubmit={onSave} aria-busy={loading || saving}>
    {loading ? <p role="status">Loading settings…</p> : null}
    {loadError ? <p role="alert" className="adm-availability-error">{loadError} Reload before saving.</p> : null}
    <div className="adm-settings-sections">
      <section className="adm-panel adm-settings-group" aria-labelledby="settings-business-title">
        <h2 id="settings-business-title">Business Information</h2>
        <div className="adm-settings-fields">
          {text('businessName', 'Business name', { maxLength: 100 })}
          {text('phone', 'Contact number', { type: 'tel', maxLength: 40 })}
          {text('email', 'Email', { type: 'email', maxLength: 160 })}
          {text('address', 'Salon address', { maxLength: 300 })}
          {text('facebookUrl', 'Facebook link', { type: 'url', maxLength: 500 })}
          {text('instagramUrl', 'Instagram link', { type: 'url', maxLength: 500 })}
          {text('timezone', 'Business timezone', { maxLength: 80 })}
        </div>
      </section>

      <section className="adm-panel adm-settings-group" aria-labelledby="settings-hours-title">
        <h2 id="settings-hours-title">Regular Hours</h2>
        <HoursEditor title="Weekly business hours" field="businessHours" value={draft.businessHours} onChange={onHoursChange} disabled={disabled} />
        <HoursEditor title="Default online booking hours" field="onlineBookingHours" value={draft.onlineBookingHours} onChange={onHoursChange} disabled={disabled} />
      </section>

      <section className="adm-panel adm-settings-group" aria-labelledby="settings-booking-title">
        <h2 id="settings-booking-title">Booking Preferences</h2>
        <div className="adm-settings-fields">
          {number('bookingInterval', 'Booking interval (minutes)', 5, 240)}
          {number('minimumNoticeHours', 'Minimum notice (hours)', 0, 720, 'any')}
          {number('maximumAdvanceDays', 'Book ahead (days)', 1, 730)}
          {number('appointmentBufferMinutes', 'Appointment buffer (minutes)', 0, 240)}
          {number('maximumAppointmentsPerDay', 'Appointments per day', 1, 100)}
          {toggle('allowSameDayBooking', 'Allow same-day booking')}
        </div>
      </section>

      <section className="adm-panel adm-settings-group" aria-labelledby="settings-policies-title">
        <h2 id="settings-policies-title">Policies &amp; Notifications</h2>
        <details className="adm-settings-disclosure"><summary>Cancellation &amp; rescheduling</summary>
          <div className="adm-settings-fields">
            {toggle('allowCustomerCancellation', 'Allow cancellation requests')}
            {toggle('requireAdminApprovalForCancellation', 'Require admin approval', !draft.allowCustomerCancellation)}
            {number('cancellationDeadlineHours', 'Cancellation notice (hours)', 0, 720, 'any')}
            {toggle('allowCustomerReschedule', 'Allow reschedule requests')}
            {number('rescheduleDeadlineHours', 'Reschedule notice (hours)', 0, 720, 'any')}
          </div>
        </details>
        <details className="adm-settings-disclosure"><summary>Appointment policies</summary>
          <div className="adm-settings-policy-fields">
            {[['cancellationPolicy', 'Cancellation policy'], ['lateArrivalPolicy', 'Late arrival policy'], ['noShowPolicy', 'No-show policy'], ['appointmentPreparationNote', 'Appointment preparation']].map(([field, label]) => <label className="adm-field" key={field}><span>{label}</span><textarea rows="2" maxLength="2000" value={draft[field]} disabled={disabled} onChange={(event) => onFieldChange(field, event.target.value)} /></label>)}
          </div>
        </details>
        <details className="adm-settings-disclosure"><summary>Notifications &amp; reminders</summary>
          <div className="adm-settings-policy-fields">
            {[['bookingConfirmationNotificationEnabled', 'Booking confirmations'], ['reminder24hEnabled', '24-hour reminders'], ['reminder12hEnabled', '12-hour reminders'], ['inAppReminderEnabled', 'In-app reminders'], ['cancellationNotificationEnabled', 'Cancellation notifications'], ['rescheduleNotificationEnabled', 'Reschedule notifications']].map(([field, label]) => toggle(field, label))}
          </div>
        </details>
      </section>
    </div>

    <details className="adm-panel adm-settings-advanced">
      <summary>Advanced Settings <span>Nail Art, reference photos, and salon tagline</span></summary>
      <div className="adm-settings-fields">
        {number('nailArtPricePerNail', 'Nail Art price per nail (₱)', 0, 10000, 'any')}
        {number('maximumNailArtQuantity', 'Maximum Nail Art quantity', 1, 10)}
        {toggle('allowReferencePhoto', 'Allow booking reference photos')}
        {text('tagline', 'Salon tagline', { maxLength: 240 })}
        <fieldset className="adm-settings-eligible"><legend>Nail Art eligible services</legend>{SERVICES.filter((service) => service.nailArtEligible).map((service) => <label className="adm-toggle-field" key={service.id}><input type="checkbox" checked={draft.nailArtEligibleServiceIds.includes(service.id)} disabled={disabled} onChange={(event) => onNailArtChange(service.id, event.target.checked)} /><span>{service.title}</span></label>)}</fieldset>
      </div>
    </details>

    <div className="adm-settings-savebar">
      <div aria-live="polite"><strong>{changes ? `${changes} unsaved change${changes === 1 ? '' : 's'}` : 'All changes saved'}</strong>{status ? <span role="status">{status}</span> : null}</div>
      <button className="adm-btn adm-btn--primary" type="submit" disabled={disabled || !changes}>{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>
  </form>;
}
