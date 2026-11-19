// Retired transport: stale clients must refresh. This route never initializes
// Admin credentials, forwards a token, or writes an appointment.
export default function bookingRetired(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(410).json({ error: { code: 'booking/client-update-required', message: 'Please refresh the page before booking.' } });
}
