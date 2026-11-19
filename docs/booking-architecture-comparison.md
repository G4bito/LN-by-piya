# Booking architecture recommendation

Reviewed November 19, 2026 (Asia/Manila). Investigation only. No application code, production settings, rules, accounts, appointments, loyalty records, organization policies, billing, or deployments were changed.

**Recommendation:** use Firebase-hosted booking functions with a narrowly permissioned Google-managed runtime identity and the existing Realtime Database reservation engine, subject to explicit approval for Blaze billing and deployment. This is a keyless implementation of the Firebase-native option. Keep Vercel for the website. A pure browser-to-RTDB design is possible but is a larger security/data-model redesign, not the smallest safe restoration of this implementation.

If a billing account is absolutely prohibited, retain that constraint: the browser/RTDB Spark design is the relevant alternative, with its additional engineering work. Do not disguise a service-account key, reuse a human administrator token as runtime credentials, or relax organization policies to restore booking.

## Evidence from the existing implementation

- `src/firebase.js:saveBooking` checks the session/settings, optionally uploads a reference image, and invokes the same-origin API. `server/bookingApi.js` verifies the Firebase customer token with revocation checking before calling the shared service. Its current initializer only supports a private-key credential in production.
- `functions/bookingAvailabilityService.js` implements the actual critical path: active customer check; date mutex; canonical price/duration and current availability; immutable UID/request intent binding; legacy bookings lookup; full-interval/buffer/capacity conflict detection; day schedule transaction; atomic appointment plus durable reservation commit; lost-response recovery; optional deterministic notification; token-owned lease release.
- Reservation entries are `scheduleSlots/<date>/<bookingId>`, not unique time cells. The JavaScript service is responsible for comparing different bookings' intervals. A transaction on one independent start-time/booking key does not establish that two different intervals cannot overlap.
- Existing admin confirmation, rescheduling, cancellation, and availability operations also use the schedule/date-lock paths. Any redesign must update all writers consistently, not just customer submission.
- `functions/index.js` already exports `submitBooking` and `saveBookingAvailability` around the same shared service. Its initialization falls back to managed application default credentials when no key JSON is supplied. The runtime is Node 22, the region is `asia-southeast1`, and no always-on minimum instance count is configured. The source also contains unrelated password reset/reminder/scheduled functions; do not deploy those merely to restore bookings.
- The callable wrapper currently relies on callable authentication. It must explicitly retain the current HTTP API's disabled-user/revocation check before any booking operation; an unexpired signed token alone is insufficient to reproduce `verifyIdToken(token, true)` behavior.

## Actual Security Rules and billing checks

Read-only authenticated production requests returned HTTP 200 for database rules and Cloud Billing metadata. Billing is currently disabled. The deployed rules differ from `database.rules.json`:

- Production permits an active customer to create their own Pending Confirmation booking without requiring a corresponding reservation, mutex ownership, canonical duration, or availability validation.
- Production's customer slot/mutex rules provide some ownership/lease restrictions, but they do not make use of that protocol mandatory for appointment creation or enforce cross-appointment interval conflicts.
- Repository rules deny direct customer booking/slot/mutex writes and keep `serverOnly` private. Their design expects the trusted booking service to be the customer write path.

A **local demo emulator** loaded a copy of the deployed rules. Two synthetic authenticated customers directly created Gel Manicure bookings for the same date at 10:00 and 11:00, each lasting 75 minutes. Both writes were accepted despite a saved blackout for that date; no schedule slot or mutex existed. Loading the repository rules into that same local demo denied both subsequent direct customer booking writes. No production customer records were read or written during this check; only production rules and billing metadata were read.

Restoring an old direct-write code path would therefore not meet the stated safety requirements. With either trusted-server choice, publication of the matching restrictive rules is a separately approved part of the release. Until then, a browser can bypass a secure UI/API through the older deployed rules.

## Comparison

| Choice | Concurrency/security | Changes and maintenance | Billing/cost |
|---|---|---|---|
| Vercel OIDC + Google WIF | Retains the existing trusted API and shared transactions. Needs tightly constrained issuer/audience/team/project/environment trust and runtime IAM. | Add a renewable external-account credential adapter, OIDC dependency/configuration, federation pool/provider, service-account impersonation, and rotation tests. No booking-data migration. More identity infrastructure to maintain. | Vercel OIDC is available on all plans; IAM API usage is free. Google's WIF setup calls for billing on the hosting project. A separate approved identity project may avoid linking billing directly to Firebase, but cross-project API/quota requirements must be verified. Vercel/Firebase usage still applies. |
| Browser directly to RTDB with rules | Can be secure using a redesigned bounded occupancy/capacity ledger whose invariants are enforced by rules, even against modified clients. The current schema/rules are insufficient. | Rework reservation representation, authoritative catalog/availability, booking-slot atomic consistency, retry identity, deletion/release rules, history integration, and all admin writers. Backfill protection for existing active appointments. Highest redesign and rules-testing effort. | No billing account or private key is required for Firebase Auth/RTDB within Spark's limits. Best fit for a strict no-billing requirement, but not the fastest safe repair. |
| Firebase functions + managed credentials | Retains the same shared trusted transaction service and restrictive customer rules. Google supplies short-lived runtime credentials; no private key or federation is needed. | Reuse existing booking function exports, choose a restricted runtime identity, preserve explicit revocation checks and safe diagnostics, isolate booking-only deployment/configuration, and update client transport. No appointment/account/loyalty migration. Simplest trusted backend here. | Production functions require Blaze and a billing account. Low traffic may stay within no-cost compute quotas, but build/artifact storage, logs, network, and over-quota usage can incur charges. No guaranteed zero total bill. |

