import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { createBookingAvailabilityService } from './bookingAvailabilityService.js';

// Cloud Functions supplies managed ADC. No private key or human login fallback.
// https://firebase.google.com/docs/admin/setup#initialize_the_sdk
export function getBookingRuntime() {
  const env = process.env;
  const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || 'ln-by-piya';
  const localDemo = env.FUNCTIONS_EMULATOR === 'true' && /^demo-[a-z0-9-]+$/.test(projectId)
    && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || '')
    && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_DATABASE_EMULATOR_HOST || '');
  if (!localDemo && (projectId !== 'ln-by-piya' || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST)) {
    throw Object.assign(new Error('Invalid managed booking configuration.'), { code: 'server/configuration' });
  }
  const databaseURL = localDemo ? `https://${projectId}-default-rtdb.firebaseio.com`
    : 'https://ln-by-piya-default-rtdb.asia-southeast1.firebasedatabase.app';
  let app = getApps().find(item => item.name === '[DEFAULT]');
  if (app && (app.options.projectId !== projectId || app.options.databaseURL !== databaseURL)) {
    throw Object.assign(new Error('Mismatched managed booking application.'), { code: 'server/configuration' });
  }
  app ||= initializeApp({ projectId, databaseURL });
  return { verifyIdToken: (token, revoked) => getAuth(app).verifyIdToken(token, revoked), service: createBookingAvailabilityService(getDatabase(app)) };
}
