import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoogleAuthErrorMessage, getPostAuthDestination, isAdminAccount } from '../src/authFlow.js';

const ADMIN_EMAIL = 'admin@luxenails.test';

test('a customer authenticated from the shared login route goes directly home', () => {
  assert.equal(getPostAuthDestination({
    email: 'customer@example.com',
    adminEmail: ADMIN_EMAIL,
  }), 'home');
});

test('a pending customer booking resumes after successful authentication', () => {
  assert.equal(getPostAuthDestination({
    email: 'customer@example.com',
    adminEmail: ADMIN_EMAIL,
    pendingBooking: true,
  }), 'booking');
});

test('only the configured admin account is sent to the admin page', () => {
  assert.equal(isAdminAccount('ADMIN@LUXENAILS.TEST', ADMIN_EMAIL), true);
  assert.equal(getPostAuthDestination({
    email: 'ADMIN@LUXENAILS.TEST',
    adminEmail: ADMIN_EMAIL,
    pendingBooking: true,
  }), 'admin');
});

test('Google popup errors produce helpful customer-facing messages', () => {
  assert.equal(
    getGoogleAuthErrorMessage({ code: 'auth/popup-closed-by-user' }),
    'Google Sign-In was cancelled.'
  );
  assert.equal(
    getGoogleAuthErrorMessage({ code: 'auth/network-request-failed' }),
    'Unable to sign in. Please check your connection and try again.'
  );
  assert.match(
    getGoogleAuthErrorMessage({ code: 'auth/popup-blocked' }),
    /allow popups/i
  );
});
