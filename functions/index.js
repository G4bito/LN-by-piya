import { randomUUID } from 'node:crypto';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MS,
  RESET_SESSION_TTL_MS,
  RESEND_COOLDOWN_MS,
  generateOpaqueToken,
  generateOtp,
  getPasswordPolicyFailures,
  hashProtectedValue,
  hashesMatch,
  isValidEmail,
  isValidOtp,
  mergePasswordPolicy,
  normalizeEmail,
  parseResetSession,
} from './passwordResetCore.js';
import {
  DEFAULT_SALON_TIME_ZONE,
  buildAppointmentReminderContent,
  getReminderClaimDecision,
  getReminderEligibility,
  getReminderRuntimeSettings,
  getPendingReminderBookingIds,
  isValidTimeZone,
} from './appointmentReminderCore.js';

function getAdminAppOptions() {
  const databaseURL = String(process.env.FIREBASE_DATABASE_URL || '').trim();
  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const options = databaseURL ? { databaseURL } : {};
  if (serviceAccountJson) {
    try {
      options.credential = cert(JSON.parse(serviceAccountJson));
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
  }
  return Object.keys(options).length ? options : undefined;
}

initializeApp(getAdminAppOptions());
setGlobalOptions({ region: 'asia-southeast1', memory: '256MiB', timeoutSeconds: 30, maxInstances: 10 });

const PASSWORD_RESET_PEPPER = defineSecret('PASSWORD_RESET_PEPPER');
const SENDGRID_API_KEY = defineSecret('SENDGRID_API_KEY');
const PASSWORD_RESET_FROM_EMAIL = defineString('PASSWORD_RESET_FROM_EMAIL');
const SALON_TIME_ZONE = defineString('SALON_TIME_ZONE', { default: DEFAULT_SALON_TIME_ZONE });

const PRIVATE_ROOT = 'serverOnly/passwordReset';
const REQUESTS_PATH = `${PRIVATE_ROOT}/requests`;
const ACTIVE_REQUESTS_PATH = `${PRIVATE_ROOT}/activeByUid`;
const SESSIONS_PATH = `${PRIVATE_ROOT}/sessions`;
const RATE_LIMITS_PATH = `${PRIVATE_ROOT}/rateLimits`;
const NEUTRAL_REQUEST_MESSAGE = 'If an account exists for this email, a verification code has been sent.';
const MIN_REQUEST_DURATION_MS = 700;
const REMINDER_MAX_ATTEMPTS = 3;
const REMINDER_LOCK_MS = 10 * 60 * 1000;

const database = getDatabase();
const adminAuth = getAuth();

function getPepper() {
  const pepper = String(PASSWORD_RESET_PEPPER.value() || '');
  if (pepper.length < 32) {
    logger.error('PASSWORD_RESET_PEPPER is missing or too short.');
    throw new HttpsError('internal', 'Password recovery is temporarily unavailable.');
  }
  return pepper;
}

function getRequestIp(request) {
  return String(request.rawRequest?.ip || 'unknown').slice(0, 128);
}

async function waitForMinimumDuration(startedAt) {
  const remaining = MIN_REQUEST_DURATION_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function consumeRateLimit(key, { limit, windowMs, minimumIntervalMs }) {
  const rateRef = database.ref(`${RATE_LIMITS_PATH}/${key}`);
  const now = Date.now();
  let rejection = null;

  const result = await rateRef.transaction((current) => {
    rejection = null;
    const record = current && typeof current === 'object' ? current : null;
    if (!record || now - Number(record.windowStartedAt || 0) >= windowMs) {
      return { count: 1, windowStartedAt: now, lastRequestAt: now };
    }

    const elapsed = now - Number(record.lastRequestAt || 0);
    if (elapsed < minimumIntervalMs) {
      rejection = Math.max(1, Math.ceil((minimumIntervalMs - elapsed) / 1000));
      return;
    }
    if (Number(record.count || 0) >= limit) {
      rejection = Math.max(1, Math.ceil((windowMs - (now - Number(record.windowStartedAt || now))) / 1000));
      return;
    }

    return {
      count: Number(record.count || 0) + 1,
      windowStartedAt: Number(record.windowStartedAt || now),
      lastRequestAt: now,
    };
  }, undefined, false);

  if (!result.committed) {
    if (rejection) {
      throw new HttpsError('resource-exhausted', `Please wait ${rejection} seconds before requesting another code.`);
    }
    throw new HttpsError('unavailable', 'Password recovery is temporarily unavailable. Please try again.');
  }
}

async function invalidateActiveRequest(uid, replacementRequestId) {
  const activeRef = database.ref(`${ACTIVE_REQUESTS_PATH}/${uid}`);
  const activeSnapshot = await activeRef.get();
  const previousRequestId = activeSnapshot.val();
  const now = Date.now();
  const updates = {
    [`${ACTIVE_REQUESTS_PATH}/${uid}`]: replacementRequestId,
  };

  if (previousRequestId && previousRequestId !== replacementRequestId) {
    updates[`${REQUESTS_PATH}/${previousRequestId}/status`] = 'superseded';
    updates[`${REQUESTS_PATH}/${previousRequestId}/used`] = true;
    updates[`${REQUESTS_PATH}/${previousRequestId}/invalidatedAt`] = now;
    updates[`${REQUESTS_PATH}/${previousRequestId}/otpHash`] = null;
  }
  await database.ref().update(updates);
}

async function removeFailedRequest(uid, requestId) {
  await database.ref(`${REQUESTS_PATH}/${requestId}`).remove().catch(() => {});
  await database.ref(`${ACTIVE_REQUESTS_PATH}/${uid}`).transaction((current) => (
    current === requestId ? null : current
  ), undefined, false).catch(() => {});
}

async function sendTransactionalEmail({ email, subject, text, html }) {
  const apiKey = SENDGRID_API_KEY.value();
  const fromEmail = PASSWORD_RESET_FROM_EMAIL.value();
  const missingConfiguration = [];
  if (!apiKey) missingConfiguration.push('SENDGRID_API_KEY');
  if (!isValidEmail(fromEmail)) missingConfiguration.push('PASSWORD_RESET_FROM_EMAIL');
  if (missingConfiguration.length) {
    throw new Error(`Email delivery configuration is invalid: ${missingConfiguration.join(', ')}.`);
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: fromEmail, name: 'Luxe Nails by Piya' },
      subject,
      content: [
        {
          type: 'text/plain',
          value: text,
        },
        {
          type: 'text/html',
          value: html,
        },
      ],
    }),
  });

  if (!response.ok) {
    const providerMessage = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 500);
    throw new Error(
      `SendGrid rejected the request with status ${response.status}${providerMessage ? `: ${providerMessage}` : '.'}`
    );
  }

  return {
    status: response.status,
    messageId: String(response.headers.get('x-message-id') || '').slice(0, 200),
  };
}

