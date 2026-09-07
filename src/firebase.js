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
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';
import { mergeProfileData } from './profilePersistence';
import { getAdminAuthorizationFromRecord, isFirebasePermissionDenied } from './authFlow';
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
  ALLOWED_IMAGE_TYPES,
  getImageFileValidationError,
} from './imageUploadConfig';
import {
  PENDING_SLOT_HOLD_MS,
  ScheduleConflictError,
  createScheduleEntry,
  getAppointmentDurationMinutes,
  getAppointmentInterval,
  hasScheduleConflict,
  isConfirmedScheduleStatus,
} from './scheduling';
import {
  getBookableTimeSlots,
  getBookingDateRestriction,
  hasReachedDailyAppointmentLimit,
  normalizeBusinessSettings,
  canManageAppointmentOnline,
  validateBusinessSettingsPatch,
} from './businessSettings';

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
let storage = null;
let googleProvider = null;
let passwordResetActionCodeSettings;
const customerRecordSyncPromises = new Map();
const authorizationPromises = new Map();
const authorizationCache = new Map();
const AUTHORIZATION_CACHE_MS = 5000;
const PORTFOLIO_UPLOAD_FOLDERS = new Set(['portfolio', 'portfolio-thumbnails']);
const CUSTOMER_UPLOAD_FOLDERS = new Set(['booking-references']);

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

