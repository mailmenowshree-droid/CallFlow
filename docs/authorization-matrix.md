# CallFlow Authorization Matrix

Reviewed: 2026-10-30  
Baseline: `feature/mongodb-foundation`  
Current implementation under review: PR #5, stacked on PR #4 and PR #3.

This document records the server-side access rules. UI visibility is a usability layer only; route handlers enforce authorization independently.

## Session and operational endpoints

| Endpoint | Access rule |
|---|---|
| `POST /api/auth/bootstrap` | Public one-time setup guarded by a configured Bearer token (minimum 32 characters), configured Manager email, and the absence of an existing Manager. |
| `POST /api/auth/login` | Public. Requires valid credentials for an active account; account and validated source-IP attempts are rate-limited. |
| `POST /api/auth/logout` | Public and idempotent; clears the HTTP-only session cookie. |
| `GET /api/auth/me` | Public session probe; returns the database-backed active user or 401. |
| `GET /api/health/database` | Public readiness check. Exposes connection/index status and configured database name, not credentials or the connection URI. |
| `POST /api/preview/seed` | Manager session plus Vercel Preview, explicit enable flag, and a database name ending in `-preview` or `_preview`. Adds synthetic records idempotently; does not delete records. |

Session authorization is revalidated against the active user record on each request. The role in the database, not a stale role claim in the signed token, is authoritative. The fixed Manager identity is restricted to local development.

## Business API matrix

| Endpoint | Manager | Team Lead | Engineer | SSE |
|---|---|---|---|---|
| `GET /api/engineers` | All profiles | All profiles | Own profile | Own profile |
| `POST /api/engineers` | Create any supported profile role | Create Engineer/SSE only | Denied | Denied |
| `PATCH /api/engineers/{id}` | Manage profiles; final active Manager cannot be removed | Manage Engineer/SSE profiles only; cannot edit privileged profiles or promote roles | Denied | Denied |
| `POST /api/engineers/{id}/leave` | Start/clear 24-hour rotation exclusion for a team member | Same | Denied | Denied |
| `GET /api/assignments` | All assignments | All assignments | Own assignments | Own assignments |
| `POST /api/assignments` | Create automatic or manual assignments | Same | Denied | Denied |
| `PATCH /api/assignments/{id}` | Update any assignment through allowed lifecycle transitions | Same | Own assignments only | Own assignments only |
| `POST /api/attendance` | Record attendance for any active team profile | Same | Own attendance only | Own attendance only |
| `GET /api/leaves` | All leave requests | All leave requests | Own requests | Own requests |
| `POST /api/leaves` | Own request, if an active team profile exists | Own request, if an active team profile exists | Own request, if an active team profile exists | Own request, if an active team profile exists |
| `PATCH /api/leaves/{id}` | Approve/reject pending requests; cancel any pending/approved request | Approve/reject pending requests; cancel own pending/approved request | Cancel own pending/approved request only | Same |
| `GET /api/reports` | Allowed | Allowed | Denied | Denied |
| `POST /api/rotations/skip` | Allowed | Allowed | Denied | Denied |
| `POST /api/users` | Create login accounts | Denied | Denied | Denied |

Additional constraints:

- Only Engineer profiles may join automatic FE/CRU/Event or FTS rotations. SSE is manual-assignment only. Team Lead and Manager profiles are not rotation members.
- Team Lead roster creation and edits are limited to Engineer/SSE. The UI hides privileged role choices and privileged-profile mutation controls; server checks remain authoritative.
- Assignment updates are restricted to the assigned Engineer/SSE unless the actor is a Team Lead or Manager. The lifecycle service rejects invalid transitions and commits the audit event and completion counter in the same transaction.
- Attendance changes by Engineer/SSE are self-scoped. Team Leads/Managers may record attendance for a selected active team profile. WFH quota reservation, attendance state, attendance event, and audit event are transactional.
- Leave review is limited to Manager/Team Lead and pending requests. Only the owner can cancel their own request, except a Manager can cancel any pending/approved request.
- Temporary rotation leave exclusion is Manager/Team Lead only; the roster update and audit event now commit in one MongoDB transaction.
- Engineer roster role/name/active changes synchronize to the matching login account in one transaction. Concurrent demotion/deactivation is serialized so at least one active Manager remains.

## Automated evidence

- `tests/mongodb-integration.test.ts` covers Manager/Team Lead restrictions, Team Lead privilege escalation denial, SSE self-scoped roster/assignment/leave reads, own-assignment lifecycle updates, forbidden administrative actions, attendance transitions/concurrency, WFH quota concurrency, leave capacity/review, and temporary leave-exclusion authorization/auditing.
- `tests/auth-session.test.ts` covers signed session validation, expiry/tampering, and inactive-user rejection.
- `scripts/e2e-browser.mjs` exercises Manager bootstrap/login, Manager account provisioning, Team Lead login/report access, Engineer login/self-service, assignment lifecycle, attendance, leave, CSV download/content, logout, and the Team Lead roster role-control boundaries.
- GitHub Actions run #353 passed on commit `0d6437959054651b69dac5cb36e74fe7a85eadf1`: `npm ci`, npm audit (0 vulnerabilities), typecheck, ESLint, 78 tests across 15 files, production build, HTTP E2E, and Chromium browser E2E.

## Remaining verification boundaries

- This is a reviewed route matrix, not exhaustive automated coverage of every role/route pair. Critical allow/deny boundaries are tested; additional pairwise negative tests may still be warranted before production.
- Real Vercel Preview login has not been verified. It requires a dedicated Preview MongoDB database and a configured Manager test account/credentials.
- Production environment configuration and production deployment have not been verified or performed. Deployment requires explicit approval.
