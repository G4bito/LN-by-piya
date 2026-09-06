import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const RESET_SESSION_TTL_MS = 5 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;

export const DEFAULT_PASSWORD_POLICY = Object.freeze({
  minLength: 8,
  maxLength: 4096,
  requireLowercase: true,
  requireUppercase: true,
  requireNumeric: true,
  requireNonAlphanumeric: true,
});

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function normalizeOtp(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 6);
}

export function isValidOtp(value) {
  return /^\d{6}$/.test(String(value ?? ''));
}

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function generateOpaqueToken(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url');
}

export function hashProtectedValue(pepper, context, value) {
  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('PASSWORD_RESET_PEPPER must contain at least 32 characters.');
  }
  return createHmac('sha256', pepper)
    .update(`${context}:${String(value)}`, 'utf8')
    .digest('hex');
}

export function hashesMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function parseResetSession(value) {
  if (typeof value !== 'string') return null;
  const [sessionId, token, extra] = value.split('.');
  if (extra || !/^[a-f0-9-]{36}$/i.test(sessionId || '') || !/^[A-Za-z0-9_-]{40,}$/.test(token || '')) {
    return null;
  }
  return { sessionId, token };
}

export function mergePasswordPolicy(remoteConstraints = {}) {
  return {
    minLength: Math.max(DEFAULT_PASSWORD_POLICY.minLength, Number(remoteConstraints.minLength) || 0),
    maxLength: Math.min(DEFAULT_PASSWORD_POLICY.maxLength, Number(remoteConstraints.maxLength) || DEFAULT_PASSWORD_POLICY.maxLength),
    requireLowercase: DEFAULT_PASSWORD_POLICY.requireLowercase || remoteConstraints.requireLowercase === true,
    requireUppercase: DEFAULT_PASSWORD_POLICY.requireUppercase || remoteConstraints.requireUppercase === true,
    requireNumeric: DEFAULT_PASSWORD_POLICY.requireNumeric || remoteConstraints.requireNumeric === true,
    requireNonAlphanumeric: DEFAULT_PASSWORD_POLICY.requireNonAlphanumeric || remoteConstraints.requireNonAlphanumeric === true,
  };
}

export function getPasswordPolicyFailures(password, policy = DEFAULT_PASSWORD_POLICY) {
  if (typeof password !== 'string') return ['a password'];
  const failures = [];
  if (password.length < policy.minLength) failures.push(`at least ${policy.minLength} characters`);
  if (password.length > policy.maxLength) failures.push(`no more than ${policy.maxLength} characters`);
  if (policy.requireLowercase && !/[a-z]/.test(password)) failures.push('a lowercase letter');
  if (policy.requireUppercase && !/[A-Z]/.test(password)) failures.push('an uppercase letter');
  if (policy.requireNumeric && !/\d/.test(password)) failures.push('a number');
  if (policy.requireNonAlphanumeric && !/[^A-Za-z\d]/.test(password)) failures.push('a symbol');
  return failures;
}
