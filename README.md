# Luxe Nails — Booking Frontend

This project is a React + Vite frontend for a nail salon booking system. It includes a portfolio gallery, services, price list, booking form, and an admin dashboard backed by Firebase Realtime Database.

Quick start

1. Install dependencies
```bash
npm install
```

2. Create a `.env.local` file from the provided example and add your Firebase Web App config:
```text
cp .env.example .env.local
# then edit .env.local and add values from Firebase project settings
```

3. Start the dev server
```bash
npm run dev
```

Notes
- The app initializes Firebase automatically if `VITE_FIREBASE_API_KEY` is present in the environment.
- `VITE_FIREBASE_DATABASE_URL` is required and must be the exact regional URL shown in the Realtime Database console.
- Bookings are stored under `/bookings`, gallery items under `/portfolio`, customers under `/users`, and administrators under `/admins`.
- Restart the Vite dev server after editing environment variables.

Firebase Realtime Database setup
- In Firebase Authentication, enable the Email/Password provider and any other providers used by the app.
- Copy `database.rules.json` into the Firebase Console **Realtime Database → Rules** tab and publish it, or deploy it with the Firebase CLI using `firebase deploy --only database`.
- The rules intentionally allow public reads of `/portfolio`. Booking and customer data remain protected.
- The first administrator must already exist at `/admins/<firebase-auth-uid>`. Do not allow public creation of admin records.
- Set `VITE_ADMIN_EMAIL` to the Firebase Authentication email belonging to that administrator UID.
- `VITE_SALON_CLOSED_WEEKDAYS` controls disabled weekly calendar days as comma-separated numbers (`0` is Sunday, `6` is Saturday). It defaults to Sunday.

Example (PowerShell):
```powershell
cp .env.example .env.local
# edit .env.local and paste values from the Firebase Web App "Config" panel
npm run dev
```

Sync existing Authentication users
- New sign-ins create their own `/users/<uid>` record automatically. To backfill older Authentication accounts, download a Firebase service account JSON and run a dry-run first:
```powershell
$env:SERVICE_ACCOUNT_PATH='./serviceAccountKey.json'
$env:FIREBASE_DATABASE_URL='https://your-database.region.firebasedatabase.app'
$env:ADMIN_EMAIL='your-admin-email@example.com'
npm run sync-auth -- --dry-run
```
- Remove `--dry-run` only after checking the destination paths. Existing `/admins/<uid>` records are preserved as administrators.
- Never commit the service account file.

Admin access
- Admin is intentionally separated from public navigation. Visit `http://localhost:5173/#/admin` and sign in with the administrator's Firebase Authentication credentials.
- Database authorization is enforced by the existing `/admins/<uid>` record and Realtime Database rules, not by a password embedded in frontend environment variables.

Spark-compatible password recovery
- Forgot Password uses Firebase Authentication's built-in password-reset email. It does not use Cloud Functions, a browser-generated OTP, Firebase Admin credentials, or an email-provider secret.
- The existing Account Recovery modal requests the email and then shows a neutral confirmation. The customer opens Firebase's secure link, chooses a new password in Firebase's hosted action handler, and returns to sign in.
- Customize the password-reset template under **Firebase Console -> Authentication -> Templates**.
- Enable **Email Enumeration Protection** in Firebase Authentication so requests for registered and unregistered addresses have the same observable result. The frontend also treats the legacy `auth/user-not-found` response neutrally.
- Keep each development or production hostname in **Authentication -> Settings -> Authorized domains**. Set `VITE_PASSWORD_RESET_CONTINUE_URL` to a fixed authorized HTTPS app URL when you want Firebase's hosted action handler to show a return-to-app link. Leave it blank until that URL is configured; local development may use an authorized `http://localhost` URL.
- The password-reset exports under `functions/` remain legacy code and are not part of the production password-recovery flow.

Appointment reminders on Firebase Spark
- The live Firebase project is currently on Spark, so the reminder scheduler runs from the external GitHub Actions workflow in `.github/workflows/appointment-reminders.yml`, not from a browser timer or Firebase Cloud Functions.
- The workflow runs every 15 minutes and invokes `scripts/processAppointmentReminders.js`. It checks only `Confirmed` bookings, interprets their schedule in `Asia/Manila`, and sends reminders during safe 24-hour and 12-hour windows.
- Add these repository secrets before enabling the workflow:
  - `FIREBASE_DATABASE_URL`: the exact Realtime Database URL.
  - `FIREBASE_SERVICE_ACCOUNT_JSON`: a dedicated service-account JSON credential with only the Firebase Auth user lookup and Realtime Database access required by the worker.
  - `SENDGRID_API_KEY`: a server-only SendGrid key restricted to Mail Send.
  - `PASSWORD_RESET_FROM_EMAIL`: a sender address already verified in SendGrid. The historical variable name is reused so the project keeps one sender configuration.
- After all four secrets exist, add the repository variable `APPOINTMENT_REMINDERS_ENABLED` with the value `true`. Until then, scheduled jobs are safely skipped instead of repeatedly failing.
- Keep GitHub Actions enabled for the repository. Use the workflow's manual **Run workflow** action for a controlled test; the scheduled run does not require the website or a customer's device to be online.
- Reminder claims and channel state live under each booking's `reminders` object. In-app records use `/notifications/<uid>/<bookingId>_<reminderType>`, making repeated scheduler runs idempotent.
- Email delivery is retried at most three times while the reminder remains in its valid window. The in-app record uses a deterministic ID, so an email retry cannot create duplicate bell notifications.
- If the Firebase project is upgraded to Blaze later, the same engine is also exported as `processAppointmentReminders` from `functions/index.js`; add the Functions source back to `firebase.json` before deploying that scheduled function. Do not run both schedulers at once.

Assets
- The gallery uses public Unsplash images as fallbacks; you can add local images under `src/assets/` and update `PortfolioGallery.jsx`.

If you want, I can also:
- Add a secure admin login
- Add availability checking (prevent double-booking)
- Add image upload for portfolio (admin)
