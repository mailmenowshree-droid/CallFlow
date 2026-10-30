import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.CALLFLOW_E2E_PORT ?? 4317);
const baseUrl = `http://127.0.0.1:${port}`;
const bootstrapToken = "callflow-e2e-bootstrap-token-2026";
const managerEmail = "manager@callflow.test";
const managerPassword = "CallFlow-E2E-Manager-2026!";
const engineerEmail = "engineer@callflow.test";
const engineerPassword = "CallFlow-E2E-Engineer-2026!";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must point to the ephemeral CI replica set.");
}

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      MONGODB_DB: `callflow_e2e_${process.pid}`,
      CALLFLOW_BOOTSTRAP_TOKEN: bootstrapToken,
      BOOTSTRAP_MANAGER_EMAIL: managerEmail,
      SESSION_SECRET: "callflow-e2e-session-secret-2026-10-30-more-than-32-characters",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
child.stdout.setEncoding("utf8").on("data", (chunk) => { serverOutput = (serverOutput + chunk).slice(-5000); });
child.stderr.setEncoding("utf8").on("data", (chunk) => { serverOutput = (serverOutput + chunk).slice(-5000); });

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  const value = values.find((item) => item.startsWith("callflow_session="));
  assert.ok(value, "Expected the API to set the CallFlow session cookie.");
  return value.split(";")[0];
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await fetch(baseUrl + path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { response, data };
}

function expectStatus(result, expected, label) {
  assert.equal(
    result.response.status,
    expected,
    `${label}: expected HTTP ${expected}, received ${result.response.status}: ${JSON.stringify(result.data)}`,
  );
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before becoming ready.\n${serverOutput}`);
    try {
      const result = await api("/api/health/database");
      if (result.response.status === 200 && result.data?.status === "connected") return;
    } catch {
      // The server is still starting.
    }
    await delay(500);
  }
  throw new Error(`Next.js did not become ready within 30 seconds.\n${serverOutput}`);
}

try {
  await waitForServer();

  expectStatus(await api("/api/auth/me"), 401, "Unauthenticated session lookup");
  expectStatus(await api("/api/engineers"), 401, "Unauthenticated team access");

  const bootstrap = await api("/api/auth/bootstrap", {
    method: "POST",
    headers: { authorization: `Bearer ${bootstrapToken}` },
    body: { name: "CI Manager", email: managerEmail, password: managerPassword },
  });
  expectStatus(bootstrap, 201, "Initial Manager bootstrap");

  expectStatus(await api("/api/auth/bootstrap", {
    method: "POST",
    headers: { authorization: `Bearer ${bootstrapToken}` },
    body: { name: "Duplicate Manager", email: managerEmail, password: managerPassword },
  }), 409, "One-time Manager bootstrap");

  const managerLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: managerEmail, password: managerPassword },
  });
  expectStatus(managerLogin, 200, "Manager login");
  const managerCookie = sessionCookie(managerLogin.response);

  const managerMe = await api("/api/auth/me", { cookie: managerCookie });
  expectStatus(managerMe, 200, "Manager session lookup");
  assert.equal(managerMe.data.user.role, "Manager");

  const createdUser = await api("/api/users", {
    method: "POST",
    cookie: managerCookie,
    body: {
      name: "CI Engineer",
      email: engineerEmail,
      password: engineerPassword,
      role: "Engineer",
      callQueue: true,
      ftsQueue: true,
    },
  });
  expectStatus(createdUser, 201, "Manager creates Engineer account");
  const engineerId = createdUser.data.user.id;

  const engineerLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: engineerEmail, password: engineerPassword },
  });
  expectStatus(engineerLogin, 200, "Engineer login");
  const engineerCookie = sessionCookie(engineerLogin.response);

  const team = await api("/api/engineers", { cookie: managerCookie });
  expectStatus(team, 200, "Manager team roster");
  assert.ok(team.data.engineers.some((engineer) => engineer.id === engineerId));

  expectStatus(await api("/api/reports?start=2026-11-02&end=2026-11-02", {
    cookie: engineerCookie,
  }), 403, "Engineer report access restriction");

  expectStatus(await api("/api/assignments", {
    method: "POST",
    cookie: engineerCookie,
    body: { kind: "FE", caseNumber: "E2E-FORBIDDEN", scheduledStartAt: "2026-11-02T10:00:00+05:30" },
  }), 403, "Engineer assignment creation restriction");

  const createdAssignment = await api("/api/assignments", {
    method: "POST",
    cookie: managerCookie,
    body: {
      kind: "FE",
      caseNumber: "E2E-1001",
      scheduledStartAt: "2026-11-02T10:00:00+05:30",
      notes: "Synthetic CI end-to-end assignment",
    },
  });
  expectStatus(createdAssignment, 201, "Manager round-robin assignment");
  const assignment = createdAssignment.data.assignment;
  assert.equal(assignment.engineerId, engineerId);

  expectStatus(await api(`/api/assignments/${assignment.id}`, {
    method: "PATCH",
    cookie: engineerCookie,
    body: { status: "In Progress" },
  }), 200, "Engineer starts assigned work");

  expectStatus(await api(`/api/assignments/${assignment.id}`, {
    method: "PATCH",
    cookie: engineerCookie,
    body: { status: "Completed" },
  }), 200, "Engineer completes assigned work");

  expectStatus(await api("/api/attendance", {
    method: "POST",
    cookie: engineerCookie,
    body: { action: "check-in", workMode: "WFH" },
  }), 200, "WFH check-in");

  expectStatus(await api("/api/attendance", {
    method: "POST",
    cookie: engineerCookie,
    body: { action: "check-in", workMode: "WFH" },
  }), 409, "Duplicate WFH check-in");

  expectStatus(await api("/api/attendance", {
    method: "POST",
    cookie: engineerCookie,
    body: { action: "check-out" },
  }), 200, "Attendance check-out");

  const leave = await api("/api/leaves", {
    method: "POST",
    cookie: engineerCookie,
    body: { startDate: "2026-11-10", endDate: "2026-11-10", reason: "Synthetic CI end-to-end leave" },
  });
  expectStatus(leave, 201, "Engineer submits leave");
  expectStatus(await api(`/api/leaves/${leave.data.leave.id}`, {
    method: "PATCH",
    cookie: managerCookie,
    body: { status: "Approved" },
  }), 200, "Manager approves leave");
  expectStatus(await api(`/api/leaves/${leave.data.leave.id}`, {
    method: "PATCH",
    cookie: engineerCookie,
    body: { status: "Cancelled" },
  }), 200, "Engineer cancels approved leave");

  const report = await api("/api/reports?start=2026-11-02&end=2026-11-02", {
    cookie: managerCookie,
  });
  expectStatus(report, 200, "Manager report access");
  assert.equal(report.data.counts.completed, 1);
  assert.ok(report.data.rows.some((row) => row.id === assignment.id && row.status === "Completed"));

  const logout = await api("/api/auth/logout", { method: "POST", cookie: engineerCookie });
  expectStatus(logout, 200, "Engineer logout");
  const clearedCookie = sessionCookie(logout.response);
  expectStatus(await api("/api/auth/me", { cookie: clearedCookie }), 401, "Session invalidation after logout");

  console.log("CallFlow API E2E passed: bootstrap, login, session/RBAC, team provisioning, assignment lifecycle, WFH attendance, leave review/cancellation, reporting, and logout.");
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