async function sendPasswordResetEmail(email, otp) {
  return sendTransactionalEmail({
    email,
    subject: 'Your Luxe Nails password reset code',
    text: `Luxe Nails by Piya\n\nPASSWORD RESET CODE\n\nYour verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request a password reset, you can ignore this email.`,
    html: `<div style="background:#0b0a0a;color:#f4ead9;padding:32px;font-family:Arial,sans-serif"><h1 style="color:#e9d4a8;font-size:24px">Luxe Nails by Piya</h1><p style="color:#c9a876;letter-spacing:2px">PASSWORD RESET CODE</p><p>Your verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#e9d4a8">${otp}</p><p>This code expires in 10 minutes.</p><p style="color:#b9ad9c">If you did not request a password reset, you can ignore this email.</p></div>`,
  });
}

async function loadPasswordPolicy() {
  try {
    const projectConfig = await adminAuth.projectConfigManager().getProjectConfig();
    return mergePasswordPolicy(projectConfig.passwordPolicyConfig?.constraints);
  } catch (error) {
    logger.warn('Unable to load Firebase password policy; using the existing Luxe Nails policy.', {
      code: error?.code || 'unknown',
    });
    return mergePasswordPolicy();
  }
}

export const requestPasswordResetCode = onCall(
  { secrets: [PASSWORD_RESET_PEPPER, SENDGRID_API_KEY] },
  async (request) => {
    const startedAt = Date.now();
    let requestId = '';
    let userUid = '';
    let resetRecordStored = false;

    logger.info('Password reset request received');

    try {
      const email = normalizeEmail(request.data?.email);
      if (!isValidEmail(email)) {
        throw new HttpsError('invalid-argument', 'Please enter a valid email address.');
      }
      logger.info('Email request accepted');

      const pepper = getPepper();
      const emailRateKey = hashProtectedValue(pepper, 'rate-email', email);
      const ipRateKey = hashProtectedValue(pepper, 'rate-ip', getRequestIp(request));
      await consumeRateLimit(`email/${emailRateKey}`, {
        limit: 3,
        windowMs: 60 * 60 * 1000,
        minimumIntervalMs: RESEND_COOLDOWN_MS,
      });
      await consumeRateLimit(`ip/${ipRateKey}`, {
        limit: 12,
        windowMs: 60 * 60 * 1000,
        minimumIntervalMs: 5 * 1000,
      });

      requestId = randomUUID();
      const response = {
        success: true,
        message: NEUTRAL_REQUEST_MESSAGE,
        requestId,
        cooldownSeconds: RESEND_COOLDOWN_MS / 1000,
      };

      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(email);
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
        logger.info('User lookup completed', { requestId });
        await waitForMinimumDuration(startedAt);
        logger.info('Request completed', { requestId });
        return response;
      }

      logger.info('User lookup completed', { requestId });
      const supportsPassword = userRecord.providerData.some((provider) => provider.providerId === 'password');
      if (userRecord.disabled || !supportsPassword) {
        await waitForMinimumDuration(startedAt);
        logger.info('Request completed', { requestId });
        return response;
      }

      userUid = userRecord.uid;
      const otp = generateOtp();
      logger.info('OTP generated', { requestId });
      const now = Date.now();
      const resetRecord = {
        uid: userUid,
        otpHash: hashProtectedValue(pepper, `otp-${requestId}`, otp),
        createdAt: now,
        expiresAt: now + OTP_TTL_MS,
        attempts: 0,
        maxAttempts: MAX_OTP_ATTEMPTS,
        status: 'pending',
        used: false,
      };

      await invalidateActiveRequest(userUid, requestId);
      await database.ref(`${REQUESTS_PATH}/${requestId}`).set(resetRecord);
      resetRecordStored = true;
      logger.info('OTP record stored', { requestId });

      logger.info('Sending email', { requestId, provider: 'sendgrid' });
      const emailResponse = await sendPasswordResetEmail(email, otp);
      logger.info('Email provider responded', {
        requestId,
        provider: 'sendgrid',
        status: emailResponse.status,
      });

      await waitForMinimumDuration(startedAt);
      logger.info('Request completed', { requestId });
      return response;
    } catch (error) {
      if (resetRecordStored && userUid && requestId) {
        await removeFailedRequest(userUid, requestId);
      }
      logger.error('Password reset request failed.', {
        requestId: requestId || 'unassigned',
        code: error?.code || 'unknown',
        message: error?.message || String(error),
        stack: error?.stack || null,
      });
      await waitForMinimumDuration(startedAt);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('internal', 'Password recovery is temporarily unavailable. Please try again.');
    }
  }
);

