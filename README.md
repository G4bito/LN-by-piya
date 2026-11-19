# Luxe Nails — Booking Frontend

This project is a React + Vite frontend for a nail salon booking system. It includes a portfolio gallery, services, price list, booking form, and an admin dashboard backed by Firebase Realtime Database.

See [Settings and booking availability](docs/booking-availability.md) for the admin workflow, Firebase paths, security, tests, and coordinated publication requirements.

See [Managed Firebase booking release](docs/firebase-booking-release.md) for the current local implementation, tests, billing/IAM approval, coordinated rules/functions/frontend rollout, and rollback. Booking uses `submitBooking` and `saveBookingAvailability` in `asia-southeast1` with Google-managed credentials. The retired Vercel `/api/booking` route cannot write bookings. No production release or billing change is authorized for this implementation.

Install frontend/test dependencies with `npm.cmd ci` and function dependencies with `npm.cmd ci --prefix functions`. Run `npm.cmd test`, `npm.cmd run check --prefix functions`, and `npm.cmd run build`. Integrated tests use `npm.cmd run test:auth-emulator` with Node 22 and Java 21+. The Firebase configuration selects only the `booking` codebase, exporting two callables and no scheduled jobs.

