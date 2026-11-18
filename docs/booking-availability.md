# Settings and booking availability

Implementation is local on `feature/booking-availability-manager`. Nothing has been pushed or deployed. No production bookings or settings were changed to test this feature.

## Admin experience

Settings now contains four compact groups: Business Information, Regular Hours, Booking Preferences, and Policies & Notifications. Regular hours, policy text, and notifications use disclosure controls. Advanced Settings starts collapsed and retains Nail Art pricing, eligible services, reference-photo preferences, and the salon tagline. All existing configuration fields remain in the draft and save only when changed. The single Save Changes action is static, displays unsaved changes, and does not cover content.

Availability is a separate sidebar destination immediately below Appointments. Overview's existing seven-day cards open it with the clicked date selected and retain their appointment counts. It provides monthly navigation, open/closed/custom hours, separate blocked periods, reset, saved blackout dates, and the selected day's appointments. Affected appointments require confirmation before a date change is saved; their status, timestamps, and details are never changed by the availability operation. Active conflicts are marked in Appointments and Availability.

Existing blackout records are preserved. Explicit Open or Custom hours can reopen a legacy closure. Restore defaults removes the new date override and restores underlying weekly hours **and any original blackout closure**; it does not erase existing blackout history.

## Reused Firebase paths

| Path | Purpose |
|---|---|
| `settings/business` | Existing salon information, weekly/online hours, preferences, policies, and notification settings. General saves update changed fields only. |
| `settings/business/blackoutDates` | Existing closures and reasons, preserved without migration. |
| `settings/business/dateOverrides/YYYY-MM-DD` | New date-specific `open`, `closed`, or `custom` configuration, separate `availableRanges`/`blockedRanges`, and numeric `updatedAt`. Only the selected date is updated. |
| `bookings` | Existing appointment records and unchanged status names. New bookings are saved through the authenticated callable. |
| `scheduleSlots/YYYY-MM-DD/bookingId` | Existing sanitized availability projection, temporary atomic holds, and durable Pending Confirmation/Confirmed reservations. |
| `scheduleMutexes/YYYY-MM-DD` | Existing date lock, reused by server submissions and date-availability saves as well as admin decisions. |
| `serverOnly/bookingIntents/bookingId` | Private, atomic binding of an intent ID to its owner and request hash, preventing reuse across dates/accounts. No customer access. |
| `adminNotifications` | Existing new-booking notifications, committed with the booking and durable reservation. |
| `users`, `admins` | Existing account status and authorization checks; no account schema migration. |

## Booking and authorization

The existing Service → Date & Time → Details → Confirm flow remains. The frontend and backend share the same service definitions, pricing, timezone calculations, schedule comparisons, and business settings under `functions/shared`. Existing `src` imports remain compatible through re-exports.

Priority is booking window/same-day/notice rules, recurring hours, explicit date overrides, blocked periods, then reservations/buffers/capacity. A date override can open a normally closed day without bypassing global rules. Full service duration plus its buffer must fit inside one available range. This intentionally replaces the old behavior that allowed appointments to start at closing time and removes the expired November 15 late-start waiver. Appointment history is unchanged. Malformed saved overrides are interpreted as closed.

`submitBooking` validates the signed-in active customer, recalculates duration and pricing on the server, rereads current settings, and checks existing bookings. A transaction on the day's schedule prevents overlapping reservations and capacity races. The final booking, durable reservation, and notification are committed together. Pending Confirmation reservations remain occupied until an admin decision; only unfinished upload/save holds expire. Cancelled, declined, completed, and no-show appointments do not occupy new capacity. Repeated submission of the same intent returns the existing booking.

`saveBookingAvailability` checks the existing administrator record, validates dates and all ranges, locks the date, rechecks affected appointments, and requires acknowledgment of their IDs before saving a conflicting change.

Database rules retain existing reads and administrator authorization. Customer writes to bookings, schedule slots, and mutexes are tightened to require the trusted booking callable. Customers cannot edit availability or general settings. Date-override records have explicit field/time/index validation. Existing customer/profile/appointment access rules are otherwise preserved.

## Files

