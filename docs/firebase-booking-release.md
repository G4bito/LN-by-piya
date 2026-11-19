# Managed Firebase booking repair and release plan

Prepared locally November 19, 2026 (Asia/Manila), on `fix/firebase-managed-booking`. **No push, production deployment, billing/IAM/policy change, or customer-data write was performed.** This is the current implementation report; earlier Vercel/OIDC assessments are historical alternatives.

## 1. Confirmed cause and production state

The deployed frontend calls `/api/booking`. Its previous initializer required private-key JSON unavailable in Vercel; organization policy prohibits creating that key. The observed failure was `initialize-booking-server / server/configuration`, before customer token verification or booking writes. The original callable transport also lacked deployed functions. The unrelated Vercel ESM startup failure was repaired previously.

Read-only reinspection confirmed billing disabled, no function entries in the v1/v2 inventories, and exactly five differences between deployed rules and `database.rules.json`:

| Rule path | Prepared repository policy versus production |
|---|---|
| `settings/business/dateOverrides` | Adds date/range schema validation absent in production. |
| `bookings/$bookingId/.write` | Denies direct customer creation; production permits it without a reservation. |
| `scheduleSlots/$dateKey/$bookingId/.write` | Restricts writes to administrators/trusted backend rather than customer holds/releases. |
| `scheduleSlots/$dateKey/$bookingId/.validate` | Validates scheduling fields/statuses and durable Pending Confirmation reservations. |
| `scheduleMutexes/$dateKey/.write` | Restricts leases to administrators/trusted backend rather than customer writes. |

Users, administrators, loyalty, history reads, and notification rules otherwise match. A local emulator loaded with copied production rules accepted overlapping synthetic 75-minute bookings on a closed date without reservations/locks. Repository rules denied customer direct writes. No real booking was created.

## 2. Files and reused functions

| Files | Change |
|---|---|
| `functions/booking.js` | Booking-only entry exports `submitBooking` and `saveBookingAvailability`; approved runtime identity parameter; `asia-southeast1`, 256MiB, 30 seconds, min 0/max 2 instances. |
| `functions/bookingRuntime.js` | Central default Admin app using managed ADC. Production rejects other projects, emulator settings, explicit credential-file and private-key JSON overrides. |
| `functions/bookingCallable.js` | Verified authorization, explicit revocation checks, 32KB payload boundary, safe typed errors, and private audit events. |
| `functions/bookingAvailabilityService.js` | Existing engine retained; a diagnostic-logger outage after optional-work failure cannot reject a committed booking. |
| `functions/index.js` | Unrelated legacy jobs preserved; superseded duplicate booking wrappers removed. Not the booking entry. |
| Functions package/lockfile; `firebase.json` | Compatible Admin SDK pin, isolated `booking` codebase, emulator port 5001; upload ignores legacy jobs, env files, node_modules. |
| Functions env examples/demo configuration; `.env.server.example` | Public runtime identity parameter; no booking private key or OIDC token. |
| `src/bookingApi.js`, `src/firebase.js` | Authenticated callable transport, fixed region, stable-intent response validation, safe errors, 35-second client timeout. |
| `api/booking.js` | Non-writing 410 retirement response for stale clients. |
| `server/bookingApi.js`, `server/firebaseAdmin.js` | Obsolete key-only Vercel bridge removed. |
| Root package/lockfile; tests; README/docs | Admin dependency test-only at root; unit, callable integration, fault, rules, and mobile verification; release instructions. |

The existing UI, service definitions, prices, Nail Art, optional-photo lifecycle, profiles, history, appointment statuses, and loyalty completion logic are preserved.

## 3. Authentication and authorization

The Firebase callable SDK attaches the current customer's ID token. The framework validates it; the wrapper additionally runs `verifyIdToken(token, true)`, rejects a mismatched UID, and derives authorization from verified claims. Existing active customer/profile and administrator-record checks remain mandatory.

The centralized default Admin app is constructed before callable framework authentication, avoiding its second fallback app on cold start. Credential/token/database work remains deferred until invocation. Google supplies managed ADC; no downloaded key or human administrator token is used. Loopback emulator credentials are permitted only for the isolated demo project.

## 4. Reservation and transaction safeguards

The shared engine validates trusted service pricing/duration, actual business/online hours, closures, custom ranges, blocked periods, buffers, notice/advance windows, same-day preference, and daily limits. Gel Manicure remains **₱299 and 75 minutes**.