export const verifyPasswordResetCode = onCall(
  { secrets: [PASSWORD_RESET_PEPPER] },
  async (request) => {
    const requestId = String(request.data?.requestId || '');
    const otp = String(request.data?.code || '');
    if (!/^[a-f0-9-]{36}$/i.test(requestId) || !isValidOtp(otp)) {
      throw new HttpsError('invalid-argument', 'The verification code is incorrect. Please try again.');
    }

    const pepper = getPepper();
    const submittedHash = hashProtectedValue(pepper, `otp-${requestId}`, otp);
    const resetRef = database.ref(`${REQUESTS_PATH}/${requestId}`);
    const now = Date.now();
    let outcome = 'incorrect';

    const result = await resetRef.transaction((current) => {
      if (!current || current.status !== 'pending' || current.used === true) {
        outcome = current?.status === 'expired' ? 'expired' : 'incorrect';
        return;
      }
      if (Number(current.expiresAt || 0) <= now) {
        outcome = 'expired';
        return { ...current, status: 'expired', used: true, otpHash: null, invalidatedAt: now };
      }
      if (Number(current.attempts || 0) >= MAX_OTP_ATTEMPTS) {
        outcome = 'locked';
        return { ...current, status: 'locked', used: true, otpHash: null, invalidatedAt: now };
      }
      if (!hashesMatch(current.otpHash, submittedHash)) {
        const attempts = Number(current.attempts || 0) + 1;
        outcome = attempts >= MAX_OTP_ATTEMPTS ? 'locked' : 'incorrect';
        return {
          ...current,
          attempts,
          lastAttemptAt: now,
          ...(attempts >= MAX_OTP_ATTEMPTS
            ? { status: 'locked', used: true, otpHash: null, invalidatedAt: now }
            : {}),
        };
      }

      outcome = 'verified';
      return {
        ...current,
        status: 'verified',
        used: true,
        otpHash: null,
        verifiedAt: now,
      };
    }, undefined, false);

    if (outcome === 'expired') {
      throw new HttpsError('deadline-exceeded', 'This verification code has expired. Please request a new code.');
    }
    if (outcome === 'locked') {
      throw new HttpsError('resource-exhausted', 'Too many incorrect attempts. Please request a new code.');
    }
    if (!result.committed || outcome !== 'verified') {
      throw new HttpsError('invalid-argument', 'The verification code is incorrect. Please try again.');
    }

    const verifiedRecord = result.snapshot.val();
    const activeRequest = await database.ref(`${ACTIVE_REQUESTS_PATH}/${verifiedRecord.uid}`).get();
    if (activeRequest.val() !== requestId) {
      throw new HttpsError('failed-precondition', 'This verification code is no longer active. Please request a new code.');
    }

    const sessionId = randomUUID();
    const sessionToken = generateOpaqueToken();
    await database.ref().update({
      [`${SESSIONS_PATH}/${sessionId}`]: {
        uid: verifiedRecord.uid,
        requestId,
        tokenHash: hashProtectedValue(pepper, `session-${sessionId}-${requestId}`, sessionToken),
        createdAt: now,
        expiresAt: now + RESET_SESSION_TTL_MS,
        status: 'active',
        used: false,
      },
      [`${REQUESTS_PATH}/${requestId}/sessionId`]: sessionId,
    });

    return {
      resetSession: `${sessionId}.${sessionToken}`,
      expiresInSeconds: RESET_SESSION_TTL_MS / 1000,
    };
  }
);

