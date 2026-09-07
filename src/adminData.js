import { findConfirmedAppointmentConflicts } from './scheduling.js';
import {
  DEFAULT_LOYALTY_PROGRAM,
  DEFAULT_LOYALTY_REWARDS,
  getLoyaltyState,
  normalizeLoyaltyProgram,
} from './loyaltyProgram.js';

export const ADMIN_BOOKING_STATUSES = [
  'Pending Confirmation',
  'Confirmed',
  'Completed',
  'Cancelled',
  'No Show',
];

export const APPOINTMENT_FILTERS = [
  'All',
  'Today',
  'Upcoming',
  'Pending',
  'Confirmed',
  'Completed',
  'Cancelled',
  'No Show',
];

export const ADMIN_NAV_ITEMS = Object.freeze([
  Object.freeze({ key: 'overview', label: 'Overview', icon: 'grid' }),
  Object.freeze({ key: 'portfolio', label: 'Portfolio', icon: 'image' }),
  Object.freeze({ key: 'bookings', label: 'Appointments', icon: 'calendar' }),
  Object.freeze({ key: 'users', label: 'Customers', icon: 'users' }),
  Object.freeze({ key: 'rewards', label: 'Rewards', icon: 'gift' }),
  Object.freeze({ key: 'settings', label: 'Settings', icon: 'settings' }),
]);

export const ADMIN_PAGE_TITLES = Object.freeze({
  overview: Object.freeze({ title: 'Overview', subtitle: "Here's what's happening at Luxe Nails today." }),
  portfolio: Object.freeze({ title: 'Portfolio manager', subtitle: 'Curate the work shown on your public gallery.' }),
  bookings: Object.freeze({ title: 'Appointments', subtitle: "Review today's schedule and recent activity." }),
  users: Object.freeze({ title: 'Customers', subtitle: 'View customer profiles, preferences, loyalty, and appointment history.' }),
  rewards: Object.freeze({ title: 'Loyalty Rewards', subtitle: 'Create, organize, and manage customer reward milestones.' }),
  settings: Object.freeze({ title: 'Business settings', subtitle: 'Keep the details that shape bookings and customer communication in one place.' }),
});

export const LOYALTY_REWARD_TARGET = DEFAULT_LOYALTY_REWARDS[0].requiredVisits;

export function getLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeBookingStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (!value || value === 'pending' || value === 'pending confirmation') return 'Pending Confirmation';
  if (value === 'confirmed') return 'Confirmed';
  if (value === 'completed') return 'Completed';
  if (value === 'cancelled' || value === 'canceled') return 'Cancelled';
  if (value === 'no show' || value === 'no-show' || value === 'noshow') return 'No Show';
  return String(status || 'Pending Confirmation');
}

export function isCancelledBooking(booking) {
  const status = normalizeBookingStatus(booking?.status);
  return status === 'Cancelled' || status === 'No Show';
}

export function isActiveAppointment(booking) {
  const status = normalizeBookingStatus(booking?.status);
  return status === 'Pending Confirmation' || status === 'Confirmed';
}

export function getAppointmentTimeMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return Number.MAX_SAFE_INTEGER;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (!period && hour > 0 && hour < 9) hour += 12;
  return (hour * 60) + minute;
}

export function compareAppointments(left, right) {
  const dateDifference = String(left?.date || '').localeCompare(String(right?.date || ''));
  if (dateDifference !== 0) return dateDifference;
  return getAppointmentTimeMinutes(left?.time) - getAppointmentTimeMinutes(right?.time);
}

export function matchesAppointmentFilter(booking, filter, todayKey, selectedDate = '') {
  if (selectedDate) return booking?.date === selectedDate;
  const status = normalizeBookingStatus(booking?.status);
  if (filter === 'All') return true;
  if (filter === 'Today') return booking?.date === todayKey;
  if (filter === 'Upcoming') return booking?.date >= todayKey && isActiveAppointment(booking);
  if (filter === 'Pending') return status === 'Pending Confirmation';
  return status === filter;
}

export function findAppointmentConflicts(bookings = []) {
  return findConfirmedAppointmentConflicts(bookings).sort((left, right) => compareAppointments(left, right));
}

export function bookingBelongsToCustomer(booking, customer) {
  if (!booking || !customer) return false;
  if (booking.uid && customer.id) return booking.uid === customer.id;
  const bookingEmail = String(booking.email || booking.customerEmail || '').trim().toLowerCase();
  const customerEmail = String(customer.email || '').trim().toLowerCase();
  return Boolean(bookingEmail && customerEmail && bookingEmail === customerEmail);
}

