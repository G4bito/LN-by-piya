import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_NAV_ITEMS,
  ADMIN_PAGE_TITLES,
  applyCompletedBookingReward,
  compareAppointments,
  compareBookingsByCreatedAt,
  findAppointmentConflicts,
  formatBookingCreatedAt,
  getCustomerAppointmentSummary,
  getBookingCreatedAtTime,
  matchesAppointmentFilter,
  normalizeBookingStatus,
} from '../src/adminData.js';

const todayKey = '2026-09-02';

test('admin navigation keeps Customers and Rewards as separate destinations', () => {
  assert.deepEqual(ADMIN_NAV_ITEMS.map((item) => item.key), [
    'overview',
    'portfolio',
    'bookings',
    'users',
    'rewards',
    'settings',
  ]);
  assert.equal(ADMIN_PAGE_TITLES.users.title, 'Customers');
  assert.equal(ADMIN_PAGE_TITLES.rewards.title, 'Loyalty Rewards');
  assert.notEqual(ADMIN_PAGE_TITLES.users.subtitle, ADMIN_PAGE_TITLES.rewards.subtitle);
});

test('appointment filters support every admin status and upcoming excludes inactive bookings', () => {
  const pending = { date: todayKey, status: 'Pending Confirmation' };
  const confirmed = { date: '2026-09-03', status: 'Confirmed' };
  const cancelled = { date: '2026-09-03', status: 'Cancelled' };

  assert.equal(matchesAppointmentFilter(pending, 'Pending', todayKey), true);
  assert.equal(matchesAppointmentFilter(pending, 'Today', todayKey), true);
  assert.equal(matchesAppointmentFilter(confirmed, 'Upcoming', todayKey), true);
  assert.equal(matchesAppointmentFilter(cancelled, 'Upcoming', todayKey), false);
  assert.equal(normalizeBookingStatus('No-show'), 'No Show');
});

test('calendar date selection takes priority over the selected status filter', () => {
  const booking = { date: '2026-09-05', status: 'Confirmed' };
  assert.equal(matchesAppointmentFilter(booking, 'Cancelled', todayKey, '2026-09-05'), true);
  assert.equal(matchesAppointmentFilter(booking, 'All', todayKey, '2026-09-06'), false);
});

test('booking-created timestamps use the salon timezone and handle missing legacy values', () => {
  const createdAt = '2026-09-07T12:42:00.000Z';

  assert.equal(formatBookingCreatedAt(createdAt, 'Asia/Manila'), 'Sep 7, 2026 · 8:42 PM');
  assert.equal(getBookingCreatedAtTime(createdAt), Date.parse(createdAt));
  assert.equal(formatBookingCreatedAt(null, 'Asia/Manila'), '');
  assert.equal(formatBookingCreatedAt('not-a-date', 'Asia/Manila'), '');
});

test('booking-created sorting stays separate from appointment-date sorting', () => {
  const bookingA = {
    id: 'a',
    createdAt: '2026-09-07T12:00:00.000Z',
    date: '2026-09-20',
    time: '2:00 PM',
  };
  const bookingB = {
    id: 'b',
    createdAt: '2026-09-08T12:00:00.000Z',
    date: '2026-09-10',
    time: '10:00 AM',
  };
  const legacyBooking = { id: 'legacy', date: '2026-09-09', time: '9:00 AM' };

  assert.deepEqual([bookingB, legacyBooking, bookingA].sort((left, right) => compareBookingsByCreatedAt(left, right, 'asc')).map(({ id }) => id), ['a', 'b', 'legacy']);
  assert.deepEqual([bookingA, legacyBooking, bookingB].sort((left, right) => compareBookingsByCreatedAt(left, right, 'desc')).map(({ id }) => id), ['b', 'a', 'legacy']);
  assert.deepEqual([bookingA, bookingB].sort(compareAppointments).map(({ id }) => id), ['b', 'a']);
});

test('conflict detection reports duration overlaps between confirmed appointments', () => {
  const conflicts = findAppointmentConflicts([
    { id: 'a', date: '2026-09-03', time: '10:00', durationMinutes: 120, status: 'Confirmed' },
    { id: 'b', date: '2026-09-03', time: '11:00', durationMinutes: 60, status: 'Confirmed' },
    { id: 'c', date: '2026-09-03', time: '10:30', durationMinutes: 60, status: 'Pending Confirmation' },
    { id: 'd', date: '2026-09-03', time: '10:30', durationMinutes: 60, status: 'Cancelled' },
  ]);

  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].appointments.map((booking) => booking.id), ['a', 'b']);
});

