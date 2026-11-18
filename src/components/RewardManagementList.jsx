import { Pencil, Plus, Power, Tag } from 'lucide-react';
import { LOYALTY_REWARD_TYPES } from '../loyaltyProgram';
import './RewardManagement.css';

export default function RewardManagementList({ rewards = [], loading = false, saving = false, loadError = '', onAdd, onEdit, onToggle, onInstallSuggested }) {
  return <section className="adm-reward-catalog" aria-labelledby="reward-catalog-title" aria-busy={loading || saving}>
    <div className="adm-reward-toolbar"><h2 id="reward-catalog-title">{loading ? 'Loading rewards…' : `${rewards.length} Reward${rewards.length === 1 ? '' : 's'}`}</h2><button type="button" className="adm-btn adm-btn--primary" onClick={onAdd} disabled={loading || saving || Boolean(loadError)}><Plus size={18} aria-hidden="true" /> Add Reward</button></div>
    {loadError ? <p role="alert" className="adm-reward-form-error">{loadError}</p> : null}
    {!loading && !loadError ? rewards.length ? <div className="adm-reward-cards">{rewards.map((reward) => <article className="adm-reward-card" key={reward.id} aria-label={`${reward.name}, ${reward.requiredVisits} visits`}>
      <div className="adm-reward-card-milestone"><strong>{reward.requiredVisits}</strong><span>{reward.requiredVisits === 1 ? 'Visit' : 'Visits'}</span></div>
      <div className="adm-reward-card-copy"><h3>{reward.name}</h3><p>{reward.description}</p><span className="adm-reward-type-tag"><Tag size={11} aria-hidden="true" />{LOYALTY_REWARD_TYPES.find((type) => type.value === reward.rewardType)?.label || 'Custom Reward'}</span></div>
      <span className={`adm-badge ${reward.active ? 'adm-badge--success' : 'adm-badge--muted'}`}>{reward.active ? 'Active' : 'Inactive'}</span>
      <div className="adm-reward-card-actions"><button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onEdit(reward)} disabled={saving} aria-label={`Edit ${reward.name}`}><Pencil size={14} aria-hidden="true" /> Edit</button><button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => onToggle(reward)} disabled={saving} aria-label={`${reward.active ? 'Deactivate' : 'Activate'} ${reward.name}`}><Power size={14} aria-hidden="true" />{reward.active ? 'Deactivate' : 'Activate'}</button></div>
    </article>)}</div> : <div className="adm-reward-empty"><p>No loyalty rewards are configured yet.</p>{onInstallSuggested ? <button className="adm-btn adm-btn--ghost" type="button" onClick={onInstallSuggested} disabled={saving}>Create Suggested Rewards</button> : null}</div> : null}
  </section>;
}
