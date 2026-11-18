import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { initializeApp as initializeAdminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getDatabase as getAdminDatabase } from 'firebase-admin/database';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectDatabaseEmulator, get, getDatabase, goOffline, ref, set } from 'firebase/database';
import { DEFAULT_LOYALTY_REWARDS, applyLoyaltyRewardClaim, createLoyaltyProgramPayload, getLoyaltyState } from '../../src/loyaltyProgram.js';
import { createRewardDraft } from '../../src/rewardEditor.js';

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:\d+$/.test(host || '')) throw new Error('Rewards integration tests require the local demo emulator.');
const projectId = 'demo-luxe-availability';
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const adminApp = initializeAdminApp({ projectId, databaseURL }, 'reward-tests');
const database = getAdminDatabase(adminApp);
const adminUid = 'salon-admin';
const originalTime = '2026-09-01T00:00:00.000Z';
let server, firebase, webApp, webDb;
const clients = [];

before(async () => {
  server = await createServer({
    configFile: false, envDir: false, cacheDir: 'node_modules/.cache/reward-emulator-vite',
    server: { middlewareMode: true, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: [{ find: /^firebase\/auth$/, replacement: 'fixture:reward-auth' }] },
    plugins: [{
      name: 'reward-test-auth-context', enforce: 'pre',
      configResolved(config) {
        Object.assign(config.env, { VITE_FIREBASE_API_KEY: 'demo-key', VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`, VITE_FIREBASE_DATABASE_URL: databaseURL, VITE_FIREBASE_PROJECT_ID: projectId, VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`, VITE_FIREBASE_MESSAGING_SENDER_ID: '123456', VITE_FIREBASE_APP_ID: 'demo-app' });
      },
      resolveId(id) { if (id === 'fixture:reward-auth') return '\0fixture:reward-auth'; },
      load(id) { if (id === '\0fixture:reward-auth') return `export const getAuth = () => ({ currentUser: { uid: '${adminUid}' } }); export class GoogleAuthProvider { setCustomParameters() {} }`; },
    }],
  });
  firebase = await server.ssrLoadModule('/src/firebase.js');
  assert.equal(firebase.firebaseConfig.projectId, projectId);
  webApp = firebase.initFirebase();
  webDb = getDatabase(webApp, databaseURL);
  const [hostname, port] = host.split(':');
  connectDatabaseEmulator(webDb, hostname, Number(port), { mockUserToken: { sub: adminUid, email: 'admin@example.test' } });
});

beforeEach(async () => {
  const program = createLoyaltyProgramPayload({ active: true, rewards: DEFAULT_LOYALTY_REWARDS }, { updatedAt: originalTime, updatedBy: adminUid });
  const claimed = applyLoyaltyRewardClaim({ uid: 'client', email: 'client@example.test', status: 'active', completedVisits: 20, loyaltyPoints: 20 }, program, { rewardId: DEFAULT_LOYALTY_REWARDS[0].id, claimId: 'original-claim', claimedAt: '2026-10-01T00:00:00.000Z', claimedBy: adminUid });
  await database.ref().set({
    admins: { [adminUid]: { uid: adminUid, email: 'admin@example.test', status: 'active' } },
    users: { client: claimed.profile }, loyaltyProgram: program,
  });
});

after(async () => {
  for (const { app, db } of clients) { goOffline(db); await deleteApp(app); }
  if (webDb) goOffline(webDb);
  if (webApp) await deleteApp(webApp);
  await server?.close();
  await deleteAdminApp(adminApp);
});

test('the existing Firebase reader loads the current reward definitions', async () => {
  const loaded = await new Promise((resolve, reject) => {
    const unsubscribe = firebase.listenToLoyaltyProgram((program) => { unsubscribe(); resolve(program); }, reject);
  });
  assert.equal(loaded.rewards.length, 4);
  assert.deepEqual(loaded.rewards.map((reward) => reward.id), DEFAULT_LOYALTY_REWARDS.map((reward) => reward.id));
});

test('the existing save helper persists an edit with IDs and customer claim history intact', async () => {
  const before = (await database.ref('users').get()).val();
  const current = (await get(ref(webDb, 'loyaltyProgram'))).val();
  const rewards = Object.entries(current.rewards).map(([id, value]) => ({ ...value, id }));
  const id = rewards[0].id;
  const draft = { ...createRewardDraft(rewards[0]), name: 'Updated Nail Art Reward', requiredVisits: 6 };
  await firebase.saveLoyaltyProgram({ active: true, rewards: rewards.map((reward) => reward.id === id ? draft : reward) });
  const reloaded = (await get(ref(webDb, 'loyaltyProgram'))).val();
  assert.equal(reloaded.rewards[id].name, 'Updated Nail Art Reward');
  assert.equal(reloaded.rewards[id].createdAt, originalTime);
  assert.deepEqual(Object.keys(reloaded.rewards).sort(), Object.keys(current.rewards).sort());
  assert.deepEqual((await database.ref('users').get()).val(), before);
  assert.equal(getLoyaltyState(before.client, 0, reloaded).rewardHistory[0].rewardName, DEFAULT_LOYALTY_REWARDS[0].name);
});

test('creating a reward through the existing helper keeps all existing definitions and customers', async () => {
  const before = (await database.ref('users').get()).val();
  const id = firebase.createLoyaltyRewardId();
  const draft = { ...createRewardDraft(), id, name: 'Extra Gel Reward', description: 'Enjoy an additional gel service.', requiredVisits: 25, rewardType: 'free_service' };
  await firebase.saveLoyaltyProgram({ active: true, rewards: [...DEFAULT_LOYALTY_REWARDS, draft] });
  const reloaded = (await get(ref(webDb, 'loyaltyProgram/rewards'))).val();
  assert.equal(Object.keys(reloaded).length, 5);
  assert.equal(reloaded[id].requiredVisits, 25);
  DEFAULT_LOYALTY_REWARDS.forEach((reward) => assert.ok(reloaded[reward.id]));
  assert.deepEqual((await database.ref('users').get()).val(), before);
});

test('deactivating and reactivating preserve earned records, lifetime visits, and claim timestamps', async () => {
  const before = (await database.ref('users').get()).val();
  const id = DEFAULT_LOYALTY_REWARDS[0].id;
  for (const active of [false, true]) {
    await firebase.saveLoyaltyProgram({ active: true, rewards: DEFAULT_LOYALTY_REWARDS.map((reward) => reward.id === id ? { ...reward, active } : reward) });
    assert.equal((await get(ref(webDb, `loyaltyProgram/rewards/${id}/active`))).val(), active);
    assert.deepEqual((await database.ref('users').get()).val(), before);
  }
});

test('unauthorized reward writes remain denied by the unchanged Firebase rules', async () => {
  const app = initializeApp({ projectId, databaseURL }, 'reward-customer');
  const db = getDatabase(app);
  const [hostname, port] = host.split(':');
  connectDatabaseEmulator(db, hostname, Number(port), { mockUserToken: { sub: 'client', email: 'client@example.test' } });
  clients.push({ app, db });
  const before = (await database.ref('loyaltyProgram').get()).val();
  const payload = createLoyaltyProgramPayload({ active: true, rewards: DEFAULT_LOYALTY_REWARDS }, { updatedBy: 'client' });
  await assert.rejects(set(ref(db, 'loyaltyProgram'), payload), /permission_denied/i);
  assert.deepEqual((await database.ref('loyaltyProgram').get()).val(), before);
});