test('customer summaries use completed bookings for lifetime milestone progress', () => {
  const customer = { id: 'customer-1', email: 'client@example.com' };
  const completed = Array.from({ length: 10 }, (_, index) => ({
    id: `completed-${index}`,
    uid: customer.id,
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    time: '10:00',
    status: 'Completed',
  }));
  const nextAppointment = {
    id: 'next',
    uid: customer.id,
    date: '2026-09-04',
    time: '2:00',
    status: 'Confirmed',
  };

  const summary = getCustomerAppointmentSummary(customer, [...completed, nextAppointment], todayKey);
  assert.equal(summary.completedVisits, 10);
  assert.equal(summary.loyaltyPoints, 10);
  assert.equal(summary.rewardsUnlocked, 2);
  assert.equal(summary.availableRewards, 2);
  assert.equal(summary.nextReward.requiredVisits, 15);
  assert.equal(summary.nextAppointment.id, 'next');
});

test('a completed booking can award loyalty only once', () => {
  const originalProfile = {
    uid: 'customer-1',
    email: 'client@example.com',
    status: 'active',
    loyaltyPoints: 3,
    completedVisits: 3,
  };
  const firstAttempt = applyCompletedBookingReward(originalProfile, 'booking-1', '2026-09-02T10:00:00.000Z');
  const secondAttempt = applyCompletedBookingReward(firstAttempt.profile, 'booking-1', '2026-09-02T10:01:00.000Z');

  assert.equal(firstAttempt.awarded, true);
  assert.equal(firstAttempt.profile.loyaltyPoints, 4);
  assert.equal(firstAttempt.profile.completedVisits, 4);
  assert.equal(firstAttempt.profile.loyalty.awardedBookings['booking-1'], '2026-09-02T10:00:00.000Z');
  assert.equal(secondAttempt.awarded, false);
  assert.equal(secondAttempt.profile.loyaltyPoints, 4);
  assert.equal(secondAttempt.profile.completedVisits, 4);
});

test('crossing a milestone records one available reward without resetting lifetime visits', () => {
  const profile = {
    uid: 'customer-1',
    email: 'client@example.com',
    status: 'active',
    loyaltyPoints: 4,
    completedVisits: 4,
  };
  const first = applyCompletedBookingReward(profile, 'booking-5', '2026-09-05T09:00:00.000Z');
  const retry = applyCompletedBookingReward(first.profile, 'booking-5', '2026-09-05T09:01:00.000Z');

  assert.equal(first.profile.totalVisits, 5);
  assert.equal(first.profile.loyalty.rewards.reward_free_simple_nail_art.status, 'available');
  assert.equal(first.profile.loyalty.rewards.reward_free_simple_nail_art.unlockedAt, '2026-09-05T09:00:00.000Z');
  assert.equal(retry.awarded, false);
  assert.equal(retry.profile.totalVisits, 5);
});

test('completed visits keep increasing after a legacy reward claim', () => {
  const claimedProfile = {
    uid: 'customer-1',
    email: 'client@example.com',
    status: 'active',
    loyaltyPoints: 2,
    completedVisits: 12,
    rewardsEarned: 1,
    rewardsClaimed: 1,
    loyalty: {
      points: 2,
      completedVisits: 12,
      rewardsEarned: 1,
      rewardsClaimed: 1,
      rewardHistory: {
        'claim-1': {
          status: 'claimed',
          rewardName: '10% Off Your Next Service',
          pointsRequired: 10,
          claimedAt: '2026-09-01T10:00:00.000Z',
        },
      },
    },
  };

  const result = applyCompletedBookingReward(claimedProfile, 'booking-13', '2026-09-05T10:00:00.000Z');

  assert.equal(result.profile.loyaltyPoints, 3);
  assert.equal(result.profile.completedVisits, 13);
  assert.equal(result.profile.rewardsEarned, 2);
  assert.equal(result.profile.loyalty.rewardHistory['claim-1'].status, 'claimed');
});

test('customer summaries use the configured reward requirement', () => {
  const customer = { id: 'customer-1', email: 'client@example.com', loyaltyPoints: 5, completedVisits: 5 };
  const program = {
    active: true,
    pointsRequired: 5,
    rewardName: 'Free Nail Art',
    rewardDescription: 'Add nail art to your next eligible appointment.',
  };
  const summary = getCustomerAppointmentSummary(customer, [], todayKey, program);

  assert.equal(summary.loyaltyPoints, 5);
  assert.equal(summary.loyaltyProgress, 5);
  assert.equal(summary.availableRewards, 1);
  assert.equal(summary.rewardStatus, 'available');
});