export const completePasswordReset = onCall(
  { secrets: [PASSWORD_RESET_PEPPER] },
  async (request) => {
    const parsedSession = parseResetSession(request.data?.resetSession);
    const newPassword = request.data?.newPassword;
    if (!parsedSession || typeof newPassword !== 'string') {
      throw new HttpsError('permission-denied', 'Your password reset session is invalid. Please request a new code.');
    }

    const pepper = getPepper();
    const sessionRef = database.ref(`${SESSIONS_PATH}/${parsedSession.sessionId}`);
    const initialSnapshot = await sessionRef.get();
    const initialSession = initialSnapshot.val();
    const expectedTokenHash = hashProtectedValue(
      pepper,
      `session-${parsedSession.sessionId}-${initialSession?.requestId || ''}`,
      parsedSession.token
    );
    const now = Date.now();

    if (
      !initialSession
      || initialSession.status !== 'active'
      || initialSession.used === true
      || Number(initialSession.expiresAt || 0) <= now
      || !hashesMatch(initialSession.tokenHash, expectedTokenHash)
    ) {
      throw new HttpsError('permission-denied', 'Your password reset session has expired. Please request a new code.');
    }

    const [activeRequest, resetRequest, passwordPolicy] = await Promise.all([
      database.ref(`${ACTIVE_REQUESTS_PATH}/${initialSession.uid}`).get(),
      database.ref(`${REQUESTS_PATH}/${initialSession.requestId}`).get(),
      loadPasswordPolicy(),
    ]);
    if (
      activeRequest.val() !== initialSession.requestId
      || resetRequest.val()?.status !== 'verified'
      || resetRequest.val()?.sessionId !== parsedSession.sessionId
    ) {
      throw new HttpsError('permission-denied', 'Your password reset session is no longer active. Please request a new code.');
    }

    const policyFailures = getPasswordPolicyFailures(newPassword, passwordPolicy);
    if (policyFailures.length) {
      throw new HttpsError('invalid-argument', `Password must include ${policyFailures.join(', ')}.`);
    }

    const operationId = randomUUID();
    let consumeOutcome = 'invalid';
    const consumed = await sessionRef.transaction((current) => {
      if (
        !current
        || current.status !== 'active'
        || current.used === true
        || Number(current.expiresAt || 0) <= Date.now()
        || !hashesMatch(current.tokenHash, expectedTokenHash)
      ) {
        consumeOutcome = 'invalid';
        return;
      }
      consumeOutcome = 'processing';
      return { ...current, status: 'processing', operationId, processingAt: Date.now() };
    }, undefined, false);

    if (!consumed.committed || consumeOutcome !== 'processing') {
      throw new HttpsError('permission-denied', 'Your password reset session has expired. Please request a new code.');
    }

    const latestActiveRequest = await database.ref(`${ACTIVE_REQUESTS_PATH}/${initialSession.uid}`).get();
    if (latestActiveRequest.val() !== initialSession.requestId) {
      await sessionRef.update({ status: 'revoked', used: true, tokenHash: null, invalidatedAt: Date.now() });
      throw new HttpsError('permission-denied', 'Your password reset session is no longer active. Please request a new code.');
    }

    try {
      await adminAuth.updateUser(initialSession.uid, { password: newPassword });
      await adminAuth.revokeRefreshTokens(initialSession.uid);
    } catch (error) {
      logger.error('Firebase Auth password update failed.', { code: error?.code || 'unknown' });
      await sessionRef.transaction((current) => (
        current?.operationId === operationId
          ? { ...current, status: 'active', operationId: null, processingAt: null }
          : current
      ), undefined, false).catch(() => {});
      throw new HttpsError('internal', 'Your password could not be updated. Please try again.');
    }

    try {
      await database.ref().update({
        [`${SESSIONS_PATH}/${parsedSession.sessionId}/status`]: 'completed',
        [`${SESSIONS_PATH}/${parsedSession.sessionId}/used`]: true,
        [`${SESSIONS_PATH}/${parsedSession.sessionId}/tokenHash`]: null,
        [`${SESSIONS_PATH}/${parsedSession.sessionId}/completedAt`]: Date.now(),
        [`${REQUESTS_PATH}/${initialSession.requestId}/status`]: 'completed',
        [`${REQUESTS_PATH}/${initialSession.requestId}/completedAt`]: Date.now(),
        [`${ACTIVE_REQUESTS_PATH}/${initialSession.uid}`]: null,
      });
    } catch (error) {
      logger.error('Password reset cleanup failed after the Auth password was updated.', {
        sessionId: parsedSession.sessionId,
      });
    }

    return { success: true };
  }
);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSalonTimeZone() {
  const configured = String(SALON_TIME_ZONE.value() || DEFAULT_SALON_TIME_ZONE).trim();
  if (isValidTimeZone(configured)) return configured;
  logger.error('SALON_TIME_ZONE is invalid; falling back to Asia/Manila.', { configured });
  return DEFAULT_SALON_TIME_ZONE;
}

