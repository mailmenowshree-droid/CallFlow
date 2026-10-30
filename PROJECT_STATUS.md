# CallFlow Project Status

Last reviewed: 2026-10-30  
Repository: https://github.com/mailmenowshree-droid/CallFlow  
Working branch: `feature/agent-preview-seed-type-fix`  
Baseline: `feature/mongodb-foundation`

## Current implementation inventory

| Capability | Code present | Verification boundary |
|---|---|---|
| Dashboard and assignment UI | Yes | Browser end-to-end workflows not yet verified |
| MongoDB persistence | Yes | Requires configured replica-set deployment for transaction tests |
| Authentication | Manager bootstrap, bcrypt password hashes, JWT session cookie, login/logout endpoints, and session lookup | CI passed on commit `196f686`; real deployed login flow not yet verified |
| Login rate limiting | MongoDB-backed atomic account/IP windows with HMAC identifiers and TTL cleanup | Unit tests and CI passed on commit `196f686`; live MongoDB behavior not yet verified |
| Preview access control | Deployed previews require a real session; fixed Manager identity is local-development-only | Must verify Vercel Preview environment and configured secrets |
| Role authorization | API routes enforce role checks for privileged operations | Route-level authorization tests remain incomplete |
| Engineer/team management | API and dashboard flows present | Database integration and role-matrix tests remain incomplete |
| Round-robin assignment | Transactional assignment service with separate FE/CRU/Event and FTS rotations | Concurrent MongoDB transaction tests remain incomplete |
| Assignment lifecycle | Transactional status transitions and completion counters | Database integration and race tests remain incomplete |
| Attendance and WFH quota | Attendance API, audit events, and quarterly quota reservation service | Live quota concurrency and end-to-end checks remain incomplete |
| Leave requests and capacity | Transactional requests, per-day reservation documents, approval/cancellation routes | Concurrent capacity tests remain incomplete |
| Reporting and CSV export | Report API and dashboard export UI | Browser/export regression tests remain incomplete |
| Automated checks | GitHub Actions typecheck, unit tests, and production build | Must pass on the latest PR head |

## Security and dependency notes

- Do not commit secrets, real customer records, or production case data.
- The repository currently has no committed npm lockfile. Dependency resolution is therefore not reproducible across installs.
- CI uses `npm install`; the latest install reported 8 dependency vulnerabilities (3 moderate, 2 high, 3 critical). The exact advisory set has not yet been audited; do not apply broad or major-version upgrades without a fresh audit and compatibility checks.
- MongoDB transaction features require a replica set or sharded cluster.
- Preview seeding requires an authenticated Manager, an explicit enable flag, and a separate database name ending in `-preview` or `_preview`; it is disabled by default.

## Next work

1. Verify the latest PR head's typecheck, unit tests, and production build.
2. Add route-level tests for authentication, role authorization, and session expiry.
3. Add MongoDB integration tests for concurrent assignment, skip, leave-capacity, attendance, and WFH quota operations when a free test replica set is available.
4. Add browser end-to-end coverage for sign-in, role-specific screens, assignment lifecycle, leave, attendance, and report export.
5. Document and verify preview and production environment configuration without deploying or changing production settings.

## Latest change

- Added database-backed login throttling with atomic fixed-window counters, account and validated source-IP limits, HMAC-hashed identifiers, and TTL cleanup. CI passed on commit `196f686`: typecheck, 39 unit tests, and production build.
- Changed rotation skip into a MongoDB transaction that serializes against assignment and completion writes and commits the engineer cooldown with its audit event.
- Added unit coverage for skip candidate eligibility and queue isolation. The new transaction change remains unverified until CI and a live replica-set test run.
