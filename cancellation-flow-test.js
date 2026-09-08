import React from 'react';
import { createRoot } from 'react-dom/client';
import Navbar from './src/components/Navbar.jsx';
import {
  initFirebase,
  listenToCustomerNotifications,
  logOut,
  reviewAppointmentChangeRequest,
  signInWithEmail,
  updateBookingStatus,
} from './src/firebase.js';

const resultNode = document.getElementById('result');
const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const databaseUrl = String(import.meta.env.VITE_FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
const adminEmail = import.meta.env.VITE_ADMIN_EMAIL;
const adminPassword = import.meta.env.VITE_ADMIN_PASS;
const runId = `codex-cancel-test-${Date.now()}`;
const customerEmail = `${runId}@example.com`;
const customerPassword = `Luxe!${crypto.randomUUID()}Aa1`;
const bookingIds = {
  direct: `${runId}-direct`,
  approved: `${runId}-approved`,
  declined: `${runId}-declined`,
};
const bookingDates = {
  [bookingIds.direct]: '2099-12-16',
  [bookingIds.approved]: '2099-12-17',
  [bookingIds.declined]: '2099-12-18',
};
const requestIds = {
  approved: `${bookingIds.approved}_cancellation`,
  declined: `${bookingIds.declined}_cancellation`,
};
let customerAuth = null;
let adminAuth = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function identityRequest(operation, body) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Identity request failed: ${payload?.error?.message || response.status}`);
  return payload;
}

async function databaseRequest(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${databaseUrl}/${path}.json?auth=${encodeURIComponent(token)}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Database ${method} failed for ${path}: ${payload?.error || response.status}`);
  return payload;
}

function createBooking(id, uid, email) {
  const timestamp = new Date().toISOString();
  return {
    id,
    uid,
    email,
    customerName: 'Codex Cancellation Test',
    name: 'Codex Cancellation Test',
    phone: '09171234567',
    customerPhone: '09171234567',
    address: 'Temporary test address',
    service: 'gel-manicure',
    serviceName: 'Gel Manicure',
    date: bookingDates[id],
    time: '11:00',
    status: 'Pending Confirmation',
    seenByAdmin: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createRequest(id, bookingId, uid) {
  return {
    id,
    bookingId,
    uid,
    type: 'cancellation',
    status: 'Pending',
    reason: 'Temporary automated integration test',
    createdAt: Date.now(),
    seenByAdmin: false,
  };
}

async function waitForNotifications(uid, minimumCount) {
  return await new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error('Realtime customer notification listener timed out.'));
    }, 10000);
    unsubscribe = listenToCustomerNotifications(uid, (notifications) => {
      const testNotifications = notifications.filter((notification) => (
        Object.values(bookingIds).includes(notification.bookingId)
      ));
      if (testNotifications.length < minimumCount) return;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(testNotifications);
    }, reject);
  });
}

async function cleanUp() {
  await logOut().catch(() => {});
  if (adminAuth?.idToken && customerAuth?.localId && runId.startsWith('codex-cancel-test-')) {
    const cleanup = {
      [`users/${customerAuth.localId}`]: null,
      [`notifications/${customerAuth.localId}`]: null,
      ...Object.fromEntries(Object.values(bookingIds).map((id) => [`bookings/${id}`, null])),
      ...Object.fromEntries(Object.values(requestIds).map((id) => [`appointmentChangeRequests/${id}`, null])),
      ...Object.fromEntries(Object.values(bookingIds).map((id) => [`scheduleSlots/${bookingDates[id]}/${id}`, null])),
    };
    await databaseRequest('', { method: 'PATCH', token: adminAuth.idToken, body: cleanup }).catch(() => {});
  }
  if (customerAuth?.idToken) {
    await identityRequest('delete', { idToken: customerAuth.idToken }).catch(() => {});
  }
}

