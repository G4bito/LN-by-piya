# Spark-only booking: implementation and release report

Prepared locally on November 19, 2026. Nothing has been pushed, deployed, or written to production. Billing, organization policies, accounts, appointments and rewards were not changed. The active working branch is `fix/firebase-spark-booking`; `fix/firebase-managed-booking` remains available at `6f4d3e8`.

## Decision and inspected regression

Use Firebase Authentication, the Firebase Web SDK, Realtime Database and Security Rules. Booking no longer calls Vercel's `/api/booking`, a callable function, Storage uploads, or an Admin SDK runtime. No server environment variables, private key, WIF, billing account or background worker is required.

The inspected managed branch implements `submitBooking`/`saveBookingAvailability` with a trusted Admin SDK reservation service. Those callables cannot be deployed on Spark. The earlier Vercel bridge requires an unavailable server credential. The previous read-only production inspection also found a separate security defect: customer booking creation was permitted without proving any reservation. Relaxing rules or returning to that write path would not solve overlap protection.

Retained the existing authentication/profile flow, service catalog, pricing helpers, date overrides, weekly-hour normalization, availability checks, completion reward helper and four booking steps. Replaced the reservation representation because arbitrary-map transactions cannot prove pairwise interval conflicts with RTDB Rules alone. The historical assessments remain in `booking-architecture-comparison.md` and `firebase-booking-release.md`.

## Paths and canonical appointment definition

| Path | Meaning and permission |
| --- | --- |
| `sparkSchedule` | One atomic conflict domain for the published scheduling window; active customers may perform only the exact validated booking transition. Administrators manage status and rescheduling. |
| `sparkSchedule/journal` | Append-only canonical appointment metadata: ID, service, date, start, duration, price, status and timestamps. No names, UID, contact details, notes or photos. Active customers can read this availability metadata, as they previously could read scheduling slots. |
| `sparkSchedule/occupied` | One character per minute, `0` or `1`. Each active appointment occupies its full interval plus the configured buffer. |
| `sparkSchedule/capacity` | 100 possible daily tokens; rules allow only the configured number. |
| `sparkSchedule/proof` | Prefix/range/suffix strings proving exactly which minutes and capacity token changed. No customer information. |
| `sparkBookingDetails/{existing-style-push-ID}` | Immutable private preparation record, read only by its active owner or an administrator. Includes the authenticated UID, original customer details, notes, pricing snapshot and optional image. **A draft alone is not an appointment or a reservation.** |
| `sparkBookingAdmin/{ID}` | Administrator-only display/reward metadata; owner/admin reads. It does not determine occupancy or canonical status. |
| `sparkBookingCatalog` | Trusted administrator-published prices, maximum service durations, quantity rules and add-on eligibility. Public read; never customer writable. |
| `sparkBookingCalendar/{YYYY-MM-DD}` | Trusted minute availability, interval starts, per-start range limits and Manila midnight. Public scheduling data; admin publish only. |
| `sparkBookingPolicy` | Trusted notice, booking window, buffer, capacity, same-day, photo and Nail Art policy. Public read; admin publish only. |
| `sparkBookingControl` | Ready/publishing/paused state, publication token and window end. Admin writes only. |
| Existing `settings/business` | Remains the source for Settings and Availability. Only changed settings/date leaves are written; unrelated values are retained. |
| Existing `bookings`, `scheduleSlots`, `scheduleMutexes` | Preserved. Legacy scheduling writes are frozen after Spark preparation starts so old clients cannot create a second scheduling authority. |
| Existing `users`, `admins`, `loyaltyProgram`, `notifications`, `adminNotifications`, `appointmentChangeRequests` | Reused with existing identity/loyalty protection. Request and notification ownership also recognize committed Spark appointments. |

Submission first saves private immutable details, then runs a Web SDK transaction on `sparkSchedule`. The same transaction appends the canonical appointment and claims every minute and one daily token. The UI reports success only after Firebase acknowledges that canonical commit. Optional notifications run afterward. Stable IDs replay an already committed result even if policy has since changed. Failed reservation attempts can leave an owner-private draft, but no active booking, capacity token or orphan reservation. Drafts are filtered out of both customer history and admin appointments.

## Why direct writes cannot bypass reservations

The rules require an active UID-matched customer, ready publication, valid immutable private details, trusted service duration/price/quantity/add-on calculations, and a valid trusted calendar entry. Rules use server `now` for minimum notice, same-day preference and the maximum advance date in Asia/Manila.

Rules cannot loop over arbitrary appointments, and their String API has no substring operation. Instead the client supplies concatenation proofs:

```text
old occupied = unchanged prefix + all-zero span + unchanged suffix
new occupied = unchanged prefix + all-one span  + unchanged suffix
prefix length = authoritative day offset + start minute
span length = trusted service duration + trusted buffer
```

Both equalities are checked by the database, with exact lengths and zero/one regular expressions. The capacity string gets the equivalent single-token proof. The calendar proof requires that the entire claimed interval consists of allowed minutes; per-start limits prevent crossing between adjacent custom ranges. The journal must equal its complete previous string plus exactly one prescribed Pending Confirmation event. The ID must be new, and all policy/header fields remain unchanged. Customers cannot remove an old booking, release occupied minutes, shorten the interval, append a status event, forge a price or modify another user's private details.