function createReminderEmail(content) {
  const details = [
    ['SERVICE', content.serviceName],
    ['DATE', content.date],
    ['TIME', content.time],
    ['NAIL ART', content.nailArt],
    ['REFERENCE PHOTO', content.referencePhoto],
  ];
  const detailText = details.map(([label, value]) => `${label}\n${value}`).join('\n\n');
  const detailHtml = details.map(([label, value]) => (
    `<div style="padding:12px 0;border-bottom:1px solid rgba(201,168,118,.22)">`
      + `<div style="margin-bottom:4px;color:#c9a876;font-size:11px;font-weight:700;letter-spacing:1.6px">${escapeHtml(label)}</div>`
      + `<div style="color:#f4ead9;font-size:15px">${escapeHtml(value)}</div>`
    + '</div>'
  )).join('');

  return {
    text: `${content.businessName.toUpperCase()}\n\nAPPOINTMENT REMINDER\n\nHi ${content.customerName},\n\n${content.intro}\n\n${detailText}\n\nWe look forward to seeing you. Please arrive on time for your appointment.\n\n${content.businessName}`,
    html: `<div style="margin:0;background:#0b0a0a;padding:28px 14px;color:#f4ead9;font-family:Arial,sans-serif">`
      + `<div style="max-width:560px;margin:0 auto;border:1px solid rgba(201,168,118,.42);border-radius:16px;background:#15110f;padding:30px">`
      + `<div style="color:#e9d4a8;font-family:Georgia,serif;font-size:25px">${escapeHtml(content.businessName)}</div>`
      + '<div style="margin:8px 0 24px;color:#c9a876;font-size:11px;font-weight:700;letter-spacing:2px">APPOINTMENT REMINDER</div>'
      + `<p style="margin:0 0 12px;line-height:1.6">Hi ${escapeHtml(content.customerName)},</p>`
      + `<p style="margin:0 0 20px;line-height:1.6;color:#ded2c0">${escapeHtml(content.intro)}</p>`
      + detailHtml
      + '<p style="margin:24px 0 5px;line-height:1.6">We look forward to seeing you.</p>'
      + '<p style="margin:0;color:#b9ad9c;line-height:1.6">Please arrive on time for your appointment.</p>'
      + `<div style="margin-top:26px;color:#c9a876;font-family:Georgia,serif">${escapeHtml(content.businessName)}</div>`
      + '</div></div>',
  };
}

