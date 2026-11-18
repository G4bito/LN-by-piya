# Booking submission investigation and local fix

Production: `https://ln-by-piya.vercel.app/`. Firebase project: `ln-by-piya`. Investigation date: November 19, 2026, Asia/Manila.

The fix is local pending approval to push/deploy and configure server credentials. Production checks were read-only: no test appointments, data corrections, rules updates, billing changes, account deletions, or loyalty resets were performed.

## Confirmed root cause

`BookingCalendar.handleConfirm` called `saveBooking` in `src/firebase.js`. After checking the signed-in user, reading `settings/business`, and rechecking the selected time, `saveBooking` invoked the Firebase callable `submitBooking` in `asia-southeast1`. The generic message came from `BookingCalendar`'s final catch branch, which replaced unexpected failures with a connection-related message.

Read-only production evidence:

- Cloud Functions v1 and v2 list APIs both returned an empty function list for `ln-by-piya`.
- The `submitBooking` preflight returned **HTTP 404**, without an `Access-Control-Allow-Origin` response header. `saveBookingAvailability` was also absent.
- Project billing was disabled; it was not changed.
- November 26 business and online hours were open from 10:00–22:00, with no saved blackout or date override closing that date. The date query returned zero bookings, zero schedule slots, and no date mutex.
- The deployed rules were older than the repository's tightened booking/slot/mutex/availability rules. User and notification rules matched. No production rules were changed.

The precise failing operation was the **callable HTTP preflight**, before the backend could execute a reservation transaction or appointment write. For a browser fetch rejected by that CORS failure, the installed Firebase Functions SDK returns status 0 and surfaces `functions/internal`. The customer's original console error was not captured directly; HTTP 404/no CORS and the installed SDK's mapping were verified separately. This was not evidence of a customer's connection failure.

The regression was introduced by `dd26504`, which replaced the previous browser reservation/save path with a callable backend. A Vercel frontend deployment does not publish Firebase functions. The previous implementation therefore introduced an unavailable deployment dependency into this project's current setup. The Rewards UI and loyalty calculations do not create this HTTP failure, and no loyalty write occurs during initial booking submission.

## Minimal safe repair for this deployment

The browser now sends its Firebase ID token to the same-origin **`POST /api/booking`** Vercel endpoint. The adapter reuses `createBookingAvailabilityService`; there is no second implementation of scheduling or pricing. No Firebase billing upgrade or direct-customer database-write fallback was introduced.

Contract: `{ operation: "submit" | "availability", data: { ... } }`, with a bearer Firebase ID token. Success returns `{ data }`. Failures return `{ error: { code, message } }` with safe messages and appropriate HTTP status. Unsupported methods, invalid JSON, oversized bodies, expired/revoked credentials, and forged tokens are rejected. Token verification uses the intended Firebase project and checks revocation. Availability edits continue to require an active administrator record. Emulator token acceptance is restricted to local demo environments and rejected in Vercel/production configuration.

## Submission operations

1. Client verifies its current signed-in user, reads saved business settings, and checks the full service duration against available start times. A reference photo is uploaded only when enabled and present; the reported booking skips this step.
2. Server verifies the Firebase ID token and active `users/<uid>` profile.
3. Server acquires the existing token-owned `scheduleMutexes/<date>` transaction lease, rereads business/online hours and date overrides, and recalculates the service price/duration. Gel Manicure remains **₱299 and 75 minutes**, using the upper end of the 60–75-minute definition.
4. Existing intent/appointment records are checked, and `serverOnly/bookingIntents/<id>` binds each ID to the authenticated owner and request hash.
5. Saved date bookings and `scheduleSlots/<date>` participate in the reservation transaction, including intervals, full duration, buffers, existing appointments, and daily capacity.
6. `bookings/<id>` and its durable Pending Confirmation slot are committed in **one atomic update**.
7. A deterministic `adminNotifications/<id>` transaction runs as optional work. It preserves existing read/handled state on retries. Notification and mutex-release work are bounded to 1.5 seconds each; failures are logged without rejecting an already-saved appointment. An unreleased mutex retains its token check and 60-second expiry.

Required reservation, ownership, account-status, and availability checks remain mandatory. Customer booking history continues to use the authorized UID query. Admin appointment visibility continues through the existing booking reader. No completed visit or loyalty point is awarded at submission.

## Retry and failure safety

The client keeps one booking ID for retries of the same unchanged intent. IDs use the existing Firebase push-key generator, avoiding reliance on `crypto.randomUUID` on older mobile browsers. The intent binding also prevents one ID from being reused across different customers/dates.