The token-owned date mutex coordinates customer creation and the existing admin scheduling workflow. `serverOnly/bookingIntents` binds stable IDs to the owner/request hash. Legacy bookings and current slots participate in full-interval conflict detection and the day schedule transaction. `bookings/<id>` and its durable reservation commit in **one atomic update**.

Failed core writes roll back provisional slots. Lost responses check the saved matching appointment before releasing anything. Replays preserve one booking and notification read state. Pending Confirmation reservations stay durable. Availability edits require acknowledgment of affected appointments and never move/delete them automatically. Optional notification, lease-cleanup, and diagnostic failures cannot undo a committed booking. Loyalty is awarded only by eligible completion, never submission.

## 5. Security Rules preparation

The repository already contains the required restrictive rules, so they were preserved rather than artificially rewritten. They deny customer booking, slot, mutex, private-intent, and forged audit writes; preserve UID-scoped history/profile reads and admin access; and keep availability/settings writes restricted. These rules are tested locally but **not deployed**. The current production bypass remains until the approved coordinated release.

## 6. Audit behavior

No Audit Logs UI or persistent audit collection exists in this checkout. Existing logs elsewhere remain. New private server events include `booking_submitted`, `booking_accepted`, `booking_validation_rejected`, `booking_creation_failed`, and `availability_updated`. They carry only fixed operation labels, sanitized codes, and server-generated correlation IDs—no customer payloads, names, UIDs, emails, addresses, credentials, or tokens. Conflict warnings are not logged as completed availability updates. Clients cannot forge these Cloud Logging events. Logging outages do not turn saved bookings into failures.

An administrator should review finite operational-log retention, such as 30 days, alongside applicable audit-retention needs. Retention was not changed. Operational logs are not a transactional financial ledger.

## 7. Verification results

- **154 unit tests**: authorization/claims, payload/error boundaries, audit privacy/outages, single cold-start app, isolated exports, callable client validation, existing pricing/settings/loyalty regressions. New regression cases failed before their fixes.
- **49 emulator tests passed** using actual Functions, Auth, and RTDB emulators under **Node 22.23.5 and Java 21**. Coverage includes email/password and Google-emulator login, existing profiles/sessions, users with/without loyalty, actual callable booking, canonical price/duration/Nail Art, closures/blocks, notice/window/interval/closing bounds, buffers/capacity, simultaneous overlaps, legacy appointment preservation, idempotent retries, disabled/revoked users, admin availability acknowledgment, own history/admin visibility, unauthorized direct writes, rollback/lost response, and notification/logger/lease failures.
- **20 mobile browser checks passed** in isolated Edge Chromium at 390×844 using the actual app and callables. Covered all four booking steps, profile autofill, ₱299 review, simulated network failure, one successful stable-ID retry, one saved Pending Confirmation booking, 75-minute duration, unchanged profile/loyalty, history, session restoration, no horizontal overflow or uncaught browser exceptions, and no use of `/api/booking`.
- Production build and Functions syntax checks passed. Vite retains its existing >500KB main-chunk warning.
- `git diff --check` passed. No production test appointments or real customer passwords were used.

Setup: `npm.cmd ci`, `npm.cmd ci --prefix functions`, then `npm.cmd test`, `npm.cmd run check --prefix functions`, and `npm.cmd run build`. Use Node 22 on PATH and Java 21+ for emulator commands:

```text
firebase.cmd emulators:exec --project demo-luxe-availability --only functions,auth,database "node --test --test-concurrency=1 tests/emulator-auth/*.test.js tests/emulator/*.test.js"
firebase.cmd emulators:exec --project demo-luxe-availability --only functions,auth,database "node tests/mobile/booking.mjs"
```

This computer uses portable runtimes and `FUNCTIONS_DISCOVERY_TIMEOUT=30`; system installations were unchanged. The checked-in demo runtime parameter avoids an interactive prompt and creates no IAM identity. The mobile runner needs Windows/installed Edge and refuses non-demo/non-loopback setup. Its emulator wiring is applied only to the locally served test module, not production source.

## 8. Billing and Console/IAM requirements — approval required

The authorized billing owner must approve linking Cloud Billing/Blaze before functions can deploy. **Billing remains disabled.** Free allowances may cover low traffic, but compute, network, logs, builds, and artifact storage can incur charges; a permanently ₱0 total cannot be guaranteed. Use min 0/max 2 instances, short timeouts, monitored usage, approved artifact retention, and budget alerts. Alerts/instance limits are not hard spending caps.

