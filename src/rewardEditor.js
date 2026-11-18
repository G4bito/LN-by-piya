import { createLoyaltyProgramPayload } from './loyaltyProgram.js';

export function createRewardDraft(reward = null) {
  return {
    id: reward?.id || '',
    name: reward?.name || '',
    description: reward?.description || '',
    requiredVisits: reward?.requiredVisits ?? '',
    rewardType: reward?.rewardType || 'custom',
    value: reward?.value ?? '',
    active: reward?.active !== false,
    sortOrder: reward?.sortOrder ?? 1,
    createdAt: reward?.createdAt || '',
  };
}

export function rewardDraftFingerprint(draft) {
  return JSON.stringify([
    draft.name, draft.description, String(draft.requiredVisits), draft.rewardType,
    String(draft.value ?? ''), draft.active !== false,
  ]);
}

export function validateRewardDraft(draft, rewards = []) {
  try {
    const id = draft.id || 'new_reward_draft';
    createLoyaltyProgramPayload({
      active: true,
      rewards: [...rewards.filter((reward) => reward.id !== id), { ...draft, id }],
    });
    return '';
  } catch (error) { return error.message; }
}
