function apiError(code = 'booking/unavailable') {
  return Object.assign(new Error('Booking is temporarily unavailable. Please try again later or contact the salon.'), { code });
}

export async function requestBookingOperation(user, operation, data, { fetchImpl = fetch } = {}) {
  if (!user?.uid) throw apiError('booking/unauthenticated');
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await fetchImpl('/api/booking', { method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, data }), signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      const code = /^booking\/[a-z-]+$/.test(body?.error?.code || '') ? body.error.code : 'booking/unavailable';
      throw apiError(code);
    }
    if (operation === 'submit' && (body.data.id !== data.id || body.data.uid !== user.uid)) throw apiError();
    if (operation === 'availability' && typeof body.data.requiresConfirmation !== 'boolean') throw apiError();
    return body.data;
  } catch (error) {
    if (error?.code?.startsWith('booking/')) throw error;
    throw apiError(error?.name === 'AbortError' ? 'booking/deadline-exceeded' : 'booking/unavailable');
  } finally { clearTimeout(timer); }
}
