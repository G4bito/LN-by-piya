#!/usr/bin/env node
import admin from 'firebase-admin';
import fs from 'fs';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || argValue('--serviceAccount') || './serviceAccountKey.json';
const databaseURL = process.env.FIREBASE_DATABASE_URL || argValue('--databaseURL');
const configuredAdminEmail = (process.env.ADMIN_EMAIL || argValue('--adminEmail') || '').trim().toLowerCase();
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('Service account file not found at', serviceAccountPath);
  process.exit(1);
}

if (!databaseURL) {
  console.error('Realtime Database URL missing. Set FIREBASE_DATABASE_URL or pass --databaseURL.');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL,
});

const auth = admin.auth();
const database = admin.database();

function normalizeUserRecord(user, existing = {}) {
  const displayName = user.displayName || existing.displayName || '';
  const normalizedName = displayName || existing.fullName || existing.name || (user.email ? user.email.split('@')[0] : 'Guest');
  return {
    uid: user.uid,
    email: user.email || existing.email || '',
    displayName,
    fullName: existing.fullName || normalizedName,
    name: existing.name || normalizedName,
    phone: existing.phone || user.phoneNumber || '',
    address: existing.address || '',
    status: existing.status || 'active',
    dateRegistered: existing.dateRegistered || user.metadata?.creationTime || '',
    lastLogin: user.metadata?.lastSignInTime || existing.lastLogin || '',
    updatedAt: new Date().toISOString(),
  };
}

async function syncAllUsers() {
  console.log('Starting Firebase Authentication → Realtime Database sync');
  let nextPageToken;
  let total = 0;

  do {
    const list = await auth.listUsers(1000, nextPageToken);
    for (const user of list.users) {
      const existingAdmin = await database.ref(`admins/${user.uid}`).get();
      const isConfiguredAdmin = configuredAdminEmail && user.email?.toLowerCase() === configuredAdminEmail;
      const path = existingAdmin.exists() || isConfiguredAdmin ? 'admins' : 'users';
      const targetRef = database.ref(`${path}/${user.uid}`);
      const existingSnapshot = await targetRef.get();
      const profile = normalizeUserRecord(user, existingSnapshot.val() || {});

      total += 1;
      if (dryRun) {
        console.log('[dry-run]', `${path}/${user.uid}`, profile.email || profile.fullName);
      } else {
        await targetRef.update(profile);
        console.log('synced', `${path}/${user.uid}`, profile.email || profile.fullName);
      }
    }
    nextPageToken = list.pageToken;
  } while (nextPageToken);

  console.log(`Sync complete. Processed ${total} users.`);
}

syncAllUsers()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Sync failed', error);
    process.exit(1);
  });