async function claimAppointmentReminder(bookingId, reminderType, now, timeZone) {
  const bookingRef = database.ref(`bookings/${bookingId}`);
  const operationId = randomUUID();
  let claimReason = 'not-eligible';

  const result = await bookingRef.transaction((booking) => {
    if (!booking) {
      claimReason = 'missing-booking';
      return;
    }

    const eligibility = getReminderEligibility(booking, reminderType, now, timeZone);
    if (!eligibility.eligible) {
      claimReason = eligibility.reason;
      return;
    }

    const reminders = booking.reminders && typeof booking.reminders === 'object' ? booking.reminders : {};
    const decision = getReminderClaimDecision(
      reminders,
      reminderType,
      eligibility.appointmentKey,
      now,
      { lockMs: REMINDER_LOCK_MS, maxAttempts: REMINDER_MAX_ATTEMPTS }
    );
    if (!decision.claim) {
      claimReason = decision.reason;
      return;
    }

    claimReason = 'claimed';
    const nextRecord = {
      ...(decision.sameAppointment ? decision.existing : {}),
      status: 'processing',
      appointmentKey: eligibility.appointmentKey,
      appointmentAt: eligibility.appointmentAt,
      dueAt: eligibility.dueAt,
      attemptCount: decision.previousAttempts + 1,
      operationId,
      lockedAt: now,
      lastAttemptAt: now,
      emailStatus: decision.sameAppointment ? (decision.existing.emailStatus || 'pending') : 'pending',
      inAppStatus: decision.sameAppointment ? (decision.existing.inAppStatus || 'pending') : 'pending',
    };

    return {
      ...booking,
      reminders: {
        ...reminders,
        [reminderType]: nextRecord,
      },
    };
  }, undefined, false);

  if (!result.committed || claimReason !== 'claimed') return { claimed: false, reason: claimReason };
  const booking = { id: bookingId, ...(result.snapshot.val() || {}) };
  return {
    claimed: true,
    operationId,
    booking,
    record: booking.reminders?.[reminderType] || {},
  };
}

async function patchReminderRecord(bookingId, reminderType, operationId, patch) {
  const recordRef = database.ref(`bookings/${bookingId}/reminders/${reminderType}`);
  const result = await recordRef.transaction((record) => {
    if (!record || record.operationId !== operationId) return;
    return { ...record, ...patch };
  }, undefined, false);
  return result.committed ? result.snapshot.val() : null;
}

async function finishReminder(bookingId, reminderType, operationId, result, now) {
  const bookingRef = database.ref(`bookings/${bookingId}`);
  return bookingRef.transaction((booking) => {
    const current = booking?.reminders?.[reminderType];
    if (!booking || !current || current.operationId !== operationId) return;
    const reminders = { ...booking.reminders };
    reminders[reminderType] = {
      ...current,
      status: result.status,
      completedAt: now,
      lockedAt: null,
      ...(result.status === 'failed'
        ? { lastError: result.errorCode || 'channel-delivery-failed', failedAt: now }
        : result.status === 'skipped'
          ? { lastError: null, skippedReason: result.errorCode || 'booking-changed', skippedAt: now }
          : { lastError: null }),
    };
    if (result.status === 'sent') {
      reminders[`${reminderType}Sent`] = true;
      reminders[`${reminderType}SentAt`] = now;
      reminders[reminderType].sentAt = now;
    }
    return { ...booking, reminders };
  }, undefined, false);
}

async function getReminderRecipient(booking) {
  const profileSnapshot = booking.uid
    ? await database.ref(`users/${booking.uid}`).get()
    : null;
  const profile = profileSnapshot?.exists() ? profileSnapshot.val() : {};
  let authUser = null;
  if (booking.uid) {
    try {
      authUser = await adminAuth.getUser(booking.uid);
    } catch (error) {
      logger.warn('Appointment reminder could not load the Firebase Auth user.', {
        bookingId: booking.id,
        code: error?.code || 'unknown',
      });
    }
  }

  const candidates = [authUser?.email, profile?.email, booking.email, booking.customerEmail];
  const email = candidates.find((candidate) => isValidEmail(String(candidate || '').trim())) || '';
  return {
    email,
    profile,
    emailEnabled: profile?.notificationPreferences?.emailAppointmentReminders !== false,
    accountDisabled: authUser?.disabled === true,
  };
}

async function createInAppReminder({ booking, reminderType, content, appointmentAt, timeZone, now }) {
  if (!booking.uid) throw new Error('missing-customer-uid');
  const notificationId = `${booking.id}_${reminderType}`;
  const notificationRef = database.ref(`notifications/${booking.uid}/${notificationId}`);
  await notificationRef.transaction((current) => current || {
    type: 'appointment_reminder',
    title: content.title,
    message: content.message,
    bookingId: booking.id,
    reminderType,
    appointmentAt,
    timeZone,
    read: false,
    createdAt: now,
  }, undefined, false);
  return notificationId;
}

