export function getAdminAuthorizationFromRecord(record, uid, email) {
  if (!record || typeof record !== 'object' || !uid) return null;

  const recordUid = String(record.uid || '').trim();
  const recordEmail = String(record.email || '').trim().toLowerCase();
  const authenticatedEmail = String(email || '').trim().toLowerCase();
  if (recordUid !== uid || !recordEmail || recordEmail !== authenticatedEmail) return null;

  return {
    role: 'admin',
    isAdmin: true,
    status: record.status === 'inactive' ? 'inactive' : 'active',
  };
}

export function getPostAuthDestination({ isAdmin = false, pendingBooking = false } = {}) {
  if (isAdmin === true) return 'admin';
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
