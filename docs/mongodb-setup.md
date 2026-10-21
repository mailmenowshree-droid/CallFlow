# MongoDB setup

CallFlow uses the official MongoDB Node.js driver. The application connects only from server-side code.

## Environment variables

Set these in the deployment platform's encrypted environment-variable settings (Production and Preview as appropriate):

- `MONGODB_URI`: the Atlas connection URI for the least-privileged application user. Never commit this value or paste it into issues/chat.
- `MONGODB_DB`: optional database name; defaults to `callflow`.

Do not use an Atlas administrator account. Do not allow all IPs (`0.0.0.0/0`) just to make connectivity work. Atlas network access must permit the deployment's actual egress path; confirm the provider's current egress guidance before changing allowlists.

## Verify connectivity

After configuring the variables and redeploying, request `/api/health/database`.

- HTTP 200 with `{"status":"connected","database":"callflow"}` means the application can ping MongoDB.
- HTTP 503 with `not_configured` means `MONGODB_URI` is absent from that deployment environment.
- HTTP 503 with `unavailable` means the server could not connect. The endpoint intentionally hides driver errors and secrets; inspect server logs privately to troubleshoot.

This endpoint verifies connectivity only. It does not mean authentication, assignment APIs, or the full production workflow is complete.

## Authentication foundation

CallFlow now has a server-side password login foundation:

- User accounts are stored in the `users` collection with bcrypt password hashes.
- Sessions are signed with `SESSION_SECRET` and stored in an HTTP-only, SameSite=Strict cookie; production cookies are Secure.
- There is no public self-registration endpoint.
- `/api/auth/me` returns the current session; `/api/auth/logout` clears the cookie.
- `/api/auth/login` accepts JSON with `email` and `password`.

Set `SESSION_SECRET` in the CallFlow Vercel project's encrypted environment variables to a cryptographically random value of at least 32 characters. Never reuse a secret from another application.

### Create the initial Manager account

Run this one-time script from a trusted local environment after installing dependencies. Set `MONGODB_URI`, `MONGODB_DB` (optional), `BOOTSTRAP_MANAGER_EMAIL`, and a strong `BOOTSTRAP_MANAGER_PASSWORD` of at least 14 characters as local environment variables, then run:

```bash
node scripts/bootstrap-manager.mjs
```

The script refuses to overwrite an existing account. Do not put the bootstrap password in source control or in Vercel; remove it from your shell environment after use. The database URI should be restricted to the CallFlow application user.

Authentication is a foundation only: the existing prototype dashboard is not yet wired to login, and operational assignment APIs are not enabled. Do not use this branch for live customer operations until authorization is applied to every data endpoint and the complete workflow is tested.
