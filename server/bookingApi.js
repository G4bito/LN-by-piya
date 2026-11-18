import { AvailabilityError } from '../functions/bookingAvailabilityService.js';
import { bookingDiagnostic } from '../functions/shared/bookingErrors.js';

const statuses = { 'invalid-argument': 400, unauthenticated: 401, 'permission-denied': 403, 'already-exists': 409, 'failed-precondition': 409, aborted: 409 };
const authFailures = new Set(['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found']);

// Vercel Node request/response API. Firebase ID tokens are verified server-side.
// https://vercel.com/docs/functions/runtimes/node-js
// https://firebase.google.com/docs/auth/admin/verify-id-tokens
export function createBookingApi({ getRuntime, log = value => console.error('Booking API failed.', value) }) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    let operation = 'validate-booking-request';
    try {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: { code: 'booking/method-not-allowed', message: 'This request is not supported.' } });
      }
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers?.authorization || '')?.[1];
      if (!token) throw new AvailabilityError('unauthenticated', 'Please sign in before booking.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers?.['content-type'] || '')) throw new AvailabilityError('invalid-argument', 'Send a valid booking request.');
      let body = request.body;
      if (typeof body === 'string') {
        if (Buffer.byteLength(body) > 32768) throw new AvailabilityError('invalid-argument', 'The booking request is too large.');
        try { body = JSON.parse(body); } catch { throw new AvailabilityError('invalid-argument', 'Send a valid booking request.'); }
      }
      if (!body || !['submit', 'availability'].includes(body.operation) || !body.data || typeof body.data !== 'object' || Array.isArray(body.data) || Buffer.byteLength(JSON.stringify(body)) > 32768) throw new AvailabilityError('invalid-argument', 'Send a valid booking request.');
      operation = 'initialize-booking-server';
      const runtime = getRuntime();
      operation = 'verify-auth-token';
      const tokenClaims = await runtime.verifyIdToken(token, true);
      operation = body.operation === 'submit' ? 'submit-booking' : 'save-availability';
      const context = { auth: { uid: tokenClaims.uid, token: tokenClaims }, data: body.data };
      const data = await (body.operation === 'submit' ? runtime.service.submitBooking(context) : runtime.service.saveAvailability(context));
      return response.status(200).json({ data });
    } catch (error) {
      log(bookingDiagnostic(error, error?.bookingOperation || operation));
      if (error instanceof AvailabilityError && statuses[error.code]) return response.status(statuses[error.code]).json({ error: { code: `booking/${error.code}`, message: error.message } });
      if (authFailures.has(error?.code)) return response.status(401).json({ error: { code: 'booking/unauthenticated', message: 'Please sign in again.' } });
      return response.status(503).json({ error: { code: 'booking/unavailable', message: 'Booking is temporarily unavailable. Please try again later or contact the salon.' } });
    }
  };
}
