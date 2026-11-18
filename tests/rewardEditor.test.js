import test from 'node:test';
import assert from 'node:assert/strict';
import { createRewardDraft, rewardDraftFingerprint, validateRewardDraft } from '../src/rewardEditor.js';
import { DEFAULT_LOYALTY_REWARDS, createLoyaltyProgramPayload, applyLoyaltyRewardClaim, getLoyaltyState } from '../src/loyaltyProgram.js';

const original = { ...DEFAULT_LOYALTY_REWARDS[0], createdAt: '2026-09-01T00:00:00.000Z', sortOrder: 0 };

test('editing preserves the existing ID, creation timestamp, ordering, and value', () => {
  const draft = createRewardDraft(original);
  assert.equal(draft.id, original.id);
  assert.equal(draft.createdAt, original.createdAt);
  assert.equal(draft.sortOrder, 0);
  const discount = createRewardDraft(DEFAULT_LOYALTY_REWARDS[1]);
  assert.equal(discount.value, 10);
});

test('the unchanged draft is clean and changing any editable reward field is dirty', () => {
  const draft = createRewardDraft(original);
  assert.equal(rewardDraftFingerprint(draft), rewardDraftFingerprint({ ...draft, requiredVisits: String(draft.requiredVisits) }));
  for (const [field, value] of [['name', 'New name'], ['description', 'New description'], ['requiredVisits', 6], ['rewardType', 'free_service'], ['value', 20], ['active', false]]) {
    assert.notEqual(rewardDraftFingerprint(draft), rewardDraftFingerprint({ ...draft, [field]: value }), field);
  }
});

test('the editor reuses loyalty validation and allows editing the same milestone', () => {
  const draft = createRewardDraft(original);
  assert.equal(validateRewardDraft(draft, DEFAULT_LOYALTY_REWARDS), '');
  assert.match(validateRewardDraft({ ...draft, requiredVisits: 10 }, DEFAULT_LOYALTY_REWARDS), /already exists/);
  assert.match(validateRewardDraft({ ...draft, requiredVisits: 1.5 }, DEFAULT_LOYALTY_REWARDS), /whole number/);
  assert.match(validateRewardDraft({ ...draft, rewardType: 'percentage_discount', value: 101 }, DEFAULT_LOYALTY_REWARDS), /1 to 100/);
  assert.match(validateRewardDraft({ ...draft, rewardType: 'fixed_discount', value: '' }, DEFAULT_LOYALTY_REWARDS), /positive/);
  assert.match(validateRewardDraft({ ...draft, name: ' ' }, DEFAULT_LOYALTY_REWARDS), /name/);
  assert.match(validateRewardDraft({ ...draft, description: ' ' }, DEFAULT_LOYALTY_REWARDS), /description/);
});

test('creating a draft does not introduce an ID or mutate existing rewards', () => {
  const before = structuredClone(DEFAULT_LOYALTY_REWARDS);
  const draft = createRewardDraft();
  assert.equal(draft.id, '');
  assert.equal(draft.active, true);
  assert.deepEqual(DEFAULT_LOYALTY_REWARDS, before);
});

test('an edited or inactive definition preserves completed visits and historical claim snapshots', () => {
  const program = { active: true, rewards: [original] };
  const claimed = applyLoyaltyRewardClaim({ completedVisits: 5, loyaltyPoints: 5 }, program, {
    rewardId: original.id, claimId: 'claim-original', claimedAt: '2026-09-10T00:00:00.000Z', claimedBy: 'admin',
  });
  assert.equal(claimed.claimed, true);
  const before = structuredClone(claimed.profile);
  const payload = createLoyaltyProgramPayload({ active: true, rewards: [{ ...original, name: 'Renamed reward', requiredVisits: 12, active: false }] }, { updatedBy: 'admin' });
  const state = getLoyaltyState(claimed.profile, 0, payload);
  assert.equal(state.completedVisits, 5);
  assert.equal(state.rewardHistory[0].rewardName, original.name);
  assert.equal(state.rewardHistory[0].claimedAt, '2026-09-10T00:00:00.000Z');
  assert.deepEqual(claimed.profile, before);
});
