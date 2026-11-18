import { createBookingApi } from '../server/bookingApi.js';
import { getBookingRuntime } from '../server/firebaseAdmin.js';

export default createBookingApi({ getRuntime: getBookingRuntime });
