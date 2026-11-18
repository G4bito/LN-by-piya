import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getDatabase as getAdminDatabase } from 'firebase-admin/database';
import { getAuth, connectAuthEmulator, signInWithCredential, GoogleAuthProvider, onAuthStateChanged } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, goOffline, get, ref, update } from 'firebase/database';
import { deleteApp } from 'firebase/app';
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (![databaseHost, authHost].every(host => /^127\.0\.0\.1:\d+$/.test(host || ''))) throw new Error('Login tests require localhost Auth and Database emulators.');
const projectId = 'demo-luxe-availability';
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const adminApp = initializeAdminApp({ projectId, databaseURL }, 'login-tests');
const database = getAdminDatabase(adminApp), adminAuth = getAdminAuth(adminApp);
const originalRules = JSON.parse(await fs.readFile('database.rules.json', 'utf8'));
let server, firebase, webApp, auth, db;
async function setRules(rules) {
  const response = await fetch(`http://${databaseHost}/.settings/rules.json?ns=${projectId}-default-rtdb`, { method: 'PUT', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(rules) });
  assert.equal(response.status, 200);
}
before(async () => {
  const reset = await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  assert.equal(reset.status, 200);
  server = await createServer({ configFile: false, envDir: false, cacheDir: 'node_modules/.cache/login-emulator-vite', server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{ name: 'demo-login-config', configResolved(config) { Object.assign(config.env, { VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, VITE_FIREBASE_DATABASE_URL: databaseURL, VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: '123456', VITE_FIREBASE_APP_ID: 'demo-app' }); } }] });
  firebase = await server.ssrLoadModule('/src/firebase.js');
  assert.equal(firebase.firebaseConfig.projectId, projectId);
  webApp = firebase.initFirebase(); auth = getAuth(webApp); db = getDatabase(webApp, databaseURL);
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const [hostname, port] = databaseHost.split(':'); connectDatabaseEmulator(db, hostname, Number(port));
  await adminAuth.createUser({ uid: 'client', email: 'client@example.test', password: 'Demo-Only-Password-24!' });
  await adminAuth.createUser({ uid: 'admin', email: 'admin@example.test', password: 'Demo-Only-Password-24!' });
});
beforeEach(async () => {
  await firebase.logOut(); await setRules(originalRules);
  await database.ref().set({ admins: { admin: { uid: 'admin', email: 'admin@example.test', status: 'active' } }, users: { client: { uid: 'client', email: 'client@example.test', status: 'active', fullName: 'Demo Client', completedVisits: 12, loyaltyPoints: 12, loyalty: { completedVisits: 12, rewards: { existing: { status: 'claimed', rewardName: 'Original reward', claimedAt: '2026-10-01T00:00:00Z' } } } } } });
});
after(async () => { await setRules(originalRules); if (auth) await firebase.logOut(); if (db) goOffline(db); if (webApp) await deleteApp(webApp); await server?.close(); await deleteAdminApp(adminApp); });
test('existing email/password customer logs in with earned loyalty and claim history intact', async () => {
  const before = (await database.ref('users/client/loyalty').get()).val();
  const beforeProfile = (await database.ref('users/client').get()).val();
  const user = await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  assert.equal(user.uid, 'client'); assert.equal((await firebase.resolveUserAuthorization(user.uid, user.email)).isAdmin, false);
  await firebase.createOrUpdateCustomerRecord(user);
  assert.deepEqual((await database.ref('users/client/loyalty').get()).val(), before);
  assert.deepEqual((await database.ref('users/client').get()).val(), beforeProfile);
  assert.equal((await firebase.getCustomerProfile(user.uid, user.email)).completedVisits, 12);
});
test('a denied optional login-metadata write must not reject an authorized existing customer', async () => {
  const rules = structuredClone(originalRules); rules.rules.users.$uid.lastLogin = { '.validate': false }; await setRules(rules);
  const before = (await database.ref('users/client').get()).val();
  const user = await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  await firebase.resolveUserAuthorization(user.uid, user.email);
  await firebase.createOrUpdateCustomerRecord(user);
  assert.equal(user.uid, 'client'); assert.equal(auth.currentUser.uid, 'client');
  assert.deepEqual((await database.ref('users/client').get()).val(), before);
});
test('customer without loyalty records can sign in without creating loyalty defaults', async () => {
  await database.ref('users/client').set({ uid: 'client', email: 'client@example.test', status: 'active' });
  const user = await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  await firebase.createOrUpdateCustomerRecord(user);
  assert.equal(user.uid, 'client'); assert.equal((await database.ref('users/client/loyalty').get()).exists(), false);
});
test('administrator login does not provision a customer profile', async () => {
  const user = await firebase.signInWithEmail('admin@example.test', 'Demo-Only-Password-24!', false);
  assert.equal((await firebase.resolveUserAuthorization(user.uid, user.email)).isAdmin, true);
  assert.equal((await database.ref('users/admin').get()).exists(), false);
});

