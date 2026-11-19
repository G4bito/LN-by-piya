import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { createBookingAvailabilityService } from './bookingAvailabilityService.js';

// Cloud Functions supplies managed ADC. No private key or human login fallback.
// https://firebase.google.com/docs/admin/setup#initialize_the_sdk
export function initializeBookingApp() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'ln-by-piya';
  const databaseURL = /^demo-[a-z0-9-]+$/.test(projectId) ? `https://${projectId}-default-rtdb.firebaseio.com`
    : 'https://ln-by-piya-default-rtdb.asia-southeast1.firebasedatabase.app';
  let app = getApps().find(item => item.name === '[DEFAULT]');
  if (app && (app.options.projectId !== projectId || app.options.databaseURL !== databaseURL)) {
    throw Object.assign(new Error('Mismatched managed booking application.'), { code: 'server/configuration' });
  }
  // Constructing the app does not fetch credentials or open the database.
  return app || initializeApp({ projectId, databaseURL });
}

export function getBookingRuntime() {
  const env = process.env;
  const projectId = env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || 'ln-by-piya';
  const localDemo = env.FUNCTIONS_EMULATOR === 'true' && /^demo-[a-z0-9-]+$/.test(projectId)
    && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || '')
    && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_DATABASE_EMULATOR_HOST || '');
  if (!localDemo && (projectId !== 'ln-by-piya' || env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST || env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_SERVICE_ACCOUNT_JSON)) {
    throw Object.assign(new Error('Invalid managed booking configuration.'), { code: 'server/configuration' });
  }
  const app = initializeBookingApp();
  return { verifyIdToken: (token, revoked) => getAuth(app).verifyIdToken(token, revoked), service: createBookingAvailabilityService(getDatabase(app)) };
}