A failed atomic core write removes the provisional slot; a lost response after a successful commit returns the saved appointment without freeing its durable reservation. Retry repairs a missing notification while preserving existing notification state. Private intent bindings remain the immutable retry journal, not active reservations. No booking, slot, or mutex was found for the reported production date; the absent function could not create a partial record.

Diagnostics contain only an event name, a fixed operation name, and a sanitized error code. They omit names, emails, phone numbers, addresses, notes, authentication tokens, credential JSON, and booking payloads. Stages identify session verification, settings reads, reference upload, API submission, token verification, profile reads, lock acquisition, intent binding, slot reservation, atomic commit, rollback, and optional cleanup. Customers receive a service-availability/recovery message rather than private error details or an unsupported network diagnosis.

## Files changed for booking

| Files | Purpose |
|---|---|
| `api/booking.js`, `server/bookingApi.js`, `server/firebaseAdmin.js` | Vercel entry, authenticated HTTP contract, safe responses/logging, server-only Firebase initialization. |
| `vercel.json`, `.env.server.example` | 30-second function limit and required server configuration names. |
| `src/bookingApi.js`, `src/firebase.js` | Same-origin authenticated transport, response validation, stable ID generation, staged safe diagnostics, preserved photo cleanup. |
| `src/components/BookingCalendar.jsx` | Preserve retry IDs, support mobile ID generation, catch setup failures, and show appropriate safe error feedback. |
| `functions/bookingAvailabilityService.js`, `functions/shared/bookingErrors.js` | Reused trusted scheduling service, operation diagnostics, atomic core commit, optional notification/lease cleanup, and lost-response recovery. |
| `package.json`, `package-lock.json` | Move the already-installed Firebase Admin SDK to runtime dependencies without changing dependency versions; add sequential auth/API emulator tests. |
| `tests/bookingApi.test.js`, `tests/emulator-auth/bookingSubmission.test.js`, `tests/emulator/availability.test.js` | API security/transport, actual SDK-to-HTTP-to-database tests, and transaction/recovery fault injection. |

The preceding [login fix](customer-access-fix.md) is retained and documented separately. `database.rules.json` is unchanged by these fixes.

## Verification

- `npm.cmd test`: **139 tests passed**.
- `npm.cmd run test:auth-emulator`: **19 tests passed**, including seven actual HTTP booking tests and twelve login tests. They cover the reported service/date/time configuration, customers with/without loyalty, closed/blocked hours, overlapping concurrent submissions, stable retry replay, unchanged loyalty records, customer history, admin reads, forged tokens/ownership, and restricted writes.
- Isolated headless Edge at **390 × 844px**: **22 browser checks passed** using the actual app, booking UI, API handler, and demo Auth/Database emulators. They included the November 26, 2026 10:00 AM Gel Manicure review/submission, a simulated API failure followed by one successful retry, customer history, unchanged loyalty, session restoration, admin login, optional reward-definition failure, and essential profile denial. The booking also succeeded with browser `crypto.randomUUID` disabled. Google was tested with an emulator credential; real OAuth popups and real iPhone/Messenger engines remain unverified.
- `npm.cmd run test:emulator`: **20 tests passed**, including notification outage, failed atomic commit/rollback, lost response/replay, failed mutex release, concurrency, authorization rules, and existing reward-history safety.
- `npm.cmd run build`: passed. The existing main chunk above 500KB remains a warning.
- `npm.cmd run check --prefix functions`, Node syntax checks, and `git diff --check`: passed.
- The browser bundle contains neither the server credential environment key nor the private server initializer.

## Publication requirements

1. Configure Vercel's **server-only** `FIREBASE_PROJECT_ID=ln-by-piya`, `FIREBASE_DATABASE_URL=https://ln-by-piya-default-rtdb.asia-southeast1.firebasedatabase.app`, and a valid `FIREBASE_SERVICE_ACCOUNT_JSON` for this project. Keep the private credential in the hosting environment, with no `VITE_` prefix and no committed key file. The saved interactive Firebase administrator login is not a production server credential.
2. Obtain approval to push and deploy the API and matching frontend together. Publishing the frontend alone would leave booking unavailable. No Firebase functions deployment or billing change is required for this adapter.
3. Review and approve publication of the repository's existing restrictive database rules after the API is ready. They protect booking/slot/mutex writes through trusted server/admin paths and preserve UID-scoped customer reads. The older production rules still allow legacy client writes; aligning them is part of securing the coordinated release. No rule permissions were widened locally.
4. Verify the Vercel API build and configured credentials, then check actual iPhone Safari and Messenger behavior. Local mobile Chromium and emulator testing cannot establish real WebKit/in-app-browser compatibility. No live customer sign-in or test appointment was performed.

## References

- [Vercel Node API runtime](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel function duration configuration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Firebase Admin ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase callable deployment and protocol](https://firebase.google.com/docs/functions/callable)
