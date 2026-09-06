import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOYALTY_PROGRAM,
  DEFAULT_LOYALTY_REWARDS,
  applyLoyaltyRewardClaim,
  createLoyaltyProgramPayload,
  getLoyaltyState,
  normalizeLoyaltyProgram,
} from '../src/loyaltyProgram.js';

const claimedAt = '2026-09-05T10:00:00.000Z';

test('missing loyalty configuration produces a clean inactive state', () => {
  const program = normalizeLoyaltyProgram(null);
  const state = getLoyaltyState({ loyaltyPoints: 4, completedVisits: 4 }, 4, program);

  assert.equal(program.configured, false);
  assert.equal(program.active, false);
  assert.deepEqual(program.rewards, []);
  assert.equal(state.status, 'inactive');
  assert.deepEqual(state.milestones, []);
});

test('multiple rewards are validated, normalized, and sorted for Firebase', () => {
  const payload = createLoyaltyProgramPayload({
    active: true,
    rewards: [
      { ...DEFAULT_LOYALTY_REWARDS[1], requiredVisits: '10' },
      { ...DEFAULT_LOYALTY_REWARDS[0], requiredVisits: '5' },
    ],
  }, {
    updatedAt: claimedAt,
    updatedBy: 'admin-1',
  });
  const program = normalizeLoyaltyProgram(payload);

  assert.equal(payload.rewards.reward_free_simple_nail_art.requiredVisits, 5);
  assert.equal(payload.rewards.reward_ten_percent_off.value, 10);
  assert.deepEqual(program.activeRewards.map((reward) => reward.requiredVisits), [5, 10]);
  assert.equal(program.configured, true);
  assert.throws(() => createLoyaltyProgramPayload({
    rewards: [
      { ...DEFAULT_LOYALTY_REWARDS[0], id: 'one', requiredVisits: 5 },
      { ...DEFAULT_LOYALTY_REWARDS[1], id: 'two', requiredVisits: 5 },
    ],
  }), /already exists at the 5-visit milestone/i);
});

test('two visits leave every default milestone locked with clear remaining visits', () => {
  const state = getLoyaltyState({}, 2, DEFAULT_LOYALTY_PROGRAM);

  assert.equal(state.completedVisits, 2);
  assert.deepEqual(state.milestones.map((reward) => reward.status), ['locked', 'locked', 'locked', 'locked']);
  assert.deepEqual(state.milestones.map((reward) => reward.remainingVisits), [3, 8, 13, 18]);
  assert.equal(state.nextReward.id, 'reward_free_simple_nail_art');
});

test('five lifetime visits unlock only the five-visit reward', () => {
  const state = getLoyaltyState({ completedVisits: 5, loyaltyPoints: 5 }, 0, DEFAULT_LOYALTY_PROGRAM);

  assert.deepEqual(state.milestones.map((reward) => reward.status), ['available', 'locked', 'locked', 'locked']);
  assert.equal(state.availableRewards, 1);
  assert.equal(state.unlockedRewards, 1);
  assert.equal(state.nextReward.requiredVisits, 10);
});

test('claiming a milestone preserves lifetime visits and legacy points', () => {
  const result = applyLoyaltyRewardClaim(
    { completedVisits: 5, loyaltyPoints: 5 },
    DEFAULT_LOYALTY_PROGRAM,
    {
      rewardId: 'reward_free_simple_nail_art',
      claimId: 'claim-1',
      claimedAt,
      claimedBy: 'admin-1',
    }
  );
  const state = getLoyaltyState(result.profile, 0, DEFAULT_LOYALTY_PROGRAM);

  assert.equal(result.claimed, true);
  assert.equal(result.profile.totalVisits, 5);
  assert.equal(result.profile.completedVisits, 5);
  assert.equal(result.profile.loyaltyPoints, 5);
  assert.equal(state.milestones[0].status, 'claimed');
  assert.equal(state.milestones[1].status, 'locked');
  assert.equal(state.rewardHistory.length, 1);
});

test('the same milestone cannot be claimed twice even with a new claim id', () => {
  const first = applyLoyaltyRewardClaim(
    { completedVisits: 5 },
    DEFAULT_LOYALTY_PROGRAM,
    { rewardId: 'reward_free_simple_nail_art', claimId: 'claim-1', claimedAt }
  );
  const duplicate = applyLoyaltyRewardClaim(
    first.profile,
    DEFAULT_LOYALTY_PROGRAM,
    { rewardId: 'reward_free_simple_nail_art', claimId: 'claim-2', claimedAt }
  );

  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.reason, 'duplicate-reward');
  assert.equal(duplicate.profile.completedVisits, 5);
});

