import { useEffect, useState } from 'react';
import { listenToSparkBookingState, refreshSparkAvailability, resumeSparkAvailability } from '../firebase';

export default function SparkBookingPublication() {
  const [state, setState] = useState(null), [saving, setSaving] = useState(false), [message, setMessage] = useState(''), [confirmation, setConfirmation] = useState(null);
  useEffect(() => listenToSparkBookingState(setState), []);
  async function publish(ids = [], recover = false) {
    setSaving(true); setMessage('');
    try {
      const result = await (recover ? resumeSparkAvailability : refreshSparkAvailability)(ids);
      if (result.requiresConfirmation) setConfirmation({ ids: result.affectedAppointmentIds, count: result.affectedCount, recover });
      else { setConfirmation(null); setMessage('Availability is ready. Existing appointments were preserved.'); }
    } catch (error) { setMessage(error.message || 'Availability could not be published.'); }
    finally { setSaving(false); }
  }
  const paused = state?.phase === 'publishing' || state?.phase === 'paused';
  return <div className="adm-panel" aria-busy={saving}>
    <div className="adm-panel-head"><div><h3>Online booking availability</h3><p className="adm-panel-subtitle">{state?.phase === 'ready' ? `Ready through ${new Date(state.windowEnds - 86400000).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}. Refresh monthly to extend the booking window.` : 'Online bookings are paused until the schedule is ready.'}</p></div>
      <button type="button" className="adm-btn adm-btn--primary" disabled={saving || !state} onClick={() => publish([], paused)}>{saving ? 'Preparing…' : paused ? 'Review and resume' : state?.phase === 'ready' ? 'Refresh schedule' : 'Prepare schedule'}</button></div>
    {message ? <p role="status">{message}</p> : null}
    {confirmation ? <div role="alert"><p>{confirmation.count} existing appointment(s) fall outside these hours. Their dates, times and statuses will remain unchanged.</p><button type="button" className="adm-btn" disabled={saving} onClick={() => publish(confirmation.ids, confirmation.recover)}>Acknowledge and prepare</button><button type="button" className="adm-btn adm-btn--ghost" disabled={saving} onClick={() => setConfirmation(null)}>Cancel</button></div> : null}
  </div>;
}
