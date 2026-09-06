import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PASSWORD_RESET_EMAIL_MESSAGE,
  getPasswordResetEmailErrorMessage,
  normalizePasswordResetEmail,
} from '../src/passwordResetEmail.js';

test('password reset email addresses are trimmed and normalized', () => {
  assert.equal(normalizePasswordResetEmail('  Customer@Example.COM '), 'customer@example.com');
});

test('password reset email confirmation does not reveal account existence', () => {
  assert.equal(
    PASSWORD_RESET_EMAIL_MESSAGE,
    'If an account exists for this email, a password reset email has been sent.'
  );
});

test('password reset email failures use safe customer-facing messages', () => {
  assert.equal(
    getPasswordResetEmailErrorMessage({ code: 'auth/network-request-failed' }),
    'Unable to connect. Please check your internet connection.'
  );
  assert.match(
    getPasswordResetEmailErrorMessage({ code: 'auth/too-many-requests' }),
    /wait a few minutes/i
  );
  assert.equal(
    getPasswordResetEmailErrorMessage({ code: 'auth/internal-error', message: 'sensitive detail' }),
    "We couldn't complete the request. Please try again."
  );
});
