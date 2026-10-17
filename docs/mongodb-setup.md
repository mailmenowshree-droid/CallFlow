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
