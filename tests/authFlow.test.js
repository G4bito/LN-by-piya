import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAdminAuthorizationFromRecord,
  getGoogleAuthErrorMessage,
  getPostAuthDestination,
} from '../src/authFlow.js';

test('a customer authenticated from the shared login route goes directly home', () => {
  assert.equal(getPostAuthDestination({
    isAdmin: false,
  }), 'home');
});

test('a pending customer booking resumes after successful authentication', () => {
  assert.equal(getPostAuthDestination({
    isAdmin: false,
    pendingBooking: true,
  }), 'booking');
});

test('only a UID-backed active admin record authorizes the admin destination', () => {
  const authorization = getAdminAuthorizationFromRecord({
    uid: 'admin-uid',
    email: 'admin@luxenails.test',
    status: 'active',
  }, 'admin-uid', 'ADMIN@LUXENAILS.TEST');

  assert.deepEqual(authorization, {
    role: 'admin',
    isAdmin: true,
    status: 'active',
  });
  assert.equal(getPostAuthDestination({
    isAdmin: authorization.isAdmin,
    pendingBooking: true,
  }), 'admin');
});

test('matching a public admin email cannot authorize a customer UID', () => {
  assert.equal(getAdminAuthorizationFromRecord({
    uid: 'real-admin-uid',
    email: 'admin@luxenails.test',
    status: 'active',
  }, 'customer-uid', 'admin@luxenails.test'), null);
  assert.equal(getPostAuthDestination({
    email: 'admin@luxenails.test',
    adminEmail: 'admin@luxenails.test',
  }), 'home');
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
