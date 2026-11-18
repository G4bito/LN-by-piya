import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAdminAuthorizationFromRecord,
  getAccountAccessErrorMessage,
  getEmailAuthErrorMessage,
  getGoogleAuthErrorMessage,
  getPostAuthDestination,
  isFirebasePermissionDenied,
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

test('a missing Admin record can be recognized from Firebase permission errors', () => {
  assert.equal(isFirebasePermissionDenied({ code: 'database/permission-denied' }), true);
  assert.equal(isFirebasePermissionDenied({ message: 'Permission denied' }), true);
  assert.equal(isFirebasePermissionDenied({ code: 'database/network-error' }), false);
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

test('credential errors offer safe recovery without exposing whether an account exists', () => {
  const message = getEmailAuthErrorMessage({ code: 'auth/invalid-credential', message: 'Firebase internal details' });
  assert.match(message, /email or password/i);
  assert.match(message, /Google/);
  assert.match(message, /reset/i);
  assert.equal(message, getEmailAuthErrorMessage({ code: 'auth/user-not-found' }));
  assert.equal(message, getEmailAuthErrorMessage({ code: 'auth/wrong-password' }));
  assert.doesNotMatch(message, /Firebase internal details|does not exist/i);
});

test('post-auth access errors distinguish profile recovery and essential permission failures', () => {
  assert.match(getAccountAccessErrorMessage({ code: 'account/profile-recovery-required' }), /profile.*contact/i);
  assert.match(getAccountAccessErrorMessage({ code: 'PERMISSION_DENIED' }), /signed in.*account.*access/i);
  assert.match(getAccountAccessErrorMessage({ code: 'database/network-error' }), /connection/i);
});

test('unsupported Google popup environments guide customers to an external browser', () => {
  assert.match(getGoogleAuthErrorMessage({ code: 'auth/operation-not-supported-in-this-environment' }), /Safari.*Chrome/);
  assert.match(getGoogleAuthErrorMessage({ code: 'auth/popup-blocked' }), /Safari.*Chrome/);
});
