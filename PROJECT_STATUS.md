# CallFlow Project Status

Last reviewed: 2026-10-17
Repository: https://github.com/mailmenowshree-droid/CallFlow
Default branch: `main`

## Current verified state

- The repository contains a Next.js 14 App Router, React, TypeScript, and Tailwind CSS UI prototype.
- `app/page.tsx` renders a sample operations dashboard, illustrative FE + CRU Events and FTS rotations, a local request form, search, and a Start Call UI action. The request form now accepts case number, date picker, 30-minute time slots displayed in IST, optional notes, and optional manual engineer selection.
- Request records live only in React component state. Refreshing the page loses changes.
- The sample engineers, request IDs, customers, assignment queues, counts, and statuses are demo values; they are not operational data.
- `README.md` explicitly states that authentication, database persistence, transactional round-robin assignment, scheduled reminders, attendance APIs, and WhatsApp integration are not implemented.
- `package.json` contains Next.js/React/Tailwind dependencies. MongoDB driver/ODM and authentication libraries are not present in the declared dependencies.
- A GitHub Actions workflow now checks TypeScript, unit tests, and a production build; the first run is in progress.
- No deployment has been verified as part of this review.
- Repository visibility is public. Never commit secrets, real customer/case data, access tokens, or database connection strings.

## Requirements and implementation status

| Capability | Status | Notes |
|---|---|---|
| Browser dashboard | Prototype present | Uses hard-coded/demo data and local component state |
| Team Lead request entry | Partial prototype | Form accepts case number, assignment type, date, 30-minute IST time slot, optional notes and optional manual engineer; records remain in browser state only |\n| Assignment notes | Prototype present | Optional notes are displayed beside each assignment; not persistent across refreshes |\n| Date/time entry | Prototype present | Native date picker and 48 half-hour time slots displayed in IST; no server-side timezone validation yet |
| Separate FE + CRU Events rotation | UI illustration + pure rule module | Not yet persisted or connected to API |
| Separate FTS rotation | UI illustration + pure rule module | Can use separate rotation state; not yet persisted or connected to API |
| Assignment confirmation | Not implemented | Requires authenticated Team Lead flow and server-side validation |
| Team Lead / Manager / Engineer roles | Not implemented | No authentication or authorization found |
| Engineer availability/scheduling/busy intervals | Not implemented | Dashboard roster is illustrative |
| Engineer availability confirmation | Not implemented | No persisted confirmations |
| Manual skip for next three completed assignments | Pure helper + unit test added | Not yet connected to persistent assignment service; CI result pending |
| Leave excludes engineer for 24 hours | Not implemented | Requires timezone-aware timestamps and server-side eligibility checks |
| Scheduled-call reminders | Not implemented | Requires durable scheduler/worker and notification provider |
| Start Call / Complete Call lifecycle | Partial UI | Start Call only updates local state; completion action/persistence is absent |
| Attendance check-in/check-out | Not implemented | No APIs, authorized correction flow, or audit trail |
| WhatsApp notifications | Not implemented | Provider, templates, consent/configuration, retry handling TBD |
| Reporting, exports, operational dashboards | Partial UI only | Current numbers are computed from in-memory demo data |
| MongoDB Atlas persistence | Not implemented | No MongoDB dependency or database layer found |
| Atomic/concurrency-safe assignments | Not implemented | Pure selection logic only; persistence and atomic pointer updates still required |
| Automated tests / CI | Not found | No workflow files or workflow runs were found |
| Vercel deployment | Unverified | Do not claim deployment success until a live deployment is checked |

## Architecture and safety decisions

1. CallFlow is independent from Defendex and JARVIS. Do not change either project while working on CallFlow.
2. Keep CallFlow database, credentials, environment variables, deployment configuration, and integrations separate.
3. Never trust client-supplied assignment state. Eligibility checks, round-robin pointer updates, assignment creation, skip counters, and audit records must be enforced on the server.
4. FE and CRU Events share one persistent rotation; FTS has a separate persistent rotation.
5. Team Lead manually enters requests and reviews/confirms proposed assignments.
6. A manual skip bypasses the engineer for the next three **completed assignments**. Define counter decrement semantics explicitly in tests; cancelled or merely scheduled calls must not decrement the counter.
7. Leave excludes an engineer for 24 hours from the recorded leave start/decision time, using UTC storage and clearly displayed local time.
8. Privileged changes (attendance corrections, skip/leave changes, manual reassignment) require role checks, a reason where appropriate, and append-only audit history.
9. The public repository must contain only code and safe synthetic data. Store secrets in deployment environment settings, never in source or commit history.

## Risks / blockers

- The current dashboard can visually imply live assignment state, but it is demo-only.
- The Start Call action only mutates browser state and has no authorization, durable state, or audit trail.
- The current `lint` script uses `next lint`; compatibility must be checked against the installed Next.js version and a clean install.
- There is no verified build/test result or verified Vercel deployment in this review.
- No database schema, environment-variable contract, authentication strategy, notification provider, or scheduler has been implemented yet.

## Recommended next actions

1. Finish the first GitHub Actions run for dependency installation, TypeScript check, unit tests, and production build; fix any failures before merging.
2. Design and implement MongoDB persistence and authentication/role authorization before presenting the app as operational.
3. Implement the atomic assignment domain service with two distinct rotations and automated tests for concurrent requests, eligibility, three-completed-assignment skip counters, and 24-hour leave exclusion.
4. Connect the Team Lead request and assignment-confirmation flow to server APIs, then implement call lifecycle and immutable audit events.
5. Add engineer scheduling/availability, attendance with authorized corrections, reporting/exports, reminders, and WhatsApp notifications in separately tested increments.
6. Verify a Vercel deployment and end-to-end workflows only after the build and integration checks pass.

## Validation log

- 2026-10-17: Reviewed repository metadata, README, package manifest, UI files, TypeScript configuration, and Tailwind configuration through the GitHub connector.
- 2026-10-17: Added a pure round-robin domain module and Vitest coverage for rotation order, overlapping busy intervals, inactive/leave eligibility, three-completion skip cooldown, and no-eligible behavior.
- 2026-10-17: Added GitHub Actions validation. An earlier run (38984052380) passed TypeScript and unit tests; production build status was not conclusively verified here. Later UI commits still need fresh CI confirmation.\n- 2026-10-17: Added optional assignment notes and updated the TL request form to use case number, date picker, 30-minute time slots displayed in IST, and show scheduled date in the assignments list. These changes are committed to `feature/validation-baseline`; fresh CI has not yet been verified.
- Not run locally: install, TypeScript check, unit tests, or production build. CI has passed TypeScript and unit tests; production build is still pending. Database tests, browser end-to-end tests, and live deployment verification have not been run.
