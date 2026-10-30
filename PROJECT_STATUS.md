# CallFlow Project Status

Last reviewed: 2026-10-30  
Repository: https://github.com/mailmenowshree-droid/CallFlow  
Baseline: feature/mongodb-foundation  
Working branch: feature/attendance-state-regression  
PR #3: https://github.com/mailmenowshree-droid/CallFlow/pull/3 (draft, unmerged)  
PR #4: https://github.com/mailmenowshree-droid/CallFlow/pull/4 (stacked on PR #3; draft, unmerged)

## Latest verified CI

- Commit: 83a6c13bf72d21f81c420861bec153e3154f54d3
- Workflow run #338: https://github.com/mailmenowshree-droid/CallFlow/actions/runs/41082822516
- npm ci: passed using the committed lockfile
- npm audit: 0 vulnerabilities (0 info, low, moderate, high, or critical)
- TypeScript typecheck: passed
- ESLint: passed
- Vitest: 75 tests passed across 15 files
- MongoDB 7 replica-set integration tests: passed
- Production build: passed
- Production HTTP API end-to-end smoke test: passed
- Production Chromium browser regression: passed
- Browser regression covers Manager bootstrap/login, Engineer and Team Lead provisioning/login, role-specific UI, assignment lifecycle, report CSV download, WFH attendance, leave approval/cancellation, and logout.
- CI uses an ephemeral MongoDB replica set and synthetic accounts. No deployed database is used.
- Playwright 1.56.1 and Chromium are installed ephemerally by CI; Playwright is not an application dependency.

## Current implementation inventory

| Capability | Implementation | Verification boundary |
|---|---|---|
| Dashboard and assignment UI | Present | Production browser regression covers Manager, Team Lead, and Engineer sign-in, assignment lifecycle, role-specific controls, and CSV download; not every UI state is covered |
| MongoDB persistence | Server-side driver, indexes, transactional services | CI uses a disposable replica set; deployed database configuration is not verified |
| Authentication | Manager bootstrap, bcrypt hashes, login/logout, signed HTTP-only sessions, active-user lookup | Unit tests, HTTP smoke test, and browser sign-in/logout pass; real Preview login remains unverified |
| Login rate limiting | Atomic MongoDB account/IP windows, HMAC identifiers, TTL cleanup | Unit and MongoDB integration tests pass |
| Role authorization | Manager/Team Lead privileged APIs; Engineer self-service boundaries | HTTP tests cover unauthenticated access and Engineer restrictions; browser tests verify Manager, Team Lead, and Engineer UI boundaries; SSE and the full route matrix remain outstanding |
| Engineer/team management | User creation, engineer roster, queue membership and audit records | Browser tests cover Manager provisioning of Engineer and Team Lead accounts; MongoDB route tests cover creation and queue membership; complete Engineer PATCH and SSE role coverage remain outstanding |
| Round-robin assignment | Transactional FE/CRU/Event and FTS queues, overlap prevention | Concurrent MongoDB assignment and skip tests pass |
| Assignment lifecycle | Transactional status changes and completion counters | MongoDB race tests, HTTP smoke test, and browser status transitions pass |
| Attendance | Check-in/check-out state guards; attendance and audit events in one transaction | Route integration tests cover invalid/duplicate transitions and concurrent Office/WFH check-ins and check-outs; browser test verifies Engineer WFH check-in |
| WFH quota | Quarterly accrual, per-engineer reservation serialization, same-day duplicate prevention | MongoDB concurrency tests and HTTP smoke test pass |
| Leave and capacity | Transactional requests, approvals/rejections/cancellation, per-day capacity locks | MongoDB concurrent capacity tests, HTTP smoke test, and browser approval/cancellation flow pass |
| Reporting and CSV | Report API, dashboard CSV export, CSV quoting and formula-injection neutralization | Report API smoke test, CSV unit tests, and browser download/content verification pass |
| Automated checks | GitHub Actions: install, audit report, typecheck, lint, unit/integration tests, build, HTTP E2E, browser E2E | Run #338 passed |

## Security and operational notes

- A committed npm lockfile is present; CI uses npm ci.
- The latest audit reports zero dependency vulnerabilities.
- Playwright is pinned to 1.56.1 in the CI workflow and installed ephemerally; it is not added to the application dependency graph or lockfile.
- MongoDB transactions require a replica set or sharded cluster.
- Tests use synthetic accounts and records. Never commit secrets or real customer/case data.
- No production deployment, merge, billing change, or paid-service activation was performed.

## Remaining verification and blockers

1. Expand the authorization matrix to cover SSE and the remaining role/route combinations; add dedicated Engineer PATCH integration coverage.
2. Verify a real Vercel Preview login against a dedicated Preview database and configured Manager account. This requires Preview environment setup and Manager credentials; no Preview credentials or settings were changed.
3. Verify production environment configuration and deployment only after explicit approval. This branch has not been deployed to production.

## Latest changes in this branch

- Added a production Chromium browser regression using Playwright, installed only in the CI runner.
- Browser regression exercises the rendered Manager setup/login flow, Manager account provisioning, Team Lead reporting access, Engineer restrictions, assignment status transitions, actual CSV download contents, WFH check-in, leave approval/cancellation, and logout.
- The first browser run exposed a strict-mode selector ambiguity between a status pill and its matching select option. The selector was narrowed to the status pill; the corrected browser regression passed in run #338.
- Added MongoDB route tests for engineer creation, atomic FE/FTS queue membership, invalid SSE queue access, Engineer mutation denial, and Team Lead queue updates.
- Enforced attendance state transitions: duplicate check-in and check-out without an active check-in return HTTP 409. The conditional MongoDB update is in the same transaction as attendance and audit events.
- Added MongoDB route tests for invalid transitions, duplicate check-in, concurrent Office check-ins, concurrent WFH check-ins, and concurrent check-outs.
- Added a production HTTP smoke test covering Manager bootstrap/login, Engineer provisioning/login, role restrictions, assignment lifecycle, WFH attendance, leave review/cancellation, reporting, and logout.
- Extracted CSV generation into a pure helper and neutralized spreadsheet formula-like values; added CSV quoting and injection regression tests.