function getProfileStorageKey(uid) {
  return `luxe-nails-profile:${uid}`;
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
  storage = getStorage(app);
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

async function readUserAuthorization(uid, email) {
  const customerAuthorization = { role: 'customer', isAdmin: false, status: 'active' };
  if (!rtdb || !uid) return customerAuthorization;
  if (!auth?.currentUser || auth.currentUser.uid !== uid) {
    throw new Error('Unable to verify authorization for a different Firebase account.');
  }

  try {
    const adminSnapshot = await get(ref(rtdb, `admins/${uid}`));
    if (adminSnapshot.exists()) {
      const adminAuthorization = getAdminAuthorizationFromRecord(adminSnapshot.val(), uid, email);
      if (!adminAuthorization) {
        throw new Error('The Admin authorization record does not match the authenticated Firebase account.');
      }
      return adminAuthorization;
    }
  } catch (error) {
    // Older deployed rules reject an authenticated user's read when their own
    // Admin node does not exist. That is an expected non-Admin result, including
    // when the SDK supplies only the message "Permission denied" and no code.
    if (!isFirebasePermissionDenied(error)) throw error;
  }

  const customerSnapshot = await get(ref(rtdb, `users/${uid}`));
  const customerRecord = customerSnapshot.exists() ? customerSnapshot.val() : null;
  return {
    ...customerAuthorization,
    status: customerRecord?.status === 'inactive' ? 'inactive' : 'active',
  };
}

async function checkUserAuthorization(uid, email) {
  const cached = authorizationCache.get(uid);
  if (cached && Date.now() - cached.checkedAt < AUTHORIZATION_CACHE_MS) {
    return cached.authorization;
  }

  const pending = authorizationPromises.get(uid);
  if (pending) return pending;

  const authorizationPromise = readUserAuthorization(uid, email)
    .then((authorization) => {
      authorizationCache.set(uid, { authorization, checkedAt: Date.now() });
      return authorization;
    })
    .finally(() => {
      if (authorizationPromises.get(uid) === authorizationPromise) authorizationPromises.delete(uid);
    });
  authorizationPromises.set(uid, authorizationPromise);
  return authorizationPromise;
}

export async function resolveUserAuthorization(uid, email) {
  return checkUserAuthorization(uid, email);
}

export async function getAccountStatus(uid, email) {
  const authorization = await checkUserAuthorization(uid, email);
  return authorization.status;
}

export async function signInWithGoogle(remember = true) {
  if (!auth) {
    throw new Error(getFirebaseAuthenticationUnavailableMessage());
  }

  await applyPersistence(remember);

  try {
    const result = await signInWithPopup(auth, googleProvider);

    const authorization = await checkUserAuthorization(result.user.uid, result.user.email);
    if (authorization.status === 'inactive') {
      await signOut(auth);
      throw new Error('Your account has been deactivated. Please contact support.');
    }

    if (!authorization.isAdmin) {
      await createOrUpdateCustomerRecord(result.user);
    }
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

  const authorization = await checkUserAuthorization(result.user.uid, result.user.email);
  if (authorization.status === 'inactive') {
    await signOut(auth);
    throw new Error('Your account has been deactivated. Please contact support.');
  }

  if (!authorization.isAdmin) {
    await createOrUpdateCustomerRecord(result.user);
  }
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
    await createOrUpdateCustomerRecord(currentUser);
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
  await signOut(auth);
  authorizationPromises.clear();
  authorizationCache.clear();
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

  const settingsSnapshot = await get(ref(rtdb, 'settings/business'));
  const businessSettings = normalizeBusinessSettings(settingsSnapshot.exists() ? settingsSnapshot.val() : {});
  const dateRestriction = getBookingDateRestriction(sanitizedBooking.date, businessSettings, new Date());
  if (dateRestriction) {
    throw new ScheduleConflictError(`This appointment date is unavailable: ${dateRestriction}. Please choose another day.`);
  }
  const allowedSlots = getBookableTimeSlots(
    sanitizedBooking.date,
    appointmentInterval?.durationMinutes,
    businessSettings,
    new Date()
  );
  if (!allowedSlots.includes(sanitizedBooking.time)) {
    throw new ScheduleConflictError('This appointment time is outside the current online booking availability. Please choose another time.');
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
    if (hasReachedDailyAppointmentLimit(scheduleEntries, sanitizedBooking.date, businessSettings)
      || hasScheduleConflict(bookingWithId, scheduleEntries, {
        includePendingHolds: true,
        bufferMinutes: businessSettings.appointmentBufferMinutes,
      })) {
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
  const settingsSnapshot = await get(ref(rtdb, 'settings/business'));
  const businessSettings = normalizeBusinessSettings(settingsSnapshot.exists() ? settingsSnapshot.val() : {});
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
        const conflictOptions = {
          includePendingHolds: false,
          excludeBookingId: bookingId,
          bufferMinutes: businessSettings.appointmentBufferMinutes,
        };
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

function getAppointmentChangeRequestId(bookingId, type) {
  const safeBookingId = String(bookingId || '').replace(/[^A-Za-z0-9_-]/g, '');
  return `${safeBookingId}_${type}`;
}

async function createAppointmentChangeRequest(booking, type, details = {}) {
  if (!isRealtimeDatabaseAvailable() || !auth?.currentUser) throw new Error('Please sign in to manage this appointment.');
  if (!booking?.id || booking.uid !== auth.currentUser.uid) throw new Error('You can only manage your own appointment.');
  const settingsSnapshot = await get(ref(rtdb, 'settings/business'));
  const settings = normalizeBusinessSettings(settingsSnapshot.exists() ? settingsSnapshot.val() : {});
  const action = type === 'cancellation' ? 'cancel' : 'reschedule';
  const eligibility = canManageAppointmentOnline(booking, action, settings);
  if (!eligibility.allowed) throw new Error(eligibility.reason);

  if (type === 'reschedule') {
    const restriction = getBookingDateRestriction(details.requestedDate, settings, new Date());
    if (restriction) throw new Error(`That date is unavailable: ${restriction}.`);
    const slots = getBookableTimeSlots(details.requestedDate, getAppointmentDurationMinutes(booking), settings, new Date());
    if (!slots.includes(details.requestedTime)) throw new Error('That time is outside the current online booking availability.');
    const scheduleEntries = await readScheduleDate(details.requestedDate);
    if (hasReachedDailyAppointmentLimit(scheduleEntries, details.requestedDate, settings, Date.now(), booking.id)
      || hasScheduleConflict({ ...booking, date: details.requestedDate, time: details.requestedTime, startMinutes: undefined, endMinutes: undefined }, scheduleEntries, {
        includePendingHolds: true,
        excludeBookingId: booking.id,
        bufferMinutes: settings.appointmentBufferMinutes,
      })) {
      throw new ScheduleConflictError('That reschedule time is no longer available. Please choose another time.');
    }
  }

  const requestId = getAppointmentChangeRequestId(booking.id, type);
  const requestRef = ref(rtdb, `appointmentChangeRequests/${requestId}`);
  const existingSnapshot = await get(requestRef);
  if (existingSnapshot.exists() && existingSnapshot.val()?.status === 'Pending') {
    throw new Error(`A ${type} request is already awaiting Admin review.`);
  }
  const now = Date.now();
  const payload = {
    id: requestId,
    bookingId: booking.id,
    uid: auth.currentUser.uid,
    type,
    status: 'Pending',
    reason: String(details.reason || '').trim().slice(0, 500),
    createdAt: now,
    seenByAdmin: false,
    ...(type === 'reschedule' ? {
      requestedDate: String(details.requestedDate || ''),
      requestedTime: String(details.requestedTime || ''),
    } : {}),
  };
  await set(requestRef, payload);
  return payload;
}

export function requestAppointmentCancellation(booking, reason = '') {
  return createAppointmentChangeRequest(booking, 'cancellation', { reason });
}

export function requestAppointmentReschedule(booking, requestedDate, requestedTime, reason = '') {
  return createAppointmentChangeRequest(booking, 'reschedule', { requestedDate, requestedTime, reason });
}

function mapAppointmentChangeRequests(snapshot) {
  const requests = [];
  snapshot.forEach((child) => requests.push({ id: child.key, ...(child.val() || {}) }));
  return requests.sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
}

export function listenToAppointmentChangeRequests(callback, errorCallback) {
  if (!isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }
  return onValue(ref(rtdb, 'appointmentChangeRequests'), (snapshot) => {
    callback(mapAppointmentChangeRequests(snapshot));
  }, (error) => errorCallback?.(error));
}

export function listenToUserAppointmentChangeRequests(uid, callback, errorCallback) {
  if (!uid || !isRealtimeDatabaseAvailable()) {
    callback([]);
    return () => {};
  }
  const requestsQuery = rtdbQuery(ref(rtdb, 'appointmentChangeRequests'), orderByChild('uid'), equalTo(uid));
  return onValue(requestsQuery, (snapshot) => {
    callback(mapAppointmentChangeRequests(snapshot));
  }, (error) => errorCallback?.(error));
}

async function rescheduleConfirmedBooking(bookingId, requestedDate, requestedTime, settings) {
  const bookingRef = ref(rtdb, `bookings/${bookingId}`);
  const snapshot = await get(bookingRef);
  if (!snapshot.exists()) throw new Error('The appointment no longer exists.');
  const booking = { id: bookingId, ...(snapshot.val() || {}) };
  if (!isConfirmedScheduleStatus(booking.status)) throw new Error('Only a confirmed appointment can be rescheduled.');
  if (booking.date === requestedDate && booking.time === requestedTime) throw new Error('Choose a different appointment time.');
  const restriction = getBookingDateRestriction(requestedDate, settings, new Date());
  if (restriction) throw new Error(`That date is unavailable: ${restriction}.`);
  const allowedSlots = getBookableTimeSlots(requestedDate, getAppointmentDurationMinutes(booking), settings, new Date());
  if (!allowedSlots.includes(requestedTime)) throw new Error('That time is outside online booking availability.');

  const locks = [];
  try {
    for (const dateKey of [...new Set([booking.date, requestedDate])].sort()) {
      locks.push(await acquireScheduleMutex(dateKey, auth?.currentUser?.uid || booking.uid));
    }
    const [scheduleEntries, bookingsForDate] = await Promise.all([
      readScheduleDate(requestedDate),
      readBookingsForDate(requestedDate),
    ]);
    const candidate = { ...booking, date: requestedDate, time: requestedTime, startMinutes: undefined, endMinutes: undefined };
    const conflictOptions = {
      includePendingHolds: true,
      excludeBookingId: bookingId,
      bufferMinutes: settings.appointmentBufferMinutes,
    };
    if (hasReachedDailyAppointmentLimit(scheduleEntries, requestedDate, settings, Date.now(), bookingId)
      || hasScheduleConflict(candidate, scheduleEntries, conflictOptions)
      || hasScheduleConflict(candidate, bookingsForDate, { ...conflictOptions, includePendingHolds: false })) {
      throw new ScheduleConflictError('That reschedule time is no longer available. Please choose another time.');
    }
    const confirmedEntry = createScheduleEntry(candidate, 'Confirmed');
    if (!confirmedEntry) throw new Error('The requested schedule is incomplete.');
    const updatedAt = new Date().toISOString();
    const updates = {
      [`bookings/${bookingId}/date`]: requestedDate,
      [`bookings/${bookingId}/time`]: requestedTime,
      [`bookings/${bookingId}/durationMinutes`]: confirmedEntry.durationMinutes,
      [`bookings/${bookingId}/startMinutes`]: confirmedEntry.startMinutes,
      [`bookings/${bookingId}/endMinutes`]: confirmedEntry.endMinutes,
      [`bookings/${bookingId}/updatedAt`]: updatedAt,
      [`bookings/${bookingId}/rescheduledAt`]: updatedAt,
      [`bookings/${bookingId}/rescheduledBy`]: 'admin-approved-customer-request',
      [`bookings/${bookingId}/reminders`]: null,
      [`scheduleSlots/${requestedDate}/${bookingId}`]: confirmedEntry,
    };
    if (booking.date !== requestedDate) updates[`scheduleSlots/${booking.date}/${bookingId}`] = null;
    await update(ref(rtdb), updates);
    return { ...booking, date: requestedDate, time: requestedTime };
  } finally {
    await Promise.allSettled(locks.map(releaseScheduleMutex));
  }
}

async function createAppointmentRequestDecisionNotification(request, approved, booking, settings) {
  const isCancellation = request.type === 'cancellation';
  const enabled = isCancellation ? settings.cancellationNotificationEnabled : settings.rescheduleNotificationEnabled;
  if (!enabled) return;
  const notificationId = `${request.id}_${approved ? 'approved' : 'declined'}`;
  const title = `${isCancellation ? 'Cancellation' : 'Reschedule'} Request ${approved ? 'Approved' : 'Declined'}`;
  const message = approved
    ? isCancellation
      ? 'Your appointment has been successfully cancelled.'
      : `Your appointment was rescheduled to ${request.requestedDate} at ${request.requestedTime}.`
    : `Your ${isCancellation ? 'cancellation' : 'reschedule'} request was declined. Your appointment remains confirmed.`;
  await set(ref(rtdb, `notifications/${request.uid}/${notificationId}`), {
    type: isCancellation ? 'booking_cancelled' : 'booking_rescheduled',
    title,
    message,
    bookingId: booking.id,
    read: false,
    createdAt: Date.now(),
  });
}

export async function reviewAppointmentChangeRequest(requestId, decision) {
  if (!isRealtimeDatabaseAvailable() || !auth?.currentUser) throw new Error('Admin authentication is required.');
  if (!['Approved', 'Declined'].includes(decision)) throw new Error('Choose a valid request decision.');
  const requestRef = ref(rtdb, `appointmentChangeRequests/${requestId}`);
  const requestSnapshot = await get(requestRef);
  if (!requestSnapshot.exists()) throw new Error('This request no longer exists.');
  const request = { id: requestId, ...(requestSnapshot.val() || {}) };
  if (request.status !== 'Pending') throw new Error('This request has already been reviewed.');
  const bookingSnapshot = await get(ref(rtdb, `bookings/${request.bookingId}`));
  if (!bookingSnapshot.exists()) throw new Error('The related appointment no longer exists.');
  let booking = { id: request.bookingId, ...(bookingSnapshot.val() || {}) };
  const settingsSnapshot = await get(ref(rtdb, 'settings/business'));
  const settings = normalizeBusinessSettings(settingsSnapshot.exists() ? settingsSnapshot.val() : {});

  if (decision === 'Approved') {
    if (request.type === 'cancellation') {
      if (!isConfirmedScheduleStatus(booking.status)) throw new Error('Only a confirmed appointment can be cancelled.');
      await updateBookingStatus(request.bookingId, 'Cancelled');
      booking = { ...booking, status: 'Cancelled' };
    } else {
      booking = await rescheduleConfirmedBooking(request.bookingId, request.requestedDate, request.requestedTime, settings);
    }
  }

  await update(requestRef, {
    status: decision,
    seenByAdmin: true,
    reviewedAt: new Date().toISOString(),
    reviewedBy: auth.currentUser.uid,
  });
  await createAppointmentRequestDecisionNotification(request, decision === 'Approved', booking, settings);
  return { status: decision };
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

  const validationErrors = validateBusinessSettingsPatch(settings);
  if (validationErrors.length) throw new Error(validationErrors[0]);

  const payload = {
    ...settings,
    updatedAt: new Date().toISOString(),
  };
  await update(ref(rtdb, 'settings/business'), payload);
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
    const authorization = await checkUserAuthorization(user.uid, user.email);
    const path = authorization.isAdmin ? 'admins' : 'users';
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
  const userRef = ref(rtdb, `users/${user.uid}`);
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
    const verifiedSnapshot = await get(userRef);
    if (!verifiedSnapshot.exists() || verifiedSnapshot.child('uid').val() !== user.uid) {
      throw new Error('The customer profile could not be verified after it was saved.');
    }
    writeStoredProfile(user.uid, mergedProfile);
    return mergedProfile;
  } catch (error) {
    console.warn('Unable to create or update user record', error);
    throw error;
  }
}

export function createOrUpdateCustomerRecord(user) {
  if (!user || !rtdb) {
    return Promise.resolve(null);
  }

  const existingSync = customerRecordSyncPromises.get(user.uid);
  if (existingSync) return existingSync;

  const syncPromise = checkUserAuthorization(user.uid, user.email)
    .then((authorization) => (authorization.isAdmin ? null : syncCustomerRecord(user)))
    .finally(() => {
      if (customerRecordSyncPromises.get(user.uid) === syncPromise) {
        customerRecordSyncPromises.delete(user.uid);
      }
    });
  customerRecordSyncPromises.set(user.uid, syncPromise);
  return syncPromise;
}

export async function prepareImageForUpload(file, folder = 'portfolio', options = {}) {
  const supportedType = ALLOWED_IMAGE_TYPES.includes(String(file?.type || '').toLowerCase());
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

export { getImageFileValidationError } from './imageUploadConfig';

export function getImageUploadErrorMessage(error) {
  const code = String(error?.code || '').toLowerCase();
  const status = Number(error?.status_ || error?.status || 0);
  if (status === 404 && code === 'storage/unknown') {
    return 'Firebase Storage is not available for this project. Finish enabling Storage, then try again.';
  }
  switch (code) {
    case 'storage/unauthenticated':
      return 'Your session has expired. Please sign in again before uploading.';
    case 'storage/admin-required':
      return 'This account is not authorized to upload portfolio photos.';
    case 'storage/unauthorized':
      return "We couldn't upload this image. Check its file type and size, then try again.";
    case 'storage/canceled':
      return 'The upload was canceled. Please select the photo and try again.';
    case 'storage/retry-limit-exceeded':
      return 'The upload timed out. Check your connection and try again.';
    case 'storage/object-not-found':
      return 'The uploaded photo could not be found. Please try again.';
    case 'storage/invalid-format':
      return error?.message || 'Please choose a valid JPG, PNG, or WebP image.';
    default:
      return 'The photo could not be uploaded. Please try again.';
  }
}

function createImageUploadError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function uploadImageFile(file, folder = 'portfolio', onProgress, options = {}) {
  if (!app || !storage || !auth) {
    throw new Error('Firebase not initialized. Call initFirebase first.');
  }

  const validationError = getImageFileValidationError(file, folder);
  if (validationError) throw createImageUploadError('storage/invalid-format', validationError);

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw createImageUploadError('storage/unauthenticated', 'Authentication is required before uploading.');
  }
  if (!PORTFOLIO_UPLOAD_FOLDERS.has(folder) && !CUSTOMER_UPLOAD_FOLDERS.has(folder)) {
    throw createImageUploadError('storage/unauthorized', 'This upload destination is not allowed.');
  }
  if (PORTFOLIO_UPLOAD_FOLDERS.has(folder)) {
    const authorization = await checkUserAuthorization(currentUser.uid, currentUser.email);
    if (!authorization.isAdmin || authorization.status !== 'active') {
      throw createImageUploadError('storage/admin-required', 'Admin authorization is required for portfolio uploads.');
    }
  }

  try {
    const uploadFile = await prepareImageForUpload(file, folder, options);
    const processedFileValidationError = getImageFileValidationError(uploadFile, folder);
    if (processedFileValidationError) {
      throw createImageUploadError('storage/invalid-format', processedFileValidationError);
    }
    const safeName = String(uploadFile.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');
    const basePath = CUSTOMER_UPLOAD_FOLDERS.has(folder)
      ? `${folder}/${currentUser.uid}`
      : folder;
    const path = `${basePath}/${Date.now()}_${safeName}`;
    const sRef = storageRef(storage, path);

    // Use resumable upload to report progress when requested
    if (typeof onProgress === 'function') {
      onProgress(0);
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
              onProgress(100);
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
    console.warn('Failed to upload image file to Firebase Storage', {
      code: error?.code || 'storage/unknown',
      status: error?.status_ || error?.status || null,
    });
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
    const authorization = await checkUserAuthorization(uid, email);
    const path = authorization.isAdmin ? 'admins' : 'users';
    const userRef = ref(rtdb, `${path}/${uid}`);
    const snap = await get(userRef);
    if (snap.exists()) {
      const data = snap.val();
      const storedProfile = readStoredProfile(uid) || {};
      const mergedProfile = mergeProfileData(storedProfile, data);
      writeStoredProfile(uid, mergedProfile);
      return mergedProfile;
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
        if (auth?.currentUser?.uid && childSnap.key === auth.currentUser.uid) return;
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
      if (auth?.currentUser?.uid && childSnap.key === auth.currentUser.uid) return;
      users.push(user);
    });

    return users.sort((a, b) => a.fullName.localeCompare(b.fullName));
  } catch (error) {
    console.warn('Failed to fetch user list from Realtime Database', error);
    return [];
  }
}

export async function updateUserStatus(uid, status) {
  if (!rtdb || !uid) {
    return Promise.reject(new Error('Firebase not initialized or user ID missing'));
  }

  try {
    const userRef = ref(rtdb, `users/${uid}`);
    await update(userRef, {
      status: status === 'active' ? 'active' : 'inactive',
      updatedAt: new Date().toISOString(),
    });
    authorizationCache.set(uid, {
      authorization: {
        role: 'customer',
        isAdmin: false,
        status: status === 'active' ? 'active' : 'inactive',
      },
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
