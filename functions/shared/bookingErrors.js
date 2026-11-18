export function safeBookingErrorCode(error) {
  const code = String(error?.code || 'unknown').toLowerCase();
  return /^[a-z0-9_/-]{1,80}$/.test(code) ? code : 'unknown';
}

export function bookingDiagnostic(error, operation) {
  return { event: 'booking_operation_failed', operation, code: safeBookingErrorCode(error) };
}

export function bookingErrorMessage(error) {
  const code = safeBookingErrorCode(error).split('/').pop();
  if (code === 'unauthenticated') return 'Please sign in again before submitting your appointment.';
  if (code === 'permission-denied') return 'Your appointment could not be submitted. Please contact the salon for assistance.';
  if (code === 'invalid-argument') return 'Please review your booking details and try again.';
  if (code === 'deadline-exceeded') return 'We could not confirm your booking. Check My Appointments before trying again.';
  return 'Booking is temporarily unavailable. Please try again later or contact the salon.';
}