The project administrator must approve the keyless runtime account, default `booking-runtime@ln-by-piya.iam.gserviceaccount.com`, and its reviewed role. Proposed runtime permissions: `firebaseauth.users.get`, `firebasedatabase.instances.get`, `firebasedatabase.instances.update`. RTDB write authority is broad and includes configuration/rules; IAM cannot confine it to booking JSON paths. Do not grant generic Owner/Editor or create a private key.

Set the non-secret `BOOKING_RUNTIME_SERVICE_ACCOUNT` parameter in ignored `functions/.env.ln-by-piya` to the approved account email. The managed initializer fixes `ln-by-piya` and the regional RTDB URL. Existing Vercel browser variables stay; no Vercel Admin credential or OIDC configuration is required.

Approve/review Cloud Functions, Cloud Run, Cloud Build, Artifact Registry and supporting IAM/Logging/Firebase APIs and service agents. The deployer needs suitable Functions deployment privileges and `iam.serviceAccounts.actAs` on the selected account; an authorized administrator must review API/build/service-agent permissions. No organization key-policy change is required. No reminder/email/password-reset secrets or scheduled jobs are needed for this booking codebase.

## 9. Coordinated deployment plan — not executed

1. Obtain explicit billing/IAM/API approval and separate push/deployment approval. Review this branch, test evidence, five-path rules diff, only-two-function manifest, and a short controlled booking maintenance window. Save prior build/rule versions for reference; an insecure rules backup is not a safe rollback target.
2. Configure approved billing/IAM/APIs/runtime identity and verify the CLI target/codebase. Validate staging with approved resources, without real customer passwords.
3. In the approved coordinated window, publish restrictive rules first: `firebase deploy --only database --project ln-by-piya`. Verify the deployed policy/hash. Old direct writers must be denied during transition even if temporarily unable to book. This is one reviewed coordinated release, not an unrelated rules-only deployment.
4. Publish only booking: `firebase deploy --only functions:booking --project ln-by-piya`. Verify both operations in `asia-southeast1`, identity, scaling, errors and logs. Do not deploy legacy schedules/email/reset jobs. Unauthenticated rejection can be checked without a booking write.
5. After rules/functions verification, publish the matching Vercel frontend and non-writing 410 route. Cached old clients must refresh. No permissive direct-write fallback is available.
6. Verify existing login, own-history/admin reads, availability UI, and absence of configuration/IAM failures. A live end-to-end test booking requires separately approved test identity, slot and production-data permission. Check real iPhone Safari/Messenger. End maintenance only after the agreed gates pass.

The sequence accepts a short controlled outage while closing the existing bypass. Local code preparation has not secured production; the older rules remain until approved publication.

## 10. Rollback

Keep restrictive rules. Restore functions/frontend only to a compatible managed-callable release, preserving all booking IDs and reservations. If this first deployment has no previous safe callable release, pause booking creation while correcting it. Do not restore permissive customer writes, the missing-key bridge, or delete appointments/slots/loyalty as rollback.

Saved appointments and intent journals survive code rollback. Reconcile ambiguous responses through stable intent/history rather than blindly creating another booking. Corrections require the applicable approval.

## 11. Remaining limits

Actual deployed IAM/function behavior, real Safari/Messenger/Google OAuth, and real reference-photo Storage upload still require authorized release checks. The no-photo mobile flow is verified; Chromium emulation is not WebKit testing. Existing dependency audit findings remain separate maintenance work; no clean audit is claimed. Firebase CLI warns that the installed Functions SDK has a newer available version; this task retains the tested locked package rather than upgrading unrelated behavior.

## Official references

[Callable contract](https://firebase.google.com/docs/functions/callable), [managed ADC](https://firebase.google.com/docs/admin/setup/), [codebase isolation](https://firebase.google.com/docs/functions/organize-functions), [identity/scaling](https://firebase.google.com/docs/functions/manage-functions), [transactions](https://firebase.google.com/docs/database/web/read-and-write), [IAM permissions](https://firebase.google.com/docs/projects/iam/permissions), [Blaze prerequisite](https://firebase.google.com/docs/functions/get-started), [pricing](https://firebase.google.com/pricing).
