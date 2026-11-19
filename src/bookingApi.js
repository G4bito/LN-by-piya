import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
export const BOOKING_FUNCTIONS_REGION = 'asia-southeast1';
const names = { submit: 'submitBooking', availability: 'saveBookingAvailability' };
const knownErrors = new Set(['invalid-argument', 'unauthenticated', 'permission-denied', 'failed-precondition', 'already-exists', 'aborted', 'deadline-exceeded', 'unavailable']);
function apiError(code = 'booking/unavailable') {
  const conflict = ['booking/failed-precondition', 'booking/already-exists', 'booking/aborted'].includes(code);
  return Object.assign(new Error(conflict ? 'This time is no longer available. Please choose another time or try again.' : 'Booking is temporarily unavailable. Please try again later or contact the salon.'), { code });
}

// The SDK attaches the existing Firebase user's ID token. No privileged browser credential.
// https://firebase.google.com/docs/functions/callable#call_the_function
export async function requestBookingOperation(user, operation, data, { call = (name, payload) => httpsCallable(getFunctions(getApp(), BOOKING_FUNCTIONS_REGION), name, { timeout: 35000 })(payload) } = {}) {
  if (!user?.uid) throw apiError('booking/unauthenticated');
  if (!Object.hasOwn(names, operation)) throw apiError('booking/invalid-argument');
  try {
    await user.getIdToken();
    const body = await call(names[operation], data);
    if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw apiError();
    if (operation === 'submit' && (body.data.id !== data.id || body.data.uid !== user.uid)) throw apiError();
    if (operation === 'availability' && typeof body.data.requiresConfirmation !== 'boolean') throw apiError();
    return body.data;
  } catch (error) {
    if (error?.code?.startsWith('booking/')) throw error;
    if (['auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled'].includes(error?.code)) throw apiError('booking/unauthenticated');
    const code = String(error?.code || '').replace(/^functions\//, '');
    throw apiError(knownErrors.has(code) ? `booking/${code}` : 'booking/unavailable');
  }
}
