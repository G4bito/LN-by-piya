# Keyless Firebase Admin authentication assessment

Reviewed November 19, 2026 (Asia/Manila). This is an investigation and proposed configuration, not a deployed implementation. No IAM changes, service accounts, keys, federation resources, billing changes, or Firebase data operations were performed.

The user reports that organization policy prohibits service-account key creation. Keep that policy in place. The approach assessed here is Vercel OIDC → Google Security Token Service → service-account impersonation → short-lived OAuth access token → Firebase Admin SDK. Use an administrator-approved runtime identity with only the permissions needed by this booking API. Do not substitute an Owner/Editor identity or a human refresh token.

The subsequent [architecture comparison](booking-architecture-comparison.md) evaluates simpler alternatives and recommends Firebase-hosted booking functions with managed credentials, subject to billing approval. OIDC remains appropriate when retaining the Vercel-hosted backend is a requirement; this assessment is not implementation authorization.

## Compatibility with this repository

- `server/firebaseAdmin.js` currently requires `FIREBASE_SERVICE_ACCOUNT_JSON` and calls `cert(account)`. Federation is **not** a drop-in value for that variable; the initializer needs a credential-provider change.
- The root Vercel runtime is Node 24 with Firebase Admin 13.10.0. Its installed Google Auth Library 10.9.0 supports `ExternalAccountClient` and a programmatic subject-token supplier. Firebase Admin's public `Credential` interface accepts `getAccessToken()` returning `{ access_token, expires_in }`.
- Vercel documents the GCP external-account/impersonation flow. The reviewed `@vercel/oidc` release is 4.0.9, requiring Node >=20. A future implementation should declare its Google Auth Library dependency directly rather than relying on a transitive dependency.
- Use `getVercelOidcToken()` when credentials are needed in the invocation context. Do not capture a build token or the first request's token permanently. Let Google Auth Library handle OAuth token caching/refresh and derive the Firebase credential's lifetime from the actual expiry.
- Keep explicit target `projectId: ln-by-piya` and the regional RTDB URL. Pool-host project and target Firebase project may differ; do not confuse their project numbers.
- Keep the existing `/api/booking` contract, `verifyIdToken(token, true)`, active UID-based customer/admin checks, availability checks, intent binding, mutex/slot transactions, atomic commit, retry recovery, and optional notifications. Vercel workload identity authorizes the backend; it does not replace customer Firebase Authentication.
- Retain the demo-only emulator branch and production rejection of emulator settings. Do not fall back to browser writes or a private key when federation fails.
- Merely replacing `cert()` with `applicationDefault()` is insufficient on Vercel unless a complete supported external-account configuration and renewable credential source are supplied. A small explicit Google Auth Library-to-Firebase credential adapter is the practical fit here.

An offline compatibility check instantiated the installed external-account client with an impersonation URL and subject-token supplier, and constructed Firebase Auth/Database clients using a synthetic custom credential. An invalid Firebase customer token was rejected. The check ran with native CommonJS `require(ESM)` support disabled. No real OIDC/Google token exchange, IAM enforcement, database read/write, or live booking was attempted. This establishes local API compatibility, not deployed readiness.

