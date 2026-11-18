import { useEffect, useId, useRef, useState } from 'react';
import { Gift, Pencil, X } from 'lucide-react';
import { LOYALTY_REWARD_TYPES } from '../loyaltyProgram';
import { rewardDraftFingerprint, validateRewardDraft } from '../rewardEditor';
import './RewardManagement.css';

export default function RewardEditorModal({ draft, rewards, onChange, onSave, onClose, saving = false, error = '' }) {
  const dialogRef = useRef(null);
  const nameRef = useRef(null);
  const keepEditingRef = useRef(null);
  const warningRef = useRef(null);
  const closeTimerRef = useRef(null);
  const initial = useRef(rewardDraftFingerprint(draft));
  const editing = Boolean(draft.id);
  const dirty = initial.current !== rewardDraftFingerprint(draft);
  const [confirmation, setConfirmation] = useState(null);
  const [validationError, setValidationError] = useState('');
  const [closing, setClosing] = useState(false);
  const id = useId();
  const needsValue = ['percentage_discount', 'fixed_discount'].includes(draft.rewardType);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    // Native showModal supplies background inertness, focus containment, and Esc.
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
    dialog.showModal();
    nameRef.current.focus({ preventScroll: true });
    document.body.style.overflow = 'hidden';
    const viewport = window.visualViewport;
    const resize = () => {
      dialog.style.setProperty('--reward-viewport-height', `${viewport?.height || window.innerHeight}px`);
      dialog.style.setProperty('--reward-viewport-bottom', `${viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => {
      clearTimeout(closeTimerRef.current);
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      dialog.close();
      document.body.style.overflow = originalOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (confirmation) {
      warningRef.current?.scrollIntoView({ block: 'nearest' });
      keepEditingRef.current?.focus({ preventScroll: true });
    }
  }, [confirmation]);

  function finishClose() {
    if (saving || closing) return;
    setClosing(true);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    closeTimerRef.current = setTimeout(onClose, reducedMotion ? 0 : 130);
  }
  function requestClose() {
    if (saving || closing) return;
    if (dirty) setConfirmation('discard');
    else finishClose();
  }
  function change(field, value) {
    setValidationError(''); setConfirmation(null);
    onChange(field, value);
  }
  async function submit(event) {
    event.preventDefault();
    if (saving || closing) return;
    const message = validateRewardDraft(draft, rewards);
    if (message) { setValidationError(message); return; }
    if (editing && dirty && confirmation !== 'impact') { setConfirmation('impact'); return; }
    if (await onSave(event)) {
      initial.current = rewardDraftFingerprint(draft);
      finishClose();
    }
  }

  return <dialog ref={dialogRef} className={`adm-reward-dialog${closing ? ' is-closing' : ''}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-subtitle`} onCancel={(event) => { event.preventDefault(); requestClose(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
  }}>
    <form className="adm-reward-modal-form" onSubmit={submit} noValidate>
      <header className="adm-reward-modal-header">
        <div><Gift className="adm-reward-desktop-icon" size={25} strokeWidth={1.6} /><Pencil className="adm-reward-mobile-icon" size={23} strokeWidth={1.6} /><h2 id={`${id}-title`}>{editing ? <><span className="adm-reward-desktop-title">Edit reward milestone</span><span className="adm-reward-mobile-title">Edit Reward</span></> : 'Add Reward'}</h2></div>
        <button className="adm-reward-close" type="button" aria-label="Close reward editor" onClick={requestClose} disabled={saving || closing}><X size={21} /></button>
      </header>
      <div className="adm-reward-modal-body">
        <p id={`${id}-subtitle`} className="adm-reward-modal-subtitle">{editing ? 'Update this milestone without affecting customer claim history.' : 'Create a new milestone for your customers.'}</p>
        <fieldset className="adm-reward-form-grid" disabled={saving || closing}>
          <label className="adm-field adm-reward-name"><span>Reward Name</span><input ref={nameRef} value={draft.name} maxLength={100} minLength={3} required autoComplete="off" onChange={(event) => change('name', event.target.value)} /></label>
          <label className="adm-field adm-reward-visits"><span>Required Visits</span><input type="number" min={1} max={1000} step={1} inputMode="numeric" required value={draft.requiredVisits} onChange={(event) => change('requiredVisits', event.target.value)} /></label>
          <label className="adm-field adm-reward-description"><span>Description</span><textarea rows={3} maxLength={240} minLength={3} required value={draft.description} onChange={(event) => change('description', event.target.value)} /></label>
          <label className="adm-field adm-reward-type"><span>Reward Type</span><select value={draft.rewardType} onChange={(event) => change('rewardType', event.target.value)}>{LOYALTY_REWARD_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          {needsValue ? <label className="adm-field adm-reward-value"><span>{draft.rewardType === 'percentage_discount' ? 'Discount Percentage' : 'Discount Value (₱)'}</span><input type="number" inputMode="decimal" min="0.01" max={draft.rewardType === 'percentage_discount' ? 100 : 1000000} step="any" required value={draft.value} onChange={(event) => change('value', event.target.value)} /></label> : null}
          <label className="adm-field adm-reward-status-field"><span>Status</span><div className={`adm-reward-status-select${draft.active ? ' is-active' : ''}`}><i aria-hidden="true" /><select value={draft.active ? 'active' : 'inactive'} onChange={(event) => change('active', event.target.value === 'active')}><option value="active">Active</option><option value="inactive">Inactive</option></select></div></label>
        </fieldset>
        {validationError || error ? <p className="adm-reward-form-error" role="alert">{validationError || error}</p> : null}
        {confirmation ? <section ref={warningRef} className="adm-reward-form-warning" role="alert"><strong>{confirmation === 'discard' ? 'Discard unsaved changes?' : 'Confirm this reward change'}</strong><p>{confirmation === 'discard' ? 'Your edits have not been saved. Discard them or keep editing.' : 'This may change customer reward details or eligibility. Completed visits and existing earned and claimed reward records will remain unchanged.'}</p></section> : null}
      </div>
      <footer className="adm-reward-modal-footer">
        {confirmation === 'discard' ? <button className="adm-btn adm-btn--primary" type="button" disabled={saving || closing} onClick={finishClose}>Discard Changes</button> : <button className="adm-btn adm-btn--primary" type="submit" disabled={saving || closing}>{saving ? 'Saving…' : confirmation === 'impact' ? 'Confirm & Save' : editing ? <><span className="adm-reward-desktop-title">Save Reward</span><span className="adm-reward-mobile-title">Save</span></> : 'Create Reward'}</button>}
        <button ref={keepEditingRef} className="adm-btn adm-btn--ghost" type="button" disabled={saving || closing} onClick={() => confirmation ? setConfirmation(null) : requestClose()}>{confirmation ? 'Keep Editing' : 'Cancel'}</button>
      </footer>
    </form>
  </dialog>;
}
