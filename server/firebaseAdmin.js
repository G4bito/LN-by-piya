import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { createBookingAvailabilityService } from '../functions/bookingAvailabilityService.js';

export function getBookingRuntime() {
  let app = getApps().find(item => item.name === 'booking-api');
  if (!app) {
    const env = process.env;
    const localEmulators = env.VERCEL !== '1' && env.NODE_ENV !== 'production' && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST || '') && /^127\.0\.0\.1:\d+$/.test(env.FIREBASE_DATABASE_EMULATOR_HOST || '') && /^demo-[a-z0-9-]+$/.test(env.FIREBASE_PROJECT_ID || '');
    if (localEmulators) {
      app = initializeApp({ projectId: env.FIREBASE_PROJECT_ID, databaseURL: `https://${env.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com` }, 'booking-api');
    } else {
      // Emulator token acceptance is never allowed in a deployed environment.
      if (env.FIREBASE_AUTH_EMULATOR_HOST || env.FIREBASE_DATABASE_EMULATOR_HOST) throw Object.assign(new Error('Invalid server configuration.'), { code: 'server/configuration' });
      let account;
      try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || ''); } catch { throw Object.assign(new Error('Missing server credentials.'), { code: 'server/configuration' }); }
      const projectId = env.FIREBASE_PROJECT_ID || 'ln-by-piya';
      const databaseURL = new URL(env.FIREBASE_DATABASE_URL || '');
      const validHost = databaseURL.hostname === `${projectId}.firebaseio.com` || databaseURL.hostname === `${projectId}-default-rtdb.firebaseio.com` || databaseURL.hostname.startsWith(`${projectId}-default-rtdb.`) && databaseURL.hostname.endsWith('.firebasedatabase.app');
      if (account.project_id !== projectId || !validHost || databaseURL.protocol !== 'https:' || databaseURL.username || databaseURL.password || databaseURL.search) throw Object.assign(new Error('Mismatched server configuration.'), { code: 'server/configuration' });
      app = initializeApp({ credential: cert(account), projectId, databaseURL: databaseURL.href }, 'booking-api');
    }
  }
  const auth = getAuth(app);
  return { verifyIdToken: (token, revoked) => auth.verifyIdToken(token, revoked), service: createBookingAvailabilityService(getDatabase(app)) };
}