async function deliverAppointmentReminder(claim, reminderType, timeZone, now, { inAppEnabled = true, businessName = 'Luxe Nails by Piya' } = {}) {
  const bookingRef = database.ref(`bookings/${claim.booking.id}`);
  const latestSnapshot = await bookingRef.get();
  const latestBooking = latestSnapshot.exists()
    ? { id: claim.booking.id, ...(latestSnapshot.val() || {}) }
    : null;
  const currentRecord = latestBooking?.reminders?.[reminderType];
  const eligibility = latestBooking
    ? getReminderEligibility(latestBooking, reminderType, now, timeZone)
    : { eligible: false, reason: 'missing-booking' };
  if (!latestBooking || currentRecord?.operationId !== claim.operationId || !eligibility.eligible) {
    await finishReminder(
      claim.booking.id,
      reminderType,
      claim.operationId,
      { status: 'skipped', errorCode: eligibility.reason || 'booking-changed' },
      now
    );
    return { status: 'skipped', reason: eligibility.reason || 'booking-changed' };
  }

  const recipient = await getReminderRecipient(latestBooking);
  const content = buildAppointmentReminderContent({
    booking: latestBooking,
    profile: recipient.profile,
    reminderType,
    appointmentAt: eligibility.appointmentAt,
    timeZone,
    businessName,
  });
  let record = currentRecord;
  let emailError = null;
  let inAppError = null;

  if (!['accepted', 'skipped'].includes(record.emailStatus)) {
    if (!recipient.emailEnabled) {
      record = await patchReminderRecord(latestBooking.id, reminderType, claim.operationId, {
        emailStatus: 'skipped',
        emailSkippedReason: 'customer-opt-out',
      }) || record;
    } else if (!recipient.email || recipient.accountDisabled) {
      logger.warn('Appointment reminder email skipped because no usable customer email is available.', {
        bookingId: latestBooking.id,
        accountDisabled: recipient.accountDisabled,
      });
      record = await patchReminderRecord(latestBooking.id, reminderType, claim.operationId, {
        emailStatus: 'skipped',
        emailSkippedReason: recipient.accountDisabled ? 'account-disabled' : 'missing-customer-email',
      }) || record;
    } else {
      try {
        const emailBody = createReminderEmail(content);
        const providerResponse = await sendTransactionalEmail({
          email: recipient.email,
          subject: content.subject,
          text: emailBody.text,
          html: emailBody.html,
        });
        record = await patchReminderRecord(latestBooking.id, reminderType, claim.operationId, {
          emailStatus: 'accepted',
          emailAcceptedAt: Date.now(),
          providerStatus: providerResponse.status,
          ...(providerResponse.messageId ? { providerMessageId: providerResponse.messageId } : {}),
        }) || record;
      } catch (error) {
        emailError = error;
        logger.error('Appointment reminder email delivery failed.', {
          bookingId: latestBooking.id,
          reminderType,
          code: error?.code || 'email-provider-error',
          message: error?.message || String(error),
        });
        record = await patchReminderRecord(latestBooking.id, reminderType, claim.operationId, {
          emailStatus: 'failed',
          emailFailedAt: Date.now(),
        }) || record;
      }
    }
  }

  if (!inAppEnabled && !['sent', 'skipped'].includes(record.inAppStatus)) {
    record = await patchReminderRecord(latestBooking.id, reminderType, claim.operationId, {
      inAppStatus: 'skipped',
      inAppSkippedReason: 'salon-disabled',
    }) || record;
  } else if (inAppEnabled && record.inAppStatus !== 'sent') {
    try {
      const notificationId = await createInAppReminder({
        booking: latestBooking,
        reminderType,
        content,
        appointmentAt: eligibility.appointmentAt,
        timeZone,
        now,
      });
      record = await patchReminderRecord(latestBooking.id, reminderType, claim.operationId, {
        inAppStatus: 'sent',
        inAppSentAt: Date.now(),
        notificationId,
      }) || record;
    } catch (error) {
      inAppError = error;
      logger.error('Appointment reminder in-app notification failed.', {
        bookingId: latestBooking.id,
        reminderType,
        code: error?.code || 'database-error',
      });
      await patchReminderRecord(latestBooking.id, reminderType, claim.operationId, {
        inAppStatus: 'failed',
        inAppFailedAt: Date.now(),
      });
    }
  }

  const failed = Boolean(emailError || inAppError);
  await finishReminder(
    latestBooking.id,
    reminderType,
    claim.operationId,
    { status: failed ? 'failed' : 'sent', errorCode: failed ? 'channel-delivery-failed' : '' },
    Date.now()
  );
  return { status: failed ? 'failed' : 'sent' };
}

