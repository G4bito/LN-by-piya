# Customer login investigation

Prepared locally. Production checks were read-only. No real customer password was requested or used, and no account, appointment, credential, loyalty total, or production rule was modified.

## Confirmed post-authentication failure

The original message `Unable to verify account access. Please sign in again.` came from the catch block in App's authentication-state observer. Firebase Authentication had already succeeded. The observer checked UID-based administrator/customer authorization, then awaited `createOrUpdateCustomerRecord`, then loaded profile completeness. Any thrown error from the required steps cleared the app session and called `logOut`.

Existing customer sign-in unnecessarily wrote profile metadata, including `lastLogin`. The deployed `users/$uid` validation compares `newData.child('loyalty').val()` with `data.child('loyalty').val()`. This is not a deep JSON comparison: Firebase documents that `RuleDataSnapshot.val()` on a node with children returns a sentinel, not the child object. In the emulator with the actual rules, an active customer with a nested loyalty object received `PERMISSION_DENIED` for an unrelated metadata update. The same update succeeded after removing only the nested loyalty object from the disposable demo fixture. The login reproduction initially failed for the loyalty customer and passed for a customer without loyalty.

Read-only production checks confirmed the reported account exists, is enabled, has the password provider, and has an active UID-owned profile with one completed visit/point and nested loyalty data. The intended project is `ln-by-piya`; production Email/Password and Google providers are enabled, and `ln-by-piya.vercel.app` is an authorized domain. The deployed public bundle uses the intended project, authentication domain, and regional database URL.

The recent Rewards UI commit did not modify authentication or user-profile rules. Comparison with `14b2452`, before the Availability/Rewards work, found the same authentication/profile logic and user rules. The user rule dates to the initial repository commit; making profile-sync errors fatal predates the recent redesign. Populating nested loyalty data exposed this pre-existing dependency; optional reward-definition loading itself was not the authentication gate. No new audit-log integration was found on this path.

## Separate invalid-credential investigation

`auth/invalid-credential` is an Authentication failure before App's post-auth profile checks. The reported account is a password account, not a Google-only account. Its actual password was never tested, so the account-specific cause of that error cannot be asserted from a screenshot.

A separate frontend bug was reproduced with a demo account: the sign-in form trimmed leading/trailing password characters, causing a correct existing password with spaces to fail. Sign-in now sends the exact password. The existing signup policy remains unchanged. Error mapping offers retry, Google if originally used, or password recovery without disclosing whether an email is registered. Google popup/browser errors recommend opening Safari or Chrome outside Messenger where appropriate.

## Local changes

- `src/firebase.js`: existing profiles are verified and read without rewriting them during sign-in; missing profiles retain the secure provisioning flow at the authenticated UID. Inconsistent existing identities require support. Email/Google helpers perform Authentication, while App's observer owns post-auth authorization/profile handling once.
- `src/App.jsx`, `src/authFlow.js`, `src/pages/Login.jsx`: distinguish essential profile access errors from invalid credentials and show safe recovery messages.
- `src/pages/LuxeNailsAuth.jsx`: preserve exact passwords during sign-in.
- `tests/authFlow.test.js`: friendly, enumeration-safe credential and profile-access error tests.
- `tests/emulator-auth/login.test.js`: real Auth/Database emulator regression tests, including the original nested-loyalty failure, UID recovery, Google credentials, inactive accounts, and admin access.
- `firebase.json`, `package.json`: local Auth emulator configuration and repeatable test command.

No Firebase Security Rules were changed. Login still requires successful required authorization and profile reads; it does not treat essential permission failures as optional. Existing accounts keep their original Authentication UID and credentials. Account creation is never used as a replacement for failed sign-in.

## Verification and limits

The nine focused auth unit checks and all twelve auth emulator checks passed. The final combined suite also tests the booking HTTP route; see the [booking report](booking-submission-fix.md) for complete counts and mobile results. Browser testing uses actual app components with demo emulators. Real iPhone Safari, Messenger's embedded browser, and real Google OAuth popup behavior remain device/browser checks; an emulated Google credential is not a real Google OAuth test.

The unrelated profile-edit path remains subject to the existing nested-loyalty validation limitation. This fix removes profile writes from login; it does not weaken that rule or silently change customer data. A separate rules fix for profile editing would need validation and publication approval.

## Sources

- [Firebase Rules val semantics](https://firebase.google.com/docs/reference/security/database#val)
- [Firebase password authentication and email enumeration protection](https://firebase.google.com/docs/auth/web/password-auth#recommended_enable_email_enumeration_protection)
- [Firebase authentication observer](https://firebase.google.com/docs/auth/web/manage-users#get_the_currently_signed-in_user)