test('twelve visits retain a claimed five-visit reward and unlock the ten-visit reward', () => {
  const claimedFive = applyLoyaltyRewardClaim(
    { completedVisits: 12, loyaltyPoints: 2 },
    DEFAULT_LOYALTY_PROGRAM,
    { rewardId: 'reward_free_simple_nail_art', claimId: 'claim-1', claimedAt }
  );
  const state = getLoyaltyState(claimedFive.profile, 0, DEFAULT_LOYALTY_PROGRAM);

  assert.deepEqual(state.milestones.map((reward) => reward.status), ['claimed', 'available', 'locked', 'locked']);
  assert.equal(state.milestones[2].remainingVisits, 3);
  assert.equal(state.completedVisits, 12);
  assert.equal(state.points, 2);
});

test('sixteen visits unlock every reached milestone without discarding older rewards', () => {
  const state = getLoyaltyState({ completedVisits: 16 }, 0, DEFAULT_LOYALTY_PROGRAM);

  assert.deepEqual(state.milestones.map((reward) => reward.status), ['available', 'available', 'available', 'locked']);
  assert.equal(state.availableRewards, 3);
  assert.equal(state.nextReward.requiredVisits, 20);
  assert.equal(state.remainingVisits, 4);
});

test('newly configured rewards unlock retroactively from existing lifetime visits', () => {
  const program = {
    active: true,
    rewards: [
      ...DEFAULT_LOYALTY_REWARDS,
      {
        id: 'reward_25_custom',
        name: 'Custom 25 Visit Reward',
        description: 'A special reward for reaching twenty-five visits.',
        requiredVisits: 25,
        rewardType: 'custom',
        active: true,
        sortOrder: 5,
      },
    ],
  };

  const atTwentyOne = getLoyaltyState({ completedVisits: 21 }, 0, program);
  const atEighteen = getLoyaltyState({ completedVisits: 18 }, 0, program);
  assert.equal(atTwentyOne.milestones.find((reward) => reward.requiredVisits === 20).status, 'available');
  assert.equal(atEighteen.milestones.find((reward) => reward.requiredVisits === 20).remainingVisits, 2);
});

test('legacy single-reward claims are matched to the migrated milestone', () => {
  const legacyProfile = {
    completedVisits: 12,
    loyaltyPoints: 2,
    loyalty: {
      rewardHistory: {
        oldClaim: {
          status: 'claimed',
          rewardName: '10% Off Next Service',
          pointsRequired: 10,
          claimedAt,
        },
      },
    },
  };
  const state = getLoyaltyState(legacyProfile, 0, DEFAULT_LOYALTY_PROGRAM);

  assert.equal(state.milestones[1].status, 'claimed');
  assert.equal(state.rewardHistory.length, 1);
  assert.equal(state.completedVisits, 12);
});

test('claim snapshots survive reward edits and deactivation', () => {
  const claimed = applyLoyaltyRewardClaim(
    { completedVisits: 5 },
    DEFAULT_LOYALTY_PROGRAM,
    { rewardId: 'reward_free_simple_nail_art', claimId: 'claim-1', claimedAt }
  );
  const editedProgram = {
    active: true,
    rewards: DEFAULT_LOYALTY_REWARDS.map((reward) => (
      reward.id === 'reward_free_simple_nail_art'
        ? { ...reward, name: 'Updated Nail Art Reward', active: false }
        : reward
    )),
  };
  const state = getLoyaltyState(claimed.profile, 0, editedProgram);

  assert.equal(state.milestones.some((reward) => reward.id === 'reward_free_simple_nail_art'), false);
  assert.equal(state.rewardHistory[0].rewardName, 'Free Simple Nail Art');
  assert.equal(state.rewardHistory[0].claimedAt, claimedAt);
});

test('inactive and locked milestone rewards cannot be claimed', () => {
  const inactive = applyLoyaltyRewardClaim(
    { completedVisits: 20 },
    { active: false, rewards: DEFAULT_LOYALTY_REWARDS },
    { rewardId: 'reward_free_simple_nail_art', claimId: 'claim-1' }
  );
  const locked = applyLoyaltyRewardClaim(
    { completedVisits: 4 },
    DEFAULT_LOYALTY_PROGRAM,
    { rewardId: 'reward_free_simple_nail_art', claimId: 'claim-2' }
  );

  assert.equal(inactive.reason, 'inactive-program');
  assert.equal(locked.reason, 'insufficient-visits');
});
