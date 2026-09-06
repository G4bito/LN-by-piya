export const LOYALTY_REWARD_TYPES = Object.freeze([
  Object.freeze({ value: 'custom', label: 'Custom Reward' }),
  Object.freeze({ value: 'percentage_discount', label: 'Percentage Discount' }),
  Object.freeze({ value: 'fixed_discount', label: 'Fixed Discount' }),
  Object.freeze({ value: 'free_service', label: 'Free Service' }),
  Object.freeze({ value: 'free_addon', label: 'Free Add-on' }),
]);

export const DEFAULT_LOYALTY_REWARDS = Object.freeze([
  Object.freeze({
    id: 'reward_free_simple_nail_art',
    name: 'Free Simple Nail Art',
    description: 'Enjoy free simple nail art on up to 2 nails.',
    requiredVisits: 5,
    rewardType: 'free_addon',
    active: true,
    sortOrder: 1,
  }),
  Object.freeze({
    id: 'reward_ten_percent_off',
    name: '10% Off Next Service',
    description: 'Enjoy 10% off one eligible nail service.',
    requiredVisits: 10,
    rewardType: 'percentage_discount',
    value: 10,
    active: true,
    sortOrder: 2,
  }),
  Object.freeze({
    id: 'reward_150_off',
    name: '₱150 Off',
    description: 'Get ₱150 off your next eligible appointment.',
    requiredVisits: 15,
    rewardType: 'fixed_discount',
    value: 150,
    active: true,
    sortOrder: 3,
  }),
  Object.freeze({
    id: 'reward_free_gel_manicure',
    name: 'Free Gel Manicure',
    description: 'Enjoy one basic Gel Manicure reward.',
    requiredVisits: 20,
    rewardType: 'free_service',
    active: true,
    sortOrder: 4,
  }),
]);

export const DEFAULT_LOYALTY_PROGRAM = Object.freeze({
  active: true,
  configured: true,
  rewards: DEFAULT_LOYALTY_REWARDS,
  activeRewards: DEFAULT_LOYALTY_REWARDS,
});

