# CallFlow

Call assignment and operations dashboard for Team Leads, Managers, and engineers.

## Stack

- Next.js 14 App Router, React 18, TypeScript, Tailwind CSS
- MongoDB Atlas for users, engineers, assignments, rotations, attendance, leave, and audit records
- bcryptjs password hashes and signed HS256 session cookies

## Authentication and initial setup

1. Configure `MONGODB_URI`, `MONGODB_DB`, and a cryptographically random `SESSION_SECRET` of at least 32 characters.
2. For the one-time Manager bootstrap, configure `CALLFLOW_BOOTSTRAP_TOKEN` (at least 32 random characters) and `BOOTSTRAP_MANAGER_EMAIL`.
3. Open `/setup-manager`, enter the configured email, Manager name, bootstrap token, and a password of at least 14 characters.
4. After the Manager account is created, remove `CALLFLOW_BOOTSTRAP_TOKEN` and `BOOTSTRAP_MANAGER_EMAIL` from the deployed environment and redeploy.
5. Sign in from the CallFlow home page. A session is stored in an HTTP-only, SameSite=Strict cookie.

The development-only fixed Manager identity is enabled only when `NODE_ENV=development`. Deployed Vercel Preview and production environments require a real session; Preview deployments do not receive an implicit Manager identity.

Login attempts are throttled using atomic MongoDB counters: 10 attempts per account and 30 per source IP per 15-minute window. Rate-limit identifiers are HMAC-hashed with `SESSION_SECRET`; expired counters are removed by a MongoDB TTL index. No external rate-limiting service is required. Requests without a validated client IP still receive the per-account limit.

Preview demo seeding is disabled by default. To enable it for QA, set `CALLFLOW_PREVIEW_SEED_ENABLED=true` only in the Vercel Preview environment and use a separate MongoDB database whose name ends in `-preview` or `_preview`. The seed endpoint also requires an authenticated Manager session. Never point a preview deployment at the production database.

## Local development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm test
npm run build
```

GitHub Actions starts an ephemeral MongoDB 7 single-node replica set for integration tests. The replica set is isolated to the GitHub runner and uses the `callflow_ci_test` database; it does not access a deployed database. For local integration testing, set `MONGODB_URI` and `MONGODB_DB` to a disposable replica-set database. Without `MONGODB_URI`, the MongoDB integration suite is skipped while unit tests still run.

## Operational boundaries

- MongoDB transactions require a replica set or sharded cluster.
- Use only synthetic data in previews and tests. Never commit credentials, tokens, or real customer/case data.
- Do not treat a successful build or preview deployment as proof of production readiness. Database concurrency, browser workflows, and production configuration must be verified separately.
