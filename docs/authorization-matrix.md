# CallFlow Authorization Matrix

Reviewed: 2026-10-31  
Baseline: `feature/mongodb-foundation`  
Current implementation under review: PR #6, stacked on PR #5, PR #4, and PR #3.

This document records the server-side access rules. UI visibility is a usability layer only; route handlers enforce authorization independently.

## Session and operational endpoints

| Endpoint | Access rule |
|---|---|
| `POST /api/auth/bootstrap` | Public one-time setup guarded by a configured Bearer token (minimum 32 characters), configured Manager email, and the absence of an existing Manager. Creates the Manager login and linked team profile in one transaction. |
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
| `PATCH /api/leaves/{id}` | Approve/reject another person’s pending request; cancel any pending/approved request | Approve/reject another person’s pending request; cancel own pending/approved request | Cancel own pending/approved request only | Same |
| `GET /api/reports` | Allowed | Allowed | Denied | Denied |
| `POST /api/rotations/skip` | Allowed | Allowed | Denied | Denied |
| `POST /api/users` | Create login accounts and linked team profiles for supported roles | Denied | Denied | Denied |

Additional constraints:

- Only Engineer profiles may join automatic FE/CRU/Event or FTS rotations. SSE is manual-assignment only. Team Lead and Manager profiles are not rotation members.
- Team Lead roster creation and edits are limited to Engineer/SSE. The UI hides privileged role choices and privileged-profile mutation controls; server checks remain authoritative.
- Assignment updates are restricted to the assigned Engineer/SSE unless the actor is a Team Lead or Manager. The lifecycle service rejects invalid transitions and commits the audit event and completion counter in the same transaction.
- Attendance changes by Engineer/SSE are self-scoped. Team Leads/Managers may record attendance for a selected active team profile. WFH quota reservation, attendance state, attendance event, and audit event are transactional.
- Leave review is limited to Manager/Team Lead and pending requests belonging to another person. Self-approval and self-rejection are forbidden for both Manager and Team Lead. Only the owner can cancel their own request, except a Manager can cancel any pending/approved request.
- Initial Manager bootstrap and Manager account provisioning create an `EngineerRecord` with the same id/email as the login for every role. This allows Manager and Team Lead accounts to use their own attendance and leave flows; only Engineer profiles can join automatic rotations.
- Accounts created before this linked-profile behavior are not automatically backfilled. Existing Manager/Team Lead records must be checked in the target database; if profiles are missing, perform an approved additive backfill. No existing database was accessed or modified.
- Temporary rotation leave exclusion is Manager/Team Lead only; the roster update and audit event now commit in one MongoDB transaction.
- Engineer roster role/name/active changes synchronize to the matching login account in one transaction. Concurrent demotion/deactivation is serialized so at least one active Manager remains.

## Automated evidence

- `tests/mongodb-integration.test.ts` covers Manager/Team Lead restrictions, linked privileged team profiles, self-approval denial at the leave route, Team Lead privilege escalation denial, SSE self-scoped roster/assignment/leave reads, own-assignment lifecycle updates, forbidden administrative actions, attendance transitions/concurrency, WFH quota concurrency, leave capacity/review, and temporary leave-exclusion authorization/auditing.
- PR #6 adds MongoDB-backed negative coverage for Engineer/SSE denial across team management, rotation exclusions, assignment creation, rotation skip, reporting, and preview seeding; Team Lead/Engineer/SSE denial for login provisioning; self-scoped versus team-wide reads; cross-user assignment/attendance/leave mutation denial; Manager/Team Lead team attendance; and linked Manager/SSE leave self-service.
- `tests/auth-session.test.ts` covers signed session validation, expiry/tampering, and inactive-user rejection.
- `scripts/e2e-browser.mjs` exercises Manager bootstrap/login, linked Manager/Team Lead profiles, Manager account provisioning, Team Lead login/report access and own leave submission/cancellation without self-review controls, Engineer login/self-service, assignment lifecycle, attendance, leave approval, CSV download/content, logout, and the Team Lead roster role-control boundaries.
- GitHub Actions run #371 passed on PR #6 merge commit `26678d42aba01544ca54f0d0866f5ddffa87aef8` (head commit `5ec4145fb06556ee825c41dfd43a40f5ac53fd8a`): `npm ci`, npm audit (0 vulnerabilities), typecheck, ESLint, 86 tests across 15 files, production build, production HTTP E2E, and Chromium browser E2E.

## Remaining verification boundaries

- The route matrix now has broader negative tests, but it is not exhaustive automated coverage of every role/route pair. Review remaining route/role combinations before production.
- Real Vercel Preview login has not been verified. It requires a dedicated Preview MongoDB database and a configured Manager test account/credentials.
- Existing Manager/Team Lead accounts created before linked-profile provisioning may lack matching `EngineerRecord` rows. Verify the Preview database and approve an additive profile backfill if needed before testing their leave/attendance flows.
- Production environment configuration and production deployment have not been verified or performed. Deployment requires explicit approval.