RTDB skips `.validate` on deletion, so deletion protection is deliberately in `.write`: `sparkSchedule` must continue to exist. Root defaults remain deny. Inherited legacy parent grants were restricted as well as leaf grants. Customer reads of private booking data are UID-scoped and require active status. The existing `users`/loyalty/admin permission expressions remain unchanged.

Two overlapping simultaneous transactions cannot both commit. A changed server state causes a retry, after which either the full minute span is no longer zero or the daily token is unavailable. An adversarial `set()` has the same rule checks. A 10:00–11:15 appointment therefore prevents an 11:00 start, including when the attacker bypasses all UI checks.

## Availability publication and administrator lifecycle

Availability gains a compact Prepare/Refresh schedule control. It does not run automatically on page load. An authorized administrator publishes `maximumAdvanceDays + 32` calendar days and refreshes monthly. Settings and date-specific availability saves republish the schedule automatically.

Publishing acquires an admin-only control transaction before reading legacy data or rebuilding occupancy. Customer reservations and normal admin scheduling changes pause during publishing. Policy, calendar, occupancy and changed setting leaves are then saved in one atomic multi-location update. Only the matching publication token may make that publishing write. Booking resumes after token-checked acknowledgment. Stale cached customer calendars fail the rules, and pre-publication admin status requests cannot overwrite a publishing snapshot.

Date changes warn about affected appointments and require acknowledgment; no existing appointment is automatically moved or cancelled. General settings changes that conflict with appointments are rejected with instructions to review their dates. A dismissed warning restores the existing published window. An interrupted/uncertain write stays paused. After two minutes, an administrator can use Review and resume; this invalidates the previous publisher token and reconstructs occupancy from canonical records.

Administrators use their normal Firebase login and existing UID-backed `admins` record. No additional trusted server is needed for admin-only transitions. Cancellation, decline, completion and no-show rebuild occupancy from **all** remaining active appointments in the same transaction as the canonical status event. Rescheduling across dates is also one transaction. Confirmation/reactivation checks availability/conflicts. Existing overlapping legacy appointments remain protected by the union of their occupied minutes; cancelling one cannot release the other's minutes. Canonical request decisions are journaled atomically and cannot be changed by replaying an already reviewed request.

Customers submit cancellation/reschedule requests only. Requests cannot alter appointment status or reservations; the administrator rechecks canonical status and target availability before approval. A narrowly scoped point-read permission was added for an owner's own request because the existing create flow reads that request ID before writing it.

## Loyalty, photos and unsupported server features

Booking does not read, create, reset or update loyalty progress. Administrator completion uses the existing `applyCompletedBookingReward` transaction, keyed by appointment ID. Existing rewards and historical claims are retained. If the later display marker fails, retrying completion cannot credit another visit. A customer cannot write completion events or administrator reward markers.

New reference photos use browser JPEG resizing to at most 960 pixels and 260,000 characters, inside private details. Original selection remains limited to JPG/PNG/WebP and 5 MB. Rules enforce the bounded data-image format. Existing salon portfolio Storage URLs can remain references, but those old objects may be unavailable on Spark; their data and URLs are not deleted. Portfolio Storage uploads outside booking were not rebuilt or enabled.

Automated scheduled reminders, transactional email, server-side audit guarantees and immediate Auth-token revocation checks cannot be supplied by an always-offline browser. Existing Functions remain reference code and are not deployed. In-app notifications do not block successful bookings. To disable access immediately under Spark, administrators must deactivate the UID's `users` or `admins` record, as the rules check that status; disabling Auth alone can leave an already issued ID token valid until expiry. No privileged credentials are exposed to solve these limitations.

## Migration and release plan — requires approval

1. During an approved maintenance window, take an authorized private backup/export and compare current production rules, active appointments, slots, overrides, settings and account/loyalty counts. Confirm Spark/billing remains unchanged. Do not publish backups or customer data to Git.
2. Review and approve the exact new rules and frontend together. Deploy only the database rules target; the default `firebase.json` intentionally contains no Functions or Storage deployment. Push/deploy the frontend only after approval. Cached old clients fail closed and must refresh. Existing Vercel browser Firebase variables remain; no new secret is needed.
3. Use the new administrator Prepare schedule action. It freezes legacy scheduling writes, reads existing records, and adds a metadata representation with the **same appointment IDs**. It never rewrites/deletes legacy bookings, old slots, profiles, rewards or claims.
4. Durable orphan slots become conservative blocked intervals. Unexpired technical holds pause new bookings until the latest existing expiry. Invalid/missing hold expiry, unusually long holds, malformed appointment scheduling or ambiguous legacy blackout arrays stop preparation for review. Resolve any anomalies explicitly; do not discard them to get bookings working.
5. Acknowledge affected existing appointments, inspect prepared dates and sample histories, and verify an authorized production booking only with separate approval. Until that live verification succeeds, production booking is **not claimed fixed**.
6. Monitor quota, successful bookings and conflicts, and refresh the published window monthly. Avoid editing scheduling data with old admin clients or the Firebase console outside the publication procedure.

