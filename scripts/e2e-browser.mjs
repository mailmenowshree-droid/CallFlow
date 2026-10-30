import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const port = Number(process.env.CALLFLOW_BROWSER_E2E_PORT ?? 4318);
const baseUrl = `http://127.0.0.1:${port}`;
const bootstrapToken = "callflow-browser-e2e-bootstrap-token-2026";
const manager = {
  name: "Browser CI Manager",
  email: "browser-manager@callflow.test",
  password: "CallFlow-Browser-Manager-2026!",
};
const engineer = {
  name: "Browser CI Engineer",
  email: "browser-engineer@callflow.test",
  password: "CallFlow-Browser-Engineer-2026!",
};
const teamLead = {
  name: "Browser CI Team Lead",
  email: "browser-team-lead@callflow.test",
  password: "CallFlow-Browser-TeamLead-2026!",
};

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must point to the ephemeral CI replica set.");
}

const futureDate = (days) => {
  const date = new Date(Date.now() + days * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const assignmentDate = futureDate(4);
const leaveDate = futureDate(8);
const assignmentCase = "E2E-BROWSER-1001";
const leaveReason = "Synthetic browser regression leave request";

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      MONGODB_DB: `callflow_browser_e2e_${process.pid}`,
      CALLFLOW_BOOTSTRAP_TOKEN: bootstrapToken,
      BOOTSTRAP_MANAGER_EMAIL: manager.email,
      SESSION_SECRET: "callflow-browser-e2e-session-secret-2026-more-than-32-characters",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
child.stdout.setEncoding("utf8").on("data", (chunk) => {
  serverOutput = (serverOutput + chunk).slice(-6000);
});
child.stderr.setEncoding("utf8").on("data", (chunk) => {
  serverOutput = (serverOutput + chunk).slice(-6000);
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health/database`);
      const data = await response.json();
      if (response.status === 200 && data.status === "connected") return;
    } catch {
      // The server is still starting.
    }
    await delay(500);
  }
  throw new Error(`Next.js did not become ready within 30 seconds.\n${serverOutput}`);
}

async function signIn(page, user) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator(".session-chip").getByText(`${user.name} · ${user.role}`, { exact: true }).waitFor();
}

async function signOut(page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
}

const navigation = (page, label) =>
  page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: label, exact: true });

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // Exercise one-time Manager setup through the rendered form.
  await page.goto(`${baseUrl}/setup-manager`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Manager name").fill(manager.name);
  await page.getByLabel("Manager email").fill(manager.email);
  await page.getByLabel("Temporary setup token").fill(bootstrapToken);
  await page.getByLabel("New password (14+ characters)").fill(manager.password);
  await page.getByLabel("Confirm password").fill(manager.password);
  await page.getByRole("button", { name: "Create Manager account" }).click();
  await page.getByRole("status").filter({ hasText: "Manager account created." }).waitFor();

  // Manager login and account provisioning through the UI.
  await signIn(page, { ...manager, role: "Manager" });
  await navigation(page, "Team").click();
  const managerRoleOptions = await page.locator('.add-member select[aria-label="Role"] option').allTextContents();
  assert.deepEqual(managerRoleOptions, ["Engineer", "SSE", "Team Lead", "Manager"], "Manager can assign all roster roles.");
  const accountPanel = page.locator(".account-panel");
  await accountPanel.getByRole("heading", { name: "Create user access" }).waitFor();

  await accountPanel.getByLabel("Account full name").fill(engineer.name);
  await accountPanel.getByLabel("Work email").fill(engineer.email);
  await accountPanel.getByLabel("Temporary password").fill(engineer.password);
  await accountPanel.getByLabel("Account role").selectOption("Engineer");
  await accountPanel.getByRole("button", { name: "Create account" }).click();
  await page.getByText(`Account created for ${engineer.email}.`, { exact: true }).waitFor();
  assert.deepEqual(
    await page.getByLabel(`Role for ${engineer.name}`).locator("option").allTextContents(),
    ["Engineer", "SSE", "Team Lead", "Manager"],
    "Manager can edit every roster role.",
  );

  await accountPanel.getByLabel("Account full name").fill(teamLead.name);
  await accountPanel.getByLabel("Work email").fill(teamLead.email);
  await accountPanel.getByLabel("Temporary password").fill(teamLead.password);
  await accountPanel.getByLabel("Account role").selectOption("Team Lead");
  await accountPanel.getByRole("button", { name: "Create account" }).click();
  await page.getByText(`Account created for ${teamLead.email}.`, { exact: true }).waitFor();

  // Manager creates and completes a round-robin assignment in the browser.
  await navigation(page, "Assignments").click();
  await page.getByRole("button", { name: "New assignment" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New assignment" });
  await dialog.getByLabel("Case number").fill(assignmentCase);
  await dialog.getByLabel("Date (IST)").fill(assignmentDate);
  await dialog.getByLabel("Time (IST)").selectOption("11:00");
  await dialog.getByRole("button", { name: "Confirm assignment" }).click();

  let assignmentRow = page.getByRole("row").filter({ hasText: assignmentCase });
  await assignmentRow.waitFor();
  await page.getByLabel(`Update status for ${assignmentCase}`).selectOption("In Progress");
  await assignmentRow.locator(".status-pill").filter({ hasText: "In Progress" }).waitFor();
  await page.getByLabel(`Update status for ${assignmentCase}`).selectOption("Completed");
  await assignmentRow.locator(".status-pill").filter({ hasText: "Completed" }).waitFor();

  // Team Lead role controls expose only Engineer/SSE and reset any prior Manager-only selection.
  await navigation(page, "Team").click();
  await page.locator('.add-member select[aria-label="Role"]').selectOption("Manager");
  await signOut(page);
  await signIn(page, { ...teamLead, role: "Team Lead" });
  await navigation(page, "Team").click();
  const teamLeadRoleSelect = page.locator('.add-member select[aria-label="Role"]');
  assert.equal(await teamLeadRoleSelect.inputValue(), "Engineer", "A role selected by a prior Manager session must not carry into a Team Lead session.");
  assert.deepEqual(await teamLeadRoleSelect.locator("option").allTextContents(), ["Engineer", "SSE"], "Team Lead can create only Engineer/SSE profiles.");
  assert.deepEqual(
    await page.getByLabel(`Role for ${engineer.name}`).locator("option").allTextContents(),
    ["Engineer", "SSE"],
    "Team Lead can edit only Engineer/SSE roster roles.",
  );
  assert.equal(await page.locator(".account-panel").count(), 0, "Team Lead must not see Manager-only account provisioning.");

  // Team Lead can read reports, but does not receive Manager-only account controls.
  await navigation(page, "Reports").click();
  await page.getByRole("heading", { name: "Reports" }).waitFor();
  await page.getByText("Assignment outcomes", { exact: true }).waitFor();

  // Manager report view must expose the saved assignment and a real CSV download.
  await signOut(page);
  await signIn(page, { ...manager, role: "Manager" });
  await navigation(page, "Reports").click();
  await page.getByLabel("To").fill(assignmentDate);
  await page.getByLabel("From").fill(assignmentDate);
  await page.getByText(assignmentCase, { exact: true }).waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "callflow-report.csv");
  const csvPath = await download.path();
  assert.ok(csvPath, "Expected a local CSV download artifact.");
  const csv = await readFile(csvPath, "utf8");
  assert.ok(csv.includes(assignmentCase), "Downloaded CSV must contain the completed assignment.");

  // Engineer view is restricted, while self-service attendance and leave remain available.
  await signOut(page);
  await signIn(page, { ...engineer, role: "Engineer" });
  assert.equal(await page.getByRole("button", { name: "New assignment" }).count(), 0, "Engineer must not see assignment creation controls.");
  await navigation(page, "Reports").click();
  await page.getByText("Reports are available to Managers and Team Leads.", { exact: true }).waitFor();

  await navigation(page, "Team").click();
  await page.getByRole("button", { name: "Attendance", exact: true }).click();
  const engineerRow = page.getByRole("row").filter({ hasText: engineer.name });
  await engineerRow.getByRole("button", { name: "WFH", exact: true }).click();
  await page.getByText("WFH attendance recorded.", { exact: true }).waitFor();
  await engineerRow.getByText("Present", { exact: true }).waitFor();

  await navigation(page, "Leaves").click();
  await page.getByLabel("Start date").fill(leaveDate);
  await page.getByLabel("End date").fill(leaveDate);
  await page.getByLabel("Reason").fill(leaveReason);
  await page.getByRole("button", { name: "Submit request" }).click();
  await page.getByText("Leave request submitted for manager review.", { exact: true }).waitFor();

  // Manager approves; the Engineer can then cancel their own approved request.
  await signOut(page);
  await signIn(page, { ...manager, role: "Manager" });
  await navigation(page, "Leaves").click();
  const leaveRow = page.getByRole("row").filter({ hasText: leaveReason });
  await leaveRow.getByRole("button", { name: "Approve", exact: true }).click();
  await leaveRow.getByText("Approved", { exact: true }).waitFor();

  await signOut(page);
  await signIn(page, { ...engineer, role: "Engineer" });
  await navigation(page, "Leaves").click();
  const ownLeaveRow = page.getByRole("row").filter({ hasText: leaveReason });
  await ownLeaveRow.getByRole("button", { name: "Cancel", exact: true }).click();
  await ownLeaveRow.getByText("Cancelled", { exact: true }).waitFor();

  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join("; ")}`);
  console.log("CallFlow browser E2E passed: Manager bootstrap/login, Engineer and Team Lead provisioning/login, role-specific UI, assignment lifecycle, report CSV download, WFH attendance, leave approval/cancellation, and logout.");
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