The second and third rows are two materially different meanings of a “Firebase architecture without a private key.” Functions still use the Admin SDK under a managed identity. Avoiding a downloaded private key does not require moving trusted business rules into the browser.

## What a secure Spark-only redesign would require

Use authenticated, create-only ownership-bound claims over every unit of occupied time, or another explicitly proven bounded interval model. A 75-minute appointment starting at 10:00 must exclude 11:00, not just another 10:00 start. Preserve configured buffers and actual service durations; do not silently switch the salon to fixed two-hour appointments or round away valid availability.

Server-enforced rules must validate the entire reservation and booking together: active UID, trusted service duration/price, every occupied interval, availability version/current closures, notice/advance limits, daily capacity, permitted status, immutable identity, and who can release a reservation. Browser checks remain usability aids. Do not trust a browser-provided hash, duration, day-of-week, counter, expiry, or “already validated” flag as authority.

RTDB transactions retry conflicting writes, but their callback runs in the client. A modified client can submit a different operation unless rules reject it. RTDB rules cannot execute this repository's JavaScript scheduling functions or its IANA-timezone calculations. A maintainable rules-driven design needs an admin-owned catalog/calendar or equivalent validated representation; lifecycle and stale-availability handling must be designed together. Do not grant customers reads of other clients' private appointments merely to enable a whole-day transaction.

An atomic multi-location update can commit booking and occupancy together only when the rules enforce their relationship. It does not independently perform conflict detection. Stable intent IDs and transactional claims still need retry/rollback/lost-response tests. Existing active appointment IDs and history must be preserved while their occupied intervals are seeded and validated before cutover. Loyalty awards remain exclusively in eligible service completion, not initial booking.

## Minimal proposed managed-function change

1. Obtain administrator approval for billing and the runtime/deployer IAM setup; do not change the existing key-creation policy. Use an approved dedicated managed runtime account rather than broad default Owner/Editor authority. Its reviewed runtime permissions cover Auth user reads for revocation and the existing RTDB reads/writes. RTDB IAM write permission itself is broad; it cannot be confined to booking JSON paths.
2. Reuse the shared booking service and the two booking operations. Keep the intended Firebase project and regional database URL explicit. Use managed ADC, with no JSON private key and no WIF token exchange.
3. Preserve explicit customer token revocation/disabled checks, active customer/admin checks, errors/diagnostics, stable IDs, locks, atomic commits, and recovery semantics. Callable authentication is not a substitute for all of these checks.
4. Separate the booking deployment/configuration from unrelated email secrets, password resets, reminders, scheduled cleanup, and their costs. Review the functions dependency/runtime package; do not assume previous Vercel packaging tests prove this target is ready.
5. Update customer and availability submission to the Firebase SDK callable transport, including region selection and existing error mapping. If retaining the literal `/api/booking` endpoint is mandatory, a thin authenticated forwarding adapter is possible, but adds an unnecessary hop; a backend transport change does not require redesigning the booking UI.
6. After staging tests and approval, publish only the intended booking functions, matching frontend, and reviewed restrictive rules together. Keep original records/UIDs/loyalty intact. No bulk data rewrite is needed for either trusted-server option.

Cost controls to review: `minInstances: 0`, a modest maximum instance count, short request timeouts, deployment artifact retention, usage monitoring, and budget alerts. Maximum instances and budget alerts are not hard spending caps. The region and actual invocation/compute/network usage determine the bill; there is no defensible fixed peso estimate without usage data.

Before release, test valid and invalid customers, token revocation, missing loyalty, simultaneous overlapping requests, different starts with overlapping full durations, buffers/daily limits, unavailable dates, retry replay, partial-write/lost-response recovery, admin lifecycle operations, history, actual deployed permissions, and mobile submission. Emulators cannot establish live IAM/deployment behavior.

## Sources

- [Firebase transactions and atomic updates](https://firebase.google.com/docs/database/web/read-and-write)
- [RTDB rule conditions and validation](https://firebase.google.com/docs/database/security/rules-conditions), [rule language reference](https://firebase.google.com/docs/reference/security/database)
- [Firebase pricing](https://firebase.google.com/pricing), [function deployment requires Blaze](https://firebase.google.com/docs/functions/get-started)
- [Managed Admin SDK credentials](https://firebase.google.com/docs/admin/setup/), [callable authentication/transport](https://firebase.google.com/docs/functions/callable)
- [Function identity, scaling, and artifact management](https://firebase.google.com/docs/functions/manage-functions)
- [Vercel OIDC](https://vercel.com/docs/oidc), [Google WIF prerequisites](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers), [IAM API pricing](https://cloud.google.com/iam/pricing)

Only local investigation documentation was changed. The emulator probe and copied rules remain in an ignored local cache; they are not application changes or a proposed production ruleset.
