import { randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { AvailabilityError } from './bookingAvailabilityService.js';
import { safeBookingErrorCode } from './shared/bookingErrors.js';

const expectedFailures = new Set(['invalid-argument', 'unauthenticated', 'permission-denied', 'failed-precondition', 'already-exists', 'aborted']);
const authFailures = new Set(['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found']);

export function createBookingCallableHandler({ operation, getRuntime, log }) {
  if (!['submit', 'availability'].includes(operation)) throw new Error('Unknown booking operation.');
  return async request => {
    const requestId = randomUUID();
    let stage = 'validate-callable-request';
    const audit = (event, error) => {
      // Only server-generated fields: no payloads, UIDs, emails, tokens or stacks.
      try { log?.({ event, operation: stage, requestId, ...(error ? { code: safeBookingErrorCode(error) } : {}) }); } catch { /* A logging outage cannot undo a committed booking. */ }
    };
    try {
      const token = /^Bearer ([^\s]+)$/i.exec(request?.rawRequest?.headers?.authorization || '')?.[1];
      if (!request?.auth?.uid || !token) throw new AvailabilityError('unauthenticated', 'Please sign in before booking.');
      if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data) || Buffer.byteLength(JSON.stringify(request.data)) > 32768) {
        throw new AvailabilityError('invalid-argument', 'Please review your booking details.');
      }
      stage = 'initialize-booking-server';
      const runtime = getRuntime();
      stage = 'verify-auth-token';
      const claims = await runtime.verifyIdToken(token, true);
      if (!claims?.uid || claims.uid !== request.auth.uid) throw new AvailabilityError('unauthenticated', 'Please sign in again.');
      stage = operation === 'submit' ? 'submit-booking' : 'save-availability';
      if (operation === 'submit') audit('booking_submitted');
      const context = { auth: { uid: claims.uid, token: claims }, data: request.data };
      const result = await (operation === 'submit' ? runtime.service.submitBooking(context) : runtime.service.saveAvailability(context));
      if (operation === 'submit') audit('booking_accepted');
      else if (!result.requiresConfirmation) audit('availability_updated');
      return result;
    } catch (error) {
      if (error instanceof AvailabilityError && expectedFailures.has(error.code) || authFailures.has(error?.code)) {
        audit(operation === 'submit' ? 'booking_validation_rejected' : 'availability_rejected', error);
        if (authFailures.has(error?.code)) throw new HttpsError('unauthenticated', 'Please sign in again.');
        throw new HttpsError(error.code, error.message);
      }
      // Service stages are fixed server labels, never exception messages.
      if (/^[a-z-]{1,60}$/.test(error?.bookingOperation || '')) stage = error.bookingOperation;
      audit(operation === 'submit' ? 'booking_creation_failed' : 'availability_update_failed', error);
      throw new HttpsError('unavailable', 'Booking is temporarily unavailable. Please try again later or contact the salon.');
    }
  };
}
