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

export function isFirebasePermissionDenied(error) {
  const details = `${error?.code || ''} ${error?.message || ''}`.trim().toLowerCase();
  return details.includes('permission_denied')
    || details.includes('permission-denied')
    || details.includes('permission denied');
}

export function getPostAuthDestination({ isAdmin = false, pendingBooking = false } = {}) {
  if (isAdmin === true) return 'admin';
  return pendingBooking ? 'booking' : 'home';
}

export function getEmailAuthErrorMessage(error, mode = 'signin') {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      // Enumeration protection intentionally combines invalid login credentials.
      // https://firebase.google.com/docs/auth/web/password-auth#recommended_enable_email_enumeration_protection
      return 'The email or password could not be verified. Try again, use Google if that is how you registered, or reset your password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/email-already-in-use':
      return 'Unable to create this account. Try signing in, continuing with Google, or resetting your password.';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'Please choose a password that meets the requirements shown.';
    case 'auth/operation-not-allowed':
      return 'Email and password sign-in is currently unavailable. Please contact the salon.';
    case 'auth/user-disabled':
      return 'This account is disabled. Please contact the salon for help.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Unable to sign in. Please check your connection and try again.';
    default:
      if (String(error?.code || '').startsWith('account/') || isFirebasePermissionDenied(error)) return getAccountAccessErrorMessage(error);
      return mode === 'signup' ? 'Your account could not be set up. Please try signing in or contact the salon.' : 'Unable to sign in right now. Please try again or contact the salon.';
  }
}

export function getAccountAccessErrorMessage(error) {
  if (error?.code === 'account/profile-recovery-required') {
    return 'Your sign-in succeeded, but your account profile needs support. Please contact the salon.';
  }
  if (isFirebasePermissionDenied(error)) {
    return 'You signed in, but your account profile could not be accessed. Please contact the salon.';
  }
  return 'Your sign-in succeeded, but account access could not be checked. Check your connection and try again. If this continues, contact the salon.';
}

export function getGoogleAuthErrorMessage(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google Sign-In was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked Google Sign-In. Please allow popups, or open this website in Safari or Chrome outside Messenger and try again.';
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported':
      return 'Google Sign-In is not supported in this browser. Open this website in Safari or Chrome outside Messenger and try again.';
    case 'auth/unauthorized-domain':
      return 'Google Sign-In is unavailable on this website address. Please contact the salon.';
    case 'auth/network-request-failed':
      return 'Unable to sign in. Please check your connection and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    default:
      return error?.message || 'Google Sign-In failed. Please try again.';
  }
}
