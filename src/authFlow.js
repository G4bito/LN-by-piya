export function isAdminAccount(email, adminEmail) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedAdminEmail = String(adminEmail || '').trim().toLowerCase();
  return Boolean(normalizedEmail && normalizedAdminEmail && normalizedEmail === normalizedAdminEmail);
}

export function getPostAuthDestination({ email, adminEmail, pendingBooking = false } = {}) {
  if (isAdminAccount(email, adminEmail)) return 'admin';
  return pendingBooking ? 'booking' : 'home';
}

export function getGoogleAuthErrorMessage(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google Sign-In was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google Sign-In popup. Please allow popups and try again.';
    case 'auth/network-request-failed':
      return 'Unable to sign in. Please check your connection and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    default:
      return error?.message || 'Google Sign-In failed. Please try again.';
  }
}
