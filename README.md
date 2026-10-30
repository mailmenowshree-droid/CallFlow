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

GitHub Actions runs these checks for pull requests and pushes to `main` and `feature/**` branches.

## Operational boundaries

- MongoDB transactions require a replica set or sharded cluster.
- Use only synthetic data in previews and tests. Never commit credentials, tokens, or real customer/case data.
- Do not treat a successful build or preview deployment as proof of end-to-end operational readiness. Database concurrency, browser workflows, and production configuration must be verified separately.
