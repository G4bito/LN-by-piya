export function getAppointmentCustomerUid(booking) {
  return String(booking?.uid || booking?.userId || booking?.customerUid || '').trim();
}

export function isCancelledAppointmentStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'cancelled' || normalized === 'canceled';
}

export function getCancellationNotificationId(bookingId, requestId = '', decision = '') {
  if (requestId) {
    return `${requestId}_${String(decision || 'approved').trim().toLowerCase()}`;
  }
  return `${bookingId}_cancelled`;
}

export function createAppointmentCancelledNotification({
  bookingId,
  serviceName,
  schedule,
  requestId = '',
  approvedRequest = false,
  createdAt = Date.now(),
}) {
  const normalizedServiceName = String(serviceName || 'Service').trim() || 'Service';
  const normalizedSchedule = String(schedule || 'the scheduled time').trim() || 'the scheduled time';
  return {
    type: 'booking_cancelled',
    title: 'Appointment Cancelled',
    message: approvedRequest
      ? `Your cancellation request has been approved. Your ${normalizedServiceName} appointment on ${normalizedSchedule} has been successfully cancelled.`
      : `Your ${normalizedServiceName} appointment on ${normalizedSchedule} has been cancelled by the salon.`,
    bookingId: String(bookingId || ''),
    ...(requestId ? { requestId: String(requestId) } : {}),
    read: false,
    createdAt,
  };
}

export function createCancellationRequestDeclinedNotification({
  bookingId,
  requestId,
  adminReason = '',
  createdAt = Date.now(),
}) {
  const normalizedReason = String(adminReason || '').trim();
  return {
    type: 'cancellation_request_declined',
    title: 'Cancellation Request Declined',
    message: `Your cancellation request was declined. Your appointment remains confirmed.${normalizedReason ? ` Salon note: ${normalizedReason}` : ''}`,
    bookingId: String(bookingId || ''),
    requestId: String(requestId || ''),
    read: false,
    createdAt,
  };
}
