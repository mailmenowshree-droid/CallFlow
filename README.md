# CallFlow

Call assignment and operations workspace for Managers, Team Leads, Engineers, and SSEs.

## Stack

- Next.js 16 App Router, React 19, TypeScript, and Tailwind CSS
- MongoDB Node.js driver for users, engineers, assignments, rotations, attendance, leave, and audit records
- bcryptjs password hashes and signed HS256 session cookies via jose
- Vitest unit and MongoDB replica-set integration tests

## Core workflows

- Manager bootstrap, password login/logout, and database-backed session validation
- Role-restricted team and user management
- Separate FE/CRU/Event and FTS round-robin queues
- Transactional assignment creation, overlap prevention, status lifecycle, and audit events
- Attendance check-in/check-out with atomic WFH quota reservation
- Leave requests, approval/rejection/cancellation, and per-day capacity reservations
- Manager/Team Lead reporting and CSV export; CSV cells are neutralized against spreadsheet formula injection

## Environment variables

Configure these only in the server-side environment. Never commit real values.

- **MONGODB_URI**: least-privileged MongoDB application connection URI. Transactions require a replica set or sharded cluster.
- **MONGODB_DB**: optional database name; defaults to callflow.
- **SESSION_SECRET**: cryptographically random value of at least 32 characters.
- **CALLFLOW_BOOTSTRAP_TOKEN**: one-time Manager bootstrap token of at least 32 characters.
- **BOOTSTRAP_MANAGER_EMAIL**: the only email accepted by the one-time bootstrap endpoint.
- **CALLFLOW_PREVIEW_SEED_ENABLED**: optional Preview-only seed switch; disabled by default.

## Initial Manager setup

1. Configure MONGODB_URI, MONGODB_DB, and SESSION_SECRET.
2. Temporarily configure CALLFLOW_BOOTSTRAP_TOKEN and BOOTSTRAP_MANAGER_EMAIL.
3. Open /setup-manager and create the initial Manager using the configured email, bootstrap token, name, and a password of at least 14 characters.
4. Remove the bootstrap token and email from the deployment environment after the Manager is created.
5. Sign in from the CallFlow home page.

The bootstrap endpoint is one-time and refuses to create another Manager after one exists. Production and Preview require a real session; the fixed Manager identity is local-development-only. Session cookies are HTTP-only, SameSite=Strict, Secure in production, and expire after eight hours.

Login attempts use MongoDB-backed account/IP throttling. Rate-limit identifiers are HMAC-hashed with SESSION_SECRET; no external rate-limiting service is required.

## Preview seeding

Preview demo seeding is disabled by default. If enabled for QA, use only the Vercel Preview environment, a separate database whose name ends in -preview or _preview, and an authenticated Manager session. Never point a Preview deployment at production data.

## Local development

Run npm ci, then npm run dev.

## Validation

Run npm run typecheck, npm run lint, npm test, npm run build, and npm run test:e2e.

The HTTP end-to-end smoke test requires a disposable MongoDB replica set in MONGODB_URI and a completed production build. It starts the built Next.js server, uses synthetic Manager/Engineer accounts, and selects a separate process-specific database name. Do not run it against a production database.

GitHub Actions starts an ephemeral MongoDB 7 single-node replica set and runs dependency installation, audit reporting, typecheck, lint, unit/integration tests, production build, and the HTTP end-to-end smoke test. The latest verified run is recorded in PROJECT_STATUS.md.

The current automated end-to-end test exercises the HTTP/API workflows. Browser-driven UI regression (including real browser sign-in and CSV download interaction) remains a separate verification item.

## Operational boundaries

- Use synthetic data in tests and previews. Never commit credentials, tokens, or real customer/case data.
- MongoDB transactions require a replica set or sharded cluster.
- A successful CI run or Preview build is not proof of production readiness.
- Production configuration and deployment must be verified separately and require explicit approval.