async function run() {
  initFirebase();
  customerAuth = await identityRequest('signUp', {
    email: customerEmail,
    password: customerPassword,
    returnSecureToken: true,
  });
  adminAuth = await identityRequest('signInWithPassword', {
    email: adminEmail,
    password: adminPassword,
    returnSecureToken: true,
  });

  await databaseRequest(`users/${customerAuth.localId}`, {
    method: 'PUT',
    token: adminAuth.idToken,
    body: { uid: customerAuth.localId, email: customerEmail, status: 'active', fullName: 'Codex Cancellation Test' },
  });
  await Promise.all(Object.entries(bookingIds).map(([key, id]) => databaseRequest(`bookings/${id}`, {
    method: 'PUT',
    token: customerAuth.idToken,
    body: createBooking(id, customerAuth.localId, customerEmail),
  })));

  await Promise.all(Object.values(bookingIds).map((id) => databaseRequest(`bookings/${id}`, {
    method: 'PATCH',
    token: adminAuth.idToken,
    body: { status: 'Confirmed', seenByAdmin: true, updatedAt: new Date().toISOString() },
  })));

  await Promise.all(Object.entries(requestIds).map(([key, id]) => databaseRequest(`appointmentChangeRequests/${id}`, {
    method: 'PUT',
    token: adminAuth.idToken,
    body: createRequest(id, bookingIds[key], customerAuth.localId),
  })));

  await signInWithEmail(adminEmail, adminPassword, false);
  await updateBookingStatus(bookingIds.direct, 'Cancelled');
  await updateBookingStatus(bookingIds.direct, 'Cancelled');
  await reviewAppointmentChangeRequest(requestIds.approved, 'Approved');
  await reviewAppointmentChangeRequest(requestIds.declined, 'Declined', 'Please contact the salon if you need another time.');

  const [directBooking, approvedBooking, declinedBooking, approvedRequest, declinedRequest, storedNotifications] = await Promise.all([
    databaseRequest(`bookings/${bookingIds.direct}`, { token: adminAuth.idToken }),
    databaseRequest(`bookings/${bookingIds.approved}`, { token: adminAuth.idToken }),
    databaseRequest(`bookings/${bookingIds.declined}`, { token: adminAuth.idToken }),
    databaseRequest(`appointmentChangeRequests/${requestIds.approved}`, { token: adminAuth.idToken }),
    databaseRequest(`appointmentChangeRequests/${requestIds.declined}`, { token: adminAuth.idToken }),
    databaseRequest(`notifications/${customerAuth.localId}`, { token: customerAuth.idToken }),
  ]);

  const stored = Object.values(storedNotifications || {});
  assert(directBooking.status === 'Cancelled', 'Direct Admin cancellation did not persist.');
  assert(approvedBooking.status === 'Cancelled' && approvedRequest.status === 'Approved', 'Cancellation approval was not atomic.');
  assert(declinedBooking.status === 'Confirmed' && declinedRequest.status === 'Declined', 'Cancellation decline changed the appointment incorrectly.');
  assert(stored.filter((notification) => notification.bookingId === bookingIds.direct).length === 1, 'Direct cancellation created a duplicate notification.');
  assert(stored.some((notification) => notification.bookingId === bookingIds.approved && notification.title === 'Appointment Cancelled'), 'Approved cancellation notification is missing.');
  assert(stored.some((notification) => notification.bookingId === bookingIds.declined && notification.type === 'cancellation_request_declined'), 'Declined cancellation notification is missing.');

  await logOut();
  await signInWithEmail(customerEmail, customerPassword, false);
  const liveNotifications = await waitForNotifications(customerAuth.localId, 3);
  const refreshedNotifications = await waitForNotifications(customerAuth.localId, 3);
  let selectedNotification = null;
  createRoot(document.getElementById('root')).render(React.createElement(Navbar, {
    currentPage: 'home',
    isSignedIn: true,
    isAdmin: false,
    user: { uid: customerAuth.localId, email: customerEmail },
    notifications: liveNotifications,
    notificationOpen: true,
    onNavigate: () => {},
    onToggleNotifications: () => {},
    onSelectNotification: (notification) => { selectedNotification = notification; },
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 100));

  const panelText = document.querySelector('.nav-notification-panel')?.textContent || '';
  const unreadBadge = Number(document.querySelector('.nav-notification-badge')?.textContent || 0);
  const directButton = [...document.querySelectorAll('.nav-notification-item')]
    .find((button) => button.textContent.includes('cancelled by the salon'));
  directButton?.click();
  assert(panelText.includes('Appointment Cancelled'), 'The real notification bell did not display Appointment Cancelled.');
  assert(panelText.includes('Cancellation Request Declined'), 'The real notification bell did not display the decline notification.');
  assert(unreadBadge === 3, `Expected unread badge 3, received ${unreadBadge}.`);
  assert(selectedNotification?.bookingId === bookingIds.direct, 'View appointment did not preserve the booking target.');
  assert(refreshedNotifications.length === liveNotifications.length, 'Notifications did not persist across listener re-subscription.');

  return {
    directCancellation: 'PASS',
    approval: 'PASS',
    decline: 'PASS',
    realtimeBell: 'PASS',
    unreadBadge: 'PASS',
    duplicatePrevention: 'PASS',
    refreshPersistence: 'PASS',
  };
}

try {
  const result = await run();
  resultNode.dataset.status = 'pass';
  resultNode.textContent = JSON.stringify(result);
} catch (error) {
  resultNode.dataset.status = 'fail';
  resultNode.textContent = `FAIL: ${error?.message || error}`;
} finally {
  await cleanUp();
}