Sources: [Vercel GCP integration](https://vercel.com/docs/oidc/gcp), [Google Auth Library](https://github.com/googleapis/google-auth-library-nodejs#workload-identity-federation), [Firebase Credential contract](https://firebase.google.com/docs/reference/admin/node/firebase-admin.app.credential), [Vercel token helper](https://github.com/vercel/vercel-extensions/blob/main/packages/oidc/docs/README.md).

## What an authorized administrator must configure

1. Confirm the organization permits the proposed OIDC issuer and service-account impersonation. If federation is also restricted, obtain an approved design from the organization administrator; do not relax organization policy. Confirm billing/API prerequisites before creating resources.
2. In Vercel, confirm the actual team issuer, immutable team ID, immutable project ID, project name, and Production environment. Prefer the team-specific issuer `https://oidc.vercel.com/<TEAM_SLUG>`. Do not infer IDs from the GitHub repository or deployment URL.
3. In an approved Google Cloud project, configure a dedicated workload identity pool and OIDC provider. Use Vercel's public discovery/JWKS endpoints; no uploaded signing key is needed. Map `google.subject=assertion.sub`. Add an attribute condition requiring the exact Vercel `owner_id`, `project_id`, and `environment == 'production'`. Do not trust every project in a team or every identity in a pool. Preview/development should use separately approved test access, not this production identity.
4. Configure audience verification consistently. The recommended provider-specific OIDC audience is `https://iam.googleapis.com/projects/<POOL_PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL_ID>/providers/<PROVIDER_ID>`; request that audience through Vercel's helper. Google Auth Library's external-account audience uses the corresponding `//iam.googleapis.com/projects/...` resource identifier. These are distinct configuration fields. An explicit Vercel-team allowed audience is another documented option, but the provider and code must use the same approach.
5. Select an approved dedicated keyless service account. Do not generate a key. Grant `roles/iam.workloadIdentityUser` **on that account only** to the exact production federation subject `owner:<TEAM_SLUG>:project:<VERCEL_PROJECT_NAME>:environment:production`, additionally constrained by the provider's immutable ID checks. A simple one-hop WIF impersonation flow does not require the broader Service Account Token Creator role, `signBlob`, or a project-wide Service Account User binding.
6. Give that runtime account a reviewed custom role on the target Firebase project containing the permissions below. Add only permissions shown necessary by staging validation; do not assign generic Firebase Admin, Authentication Admin, Owner, or Editor roles.
7. Enable the APIs needed for federation: IAM, IAM Service Account Credentials, Security Token Service, and Resource Manager as required by Google's setup. Confirm the existing Identity Toolkit and Firebase Realtime Database APIs are enabled. API/quota project selection must be reviewed if pool, service account, and Firebase resources are in different projects.
8. Configure only non-key server identifiers in Vercel Production: `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `GCP_PROJECT_NUMBER` (pool host), `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`, `GCP_SERVICE_ACCOUNT_EMAIL`, and, for the provider-specific audience approach, `GCP_AUDIENCE`. None should have a `VITE_` prefix. Do not manually paste short-lived OIDC/OAuth tokens into environment settings. The proposed OIDC mode would no longer require `FIREBASE_SERVICE_ACCOUNT_JSON`.

Provider setup sources: [Vercel token claims](https://vercel.com/docs/oidc/reference), [Google federation setup and exact-subject binding](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers), [service-account authentication roles](https://docs.cloud.google.com/iam/docs/service-account-permissions).

## Runtime permissions and their limits

| Permission | Why the current API needs it |
|---|---|
| `firebaseauth.users.get` | Read the Auth user's disabled/revocation state for `verifyIdToken(..., true)`. No account creation, deletion, password reset, or Auth update permission is needed. |
| `firebasedatabase.instances.get` | Read required profiles, administrator status, settings, appointments, and reservation state. |
| `firebasedatabase.instances.update` | Perform the existing reservation transactions and appointment/availability/notification writes. |

The RTDB write permission is inherently broad: it also permits database configuration/security-rule operations. IAM cannot confine this OAuth Admin access to `bookings/<id>` or other JSON paths. Admin OAuth access normally bypasses database rules; switching to federation must preserve the same trusted-server authorization checks and leave client rules unchanged. A custom role reduces unnecessary capabilities but is not path-level isolation. Narrower server access would require a separate reviewed rules/architecture change, outside this credential repair.

Request the Auth/Database OAuth scopes required by the SDK operations, including `firebase.database` and `userinfo.email` for RTDB and `identitytoolkit` for Auth. OAuth scopes do not replace IAM grants. If a separate quota project is configured, check whether `serviceusage.services.use` is additionally required there.

The human setup administrator needs authority to manage identity pools/providers, manage the selected service-account IAM binding, grant the target-project custom role, and enable APIs. Typical setup roles are Workload Identity Pool Admin, Service Account Admin, Service Usage Admin, and appropriate project IAM/custom-role administration, or equivalent scoped permissions. These are setup privileges, not permissions for the booking runtime. Existing approved accounts/roles may be reused rather than newly granted.

Sources: [Firebase IAM permission meanings](https://firebase.google.com/docs/projects/iam/permissions), [Auth revocation checks](https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.baseauth#baseauthverifyidtoken), [RTDB OAuth authentication and scopes](https://firebase.google.com/docs/database/rest/auth).

## Costs and billing gate

Vercel documents OIDC federation as available on all plans. Google documents IAM API usage as free. Vercel compute, Firebase database/network usage, optional Cloud Logging, and other consumed services retain their normal pricing and quotas; this is not a promise of a zero total bill.

Google's WIF setup lists a billing-enabled project as a prerequisite. The earlier read-only project check found billing disabled for `ln-by-piya`; that state was not rechecked in this assessment. Linking a Cloud Billing account directly to a Spark Firebase project automatically upgrades it to Blaze. **Do not link billing or promise that this setup leaves Spark unchanged without administrator review and explicit approval.**

Google supports hosting the federation pool separately from the service account/resources. An already-approved billing-enabled identity project may be appropriate, but the administrator must verify cross-project API/quota requirements and resulting costs before claiming that the Firebase project's billing can remain unchanged. No pool, project, billing link, or API was created/enabled here.

Sources: [Vercel OIDC availability](https://vercel.com/docs/oidc), [Google IAM pricing](https://cloud.google.com/iam/pricing), [Google WIF prerequisites and cross-project impersonation](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers), [Firebase pricing-plan changes](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## Required validation before release

After the administrator approves/configures trust and permissions, implement the credential adapter locally, retaining the existing compatible Firebase Admin dependency chain. Verify startup packaging, token renewal in warm functions/RTDB connections, and sanitized stage-specific diagnostics. Test allowed Production identity and rejection of wrong issuer/audience/team/project/Preview identity, expired credentials, and missing IAM permissions. Preserve customer-token signature/audience/revocation checks.

Rerun the booking/auth/concurrency/recovery emulator tests and production build. Real federation needs a controlled, separately approved staging deployment because Firebase Emulators do not enforce Google IAM or STS trust. A Preview deployment must not receive production database authority merely to test this. Any live booking test, production deployment, IAM/rule change, or billing change requires its applicable approval. No deployment or code push was performed in this assessment.
