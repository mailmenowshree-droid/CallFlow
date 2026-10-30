# CallFlow Project Status

Last reviewed: 2026-10-30  
Repository: https://github.com/mailmenowshree-droid/CallFlow  
Baseline: feature/mongodb-foundation  
Working branch: feature/attendance-state-regression  
PR #3: https://github.com/mailmenowshree-droid/CallFlow/pull/3 (draft, unmerged)  
PR #4: https://github.com/mailmenowshree-droid/CallFlow/pull/4 (stacked on PR #3; draft, unmerged)

## Latest verified CI

- Commit: 9debb335bd255fa80658963119b206bc6ab57277
- Workflow run #346: https://github.com/mailmenowshree-droid/CallFlow/actions/runs/41098512053
- `npm ci`: passed using the committed lockfile
- `npm audit`: 0 vulnerabilities
- TypeScript typecheck: passed
- ESLint: passed
- Vitest: 77 tests passed across 15 files
- MongoDB 7 replica-set integration tests: passed
- Production build: passed
- Production HTTP API end-to-end smoke test: passed
- Production Chromium browser regression: passed, including actual CSV download/content verification
- CI uses an ephemeral MongoDB replica set and synthetic accounts. No deployed database is used.
- Playwright 1.56.1 and Chromium are installed ephemerally by CI; Playwright is not an application dependency.

## Current implementation inventory

| Capability | Implementation | Verification boundary |
|---|---|---|
| Dashboard and assignment UI | Present | Production browser regression covers Manager, Team Lead, and Engineer sign-in, assignment lifecycle, role-specific controls, and CSV download; not every UI state is covered |
| MongoDB persistence | Server-side driver, indexes, transactional services | CI uses a disposable replica set; deployed database configuration is not verified |
| Authentication | Manager bootstrap, bcrypt hashes, login/logout, signed HTTP-only sessions, active-user lookup | Unit tests, HTTP smoke test, and browser sign-in/logout pass; real Preview login remains unverified |
| Login rate limiting | Atomic MongoDB account/IP windows, HMAC identifiers, TTL cleanup | Unit and MongoDB integration tests pass |
| Role authorization | Manager/Team Lead privileged APIs; Engineer/SSE self-service boundaries; Team Lead privilege limits | MongoDB tests cover SSE self-scoped roster/assignment/leave reads, own-assignment updates, denied administrative routes, Team Lead restrictions, and Manager role synchronization; a final route-by-route matrix review remains |
| Engineer/team management | User creation, engineer roster, queue membership, audit records, and synchronized account/profile updates | MongoDB tests cover Engineer PATCH, queue membership, Team Lead restrictions, role/name/active synchronization, and protection against removing the final active Manager; browser tests cover Manager provisioning |
| Round-robin assignment | Transactional FE/CRU/Event and FTS queues, overlap prevention | Concurrent MongoDB assignment and skip tests pass |
| Assignment lifecycle | Transactional status changes and completion counters | MongoDB race tests, HTTP smoke test, and browser status transitions pass |
| Attendance | Check-in/check-out state guards; attendance and audit events in one transaction | Route integration tests cover invalid/duplicate transitions and concurrent Office/WFH check-ins and check-outs; browser test verifies Engineer WFH check-in |
| WFH quota | Quarterly accrual, per-engineer reservation serialization, same-day duplicate prevention | MongoDB concurrency tests and HTTP smoke test pass |
| Leave and capacity | Transactional requests, approvals/rejections/cancellation, per-day capacity locks | MongoDB concurrent capacity tests, HTTP smoke test, and browser approval/cancellation flow pass |
| Reporting and CSV | Report API, dashboard CSV export, CSV quoting and formula-injection neutralization | Report API smoke test, CSV unit tests, and browser download/content verification pass |
| Automated checks | GitHub Actions: install, audit report, typecheck, lint, unit/integration tests, build, HTTP E2E, browser E2E | Run #344 passed |

## Security and operational notes

- A committed npm lockfile is present; CI uses npm ci.
- The latest audit reports zero dependency vulnerabilities.
- Playwright is pinned to 1.56.1 in the CI workflow and installed ephemerally; it is not added to the application dependency graph or lockfile.
- MongoDB transactions require a replica set or sharded cluster.
- Tests use synthetic accounts and records. Never commit secrets or real customer/case data.
- No production deployment, merge, billing change, or paid-service activation was performed.

## Remaining verification and blockers

1. Complete a final route-by-route authorization review beyond the role combinations covered by automated tests.
2. Verify a real Vercel Preview login against a dedicated Preview database and configured Manager account. This requires Preview database configuration and Manager credentials; no Preview credentials or settings were changed.
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
- Restricted Team Leads to Engineer/SSE roster management; Team Leads cannot modify privileged profiles or create/promote Team Lead/Manager profiles.
- Synchronized engineer roster name, role, and active changes to matching user accounts in the same MongoDB transaction.
- Added a transactional role-policy lock and active-Manager count check to prevent concurrent demotions/deactivations from removing the final active Manager.
- Added SSE role regression coverage for self-scoped roster, assignment, and leave reads; own-assignment lifecycle updates; and denial of management, reporting, account-creation, rotation-skip, and other-user mutation routes.
- Verified that engineer name, role, and active-state changes synchronize to the matching user account; added protection against concurrent removal of the final active Manager.
- GitHub Actions run #346 passed with 77 tests across 15 files, zero npm audit vulnerabilities, typecheck, lint, production build, HTTP E2E, and Chromium browser E2E.

