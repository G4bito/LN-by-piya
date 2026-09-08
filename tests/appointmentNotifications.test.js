import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createAppointmentCancelledNotification,
  createCancellationRequestDeclinedNotification,
  getAppointmentCustomerUid,
  getCancellationNotificationId,
  isCancelledAppointmentStatus,
} from '../src/appointmentNotifications.js';

test('direct Admin cancellation creates one deterministic unread customer notification', () => {
  assert.equal(getCancellationNotificationId('booking-123'), 'booking-123_cancelled');
  assert.equal(getCancellationNotificationId('booking-123'), 'booking-123_cancelled');
  assert.deepEqual(createAppointmentCancelledNotification({
    bookingId: 'booking-123',
    serviceName: 'Gel Manicure',
    schedule: 'September 16, 2026 at 11:00 AM',
    createdAt: 1000,
  }), {
    type: 'booking_cancelled',
    title: 'Appointment Cancelled',
    message: 'Your Gel Manicure appointment on September 16, 2026 at 11:00 AM has been cancelled by the salon.',
    bookingId: 'booking-123',
    read: false,
    createdAt: 1000,
  });
});

test('approved cancellation request uses the successful cancellation message and stable request event id', () => {
  assert.equal(
    getCancellationNotificationId('booking-123', 'request-456', 'Approved'),
    'request-456_approved'
  );
  const notification = createAppointmentCancelledNotification({
    bookingId: 'booking-123',
    serviceName: 'Gel Manicure',
    schedule: 'September 16, 2026 at 11:00 AM',
    requestId: 'request-456',
    approvedRequest: true,
    createdAt: 2000,
  });
  assert.equal(notification.title, 'Appointment Cancelled');
  assert.match(notification.message, /cancellation request has been approved/i);
  assert.match(notification.message, /successfully cancelled/i);
  assert.equal(notification.requestId, 'request-456');
  assert.equal(notification.read, false);
});

test('declined cancellation request keeps the appointment confirmed in customer-facing copy', () => {
  const notification = createCancellationRequestDeclinedNotification({
    bookingId: 'booking-123',
    requestId: 'request-456',
    adminReason: 'Please contact the salon.',
    createdAt: 3000,
  });
  assert.equal(notification.type, 'cancellation_request_declined');
  assert.equal(notification.title, 'Cancellation Request Declined');
  assert.match(notification.message, /appointment remains confirmed/i);
  assert.match(notification.message, /Please contact the salon/);
});

test('customer UID resolution supports current and legacy appointment fields without identity fallbacks', () => {
  assert.equal(getAppointmentCustomerUid({ uid: 'current-uid' }), 'current-uid');
  assert.equal(getAppointmentCustomerUid({ userId: 'legacy-user-id' }), 'legacy-user-id');
  assert.equal(getAppointmentCustomerUid({ customerUid: 'legacy-customer-uid' }), 'legacy-customer-uid');
  assert.equal(getAppointmentCustomerUid({ email: 'customer@example.com', phone: '123' }), '');
  assert.equal(isCancelledAppointmentStatus('Cancelled'), true);
  assert.equal(isCancelledAppointmentStatus('canceled'), true);
  assert.equal(isCancelledAppointmentStatus('Confirmed'), false);
});

test('Realtime Database rules allow the cancellation-declined notification schema', () => {
  const rules = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  assert.match(rules, /cancellation_request_declined/);
});
