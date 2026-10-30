# MongoDB setup

CallFlow uses the official MongoDB Node.js driver from server-side code only.

## Environment variables

Set these in the deployment platform's encrypted environment-variable settings:

- **MONGODB_URI**: connection URI for a least-privileged CallFlow application user. Use a replica set or sharded cluster because assignment, attendance, WFH quota, and leave-capacity workflows use transactions.
- **MONGODB_DB**: optional database name; defaults to callflow.
- **SESSION_SECRET**: cryptographically random secret of at least 32 characters. Do not reuse a secret from another application.
- **CALLFLOW_BOOTSTRAP_TOKEN**: one-time bootstrap token of at least 32 characters.
- **BOOTSTRAP_MANAGER_EMAIL**: the email address permitted to create the initial Manager.
- **CALLFLOW_PREVIEW_SEED_ENABLED**: optional Preview-only seed switch; keep disabled unless synthetic QA data is required.

Do not use an Atlas administrator account. Do not allow all IPs (0.0.0.0/0) just to make connectivity work. Permit only the deployment's actual network path after checking the provider's current egress guidance.

## Initial Manager setup

1. Configure MONGODB_URI, MONGODB_DB, and SESSION_SECRET.
2. Temporarily set CALLFLOW_BOOTSTRAP_TOKEN and BOOTSTRAP_MANAGER_EMAIL.
3. Open /setup-manager and submit the configured email, Manager name, bootstrap token, and a password of at least 14 characters.
4. The bootstrap transaction creates the first Manager and its audit event. It refuses to create another Manager after one exists.
5. Remove CALLFLOW_BOOTSTRAP_TOKEN and BOOTSTRAP_MANAGER_EMAIL from the deployed environment after successful setup. Keep SESSION_SECRET.
6. Sign in from the CallFlow home page.

Never paste connection strings, tokens, or passwords into issues, chat, source control, or build logs.

## Authentication and authorization

- User passwords are stored as bcrypt hashes.
- Sessions are signed with HS256 and stored in an HTTP-only, SameSite=Strict cookie; production cookies are Secure and expire after eight hours.
- The session is resolved against an active user record in MongoDB, so the database role is authoritative.
- Roles are Manager, Team Lead, Engineer, and SSE. Privileged APIs restrict Manager/Team Lead operations; Engineer access is scoped to the assigned engineer's own records where applicable.
- Login throttling uses atomic MongoDB account/IP windows and HMAC-hashed identifiers. It does not require a third-party rate-limiting service.
- There is no public self-registration endpoint.

## Verify database connectivity

Request /api/health/database from the deployment:

- HTTP 200 with status connected and indexes ready means the application can ping MongoDB and ensure its indexes.
- HTTP 503 with not_configured means MONGODB_URI is absent.
- HTTP 503 with unavailable means the server could not connect. The endpoint intentionally hides driver errors and secrets; inspect server logs privately.

A successful health check verifies connectivity only. It does not prove the full application workflow.

## Transactions and integration tests

GitHub Actions starts an ephemeral MongoDB 7 single-node replica set on the runner. It uses a CI-only database and does not access a deployed database. The integration suite verifies concurrent assignment selection, assignment completion counters, rotation skips, WFH quota reservations, attendance state transitions/check-in/check-out races, and leave-capacity reservations.

The production HTTP smoke test runs after the build. It starts the built Next.js server, bootstraps a synthetic Manager, creates and logs in an Engineer, exercises role restrictions, assignment lifecycle, WFH attendance, leave approval/cancellation, reporting, and logout. It uses a separate process-specific database name. Run npm run test:e2e only with a disposable replica-set URI; never point it at production.

## Preview and production verification checklist

Before using a Preview deployment:

- Confirm MONGODB_URI points to a non-production replica-set database.
- Confirm MONGODB_DB is the intended Preview database.
- Confirm SESSION_SECRET is a unique random value of at least 32 characters.
- Use the one-time bootstrap variables only for initial Manager creation, then remove them.
- Verify /api/health/database, Manager login, role restrictions, team roster, assignment lifecycle, attendance/WFH quota, leave review, reporting, and CSV export using synthetic records.
- If Preview seeding is needed, enable it only for Preview and use a database name ending in -preview or _preview.

Production configuration and deployment are not verified by CI. Do not infer production readiness from a successful build or Preview deployment. Verify the production environment separately and obtain explicit approval before changing production settings or deploying.