Rollback keeps strict rules and preserves both legacy and Spark data. Pause online bookings first. Revert the UI to a compatible Spark build or a maintenance/contact-salon screen; do not restore the old direct-write rules or a frontend that expects an undeployed callable. Managed Functions work remains available on its branch and in `functions/`, `firebase.managed.json`, `database.managed.rules.json` and the managed mobile runner, but is **not a Spark runtime fallback**. Moving back to that architecture would require separate approval and a migration that includes bookings created under Spark.

## Cost and practical limits

No billing activation or paid service is used. Firebase currently lists Spark RTDB limits of **100 simultaneous connections, 1 GB stored, and 10 GB downloaded monthly**. Quota exhaustion can stop service; free does not mean unlimited availability. Vercel hosting remains under the existing arrangement. See [Firebase pricing](https://firebase.google.com/pricing).

The default 92-day occupancy string is about 132 KB, plus roughly another copy for its proof and small capacity strings. Only submission/admin maintenance reads the full schedule; normal availability/history listeners subscribe to the journal and legacy block metadata. The global transaction intentionally trades some bandwidth/contention for a single auditable conflict boundary. Larger booking windows and a growing journal increase transfer costs against the free quota. At a two-year window the occupied/proof strings together are about 2.2 MB before the journal. Monitor usage for this small salon.

The journal is bounded at four million characters; new bookings stop safely near that limit. There is no automatic archival/deletion. Before reaching it, an administrator needs a separately reviewed archival/checkpoint procedure that preserves all appointment identities and history. Private abandoned drafts also need quota monitoring and separately approved cleanup. Authenticated abuse can exhaust a free quota; this implementation is not a server-based rate limiter. Do not broaden write permissions in response.

Scheduling is limited to Asia/Manila and whole-minute intervals/buffers; fractional minute/capacity/day settings pause publication rather than silently rounding. Existing configuration values remain saved. Public scheduling metadata intentionally excludes customer identities/contact data, but active users can see occupied dates, services and times. This matches the existing availability model; it is not a private per-customer calendar service.

Cloud Storage now requires Blaze, including access to legacy buckets. The bounded RTDB photo alternative avoids that paid dependency. See [Firebase Storage billing changes](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024). Background server features and high-resolution/unbounded image storage remain outside the Spark implementation.

## Files and verification

- `src/spark/engine.js`: minute/capacity proof engine, calendar compiler, canonical journal and admin transitions.
- `src/spark/client.js`: authenticated Web SDK submission, immutable details, merged readers, admin changes, atomic publication/recovery.
- `src/spark/photo.js`: bounded private reference-image preparation.
- `src/firebase.js`: existing public helpers wired to Spark, preserved authentication/profile/loyalty helpers and optional notifications.
- `src/components/BookingCalendar.jsx`: publication state, safe photo feedback and preserved confirmed response.
- `src/components/SparkBookingPublication.jsx`, `src/pages/AdminPage.jsx`: prepare/refresh/recover controls within the existing Availability page.
- `scripts/buildSparkRules.mjs`, `database.rules.json`: reproducible strict rules and preserved identity/loyalty rules.
- `firebase.json`, `vercel.json`, `package.json`: Spark-only deployment/emulator defaults and test commands; Vercel no longer configures or builds the retired `/api/booking` function.
- `database.managed.rules.json`, `firebase.managed.json`, `tests/mobile/booking.managed.mjs`: preserved managed implementation configuration/tests.
- `tests/sparkEngine.test.js`, `tests/spark/booking.test.js`, `tests/spark-app/booking.test.js`, `tests/mobile/booking.mjs`: unit, direct-SDK adversarial, real application integration and mobile checks.
- `.env.server.example`, this report and notices in the historical assessment/release documents: distinguish active Spark setup from the preserved alternative.

Run from this directory, with Node 24 and Java 21+ available:

```text
npm.cmd test
npm.cmd run test:emulator
npm.cmd run test:auth-emulator
npm.cmd run test:spark-app
npm.cmd run test:mobile
npm.cmd run build
git diff --check
```

All test runners reject non-loopback emulator setup and use synthetic `demo-luxe-availability` accounts/data. Admin SDK is a local test dependency only, not booking runtime authority. No customer password or production appointment was used.

Recorded checks: 160 unit tests; 20 Spark database/adversarial tests; 12 existing Auth/profile tests; 6 actual application integration tests; 21 mobile browser checks at 390×844. Build succeeds with the existing >500 KB Vite chunk warning. The mobile engine is Edge Chromium, not a real iPhone Safari or Facebook Messenger browser; those still need authorized release smoke tests. No claim of production success is made.

Official references: [RTDB Rules API](https://firebase.google.com/docs/reference/security/database), [transaction behavior](https://firebase.google.com/docs/database/web/read-and-write#save_data_as_transactions), [permission inheritance](https://firebase.google.com/docs/database/security/core-syntax#read_and_write_rules_cascade), and [database limits](https://firebase.google.com/docs/database/usage/limits).
