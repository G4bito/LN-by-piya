import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  DEFAULT_PASSWORD_POLICY,
  generateOtp,
  getPasswordPolicyFailures,
  hashProtectedValue,
  hashesMatch,
  isValidOtp,
  normalizeEmail,
  normalizeOtp,
  parseResetSession,
} from '../functions/passwordResetCore.js';

test('password reset codes are exactly six numeric digits', () => {
  for (let index = 0; index < 100; index += 1) {
    const code = generateOtp();
    assert.match(code, /^\d{6}$/);
    assert.equal(isValidOtp(code), true);
  }
  assert.equal(normalizeOtp('12a 34-567'), '123456');
  assert.equal(isValidOtp('12345'), false);
});

test('OTP storage uses a peppered request-specific hash', () => {
  const pepper = 'a-secure-test-pepper-that-is-longer-than-thirty-two-characters';
  const firstHash = hashProtectedValue(pepper, 'otp-request-one', '123456');
  const secondHash = hashProtectedValue(pepper, 'otp-request-two', '123456');
  assert.notEqual(firstHash, '123456');
  assert.notEqual(firstHash, secondHash);
  assert.equal(hashesMatch(firstHash, firstHash), true);
  assert.equal(hashesMatch(firstHash, secondHash), false);
});

test('reset sessions require an opaque token tied to a UUID', () => {
  const sessionId = randomUUID();
  const token = 'A'.repeat(43);
  assert.deepEqual(parseResetSession(`${sessionId}.${token}`), { sessionId, token });
  assert.equal(parseResetSession(`${sessionId}.short`), null);
  assert.equal(parseResetSession(`not-a-uuid.${token}`), null);
});

test('password validation preserves the existing Luxe Nails policy', () => {
  assert.deepEqual(getPasswordPolicyFailures('Valid#123', DEFAULT_PASSWORD_POLICY), []);
  const failures = getPasswordPolicyFailures('weak', DEFAULT_PASSWORD_POLICY);
  assert.ok(failures.includes('at least 8 characters'));
  assert.ok(failures.includes('an uppercase letter'));
  assert.ok(failures.includes('a number'));
  assert.ok(failures.includes('a symbol'));
});

test('email normalization is stable for rate-limit keys and Auth lookup', () => {
  assert.equal(normalizeEmail('  Customer@Example.COM '), 'customer@example.com');
});
