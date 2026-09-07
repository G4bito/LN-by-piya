// Minimal Firebase helper. Install firebase and add your config.
// npm install firebase

import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
} from 'firebase/auth';
import { getDatabase, ref, set, get, onValue, update, push, remove, runTransaction, query as rtdbQuery, orderByChild, orderByKey, equalTo, startAt, endAt, limitToLast } from 'firebase/database';
import { mergeProfileData } from './profilePersistence';
import {
  PASSWORD_RESET_EMAIL_MESSAGE,
  getPasswordResetEmailErrorMessage,
  normalizePasswordResetEmail,
} from './passwordResetEmail';
import { sanitizePhoneNumber } from './validation';
import { applyCompletedBookingReward } from './adminData';
import {
  applyLoyaltyRewardClaim,
  createLoyaltyProgramPayload,
  normalizeLoyaltyProgram,
} from './loyaltyProgram';
import {
  PENDING_SLOT_HOLD_MS,
  ScheduleConflictError,
  createScheduleEntry,
  getAppointmentDurationMinutes,
  getAppointmentInterval,
  hasScheduleConflict,
  isConfirmedScheduleStatus,
} from './scheduling';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  passwordResetContinueUrl: import.meta.env.VITE_PASSWORD_RESET_CONTINUE_URL,
};

let app = null;
let rtdb = null;
let auth = null;
let googleProvider = null;
let passwordResetActionCodeSettings;
const customerRecordSyncPromises = new Map();
const accountStatusPromises = new Map();
const accountStatusCache = new Map();
const ACCOUNT_STATUS_CACHE_MS = 5000;

const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60}$/;

function sanitizeName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return NAME_REGEX.test(trimmed) ? trimmed : '';
}

function sanitizePhone(value) {
  return sanitizePhoneNumber(value);
}

function sanitizeAddress(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

export function getMissingFirebaseEnvironmentVariables() {
  const missingVariables = [];

  if (!String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim()) {
    missingVariables.push('VITE_FIREBASE_API_KEY');
  }
  if (!String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim()) {
    missingVariables.push('VITE_FIREBASE_AUTH_DOMAIN');
  }
  if (!String(import.meta.env.VITE_FIREBASE_DATABASE_URL || '').trim()) {
    missingVariables.push('VITE_FIREBASE_DATABASE_URL');
  }
  if (!String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim()) {
    missingVariables.push('VITE_FIREBASE_PROJECT_ID');
  }
  if (!String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim()) {
    missingVariables.push('VITE_FIREBASE_STORAGE_BUCKET');
  }
  if (!String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim()) {
    missingVariables.push('VITE_FIREBASE_MESSAGING_SENDER_ID');
  }
  if (!String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim()) {
    missingVariables.push('VITE_FIREBASE_APP_ID');
  }

  return missingVariables;
}

function getFirebaseAuthenticationUnavailableMessage() {
  const missingVariables = getMissingFirebaseEnvironmentVariables();
  if (missingVariables.length > 0) {
    return `Firebase authentication is not configured. Missing: ${missingVariables.join(', ')}.`;
  }
  return 'Firebase authentication failed to initialize. Check the browser console for the Firebase initialization error.';
}

function sanitizePreference(value, maxLength = 60) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeNailPreferences(incomingPreferences, existingPreferences = {}) {
  const incoming = incomingPreferences && typeof incomingPreferences === 'object'
    ? incomingPreferences
    : null;
  const existing = existingPreferences && typeof existingPreferences === 'object'
    ? existingPreferences
    : {};
  const preferenceValue = (key) => (
    incoming && Object.prototype.hasOwnProperty.call(incoming, key) ? incoming[key] : existing[key]
  );

  return {
    shape: sanitizePreference(preferenceValue('shape')),
    length: sanitizePreference(preferenceValue('length')),
    finish: sanitizePreference(preferenceValue('finish')),
    favoriteColor: sanitizePreference(preferenceValue('favoriteColor')),
    favoriteService: sanitizePreference(preferenceValue('favoriteService')),
    preferredTechnician: sanitizePreference(preferenceValue('preferredTechnician')),
    notes: sanitizePreference(preferenceValue('notes'), 240),
  };
}

function createProfileUpdate(profile) {
  const { nailPreferences = {}, notificationPreferences = {}, ...profileFields } = profile || {};
  return {
    ...profileFields,
    'nailPreferences/shape': nailPreferences.shape || '',
    'nailPreferences/length': nailPreferences.length || '',
    'nailPreferences/finish': nailPreferences.finish || '',
    'nailPreferences/favoriteColor': nailPreferences.favoriteColor || '',
    'nailPreferences/favoriteService': nailPreferences.favoriteService || '',
    'nailPreferences/preferredTechnician': nailPreferences.preferredTechnician || '',
    'nailPreferences/notes': nailPreferences.notes || '',
    'notificationPreferences/emailAppointmentReminders': notificationPreferences.emailAppointmentReminders !== false,
  };
}

function isAdminEmail(email) {
  return typeof email === 'string' && String(email).toLowerCase() === ADMIN_EMAIL;
}

function getProfileStorageKey(uid) {
  return `luxe-nails-profile:${uid}`;
}

function getRecordPath(email) {
  return isAdminEmail(email) ? 'admins' : 'users';
}

function isRealtimeDatabaseAvailable() {
  return Boolean(rtdb);
}

function getPasswordResetActionCodeSettings(continueUrl) {
  const value = typeof continueUrl === 'string' ? continueUrl.trim() : '';
  if (!value) return undefined;

  try {
    const parsedUrl = new URL(value);
    const isLocalDevelopment = parsedUrl.protocol === 'http:'
      && (parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1');
    if (parsedUrl.protocol !== 'https:' && !isLocalDevelopment) throw new Error('Unsupported URL protocol.');
    return { url: parsedUrl.toString(), handleCodeInApp: false };
  } catch {
    console.warn('Ignoring invalid VITE_PASSWORD_RESET_CONTINUE_URL configuration.');
    return undefined;
  }
}

function readStoredProfile(uid) {
  if (!uid || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getProfileStorageKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('Unable to read local profile', error);
    return null;
  }
}

function writeStoredProfile(uid, profile) {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getProfileStorageKey(uid), JSON.stringify(profile));
  } catch (error) {
    console.warn('Unable to save local profile', error);
  }
}

