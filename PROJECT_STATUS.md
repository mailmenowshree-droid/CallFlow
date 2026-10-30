# CallFlow Project Status

Last reviewed: 2026-10-30  
Repository: https://github.com/mailmenowshree-droid/CallFlow  
Baseline: feature/mongodb-foundation  
Working branch: feature/attendance-state-regression  
PR #3: https://github.com/mailmenowshree-droid/CallFlow/pull/3 (draft, unmerged)  
PR #4: https://github.com/mailmenowshree-droid/CallFlow/pull/4 (stacked on PR #3; draft, unmerged)

## Latest verified CI

- Commit: a9ed2697535433734cbcba7772a31ed0f554bfdf
- Workflow run #331: https://github.com/mailmenowshree-droid/CallFlow/actions/runs/41076297999
- npm ci: passed using the committed lockfile
- npm audit: 0 vulnerabilities (0 info, low, moderate, high, or critical)
- TypeScript typecheck: passed
- ESLint: passed
- Vitest: 73 tests passed across 15 files
- MongoDB 7 replica-set integration tests: passed
- Production build: passed
- Production HTTP API end-to-end smoke test: passed
- CI MongoDB is ephemeral and isolated to the GitHub runner. No deployed database is used.

## Current implementation inventory

| Capability | Implementation | Verification boundary |
|---|---|---|
| Dashboard and assignment UI | Present | HTTP workflows are tested; browser-driven UI regression remains outstanding |
| MongoDB persistence | Server-side driver, indexes, transactional services | CI uses a disposable replica set; deployed database configuration is not verified |
| Authentication | Manager bootstrap, bcrypt hashes, login/logout, signed HTTP-only sessions, active-user lookup | Unit tests and production HTTP smoke test pass; real Preview login remains unverified |
| Login rate limiting | Atomic MongoDB account/IP windows, HMAC identifiers, TTL cleanup | Unit and MongoDB integration tests pass |
| Role authorization | Manager/Team Lead privileged APIs; Engineer self-service boundaries | Session tests and HTTP smoke tests cover unauthenticated access and Engineer restrictions; full route matrix remains outstanding |
| Engineer/team management | User creation, engineer roster, queue membership and audit records | Manager creation and roster read covered by HTTP smoke test; PATCH mutation matrix needs more integration coverage |
| Round-robin assignment | Transactional FE/CRU/Event and FTS queues, overlap prevention | Concurrent MongoDB assignment tests pass |
| Assignment lifecycle | Transactional status changes and completion counters | MongoDB race tests and HTTP lifecycle smoke test pass |
| Attendance | Check-in/check-out state guards; attendance and audit events in one transaction | Route integration tests cover invalid/duplicate transitions and concurrent Office/WFH check-ins and check-outs |
| WFH quota | Quarterly accrual, per-engineer reservation serialization, same-day duplicate prevention | MongoDB concurrency tests and HTTP smoke test pass |
| Leave and capacity | Transactional requests, approvals/rejections/cancellation, per-day capacity locks | MongoDB concurrent capacity tests and HTTP smoke test pass |
| Reporting and CSV | Report API, dashboard CSV export, CSV quoting and formula-injection neutralization | Report API smoke test and CSV unit tests pass; browser download interaction remains unverified |
| Automated checks | GitHub Actions: install, audit report, typecheck, lint, tests, build, production HTTP smoke test | Latest run #331 passed |

## Security and operational notes

- A committed npm lockfile is present; CI uses npm ci.
- The latest audit reports zero dependency vulnerabilities.
- CI emits non-blocking toolchain warnings (Vite config-loader compatibility and GitHub Actions Node 20 deprecation notices); these do not fail validation.
- MongoDB transactions require a replica set or sharded cluster.
- Tests use synthetic accounts and records. Never commit secrets or real customer/case data.
- No production deployment, merge, billing change, or paid-service activation was performed.

## Remaining verification

1. Add browser-driven UI regression for sign-in, role-specific navigation, assignment/leave/attendance screens, and the CSV download interaction. The current end-to-end test is HTTP/API-level, not a browser test.
2. Expand engineer PATCH and complete role-matrix integration coverage.
3. Verify a real Vercel Preview login against a dedicated Preview database and configured Manager account. No Preview credentials or environment settings were changed.
4. Verify production environment configuration and deployment only after explicit approval. This branch has not been deployed to production.

## Latest changes in this branch

- Enforced attendance state transitions: duplicate check-in and check-out without an active check-in return HTTP 409. The conditional MongoDB update is in the same transaction as attendance and audit events.
- Added MongoDB route tests for invalid transitions, duplicate check-in, concurrent Office check-ins, concurrent WFH check-ins, and concurrent check-outs.
- Added a production HTTP smoke test covering Manager bootstrap/login, Engineer provisioning/login, role restrictions, assignment lifecycle, WFH attendance, leave approval/cancellation, reporting, and logout.
- Extracted CSV generation into a pure helper and neutralized spreadsheet formula-like values; added CSV quoting and injection regression tests.