export const PHONE_REGEX = /^\d{11}$/;

export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\d]/g, '');
}

export function isValidPhoneNumber(value) {
  return PHONE_REGEX.test(normalizePhoneNumber(value));
}

export function sanitizePhoneNumber(value) {
  const normalized = normalizePhoneNumber(value);
  return isValidPhoneNumber(normalized) ? normalized : '';
}