async function processReminderBooking(booking, reminderType, now, timeZone, runtimeSettings) {
  const claim = await claimAppointmentReminder(booking.id, reminderType, now, timeZone);
  if (!claim.claimed) return { status: 'ignored', reason: claim.reason };
  return deliverAppointmentReminder(claim, reminderType, timeZone, now, runtimeSettings);
}

export async function runAppointmentReminderSweep({ now = Date.now() } = {}) {
  const [settingsSnapshot, snapshot, pendingRequestsSnapshot] = await Promise.all([
    database.ref('settings/business').get(),
    database.ref('bookings').orderByChild('status').equalTo('Confirmed').get(),
    database.ref('appointmentChangeRequests').orderByChild('status').equalTo('Pending').get(),
  ]);
  const runtimeSettings = getReminderRuntimeSettings(
    settingsSnapshot.exists() ? settingsSnapshot.val() : {},
    getSalonTimeZone()
  );
  const { timeZone, reminderTypes } = runtimeSettings;
  const bookings = [];
  snapshot.forEach((child) => bookings.push({ id: child.key, ...(child.val() || {}) }));
  const pendingReminderBookingIds = getPendingReminderBookingIds(
    pendingRequestsSnapshot.exists() ? pendingRequestsSnapshot.val() : {}
  );
  const counts = { sent: 0, failed: 0, skipped: 0, ignored: 0, paused: 0 };

  for (let index = 0; index < bookings.length; index += 5) {
    const batch = bookings.slice(index, index + 5);
    const results = await Promise.allSettled(batch.flatMap((booking) => (
      reminderTypes.map((reminderType) => pendingReminderBookingIds.has(booking.id)
        ? Promise.resolve({ status: 'paused', reason: 'pending-appointment-change' })
        : processReminderBooking(booking, reminderType, now, timeZone, runtimeSettings))
    )));
    results.forEach((result) => {
      if (result.status === 'rejected') {
        counts.failed += 1;
        logger.error('Appointment reminder processing failed.', {
          code: result.reason?.code || 'unknown',
          message: result.reason?.message || String(result.reason),
        });
        return;
      }
      const status = result.value?.status || 'ignored';
      counts[status] = Number(counts[status] || 0) + 1;
    });
  }

  logger.info('Appointment reminder run completed.', {
    confirmedBookings: bookings.length,
    appointmentsPausedForReview: pendingReminderBookingIds.size,
    timeZone,
    enabledReminderTypes: reminderTypes,
    ...counts,
  });
  return { confirmedBookings: bookings.length, timeZone, ...counts };
}

export const processAppointmentReminders = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Manila',
    timeoutSeconds: 300,
    maxInstances: 1,
    secrets: [SENDGRID_API_KEY],
  },
  () => runAppointmentReminderSweep()
);

export const cleanupPasswordResetData = onSchedule(
  { schedule: 'every 24 hours', timeZone: 'Asia/Manila' },
  async () => {
    const now = Date.now();
    const retentionCutoff = now - 24 * 60 * 60 * 1000;
    const updates = {};
    const [requestsSnapshot, sessionsSnapshot, rateLimitsSnapshot] = await Promise.all([
      database.ref(REQUESTS_PATH).get(),
      database.ref(SESSIONS_PATH).get(),
      database.ref(RATE_LIMITS_PATH).get(),
    ]);

    requestsSnapshot.forEach((child) => {
      const record = child.val() || {};
      if (Number(record.expiresAt || record.createdAt || 0) < retentionCutoff) {
        updates[`${REQUESTS_PATH}/${child.key}`] = null;
      }
    });
    sessionsSnapshot.forEach((child) => {
      const record = child.val() || {};
      if (Number(record.expiresAt || record.createdAt || 0) < retentionCutoff) {
        updates[`${SESSIONS_PATH}/${child.key}`] = null;
      }
    });
    rateLimitsSnapshot.forEach((rateTypeSnapshot) => {
      rateTypeSnapshot.forEach((child) => {
        const record = child.val() || {};
        if (Number(record.windowStartedAt || 0) < retentionCutoff) {
          updates[`${RATE_LIMITS_PATH}/${rateTypeSnapshot.key}/${child.key}`] = null;
        }
      });
    });

    if (Object.keys(updates).length) await database.ref().update(updates);
  }
);
