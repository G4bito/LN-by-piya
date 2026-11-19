import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { onCall } from 'firebase-functions/v2/https';
import { createBookingCallableHandler } from './bookingCallable.js';
import { getBookingRuntime, initializeBookingApp } from './bookingRuntime.js';

// Reuse the default app before the callable framework verifies its first token.
initializeBookingApp();

// This codebase exports booking only: no email secrets or scheduled jobs.
// https://firebase.google.com/docs/functions/organize-functions#organize_functions_in_codebases
const serviceAccount = defineString('BOOKING_RUNTIME_SERVICE_ACCOUNT', {
  default: 'booking-runtime@ln-by-piya.iam.gserviceaccount.com',
  description: 'Approved keyless booking runtime identity with reviewed Auth/RTDB permissions.',
});
const options = { region: 'asia-southeast1', memory: '256MiB', timeoutSeconds: 30, minInstances: 0, maxInstances: 2, serviceAccount };
const handler = operation => createBookingCallableHandler({ operation, getRuntime: getBookingRuntime, log: event => logger.info(event) });
export const submitBooking = onCall(options, handler('submit'));
export const saveBookingAvailability = onCall(options, handler('availability'));