| Files | Change |
|---|---|
| `src/components/AdminSettings.jsx` | New compact controlled settings form. |
| `src/components/BookingAvailabilityManager.jsx` | New monthly availability editor, appointment list, warnings, and native confirmation dialog. |
| `src/pages/AdminPage.jsx`, `src/adminData.js`, `src/pages/AdminDashboard.css` | Sidebar destination, Overview routing/statuses, conflict indicators, Settings integration, responsive styling. |
| `src/App.jsx`, `src/pages/BookingPage.jsx` | Reuse the existing settings listener and pass loading/error state. |
| `src/components/BookingCalendar.jsx`, `src/bookingUi.js`, `src/firebase.js` | Apply date overrides to calendar/slots, preserve submission intent IDs, call trusted functions, and retain durable pending reservations. |
| `functions/shared/{businessSettings,scheduling,bookingPricing,dateOverrides,availability}.js`, `functions/shared/constants/services.js` | Single scheduling/pricing source used in both runtimes. |
| `src/{businessSettings,scheduling,bookingPricing}.js`, `src/constants/services.js` | Compatible re-exports of relocated shared code. |
| `functions/bookingAvailabilityService.js`, `functions/index.js` | Trusted service and two callable exports. |
| `database.rules.json`, `firebase.json` | Tightened write permissions, override schema, function source, and local emulator configuration. |
| `package.json`, `functions/package.json`, `.gitignore` | Emulator test command, function syntax check, and ignored emulator log. No dependencies added. |
| `tests/{availability,adminData,bookingCompletion,bookingUi,businessSettings}.test.js`, `tests/emulator/availability.test.js` | Coverage for settings preservation, availability, lifecycle, permissions, idempotency, and concurrency. |

## Verification performed

- `npm test`: 124 tests passed, including the existing loyalty, pricing, profile, reminders, and cancellation tests.
- `npm run check --prefix functions`: passed.
- `npm run build`: passed. Vite still reports its existing main-chunk size warning.
- `npm run test:emulator`: 11 tests passed against the local `demo-luxe-availability` Realtime Database emulator using Java 21. This includes denied customer writes, active/inactive admin checks, blackout preservation, conflicting concurrent bookings, simultaneous retries, cross-date intent reuse, capacity, canonical pricing/duration, and unchanged affected appointments.
- Hidden Edge browser checks used the actual Settings/Availability components with **local sample data and a fixture saver**, not production Firebase: custom/blocked ranges, closure confirmation, reset, saved appointment preservation, four Settings groups, collapsed Advanced Settings, one Save Changes action, unsaved-change feedback, and persistence after reload passed.
- Browser layouts passed at 1440, 768, 390, and 320 CSS pixels with no horizontal overflow. Existing input/control styles and the black-and-gold palette were retained.

For emulator tests, use Firebase CLI and Java 21+. The development computer's Java 17 was left unchanged; verification used a portable temporary Java 21 runtime. The test suite refuses to run without a local emulator host and uses only a demo project.

## Publication and remaining checks

Publication requires the owner's approval. No new Firebase configuration variables or data migration are needed; existing Firebase project/database configuration and the `asia-southeast1` Functions region are reused. Deploy only the two new callables (`submitBooking`, `saveBookingAvailability`), the database rules, and the matching frontend as a coordinated release. Do not deploy unrelated scheduled functions. Do not change the Firebase billing plan.

Deploy the callables before switching the frontend/rules, then publish the matching frontend and tightened rules together and have existing clients reload. There is deliberately no fallback to unsafe direct customer booking writes. Publishing rules alone while an old frontend is cached would prevent that old frontend from creating bookings.

The deployed callable HTTP/auth boundary, real Storage reference-photo uploads, and production notification delivery still need an approved staging/deployment smoke test. Emulator service tests exercise the real database and rules but do not claim a deployed Cloud Functions or production end-to-end test. No deployment or billing action has been performed.

Implementation follows the official [Firebase callable documentation](https://firebase.google.com/docs/functions/callable), [transaction behavior](https://firebase.google.com/docs/database/web/read-and-write#save_data_as_transactions), and [Realtime Database emulator guidance](https://firebase.google.com/docs/emulator-suite/connect_rtdb).