export function getCustomerAppointmentSummary(
  customer,
  bookings = [],
  todayKey = getLocalDateKey(),
  loyaltyProgram = DEFAULT_LOYALTY_PROGRAM
) {
  const customerBookings = bookings
    .filter((booking) => bookingBelongsToCustomer(booking, customer))
    .sort(compareAppointments);
  const completed = customerBookings.filter((booking) => normalizeBookingStatus(booking.status) === 'Completed');
  const upcoming = customerBookings.filter((booking) => booking.date >= todayKey && isActiveAppointment(booking));
  const loyaltyState = getLoyaltyState(customer, completed.length, loyaltyProgram);

  return {
    bookings: [...customerBookings].reverse(),
    completedVisits: loyaltyState.completedVisits,
    loyaltyPoints: loyaltyState.points,
    lastVisit: completed.at(-1) || null,
    nextAppointment: upcoming[0] || null,
    rewardsUnlocked: loyaltyState.unlockedRewards,
    availableRewards: loyaltyState.availableRewards,
    claimedRewards: loyaltyState.claimedRewards,
    rewardsEarned: loyaltyState.rewardsEarned,
    rewardProgress: loyaltyState.rewardProgress,
    loyaltyProgress: loyaltyState.progressPoints,
    remainingVisits: loyaltyState.remainingVisits,
    rewardStatus: loyaltyState.status,
    rewardHistory: loyaltyState.rewardHistory,
    milestones: loyaltyState.milestones,
    nextReward: loyaltyState.nextReward,
    allRewardsUnlocked: loyaltyState.allRewardsUnlocked,
  };
}

export function applyCompletedBookingReward(
  profile,
  bookingId,
  awardedAt = new Date().toISOString(),
  loyaltyProgram = DEFAULT_LOYALTY_PROGRAM
) {
  if (!profile || !bookingId) return { profile, awarded: false };

  const loyalty = profile.loyalty && typeof profile.loyalty === 'object' ? profile.loyalty : {};
  const awardedBookings = loyalty.awardedBookings && typeof loyalty.awardedBookings === 'object'
    ? loyalty.awardedBookings
    : {};
  if (awardedBookings[bookingId]) return { profile, awarded: false };

  const currentPoints = Math.max(0, Number(profile.loyaltyPoints ?? loyalty.points ?? 0) || 0);
  const storedVisitValues = [
    profile.totalVisits,
    profile.completedVisits,
    loyalty.totalVisits,
    loyalty.completedVisits,
  ].map(Number).filter(Number.isFinite);
  const currentVisits = storedVisitValues.length > 0
    ? Math.max(0, ...storedVisitValues)
    : currentPoints;
  const nextPoints = currentPoints + 1;
  const nextVisits = currentVisits + 1;
  const program = normalizeLoyaltyProgram(loyaltyProgram);
  const existingClaims = Number(profile.rewardsClaimed ?? loyalty.rewardsClaimed ?? 0) || 0;
  const existingEarned = Number(profile.rewardsEarned ?? loyalty.rewardsEarned ?? 0) || 0;
  const existingRewardRecords = loyalty.rewards && typeof loyalty.rewards === 'object'
    ? loyalty.rewards
    : {};
  const rewardRecords = { ...existingRewardRecords };

  program.activeRewards.forEach((reward) => {
    const existing = rewardRecords[reward.id] && typeof rewardRecords[reward.id] === 'object'
      ? rewardRecords[reward.id]
      : null;
    if (nextVisits < reward.requiredVisits || existing?.status === 'claimed') return;
    rewardRecords[reward.id] = {
      ...existing,
      rewardId: reward.id,
      status: 'available',
      rewardName: reward.name,
      rewardDescription: reward.description,
      requiredVisits: reward.requiredVisits,
      rewardType: reward.rewardType,
      ...(Number.isFinite(Number(reward.value)) ? { value: Number(reward.value) } : {}),
      unlockedAt: existing?.unlockedAt || awardedAt,
    };
  });

  const unlockedRewards = program.activeRewards.filter((reward) => (
    nextVisits >= reward.requiredVisits
    || rewardRecords[reward.id]?.status === 'available'
    || rewardRecords[reward.id]?.status === 'claimed'
  )).length;
  const nextRewardsEarned = Math.max(existingEarned, existingClaims, unlockedRewards);

  return {
    awarded: true,
    profile: {
      ...profile,
      loyaltyPoints: nextPoints,
      totalVisits: nextVisits,
      completedVisits: nextVisits,
      rewardsEarned: nextRewardsEarned,
      loyalty: {
        ...loyalty,
        points: nextPoints,
        totalVisits: nextVisits,
        completedVisits: nextVisits,
        rewardsEarned: nextRewardsEarned,
        rewards: rewardRecords,
        awardedBookings: {
          ...awardedBookings,
          [bookingId]: awardedAt,
        },
      },
      updatedAt: awardedAt,
    },
  };
}