export function initFirebase() {
  if (app) return app;

  const missingVariables = getMissingFirebaseEnvironmentVariables();
  if (missingVariables.length > 0) {
    console.error('Firebase initialization skipped. Missing Vite environment variables:', missingVariables);
    return null;
  }

  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  rtdb = getDatabase(app, firebaseConfig.databaseURL);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  passwordResetActionCodeSettings = getPasswordResetActionCodeSettings(firebaseConfig.passwordResetContinueUrl);
  googleProvider.setCustomParameters({ prompt: 'select_account' });

  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__LuxeFirebaseDebug = {
      environment: {
        apiKey: Boolean(firebaseConfig.apiKey),
        authDomain: Boolean(firebaseConfig.authDomain),
        databaseURL: Boolean(firebaseConfig.databaseURL),
        projectId: Boolean(firebaseConfig.projectId),
        storageBucket: Boolean(firebaseConfig.storageBucket),
        messagingSenderId: Boolean(firebaseConfig.messagingSenderId),
        appId: Boolean(firebaseConfig.appId),
        measurementId: Boolean(firebaseConfig.measurementId),
      },
      runtime: {
        realtime: Boolean(rtdb),
        functions: Boolean(app),
      },
    };
    console.info('LuxeFirebase initialized', window.__LuxeFirebaseDebug);
  }

  return app;
}

async function applyPersistence(remember) {
  if (!auth) {
    throw new Error(getFirebaseAuthenticationUnavailableMessage());
  }
  const persistence = remember ? browserLocalPersistence : browserSessionPersistence;
  await setPersistence(auth, persistence);
}

async function readAccountStatus(uid, email) {
  if (!rtdb) return 'active';
  try {
    const path = getRecordPath(email);
    const userRef = ref(rtdb, `${path}/${uid}`);
    const snap = await get(userRef);
    if (snap.exists()) {
      const data = snap.val();
      return data.status || 'active';
    }
    if (path === 'admins') {
      const fallbackRef = ref(rtdb, `users/${uid}`);
      const fallbackSnap = await get(fallbackRef);
      if (fallbackSnap.exists()) {
        const data = fallbackSnap.val();
        return data.status || 'active';
      }
    }
  } catch (error) {
    console.warn('Unable to check account status', error);
  }
  return 'active';
}

async function checkAccountStatus(uid, email) {
  const cached = accountStatusCache.get(uid);
  if (cached && Date.now() - cached.checkedAt < ACCOUNT_STATUS_CACHE_MS) {
    return cached.status;
  }

  const pending = accountStatusPromises.get(uid);
  if (pending) return pending;

  const statusPromise = readAccountStatus(uid, email)
    .then((status) => {
      accountStatusCache.set(uid, { status, checkedAt: Date.now() });
      return status;
    })
    .finally(() => {
      if (accountStatusPromises.get(uid) === statusPromise) accountStatusPromises.delete(uid);
    });
  accountStatusPromises.set(uid, statusPromise);
  return statusPromise;
}

export async function getAccountStatus(uid, email) {
  return checkAccountStatus(uid, email);
}

export async function signInWithGoogle(remember = true) {
  if (!auth) {
    throw new Error(getFirebaseAuthenticationUnavailableMessage());
  }

  await applyPersistence(remember);

  try {
    const result = await signInWithPopup(auth, googleProvider);

    const accountStatus = await checkAccountStatus(result.user.uid, result.user.email);
    if (accountStatus === 'inactive') {
      await signOut(auth);
      throw new Error('Your account has been deactivated. Please contact support.');
    }

    await createOrUpdateCustomerRecord(result.user).catch((error) => {
      console.warn('Failed to sync customer record after Google sign-in', error);
    });
    return result.user;
  } catch (error) {
    throw error;
  }
}

export async function signInWithEmail(email, password, remember = true) {
  if (!auth) {
    throw new Error(getFirebaseAuthenticationUnavailableMessage());
  }

  await applyPersistence(remember);
  const result = await signInWithEmailAndPassword(auth, email, password);

  const accountStatus = await checkAccountStatus(result.user.uid, email);
  if (accountStatus === 'inactive') {
    await signOut(auth);
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  await createOrUpdateCustomerRecord(result.user).catch((error) => {
    console.warn('Failed to sync customer record after email sign-in', error);
  });
  return result.user;
}

export async function createAccountWithEmail(name, email, password, remember = true) {
  if (!auth) {
    throw new Error(getFirebaseAuthenticationUnavailableMessage());
  }

  await applyPersistence(remember);
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (name && auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: name });
  }

  const currentUser = auth.currentUser || result.user;
  if (currentUser) {
    await createOrUpdateCustomerRecord(currentUser).catch((error) => {
      console.warn('Failed to sync customer record after account creation', error);
    });
  }
  return result.user;
}

export function subscribeToAuthChanges(callback) {
  if (!auth) {
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, callback);
}

export async function logOut() {
  if (!auth) {
    return Promise.resolve();
  }
  return signOut(auth);
}

