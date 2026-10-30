# CallFlow Project Status

Last reviewed: 2026-10-30  
Repository: https://github.com/mailmenowshree-droid/CallFlow  
Baseline: `feature/mongodb-foundation`  
Working branch: `feature/team-lead-role-ui-guards`  
PR #3: https://github.com/mailmenowshree-droid/CallFlow/pull/3 (draft, unmerged)  
PR #4: https://github.com/mailmenowshree-droid/CallFlow/pull/4 (stacked on PR #3; draft, unmerged)  
PR #5: https://github.com/mailmenowshree-droid/CallFlow/pull/5 (stacked on PR #4; draft, unmerged)

## Latest verified CI

- Commit: `ba43938066c16ce733c6d403c555cc469f8f7cd0`
- Workflow run #366: https://github.com/mailmenowshree-droid/CallFlow/actions/runs/41109136019
- `npm ci`: passed using the committed lockfile
- `npm audit`: 0 vulnerabilities
- TypeScript typecheck: passed
- ESLint: passed
- Vitest: 82 tests passed across 15 files
- MongoDB 7 replica-set integration tests: passed
- Production build: passed
- Production HTTP API end-to-end smoke test: passed
- Production Chromium browser regression: passed, including actual CSV download/content verification, Team Lead role-control assertions, and Team Lead self-service leave without self-review controls
- CI uses an ephemeral MongoDB replica set and synthetic accounts. No deployed database is used.
- Playwright 1.56.1 and Chromium are installed ephemerally by CI; Playwright is not an application dependency.
- The leave/profile/self-review changes were followed by a test assertion correction; run #366 is the passing verification for the final code state.

## Current implementation inventory

| Capability | Implementation | Verification boundary |
|---|---|---|
| Dashboard and assignment UI | Present | Browser regression covers Manager, Team Lead, Engineer sign-in, assignment lifecycle, role-specific controls, and CSV download; not every UI state is covered |
| MongoDB persistence | Server-side driver, indexes, transactional services | CI uses a disposable replica set; deployed database configuration is not verified |
| Authentication | Manager bootstrap, bcrypt hashes, login/logout, signed HTTP-only sessions, active-user lookup, linked team profiles for all login roles | Unit tests, HTTP smoke test, and browser sign-in/logout pass; real Preview login remains unverified |
| Login rate limiting | Atomic MongoDB account/IP windows, HMAC identifiers, TTL cleanup | Unit and MongoDB integration tests pass |
| Role authorization | Manager/Team Lead privileged APIs; Engineer/SSE self-service boundaries; Team Lead privilege limits and no self-review | Route matrix reviewed and documented in [authorization-matrix.md](docs/authorization-matrix.md); critical server-side allow/deny paths and browser controls are tested, but not every role/route pair has an individual test |
| Engineer/team management | User creation, linked team profiles for every role, engineer roster, queue membership, audit records, synchronized account/profile updates | MongoDB tests cover Engineer PATCH, queue membership, Team Lead restrictions, role/name/active synchronization, and protection against removing the final active Manager; browser tests cover Manager bootstrap/provisioning and Team Lead role controls |
| Round-robin assignment | Transactional FE/CRU/Event and FTS queues, overlap prevention | Concurrent MongoDB assignment and skip tests pass |
| Assignment lifecycle | Transactional status changes and completion counters | MongoDB race tests, HTTP smoke test, and browser status transitions pass |
| Attendance | Check-in/check-out state guards; attendance and audit events in one transaction | Route integration tests cover invalid/duplicate transitions and concurrent Office/WFH check-ins and check-outs; browser test verifies Engineer WFH check-in |
| WFH quota | Quarterly accrual, per-engineer reservation serialization, same-day duplicate prevention | MongoDB concurrency tests and HTTP smoke test pass |
| Leave and capacity | Transactional requests, approvals/rejections/cancellation, per-day capacity locks, transactional 24-hour rotation exclusions, reviewer self-approval denied | MongoDB concurrent capacity/review/self-review tests and exclusion-route tests pass; browser covers Team Lead self-submission, Manager approval, and owner cancellation |
| Reporting and CSV | Report API, dashboard CSV export, CSV quoting and formula-injection neutralization | Report API smoke test, CSV unit tests, and browser download/content verification pass |
| Automated checks | GitHub Actions: install, audit report, typecheck, lint, unit/integration tests, build, HTTP E2E, browser E2E | Run #366 passed |

## Security and operational notes

- A committed npm lockfile is present; CI uses `npm ci`.
- The latest audit reports zero dependency vulnerabilities.
- Playwright is pinned to 1.56.1 in the CI workflow and installed ephemerally; it is not added to the application dependency graph or lockfile.
- MongoDB transactions require a replica set or sharded cluster.
- Tests use synthetic accounts and records. Never commit secrets or real customer/case data.
- The public database health endpoint exposes connection/index status and the configured database name only; it does not return credentials or the connection URI.
- No production deployment, merge, billing change, paid-service activation, or configuration change was performed.

## Remaining verification and blockers

1. Verify a real Vercel Preview login against a dedicated Preview database and configured Manager account. This requires Preview database configuration and Manager test credentials; no Preview credentials or settings were changed.
2. Production environment configuration and deployment remain unverified. Any deployment requires explicit approval.
3. The authorization matrix has been reviewed route-by-route, but automated tests do not yet assert every possible role/route pair. Add further pairwise negative tests before treating authorization verification as exhaustive.
4. End-to-end verification against a deployed Preview environment remains outstanding; current HTTP and Chromium E2E use an isolated local production build and ephemeral MongoDB replica set.

## Latest changes in this branch

- Restricted Team Lead roster creation and role editing to Engineer/SSE. Manager/Team Lead profiles render read-only for Team Leads, including queue membership and absence actions.
- Roster role and queue controls reset on sign-in/sign-out; selecting a non-Engineer role clears queue membership and hides rotation controls.
- Extended Chromium E2E to compare Manager and Team Lead role options, verify the session-state reset, and confirm Team Leads cannot mutate a privileged roster profile.
- Made temporary 24-hour rotation leave exclusions transactional: the engineer update and corresponding audit event now commit or roll back together.
- Added MongoDB route tests for Team Lead/Manager exclusion actions and Engineer denial.
- Added [docs/authorization-matrix.md](docs/authorization-matrix.md), documenting all session, operational, and business API access rules plus current verification boundaries.
- Initial Manager bootstrap and Manager-created user accounts now create linked team profiles for all roles, enabling Manager and Team Lead attendance/leave self-service.
- Manager and Team Lead cannot approve or reject their own leave. The UI hides self-review actions; integration and browser tests verify the rule.
- Browser E2E verifies Team Lead leave submission, Manager approval, and Team Lead cancellation.
- GitHub Actions run #366 passed with 82 tests across 15 files, zero npm audit vulnerabilities, typecheck, lint, production build, HTTP E2E, and Chromium browser E2E.