const MAX_REQUIRED_VISITS = 1000;
const MAX_REWARD_NAME_LENGTH = 100;
const MAX_REWARD_DESCRIPTION_LENGTH = 240;
const MAX_REWARD_VALUE = 1000000;
const VALID_REWARD_TYPES = new Set(LOYALTY_REWARD_TYPES.map((type) => type.value));

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record, key) {
  return isRecord(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function toNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function getStoredNumber(profile, keys) {
  const loyalty = isRecord(profile?.loyalty) ? profile.loyalty : {};
  const values = [];
  for (const key of keys) {
    if (hasOwn(profile, key) && Number.isFinite(Number(profile[key]))) {
      values.push(toNonNegativeInteger(profile[key]));
    }
  }
  for (const key of keys) {
    if (hasOwn(loyalty, key) && Number.isFinite(Number(loyalty[key]))) {
      values.push(toNonNegativeInteger(loyalty[key]));
    }
  }
  return values.length > 0
    ? { exists: true, value: Math.max(...values) }
    : { exists: false, value: 0 };
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function compareRewards(left, right) {
  return left.requiredVisits - right.requiredVisits
    || left.sortOrder - right.sortOrder
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id);
}

function normalizeReward(id, value, index = 0) {
  if (!isRecord(value)) return null;
  const rewardId = cleanText(value.id || id);
  const requiredVisits = Number(value.requiredVisits ?? value.pointsRequired);
  const name = cleanText(value.name || value.rewardName);
  const description = cleanText(value.description || value.rewardDescription);
  const rewardType = VALID_REWARD_TYPES.has(value.rewardType) ? value.rewardType : 'custom';
  const numericValue = Number(value.value);

  if (
    !rewardId
    || !Number.isInteger(requiredVisits)
    || requiredVisits < 1
    || requiredVisits > MAX_REQUIRED_VISITS
    || name.length < 3
    || name.length > MAX_REWARD_NAME_LENGTH
    || description.length < 3
    || description.length > MAX_REWARD_DESCRIPTION_LENGTH
  ) return null;

  const reward = {
    id: rewardId,
    name,
    description,
    requiredVisits,
    rewardType,
    active: value.active !== false,
    sortOrder: toNonNegativeInteger(value.sortOrder, index + 1),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : '',
  };

  if (Number.isFinite(numericValue) && numericValue >= 0) reward.value = numericValue;
  return reward;
}

function getRewardEntries(source) {
  if (Array.isArray(source?.rewards)) {
    return source.rewards.map((reward, index) => [reward?.id || `reward_${index + 1}`, reward]);
  }
  if (isRecord(source?.rewards)) return Object.entries(source.rewards);

  // Backward compatibility for the previous single-reward Firebase structure.
  if (isRecord(source) && (source.pointsRequired || source.rewardName)) {
    return [['legacy_single_reward', {
      requiredVisits: source.pointsRequired,
      name: source.rewardName,
      description: source.rewardDescription,
      rewardType: 'custom',
      active: source.active,
      sortOrder: 1,
      createdAt: source.updatedAt,
      updatedAt: source.updatedAt,
      updatedBy: source.updatedBy,
    }]];
  }
  return [];
}

export function normalizeLoyaltyProgram(value) {
  const source = isRecord(value) ? value : null;
  const rewards = getRewardEntries(source)
    .map(([id, reward], index) => normalizeReward(id, reward, index))
    .filter(Boolean)
    .sort(compareRewards);
  const configured = Boolean(source && rewards.length > 0);
  const enabled = configured && source.active !== false;
  const activeRewards = enabled ? rewards.filter((reward) => reward.active) : [];
  const firstReward = activeRewards[0] || rewards[0] || null;

  return {
    active: activeRewards.length > 0,
    enabled,
    configured,
    rewards,
    activeRewards,
    updatedAt: typeof source?.updatedAt === 'string' ? source.updatedAt : '',
    updatedBy: typeof source?.updatedBy === 'string' ? source.updatedBy : '',
    // Compatibility aliases for code reading the former single-reward shape.
    pointsRequired: firstReward?.requiredVisits || 0,
    rewardName: firstReward?.name || '',
    rewardDescription: firstReward?.description || '',
  };
}

export function createLoyaltyRewardPayload(value, metadata = {}) {
  const id = cleanText(value?.id || metadata.id);
  const requiredVisits = Number(value?.requiredVisits ?? value?.pointsRequired);
  const name = cleanText(value?.name || value?.rewardName);
  const description = cleanText(value?.description || value?.rewardDescription);
  const rewardType = String(value?.rewardType || 'custom');
  const numericValue = value?.value === '' || value?.value == null ? null : Number(value.value);

  if (!id || /[.#$\[\]/]/.test(id)) throw new Error('This reward has an invalid identifier.');
  if (!Number.isInteger(requiredVisits) || requiredVisits < 1 || requiredVisits > MAX_REQUIRED_VISITS) {
    throw new Error(`Required visits must be a whole number from 1 to ${MAX_REQUIRED_VISITS}.`);
  }
  if (name.length < 3 || name.length > MAX_REWARD_NAME_LENGTH) {
    throw new Error(`Reward name must contain 3-${MAX_REWARD_NAME_LENGTH} characters.`);
  }
  if (description.length < 3 || description.length > MAX_REWARD_DESCRIPTION_LENGTH) {
    throw new Error(`Reward description must contain 3-${MAX_REWARD_DESCRIPTION_LENGTH} characters.`);
  }
  if (!VALID_REWARD_TYPES.has(rewardType)) throw new Error('Choose a valid reward type.');
  if (rewardType === 'percentage_discount' && (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > 100)) {
    throw new Error('Percentage discounts must have a value from 1 to 100.');
  }
  if (rewardType === 'fixed_discount' && (!Number.isFinite(numericValue) || numericValue <= 0 || numericValue > MAX_REWARD_VALUE)) {
    throw new Error('Fixed discounts must have a positive value.');
  }

  const updatedAt = String(metadata.updatedAt || new Date().toISOString());
  const payload = {
    name,
    description,
    requiredVisits,
    rewardType,
    active: value?.active !== false,
    sortOrder: toNonNegativeInteger(value?.sortOrder, 1),
    createdAt: String(value?.createdAt || metadata.createdAt || updatedAt),
    updatedAt,
    updatedBy: String(metadata.updatedBy || value?.updatedBy || ''),
  };
  if (numericValue != null && Number.isFinite(numericValue)) payload.value = numericValue;
  return payload;
}

export function createLoyaltyProgramPayload(value, metadata = {}) {
  const sourceRewards = Array.isArray(value?.rewards)
    ? value.rewards
    : isRecord(value?.rewards)
      ? Object.entries(value.rewards).map(([id, reward]) => ({ ...reward, id }))
      : [];
  const updatedAt = String(metadata.updatedAt || new Date().toISOString());
  const updatedBy = String(metadata.updatedBy || '');
  const rewards = {};
  const activeMilestones = new Map();

  sourceRewards.forEach((reward, index) => {
    const id = cleanText(reward?.id);
    const payload = createLoyaltyRewardPayload(
      { ...reward, sortOrder: reward?.sortOrder ?? index + 1 },
      { id, updatedAt, updatedBy, createdAt: reward?.createdAt }
    );
    if (payload.active && activeMilestones.has(payload.requiredVisits)) {
      throw new Error(`A reward already exists at the ${payload.requiredVisits}-visit milestone.`);
    }
    if (payload.active) activeMilestones.set(payload.requiredVisits, id);
    rewards[id] = payload;
  });

  return {
    active: value?.enabled !== false && value?.active !== false,
    rewards,
    updatedAt,
    updatedBy,
  };
}

function matchRewardForClaim(entry, program) {
  const explicitId = cleanText(entry?.rewardId);
  if (explicitId && program.rewards.some((reward) => reward.id === explicitId)) return explicitId;
  const requiredVisits = toNonNegativeInteger(entry?.requiredVisits ?? entry?.pointsRequired);
  const name = cleanText(entry?.rewardName || entry?.name).toLowerCase();
  const exact = program.rewards.find((reward) => (
    reward.requiredVisits === requiredVisits
    && (!name || reward.name.toLowerCase() === name)
  ));
  if (exact) return exact.id;
  const sameMilestone = program.rewards.filter((reward) => reward.requiredVisits === requiredVisits);
  return sameMilestone.length === 1 ? sameMilestone[0].id : '';
}

function normalizeClaimEntry(id, entry, program) {
  if (!isRecord(entry) || (entry.status !== 'claimed' && !entry.claimedAt)) return null;
  const rewardId = matchRewardForClaim(entry, program);
  const configuredReward = program.rewards.find((reward) => reward.id === rewardId);
  return {
    id,
    rewardId,
    status: 'claimed',
    rewardName: cleanText(entry.rewardName || entry.name || configuredReward?.name || 'Loyalty Reward'),
    rewardDescription: cleanText(entry.rewardDescription || entry.description || configuredReward?.description),
    requiredVisits: Math.max(1, toNonNegativeInteger(
      entry.requiredVisits ?? entry.pointsRequired,
      configuredReward?.requiredVisits || 1
    )),
    rewardType: VALID_REWARD_TYPES.has(entry.rewardType)
      ? entry.rewardType
      : configuredReward?.rewardType || 'custom',
    value: Number.isFinite(Number(entry.value)) ? Number(entry.value) : configuredReward?.value,
    unlockedAt: typeof entry.unlockedAt === 'string' ? entry.unlockedAt : '',
    claimedAt: typeof entry.claimedAt === 'string' ? entry.claimedAt : '',
    claimedBy: typeof entry.claimedBy === 'string' ? entry.claimedBy : '',
  };
}

function getClaimHistory(profile, program) {
  const loyalty = isRecord(profile?.loyalty) ? profile.loyalty : {};
  const rewardRecords = isRecord(loyalty.rewards) ? loyalty.rewards : {};
  const legacyHistory = isRecord(loyalty.rewardHistory) ? loyalty.rewardHistory : {};
  const claims = [
    ...Object.entries(rewardRecords).map(([id, entry]) => normalizeClaimEntry(`reward_${id}`, { ...entry, rewardId: entry?.rewardId || id }, program)),
    ...Object.entries(legacyHistory).map(([id, entry]) => normalizeClaimEntry(id, entry, program)),
  ].filter(Boolean);
  const unique = new Map();

  claims.forEach((claim) => {
    const key = claim.rewardId ? `reward:${claim.rewardId}` : `claim:${claim.id}`;
    const existing = unique.get(key);
    if (!existing || String(claim.claimedAt).localeCompare(String(existing.claimedAt)) > 0) unique.set(key, claim);
  });

  return [...unique.values()].sort((left, right) => (
    String(right.claimedAt || right.unlockedAt).localeCompare(String(left.claimedAt || left.unlockedAt))
  ));
}

export function getLoyaltyState(profile, completedBookingCount = 0, loyaltyProgram = null) {
  const program = normalizeLoyaltyProgram(loyaltyProgram);
  const completedFallback = toNonNegativeInteger(completedBookingCount);
  const storedVisits = getStoredNumber(profile, ['totalVisits', 'completedVisits']);
  const storedPoints = getStoredNumber(profile, ['loyaltyPoints', 'points']);
  const completedVisits = Math.max(storedVisits.exists ? storedVisits.value : 0, completedFallback);
  const points = storedPoints.exists ? storedPoints.value : completedVisits;
  const loyalty = isRecord(profile?.loyalty) ? profile.loyalty : {};
  const rewardRecords = isRecord(loyalty.rewards) ? loyalty.rewards : {};
  const claimHistory = getClaimHistory(profile, program);

  const milestones = program.activeRewards.map((reward) => {
    const record = isRecord(rewardRecords[reward.id]) ? rewardRecords[reward.id] : {};
    const claim = claimHistory.find((entry) => entry.rewardId === reward.id);
    const claimed = Boolean(claim || record.status === 'claimed' || record.claimedAt);
    const available = !claimed && (completedVisits >= reward.requiredVisits || record.status === 'available');
    const status = claimed ? 'claimed' : available ? 'available' : 'locked';
    return {
      ...reward,
      status,
      progress: Math.min(completedVisits, reward.requiredVisits),
      remainingVisits: Math.max(reward.requiredVisits - completedVisits, 0),
      unlockedAt: claim?.unlockedAt || (typeof record.unlockedAt === 'string' ? record.unlockedAt : ''),
      claimedAt: claim?.claimedAt || (typeof record.claimedAt === 'string' ? record.claimedAt : ''),
    };
  });

  const availableRewardItems = milestones.filter((reward) => reward.status === 'available');
  const claimedMilestones = milestones.filter((reward) => reward.status === 'claimed');
  const unlockedRewards = availableRewardItems.length + claimedMilestones.length;
  const nextReward = milestones.find((reward) => reward.status === 'locked') || null;
  const finalReward = milestones.at(-1) || null;
  const progressTarget = nextReward || finalReward;
  const recordedClaims = Math.max(
    toNonNegativeInteger(profile?.rewardsClaimed),
    toNonNegativeInteger(loyalty.rewardsClaimed)
  );
  const claimedRewards = Math.max(recordedClaims, claimHistory.length);
  const recordedEarned = Math.max(
    toNonNegativeInteger(profile?.rewardsEarned),
    toNonNegativeInteger(loyalty.rewardsEarned)
  );
  const rewardsEarned = Math.max(recordedEarned, unlockedRewards, claimedRewards);

  return {
    program,
    points,
    completedVisits,
    totalVisits: completedVisits,
    milestones,
    nextReward,
    pointsRequired: progressTarget?.requiredVisits || 0,
    progressPoints: progressTarget ? Math.min(completedVisits, progressTarget.requiredVisits) : 0,
    rewardProgress: completedVisits,
    remainingVisits: nextReward?.remainingVisits || 0,
    availableRewards: availableRewardItems.length,
    availableRewardItems,
    unlockedRewards,
    claimedRewards,
    claimedMilestones,
    rewardsEarned,
    rewardHistory: claimHistory,
    claimHistory,
    lastClaimedReward: claimHistory[0] || null,
    allRewardsUnlocked: milestones.length > 0 && !nextReward,
    status: !program.active ? 'inactive' : availableRewardItems.length > 0 ? 'available' : nextReward ? 'locked' : 'complete',
    usesStoredPoints: storedPoints.exists,
  };
}

export function applyLoyaltyRewardClaim(profile, loyaltyProgram, options = {}) {
  if (!isRecord(profile)) return { profile, claimed: false, reason: 'missing-profile' };

  const program = normalizeLoyaltyProgram(loyaltyProgram);
  if (!program.active) return { profile, claimed: false, reason: 'inactive-program' };

  const rewardId = cleanText(options.rewardId);
  const reward = program.activeRewards.find((item) => item.id === rewardId);
  if (!reward) return { profile, claimed: false, reason: 'missing-reward' };

  const claimId = cleanText(options.claimId);
  if (!claimId) return { profile, claimed: false, reason: 'missing-claim-id' };

  const state = getLoyaltyState(profile, options.fallbackVisits || 0, program);
  const milestone = state.milestones.find((item) => item.id === rewardId);
  if (milestone?.status === 'claimed') return { profile, claimed: false, reason: 'duplicate-reward' };
  if (milestone?.status !== 'available') return { profile, claimed: false, reason: 'insufficient-visits' };

  const loyalty = isRecord(profile.loyalty) ? profile.loyalty : {};
  const rewardRecords = isRecord(loyalty.rewards) ? loyalty.rewards : {};
  const rewardHistory = isRecord(loyalty.rewardHistory) ? loyalty.rewardHistory : {};
  if (rewardHistory[claimId]) return { profile, claimed: false, reason: 'duplicate-claim' };

  const claimedAt = String(options.claimedAt || new Date().toISOString());
  const rewardRecord = {
    rewardId: reward.id,
    status: 'claimed',
    rewardName: reward.name,
    rewardDescription: reward.description,
    requiredVisits: reward.requiredVisits,
    rewardType: reward.rewardType,
    unlockedAt: milestone.unlockedAt || String(options.unlockedAt || claimedAt),
    claimedAt,
  };
  if (Number.isFinite(Number(reward.value))) rewardRecord.value = Number(reward.value);
  if (options.claimedBy) rewardRecord.claimedBy = String(options.claimedBy);

  const nextClaimedRewards = Math.max(state.claimedRewards + 1, state.claimHistory.length + 1);
  const nextRewardsEarned = Math.max(state.rewardsEarned, state.unlockedRewards, nextClaimedRewards);
  const nextProfile = {
    ...profile,
    totalVisits: state.completedVisits,
    completedVisits: state.completedVisits,
    rewardsEarned: nextRewardsEarned,
    rewardsClaimed: nextClaimedRewards,
    loyalty: {
      ...loyalty,
      totalVisits: state.completedVisits,
      completedVisits: state.completedVisits,
      rewardsEarned: nextRewardsEarned,
      rewardsClaimed: nextClaimedRewards,
      rewards: {
        ...rewardRecords,
        [reward.id]: rewardRecord,
      },
      rewardHistory: {
        ...rewardHistory,
        [claimId]: rewardRecord,
      },
      lastClaimedReward: rewardRecord,
    },
    updatedAt: claimedAt,
  };

  return { profile: nextProfile, claimed: true, reward: rewardRecord, claimId };
}