export async function requestPasswordResetEmail(email) {
  if (!auth) throw new Error('Password recovery is not configured yet.');

  const normalizedEmail = normalizePasswordResetEmail(email);
  try {
    await firebaseSendPasswordResetEmail(auth, normalizedEmail, passwordResetActionCodeSettings);
  } catch (error) {
    // Older Firebase projects can still return user-not-found when email-enumeration
    // protection is disabled. Keep the public response neutral either way.
    if (error?.code === 'auth/user-not-found') {
      return { success: true, message: PASSWORD_RESET_EMAIL_MESSAGE };
    }

    console.error('Firebase password reset email request failed', {
      code: error?.code || 'unknown',
    });
    const friendlyError = new Error(getPasswordResetEmailErrorMessage(error));
    friendlyError.name = 'PasswordRecoveryError';
    friendlyError.code = error?.code || 'auth/unknown';
    throw friendlyError;
  }

  return { success: true, message: PASSWORD_RESET_EMAIL_MESSAGE };
}

function promiseWithTimeout(promise, ms, errorMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export async function saveBooking(booking) {
  const appointmentInterval = getAppointmentInterval(booking);
  const sanitizedBooking = Object.fromEntries(
    Object.entries({
      ...booking,
      name: sanitizeName(booking?.name || booking?.customerName),
      customerName: sanitizeName(booking?.customerName || booking?.name),
      email: booking?.email || booking?.customerEmail || '',
      phone: sanitizePhone(booking?.phone || booking?.customerPhone),
      customerPhone: sanitizePhone(booking?.customerPhone || booking?.phone),
      address: booking?.address || '',
      notes: String(booking?.notes || '').trim(),
      serviceName: String(booking?.serviceName || booking?.serviceTitle || '').trim(),
      status: 'Pending Confirmation',
      seenByAdmin: false,
      durationMinutes: appointmentInterval?.durationMinutes || getAppointmentDurationMinutes(booking),
      startMinutes: appointmentInterval?.startMinutes,
      endMinutes: appointmentInterval?.endMinutes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).filter(([, value]) => value !== undefined)
  );

  if (!isRealtimeDatabaseAvailable()) {
    throw new Error('Realtime Database is not initialized. Check VITE_FIREBASE_DATABASE_URL and restart the app.');
  }

  if (!sanitizedBooking.uid) {
    throw new Error('Please sign in before submitting a booking.');
  }

  const bookingsRef = ref(rtdb, 'bookings');
  const newBookingRef = push(bookingsRef);
  const bookingId = newBookingRef.key;
  const bookingWithId = { id: bookingId, ...sanitizedBooking };
  const pendingScheduleEntry = createScheduleEntry(
    bookingWithId,
    'Pending',
    Date.now() + PENDING_SLOT_HOLD_MS
  );
  if (!pendingScheduleEntry) {
    throw new Error('Please select a valid service, date, and time before confirming.');
  }
  let scheduleLock = null;
  let scheduleClaimCreated = false;

  try {
    scheduleLock = await acquireScheduleMutex(sanitizedBooking.date, sanitizedBooking.uid);
    const scheduleEntries = await readScheduleDate(sanitizedBooking.date);
    if (hasScheduleConflict(bookingWithId, scheduleEntries, { includePendingHolds: true })) {
      throw new ScheduleConflictError();
    }

    await set(ref(rtdb, `scheduleSlots/${sanitizedBooking.date}/${bookingId}`), pendingScheduleEntry);
    scheduleClaimCreated = true;
    await promiseWithTimeout(
      set(newBookingRef, sanitizedBooking),
      20000,
      'Booking save timed out. Please check your connection and try again.'
    );
  } catch (error) {
    if (scheduleClaimCreated) {
      await removeScheduleClaim(sanitizedBooking.date, bookingId).catch((cleanupError) => {
        console.warn('Unable to clean up an incomplete schedule claim.', cleanupError);
      });
    }
    throw error;
  } finally {
    await releaseScheduleMutex(scheduleLock);
  }

  if (sanitizedBooking.uid) {
    const authUser = {
      uid: sanitizedBooking.uid,
      email: sanitizedBooking.email || '',
      displayName: sanitizedBooking.customerName || sanitizedBooking.name || '',
    };

    createOrUpdateCustomerRecord(authUser).catch((error) => {
      console.warn('Failed to sync customer record after booking save', error);
    });
  }

  return bookingWithId;
}

function getScheduleEntries(snapshot) {
  const entries = [];
  snapshot.forEach((childSnapshot) => {
    entries.push({ bookingId: childSnapshot.key, ...childSnapshot.val() });
  });
  return entries;
}

async function acquireScheduleMutex(date, ownerUid) {
  const mutexRef = ref(rtdb, `scheduleMutexes/${date}`);
  const token = `${ownerUid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = Date.now();
    const result = await runTransaction(mutexRef, (current) => {
      if (current && Number(current.expiresAt) > now) return;
      return { ownerUid, token, expiresAt: now + 15000 };
    }, { applyLocally: false });
    if (result.committed) return { mutexRef, token };
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new ScheduleConflictError('Sorry, this time slot is being updated. Please select another available time or try again.');
}

async function releaseScheduleMutex(lock) {
  if (!lock) return;
  try {
    await runTransaction(lock.mutexRef, (current) => (
      current?.token === lock.token ? null : undefined
    ), { applyLocally: false });
  } catch (error) {
    console.warn('Unable to release the schedule lock; it will expire automatically.', error);
  }
}

async function readScheduleDate(date) {
  const snapshot = await get(ref(rtdb, `scheduleSlots/${date}`));
  return getScheduleEntries(snapshot);
}

async function removeScheduleClaim(date, bookingId) {
  if (!date || !bookingId) return;
  await remove(ref(rtdb, `scheduleSlots/${date}/${bookingId}`));
}

async function readBookingsForDate(date) {
  const dateQuery = rtdbQuery(ref(rtdb, 'bookings'), orderByChild('date'), equalTo(date));
  const snapshot = await get(dateQuery);
  const bookings = [];
  snapshot.forEach((childSnapshot) => {
    bookings.push({ id: childSnapshot.key, ...childSnapshot.val() });
  });
  return bookings;
}

export async function updateBookingStatus(bookingId, status) {
  if (!isRealtimeDatabaseAvailable() || !bookingId) {
    return Promise.reject(new Error('Realtime Database is not initialized or booking ID is missing'));
  }

  const updatedAt = new Date().toISOString();
  const updateData = {
    status,
    seenByAdmin: true,
    updatedAt,
  };

  const bookingRef = ref(rtdb, `bookings/${bookingId}`);
  const bookingSnapshot = await get(bookingRef);
  if (!bookingSnapshot.exists()) {
    throw new Error('The selected booking no longer exists.');
  }
  const booking = { id: bookingId, ...(bookingSnapshot.val() || {}) };
  if (isConfirmedScheduleStatus(status) && !isConfirmedScheduleStatus(booking.status)) {
    updateData.confirmedAt = updatedAt;
  }
  let scheduleLock = null;

  try {
    if (booking.date && booking.time && booking.uid) {
      scheduleLock = await acquireScheduleMutex(booking.date, auth?.currentUser?.uid || booking.uid);

      if (isConfirmedScheduleStatus(status)) {
        const [scheduleEntries, bookingsForDate] = await Promise.all([
          readScheduleDate(booking.date),
          readBookingsForDate(booking.date),
        ]);
        const conflictOptions = { includePendingHolds: false, excludeBookingId: bookingId };
        const conflictsWithSlot = hasScheduleConflict(booking, scheduleEntries, conflictOptions);
        const conflictsWithBooking = hasScheduleConflict(booking, bookingsForDate, conflictOptions);

        if (conflictsWithSlot || conflictsWithBooking) {
          throw new ScheduleConflictError(
            `Schedule conflict: another confirmed appointment is already booked for ${booking.date} at ${booking.time}. Please reschedule this appointment before accepting it.`
          );
        }

        const confirmedEntry = createScheduleEntry(booking, 'Confirmed');
        if (!confirmedEntry) throw new Error('This appointment has incomplete scheduling information.');
        await set(ref(rtdb, `scheduleSlots/${booking.date}/${bookingId}`), confirmedEntry);
        await update(bookingRef, updateData);
      } else {
        await update(bookingRef, updateData);
        await removeScheduleClaim(booking.date, bookingId);
      }
    } else {
      await update(bookingRef, updateData);
    }
  } catch (error) {
    console.warn('Failed to update booking status', error);
    throw error;
  } finally {
    await releaseScheduleMutex(scheduleLock);
  }

  let rewardGiven = booking.rewardGiven === true;
  if (status === 'Completed' && booking.uid && !rewardGiven) {
    let loyaltyProgram = null;
    try {
      const programSnapshot = await get(ref(rtdb, 'loyaltyProgram'));
      loyaltyProgram = programSnapshot.exists() ? programSnapshot.val() : null;
    } catch (error) {
      console.warn('Unable to load the loyalty reward settings while awarding this visit.', error);
    }

    const userRef = ref(rtdb, `users/${booking.uid}`);
    const transactionResult = await runTransaction(userRef, (profile) => {
      if (!profile) return;
      return applyCompletedBookingReward(profile, bookingId, updatedAt, loyaltyProgram).profile;
    });

    if (!transactionResult.committed) {
      throw new Error('The appointment was completed, but the customer loyalty record could not be updated.');
    }

    await update(bookingRef, {
      rewardGiven: true,
      rewardGivenAt: updatedAt,
    });
    rewardGiven = true;
  }

  return { status, rewardGiven, confirmedAt: updateData.confirmedAt || booking.confirmedAt || null };
}

function sanitizePortfolioItem(item) {
  const sanitized = {
    id: item?.id || String(Date.now()),
    title: String(item?.title || '').trim(),
    category: String(item?.category || '').trim(),
    image: String(item?.image || item?.imageUrl || ''),
    thumbnail: String(item?.thumbnail || item?.thumbnailUrl || ''),
    position: item?.position != null ? Number(item.position) : Date.now(),
    createdAt: item?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  ['description', 'style', 'shape', 'length', 'finish', 'serviceId', 'service', 'serviceName'].forEach((field) => {
    const value = String(item?.[field] || '').trim();
    if (value) sanitized[field] = value;
  });

  sanitized.visible = item?.visible !== false;

  return sanitized;
}

export async function addPortfolioItem(item) {
  const sanitized = sanitizePortfolioItem(item);
  if (!isRealtimeDatabaseAvailable()) {
    throw new Error('Realtime Database is not initialized.');
  }

  const portfolioRef = ref(rtdb, `portfolio/${String(sanitized.id)}`);
  await set(portfolioRef, sanitized);
  return sanitized;
}

export async function updatePortfolioItem(id, updates) {
  if (!isRealtimeDatabaseAvailable()) {
    throw new Error('Realtime Database is not initialized.');
  }

  const updateData = {
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const itemRef = ref(rtdb, `portfolio/${String(id)}`);
  await update(itemRef, updateData);
  return updateData;
}

export async function deletePortfolioItem(id) {
  if (!isRealtimeDatabaseAvailable()) {
    throw new Error('Realtime Database is not initialized.');
  }

  const itemRef = ref(rtdb, `portfolio/${String(id)}`);
  await remove(itemRef);
  return true;
}

export function listenToPortfolio(callback, errorCallback, { includeHidden = false } = {}) {
  if (!isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }

  const portfolioRef = ref(rtdb, 'portfolio');
  const queryRef = rtdbQuery(portfolioRef, orderByChild('position'));
  return onValue(
    queryRef,
    (snapshot) => {
      const items = [];
      snapshot.forEach((childSnap) => {
        const data = childSnap.val();
        if (!includeHidden && data?.visible === false) return;
        const position = data?.position != null ? Number(data.position) : Number(new Date(data?.createdAt).getTime() || Date.now());
        items.push({ id: childSnap.key, ...data, position });
      });
      items.sort((a, b) => a.position - b.position);
      callback(items);
    },
    (error) => {
      console.warn('Unable to listen for portfolio updates in Realtime Database', error);
      if (errorCallback) errorCallback(error);
    }
  );
}

export function listenToBusinessSettings(callback, errorCallback) {
  if (!isRealtimeDatabaseAvailable()) {
    callback({});
    return () => {};
  }

  return onValue(
    ref(rtdb, 'settings/business'),
    (snapshot) => callback(snapshot.exists() ? snapshot.val() : {}),
    (error) => {
      console.warn('Unable to listen for business settings in Realtime Database', error);
      errorCallback?.(error);
    }
  );
}

export async function saveBusinessSettings(settings) {
  if (!isRealtimeDatabaseAvailable()) {
    throw new Error('Realtime Database is not initialized.');
  }

  const payload = {
    ...settings,
    updatedAt: new Date().toISOString(),
  };
  await set(ref(rtdb, 'settings/business'), payload);
  return payload;
}

export function listenToBookings(callback, errorCallback) {
  if (!isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }

  const bookingsRef = ref(rtdb, 'bookings');
  const queryRef = rtdbQuery(bookingsRef, orderByChild('createdAt'));
  return onValue(
    queryRef,
    (snapshot) => {
      const bookings = [];
      snapshot.forEach((childSnap) => {
        bookings.push({ id: childSnap.key, ...childSnap.val() });
      });
      bookings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      callback(bookings);
    },
    (error) => {
      console.warn('Unable to listen for booking updates in Realtime Database', error);
      if (errorCallback) errorCallback(error);
    }
  );
}

export function listenToScheduleDate(date, callback, errorCallback) {
  if (!date || !isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }

  return onValue(
    ref(rtdb, `scheduleSlots/${date}`),
    (snapshot) => callback(getScheduleEntries(snapshot)),
    (error) => {
      console.warn('Unable to listen for schedule availability.', error);
      if (errorCallback) errorCallback(error);
    }
  );
}

export function listenToScheduleMonth(monthKey, callback, errorCallback) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || '')) || !isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }

  const monthQuery = rtdbQuery(
    ref(rtdb, 'scheduleSlots'),
    orderByKey(),
    startAt(`${monthKey}-01`),
    endAt(`${monthKey}-31`)
  );

  return onValue(
    monthQuery,
    (snapshot) => {
      const entries = [];
      snapshot.forEach((dateSnapshot) => {
        dateSnapshot.forEach((entrySnapshot) => {
          entries.push({
            bookingId: entrySnapshot.key,
            date: dateSnapshot.key,
            ...entrySnapshot.val(),
          });
        });
      });
      callback(entries);
    },
    (error) => {
      console.warn('Unable to listen for monthly schedule availability.', error);
      if (errorCallback) errorCallback(error);
    }
  );
}

export async function syncConfirmedScheduleSlots(bookings = []) {
  if (!isRealtimeDatabaseAvailable() || !Array.isArray(bookings)) return false;

  const updates = {};
  const scheduleSnapshot = await get(ref(rtdb, 'scheduleSlots'));
  const currentEntries = new Map();
  const comparableFields = ['bookingId', 'ownerUid', 'date', 'time', 'serviceId', 'durationMinutes', 'startMinutes', 'endMinutes', 'status', 'expiresAt'];
  const now = Date.now();
  scheduleSnapshot.forEach((dateSnapshot) => {
    dateSnapshot.forEach((entrySnapshot) => {
      const entry = entrySnapshot.val() || {};
      currentEntries.set(`${dateSnapshot.key}/${entrySnapshot.key}`, entry);
      if (String(entry.status || '').toLowerCase() === 'pending' && Number(entry.expiresAt) <= now) {
        updates[`${dateSnapshot.key}/${entrySnapshot.key}`] = null;
      }
    });
  });

  bookings.forEach((booking) => {
    if (!booking?.id || !booking?.date) return;
    const schedulePath = `${booking.date}/${booking.id}`;
    if (isConfirmedScheduleStatus(booking.status)) {
      const entry = createScheduleEntry(booking, 'Confirmed');
      const currentEntry = currentEntries.get(schedulePath);
      const isCurrent = entry && currentEntry && comparableFields.every((field) => (
        (entry[field] ?? null) === (currentEntry[field] ?? null)
      ));
      if (entry && !isCurrent) updates[schedulePath] = entry;
      return;
    }

    const status = String(booking.status || '').trim().toLowerCase();
    if (currentEntries.has(schedulePath) && ['completed', 'cancelled', 'canceled', 'declined', 'no show', 'no-show'].includes(status)) {
      updates[schedulePath] = null;
    }
  });

  if (Object.keys(updates).length === 0) return true;
  await update(ref(rtdb, 'scheduleSlots'), updates);
  return true;
}

export async function markBookingSeen(bookingId) {
  if (!isRealtimeDatabaseAvailable() || !bookingId) {
    return Promise.reject(new Error('Realtime Database is not initialized or booking ID is missing'));
  }

  const updateData = { seenByAdmin: true, updatedAt: new Date().toISOString() };
  try {
    const bookingRef = ref(rtdb, `bookings/${bookingId}`);
    await update(bookingRef, updateData);
    return true;
  } catch (error) {
    console.warn('Failed to mark booking seen', error);
    throw error;
  }
}

export async function saveCustomerProfile(user, profile) {
  if (!user) {
    return Promise.resolve(null);
  }

  const existingProfile = readStoredProfile(user.uid) || {};
  const normalizedProfile = {
    uid: user.uid,
    email: user.email || existingProfile.email || '',
    displayName: user.displayName || existingProfile.displayName || '',
    fullName: sanitizeName(profile?.fullName || profile?.name || user.displayName || existingProfile.fullName || ''),
    name: sanitizeName(profile?.name || profile?.fullName || user.displayName || existingProfile.name || ''),
    phone: sanitizePhone(profile?.phone || existingProfile.phone || ''),
    address: sanitizeAddress(profile?.address || existingProfile.address || ''),
    nailPreferences: normalizeNailPreferences(profile?.nailPreferences, existingProfile.nailPreferences),
    notificationPreferences: {
      emailAppointmentReminders: profile?.notificationPreferences?.emailAppointmentReminders
        ?? existingProfile.notificationPreferences?.emailAppointmentReminders
        ?? true,
    },
    status: profile?.status || existingProfile.status || 'active',
    updatedAt: new Date().toISOString(),
  };

  const mergedProfile = mergeProfileData(existingProfile, normalizedProfile);
  writeStoredProfile(user.uid, mergedProfile);

  if (!rtdb) {
    return Promise.resolve(mergedProfile);
  }

  try {
    const path = getRecordPath(user.email);
    const profileRef = ref(rtdb, `${path}/${user.uid}`);
    // Only customer-editable profile fields are written here. Loyalty fields are
    // server/admin-owned and must not be overwritten by an older local profile.
    await update(profileRef, createProfileUpdate(normalizedProfile));
    return mergedProfile;
  } catch (error) {
    console.warn('Realtime Database profile save failed, using local fallback', error);
    return mergedProfile;
  }
}

async function syncCustomerRecord(user) {
  const path = getRecordPath(user.email);
  const userRef = ref(rtdb, `${path}/${user.uid}`);
  try {
    const snap = await get(userRef);
    const existing = snap.exists() ? snap.val() : {};
    const displayName = user.displayName || existing.displayName || '';
    const normalizedName = sanitizeName(displayName || user.email?.split('@')[0] || 'Guest');

    const storedProfile = readStoredProfile(user.uid) || {};
    const normalizedProfile = {
      uid: user.uid,
      email: user.email || existing.email || '',
      displayName,
      fullName: existing.fullName || existing.name || normalizedName,
      name: existing.name || normalizedName,
      phone: existing.phone || storedProfile.phone || '',
      address: existing.address || storedProfile.address || '',
      nailPreferences: normalizeNailPreferences(existing.nailPreferences, storedProfile.nailPreferences),
      notificationPreferences: {
        emailAppointmentReminders: existing.notificationPreferences?.emailAppointmentReminders
          ?? storedProfile.notificationPreferences?.emailAppointmentReminders
          ?? true,
      },
      status: existing.status || storedProfile.status || 'active',
      dateRegistered: existing.dateRegistered || existing.createdAt || new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mergedProfile = mergeProfileData(storedProfile, normalizedProfile);
    // Keep completion rewards and loyalty history untouched during sign-in sync.
    await update(userRef, createProfileUpdate(normalizedProfile));
    writeStoredProfile(user.uid, mergedProfile);
    return mergedProfile;
  } catch (error) {
    console.warn('Unable to create or update user record', error);
    return null;
  }
}

export function createOrUpdateCustomerRecord(user) {
  if (!user || !rtdb) {
    return Promise.resolve(null);
  }

  const existingSync = customerRecordSyncPromises.get(user.uid);
  if (existingSync) return existingSync;

  const syncPromise = syncCustomerRecord(user).finally(() => {
    if (customerRecordSyncPromises.get(user.uid) === syncPromise) {
      customerRecordSyncPromises.delete(user.uid);
    }
  });
  customerRecordSyncPromises.set(user.uid, syncPromise);
  return syncPromise;
}

export async function prepareImageForUpload(file, folder = 'portfolio', options = {}) {
  const supportedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file?.type);
  if (!supportedType || typeof window === 'undefined' || typeof createImageBitmap !== 'function') return file;

  const maxDimension = Number(options.maxDimension)
    || (folder === 'booking-references' ? 1600 : folder === 'portfolio-thumbnails' ? 720 : 2400);
  const quality = Number(options.quality) || (maxDimension <= 720 ? 0.84 : 0.9);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const largestDimension = Math.max(bitmap.width, bitmap.height);
    if (largestDimension <= maxDimension && file.size <= 1.5 * 1024 * 1024) return file;

    const scale = Math.min(1, maxDimension / largestDimension);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: file.type !== 'image/jpeg' });
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.size >= file.size) return file;
    const baseName = String(file.name || 'upload').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

export async function uploadImageFile(file, folder = 'portfolio', onProgress, options = {}) {
  if (!app) {
    throw new Error('Firebase not initialized. Call initFirebase first.');
  }

  if (!file) throw new Error('No file provided for upload');

  try {
    const uploadFile = await prepareImageForUpload(file, folder, options);
    const {
      getStorage,
      ref: storageRef,
      uploadBytes,
      getDownloadURL,
      uploadBytesResumable,
    } = await import('firebase/storage');
    const storage = getStorage(app);
    const safeName = String(uploadFile.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${folder}/${Date.now()}_${safeName}`;
    const sRef = storageRef(storage, path);

    // Use resumable upload to report progress when requested
    if (typeof onProgress === 'function') {
      const task = uploadBytesResumable(sRef, uploadFile);
      return await new Promise((resolve, reject) => {
        task.on(
          'state_changed',
          (snapshot) => {
            const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            try { onProgress(percent); } catch (e) { /* ignore */ }
          },
          (error) => reject(error),
          async () => {
            try {
              const url = await getDownloadURL(sRef);
              resolve(url);
            } catch (err) {
              reject(err);
            }
          }
        );
      });
    }

    await uploadBytes(sRef, uploadFile);
    const url = await getDownloadURL(sRef);
    return url;
  } catch (error) {
    console.warn('Failed to upload image file to Firebase Storage', error);
    throw error;
  }
}

export async function getCustomerProfile(uid, email) {
  if (!uid) return readStoredProfile(uid);

  const cachedProfile = readStoredProfile(uid);
  if (cachedProfile) {
    return Promise.resolve(cachedProfile);
  }

  if (!isRealtimeDatabaseAvailable()) {
    return readStoredProfile(uid);
  }

  try {
    const path = getRecordPath(email);
    const userRef = ref(rtdb, `${path}/${uid}`);
    const snap = await get(userRef);
    if (snap.exists()) {
      const data = snap.val();
      const storedProfile = readStoredProfile(uid) || {};
      const mergedProfile = mergeProfileData(storedProfile, data);
      writeStoredProfile(uid, mergedProfile);
      return mergedProfile;
    }
    if (path === 'admins') {
      const fallbackRef = ref(rtdb, `users/${uid}`);
      const fallbackSnap = await get(fallbackRef);
      if (fallbackSnap.exists()) {
        const data = fallbackSnap.val();
        const storedProfile = readStoredProfile(uid) || {};
        const mergedProfile = mergeProfileData(storedProfile, data);
        writeStoredProfile(uid, mergedProfile);
        return mergedProfile;
      }
    }
  } catch (error) {
    console.warn('Realtime Database profile load failed, using local fallback', error);
  }

  return readStoredProfile(uid);
}

function mapUserRecord(snapshot) {
  const data = snapshot.val() || {};
  const loyalty = data.loyalty && typeof data.loyalty === 'object' ? data.loyalty : {};
  const loyaltyPoints = data.loyaltyPoints ?? loyalty.points;
  const completedVisits = data.totalVisits ?? data.completedVisits ?? loyalty.totalVisits ?? loyalty.completedVisits;
  return {
    id: snapshot.key,
    fullName: data.fullName || data.displayName || data.name || 'Guest',
    email: data.email || '',
    phone: data.phone || '',
    address: data.address || '',
    status: data.status || 'active',
    dateRegistered: data.dateRegistered || data.createdAt || '',
    lastLogin: data.lastLogin || '',
    nailPreferences: data.nailPreferences && typeof data.nailPreferences === 'object' ? data.nailPreferences : {},
    loyaltyPoints: loyaltyPoints == null ? undefined : Number(loyaltyPoints) || 0,
    totalVisits: completedVisits == null ? undefined : Number(completedVisits) || 0,
    completedVisits: completedVisits == null ? undefined : Number(completedVisits) || 0,
    rewardsEarned: Number(data.rewardsEarned ?? loyalty.rewardsEarned ?? 0) || 0,
    rewardsClaimed: Number(data.rewardsClaimed ?? loyalty.rewardsClaimed ?? 0) || 0,
    loyalty,
  };
}

export function listenToLoyaltyProgram(callback, errorCallback) {
  if (!isRealtimeDatabaseAvailable()) {
    callback(normalizeLoyaltyProgram(null));
    return () => {};
  }

  return onValue(
    ref(rtdb, 'loyaltyProgram'),
    (snapshot) => callback(normalizeLoyaltyProgram(snapshot.exists() ? snapshot.val() : null)),
    (error) => {
      console.warn('Unable to listen for loyalty reward settings', error);
      callback(normalizeLoyaltyProgram(null));
      errorCallback?.(error);
    }
  );
}

export async function saveLoyaltyProgram(program) {
  if (!isRealtimeDatabaseAvailable() || !auth?.currentUser) {
    throw new Error('Firebase is not ready. Please sign in again and retry.');
  }

  const payload = createLoyaltyProgramPayload(program, {
    updatedAt: new Date().toISOString(),
    updatedBy: auth.currentUser.uid,
  });
  await set(ref(rtdb, 'loyaltyProgram'), payload);
  return normalizeLoyaltyProgram(payload);
}

export function createLoyaltyRewardId() {
  if (isRealtimeDatabaseAvailable()) {
    return push(ref(rtdb, 'loyaltyProgram/rewards')).key;
  }
  return `reward_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function listenToCustomerLoyalty(uid, callback, errorCallback) {
  if (!uid || !isRealtimeDatabaseAvailable()) {
    callback(null);
    return () => {};
  }

  return onValue(
    ref(rtdb, `users/${uid}`),
    (snapshot) => callback(snapshot.exists() ? snapshot.val() : null),
    (error) => {
      console.warn('Unable to listen for customer loyalty updates', error);
      errorCallback?.(error);
    }
  );
}

export async function claimCustomerLoyaltyReward(uid, rewardId, loyaltyProgram, fallbackVisits = 0) {
  if (!uid || !isRealtimeDatabaseAvailable() || !auth?.currentUser) {
    throw new Error('Firebase is not ready. Please sign in again and retry.');
  }

  let program = normalizeLoyaltyProgram(loyaltyProgram);
  try {
    const programSnapshot = await get(ref(rtdb, 'loyaltyProgram'));
    program = normalizeLoyaltyProgram(programSnapshot.exists() ? programSnapshot.val() : null);
  } catch (error) {
    if (!program.configured) throw error;
  }

  if (!program.active) {
    throw new Error('The loyalty program is not active.');
  }

  const reward = program.activeRewards.find((item) => item.id === rewardId);
  if (!reward) throw new Error('This reward is no longer active. Refresh and try again.');

  const claimId = push(ref(rtdb, `users/${uid}/loyalty/rewardHistory`)).key;
  const claimedAt = new Date().toISOString();
  let outcome = null;
  const transactionResult = await runTransaction(ref(rtdb, `users/${uid}`), (profile) => {
    if (!profile) return;
    outcome = applyLoyaltyRewardClaim(profile, program, {
      claimId,
      rewardId,
      claimedAt,
      claimedBy: auth.currentUser.uid,
      fallbackVisits,
    });
    return outcome.claimed ? outcome.profile : undefined;
  });

  if (!transactionResult.committed || !outcome?.claimed) {
    const message = outcome?.reason === 'insufficient-visits'
      ? 'This customer has not reached this reward milestone yet.'
      : outcome?.reason === 'duplicate-reward'
        ? 'This customer already claimed this reward.'
      : 'The reward could not be claimed. Refresh the customer record and try again.';
    throw new Error(message);
  }

  return { id: claimId, ...outcome.reward };
}

const ADMIN_EMAIL = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ADMIN_EMAIL
  ? String(import.meta.env.VITE_ADMIN_EMAIL).toLowerCase()
  : '';

export function listenToUsers(callback) {
  if (!rtdb) {
    callback([]);
    return () => {};
  }

  const usersRef = ref(rtdb, 'users');
  return onValue(
    usersRef,
    (snap) => {
      const users = [];
      snap.forEach((childSnap) => {
        const user = mapUserRecord(childSnap);
        if (ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL) return; // exclude admin account
        users.push(user);
      });
      callback(users.sort((a, b) => a.fullName.localeCompare(b.fullName)));
    },
    (error) => {
      console.warn('Unable to listen for user updates', error);
      callback([]);
    }
  );
}

export async function getAllUsers() {
  if (!rtdb) {
    console.warn('Realtime Database not initialized. getAllUsers will return empty array.');
    return [];
  }

  try {
    const usersRef = ref(rtdb, 'users');
    const snap = await get(usersRef);
    if (!snap.exists()) {
      return [];
    }

    const users = [];
    snap.forEach((childSnap) => {
      const user = mapUserRecord(childSnap);
      if (ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL) return; // exclude admin
      users.push(user);
    });

    return users.sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (error) {
    console.warn('Failed to fetch user list from Realtime Database', error);
    return [];
  }
}

export async function updateUserStatus(uid, status, email) {
  if (!rtdb || !uid) {
    return Promise.reject(new Error('Firebase not initialized or user ID missing'));
  }

  try {
    const path = getRecordPath(email || '');
    const userRef = ref(rtdb, `${path}/${uid}`);
    await update(userRef, {
      status: status === 'active' ? 'active' : 'inactive',
      updatedAt: new Date().toISOString(),
    });
    accountStatusCache.set(uid, {
      status: status === 'active' ? 'active' : 'inactive',
      checkedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.warn('Failed to update user status', error);
    throw error;
  }
}

export function listenToUserBookings(uid, callback, errorCallback) {
  if (!uid || !isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }

  const bookingsRef = ref(rtdb, 'bookings');
  const userBookingsQuery = rtdbQuery(bookingsRef, orderByChild('uid'), equalTo(uid));
  return onValue(
    userBookingsQuery,
    (snapshot) => {
      const bookings = [];
      snapshot.forEach((childSnapshot) => {
        bookings.push({ id: childSnapshot.key, ...childSnapshot.val() });
      });
      bookings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      callback(bookings);
    },
    (error) => {
      console.warn('Unable to listen for customer booking updates', error);
      if (errorCallback) errorCallback(error);
    }
  );
}

export function listenToCustomerNotifications(uid, callback, errorCallback) {
  if (!uid || !isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }

  const notificationsQuery = rtdbQuery(
    ref(rtdb, `notifications/${uid}`),
    orderByChild('createdAt'),
    limitToLast(20)
  );
  return onValue(
    notificationsQuery,
    (snapshot) => {
      const notifications = [];
      snapshot.forEach((childSnapshot) => {
        notifications.push({ id: childSnapshot.key, ...(childSnapshot.val() || {}) });
      });
      notifications.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
      callback(notifications);
    },
    (error) => {
      console.warn('Unable to listen for appointment reminders', error);
      errorCallback?.(error);
    }
  );
}

export async function markCustomerNotificationsRead(uid, notificationIds = []) {
  if (!uid || !isRealtimeDatabaseAvailable()) return false;
  const safeIds = [...new Set(notificationIds)]
    .map((value) => String(value || ''))
    .filter((value) => value && !/[.#$\[\]/]/.test(value));
  if (!safeIds.length) return true;

  const readAt = Date.now();
  const updates = {};
  safeIds.forEach((notificationId) => {
    updates[`notifications/${uid}/${notificationId}/read`] = true;
    updates[`notifications/${uid}/${notificationId}/readAt`] = readAt;
  });
  await update(ref(rtdb), updates);
  return true;
}

export async function updateAppointmentReminderPreference(uid, enabled) {
  if (!uid || !isRealtimeDatabaseAvailable()) {
    throw new Error('Realtime Database is not ready. Please try again.');
  }
  const normalizedEnabled = enabled !== false;
  await set(
    ref(rtdb, `users/${uid}/notificationPreferences/emailAppointmentReminders`),
    normalizedEnabled
  );
  const storedProfile = readStoredProfile(uid) || {};
  writeStoredProfile(uid, {
    ...storedProfile,
    notificationPreferences: {
      ...(storedProfile.notificationPreferences || {}),
      emailAppointmentReminders: normalizedEnabled,
    },
  });
  return normalizedEnabled;
}

export async function getUserBookings(uid) {
  if (!uid) return [];

  if (!isRealtimeDatabaseAvailable()) {
    console.warn('Realtime Database is not initialized. getUserBookings will return an empty array.');
    return [];
  }

  try {
    const bookingsRef = ref(rtdb, 'bookings');
    const userBookingsQuery = rtdbQuery(bookingsRef, orderByChild('uid'), equalTo(uid));
    const snap = await get(userBookingsQuery);
    if (!snap.exists()) return [];
    const bookings = [];
    snap.forEach((childSnap) => {
      bookings.push({ id: childSnap.key, ...childSnap.val() });
    });
    return bookings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch (error) {
    console.warn('Failed to fetch user bookings from Realtime Database', error);
    return [];
  }
}

export async function getBookings() {
  if (!isRealtimeDatabaseAvailable()) {
    console.warn('Realtime Database is not initialized. getBookings will return an empty array.');
    return [];
  }

  try {
    const snap = await get(ref(rtdb, 'bookings'));
    if (!snap.exists()) return [];
    const bookings = [];
    snap.forEach((childSnap) => {
      bookings.push({ id: childSnap.key, ...childSnap.val() });
    });
    return bookings.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch (error) {
    console.warn('Failed to fetch bookings from Realtime Database', error);
    return [];
  }
}

export default { initFirebase, saveBooking, listenToBookings, markBookingSeen, updateBookingStatus };