test('production-rule reproduction isolates nested loyalty as the cause of unrelated metadata denials', async () => {
  await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  await assert.rejects(update(ref(db, 'users/client'), { lastLogin: 'demo-login' }), /permission.denied/i);
  // Disposable demo data only: removing this field isolates the failing rule term.
  await database.ref('users/client/loyalty').remove();
  await update(ref(db, 'users/client'), { lastLogin: 'demo-login' });
  assert.equal((await database.ref('users/client/completedVisits').get()).val(), 12);
});

test('missing essential profile is provisioned under the same authenticated UID without replacing the Auth account', async () => {
  await database.ref('users/client').remove();
  const before = await adminAuth.getUser('client');
  const user = await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  const profile = await firebase.createOrUpdateCustomerRecord(user);
  assert.equal(profile.uid, 'client'); assert.equal(profile.status, 'active');
  assert.equal((await database.ref('users/client/loyalty').get()).exists(), false);
  assert.equal((await adminAuth.getUser('client')).metadata.creationTime, before.metadata.creationTime);
});

test('an inconsistent existing UID requires support instead of overwriting the customer', async () => {
  await database.ref('users/client/uid').set('wrong-uid');
  const before = (await database.ref('users/client').get()).val();
  const user = await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  await assert.rejects(firebase.createOrUpdateCustomerRecord(user), { code: 'account/profile-recovery-required' });
  assert.deepEqual((await database.ref('users/client').get()).val(), before);
});

test('essential profile permission denial is not treated as optional loyalty failure', async () => {
  const rules = structuredClone(originalRules); rules.rules.users.$uid['.read'] = false; await setRules(rules);
  const user = await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  await assert.rejects(firebase.resolveUserAuthorization(user.uid, user.email), /permission.denied/i);
});

test('inactive customer and administrator status remain enforced by authorization', async () => {
  for (const uid of ['client', 'admin']) {
    await firebase.logOut(); await database.ref(`${uid === 'admin' ? 'admins' : 'users'}/${uid}/status`).set('inactive');
    const user = await firebase.signInWithEmail(`${uid}@example.test`, 'Demo-Only-Password-24!', false);
    assert.equal((await firebase.resolveUserAuthorization(user.uid, user.email)).status, 'inactive');
    await firebase.logOut(); assert.equal(auth.currentUser, null);
  }
});

test('invalid password is rejected by Authentication before profile verification', async () => {
  await assert.rejects(firebase.signInWithEmail('client@example.test', 'Wrong-Demo-Password!', false), error => ['auth/invalid-credential', 'auth/wrong-password'].includes(error.code));
  assert.equal(auth.currentUser, null);
});

test('Google credential uses the same UID-based profile flow in the Auth emulator', async () => {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ iss: 'https://accounts.google.com', aud: projectId, sub: 'demo-google-client', email: 'google@example.test', email_verified: true, name: 'Demo Google Client' })}.`;
  const result = await signInWithCredential(auth, GoogleAuthProvider.credential(token));
  const authorization = await firebase.resolveUserAuthorization(result.user.uid, result.user.email);
  assert.equal(authorization.isAdmin, false);
  const profile = await firebase.createOrUpdateCustomerRecord(result.user);
  assert.equal(profile.uid, result.user.uid); assert.equal(profile.email, 'google@example.test');
});

test('auth observer session initialization reads the existing customer and preserves progress', async () => {
  await firebase.signInWithEmail('client@example.test', 'Demo-Only-Password-24!', false);
  const restored = await new Promise(resolve => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      if (!user) return;
      const authorization = await firebase.resolveUserAuthorization(user.uid, user.email);
      const profile = await firebase.createOrUpdateCustomerRecord(user);
      unsubscribe(); resolve({ authorization, profile });
    });
  });
  assert.equal(restored.authorization.status, 'active'); assert.equal(restored.profile.completedVisits, 12);
});
