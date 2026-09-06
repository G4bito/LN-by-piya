export const PASSWORD_RESET_EMAIL_MESSAGE = 'If an account exists for this email, a password reset email has been sent.';

export function normalizePasswordResetEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function getPasswordResetEmailErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'auth/network-request-failed') {
    return 'Unable to connect. Please check your internet connection.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many requests. Please wait a few minutes and try again.';
  }
  if (code === 'auth/invalid-email' || code === 'auth/missing-email') {
    return 'Please enter a valid email address.';
  }
  return "We couldn't complete the request. Please try again.";
}
