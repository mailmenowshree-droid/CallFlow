import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { requireSession, type SessionUser } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import { AssignmentServiceError, createAssignment } from "@/lib/assignment-service";
import { LifecycleError, transitionAssignment } from "@/lib/assignment-lifecycle";
import { reserveWfhDay, type WfhReservationResult } from "@/lib/wfh-quota";
import type { EngineerRecord, RotationRecord } from "@/lib/callflow-types";
import { GET as getAssignments, POST as postAssignment } from "../app/api/assignments/route";
import { PATCH as patchAssignment } from "../app/api/assignments/[id]/route";
import { POST as postLeave, GET as getLeaves } from "../app/api/leaves/route";
import { PATCH as patchLeave } from "../app/api/leaves/[id]/route";
import { POST as postRotationSkip } from "../app/api/rotations/skip/route";
import { POST as postAttendance } from "../app/api/attendance/route";
import { GET as getEngineers, POST as postEngineer } from "../app/api/engineers/route";
import { PATCH as patchEngineer } from "../app/api/engineers/[id]/route";
import { POST as postEngineerLeaveExclusion } from "../app/api/engineers/[id]/leave/route";
import { GET as getReports } from "../app/api/reports/route";
import { POST as postUser } from "../app/api/users/route";
import { POST as postBootstrapManager } from "../app/api/auth/bootstrap/route";

vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));

const integration = describe.skipIf(!process.env.MONGODB_URI);

integration("MongoDB replica-set integration", () => {
  let db: Db;

  const now = new Date("2026-10-30T12:00:00.000Z");
  const startAt = new Date("2026-11-02T10:00:00.000Z");
  const endAt = new Date("2026-11-02T10:30:00.000Z");

  const makeEngineer = (id: string): EngineerRecord => ({
    id,
    name: id,
    email: `${id}@example.test`,
    role: "Engineer",
    active: true,
    callQueue: true,
    ftsQueue: true,
    absent: false,
    attendanceStatus: "Not checked in",
    createdAt: now,
    updatedAt: now,
  });

  const makeSession = (id: string, role: SessionUser["role"]): SessionUser => ({
    id,
    email: `${id}@example.test`,
    name: id,
    role,
  });

  const setSession = (id: string, role: SessionUser["role"]) => {
    const session = makeSession(id, role);
    vi.mocked(requireSession).mockImplementationOnce(async (allowedRoles) => {
      if (allowedRoles && !allowedRoles.includes(role)) throw new Error("FORBIDDEN");
      return session;
    });
  };

  async function resetDatabase() {
    const collections = [
      "engineers",
      "users",
      "assignments",
      "rotation_state",
      "audit_events",
      "leave_requests",
      "leave_capacity",
      "wfh_quota",
      "attendance_events",
      "role_policy_locks",
    ];
    await Promise.all(collections.map((name) => db.collection(name).deleteMany({})));
    vi.mocked(requireSession).mockReset();
  }

  async function seedRotation(engineerIds: string[], key: RotationRecord["_id"] = "FE_CRU_EVENT") {
    await db.collection<RotationRecord>("rotation_state").insertOne({
      _id: key,
      engineerIds,
      nextIndex: 0,
      completedAssignments: 0,
      updatedAt: now,
    });
  }

  function assignmentInput(requestId: string) {
    return {
      requestId,
      rotation: "FE_CRU_EVENT" as const,
      kind: "FE" as const,
      caseNumber: requestId,
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      createdBy: "manager-1",
    };
  }

  async function runWfhCheckIn(todayKey: string): Promise<WfhReservationResult> {
    const client = await getMongoClient();
    const session = client.startSession();
    let result: WfhReservationResult | undefined;
    try {
      await session.withTransaction(async () => {
        const reservation = await reserveWfhDay(db, session, {
          engineerId: "wfh-engineer",
          quarterStart: "2026-10-01",
          todayKey,
          monthsElapsedInQuarter: 1,
          now,
        });
        result = reservation;
        if (reservation.ok) {
          await db.collection("attendance_events").insertOne({
            id: randomUUID(),
            engineerId: "wfh-engineer",
            eventType: "WFH_CHECKED_IN",
            attendanceDate: todayKey,
            occurredAt: now,
          }, { session });
        }
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    if (!result) throw new Error("WFH transaction completed without a result.");
    return result;
  }


  const engineerPostRequest = (body: {
    name: string;
    role: "Engineer" | "SSE" | "Team Lead" | "Manager";
    callQueue: boolean;
    ftsQueue: boolean;
  }) => new NextRequest("http://localhost/api/engineers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const engineerPatchRequest = (body: Record<string, unknown>) => new NextRequest(
    "http://localhost/api/engineers/engineer-id",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const assignmentPatchRequest = (id: string, status: "In Progress" | "Completed" | "Needs attention" | "Cancelled") => new NextRequest(
    `http://localhost/api/assignments/${id}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );

  const attendanceRequest = (body: { action: "check-in" | "check-out"; workMode?: "Office" | "WFH"; engineerId?: string }) => new NextRequest(
    "http://localhost/api/attendance",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const rotationSkipRequest = (rotation: "FE_CRU_EVENT" | "FTS") => new NextRequest(
    "http://localhost/api/rotations/skip",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rotation }),
    },
  );

  const leavePostRequest = () => new NextRequest("http://localhost/api/leaves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      reason: "Integration test",
    }),
  });

  const leavePatchRequest = (status: "Approved" | "Rejected" | "Cancelled") => new NextRequest(
    "http://localhost/api/leaves/leave-id",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );

  const engineerLeaveExclusionRequest = (action: "start" | "clear") => new NextRequest(
    "http://localhost/api/engineers/leave-exclusion-member/leave",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );

  beforeAll(async () => {
    await ensureCallFlowIndexes();
    db = await getDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await (await getMongoClient()).close();
  });

  it("serializes concurrent round-robin assignments across the shared rotation", async () => {
    await db.collection<EngineerRecord>("engineers").insertMany([
      makeEngineer("eng-a"),
      makeEngineer("eng-b"),
    ]);
    await seedRotation(["eng-a", "eng-b"]);

    const results = await Promise.all([
      createAssignment(assignmentInput("request-a")),
      createAssignment(assignmentInput("request-b")),
    ]);

    expect(new Set(results.map((assignment) => assignment.engineerId)).size).toBe(2);
    const rotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FE_CRU_EVENT" });
    expect(rotation?.nextIndex).toBe(0);
    expect(await db.collection("assignments").countDocuments({})).toBe(2);
  });

  it("prevents overlapping assignments from being committed to one engineer", async () => {
    await db.collection<EngineerRecord>("engineers").insertOne(makeEngineer("eng-only"));
    await seedRotation(["eng-only"]);

    const results = await Promise.allSettled([
      createAssignment(assignmentInput("overlap-a")),
      createAssignment(assignmentInput("overlap-b")),
    ]);

    const successful = results.filter((result) => result.status === "fulfilled");
    const rejected = results.find((result) => result.status === "rejected");
    expect(successful).toHaveLength(1);
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(AssignmentServiceError);
      expect(rejected.reason.code).toBe("NO_ELIGIBLE_ENGINEER");
    }
    expect(await db.collection("assignments").countDocuments({})).toBe(1);
  });

  it("increments the completed-assignment counter exactly once under concurrent completion", async () => {
    await db.collection<EngineerRecord>("engineers").insertOne(makeEngineer("eng-complete"));
    await seedRotation(["eng-complete"]);
    const assignment = await createAssignment(assignmentInput("complete-once"));
    await transitionAssignment(assignment.id, "In Progress", "manager-start");

    const results = await Promise.allSettled([
      transitionAssignment(assignment.id, "Completed", "manager-1"),
      transitionAssignment(assignment.id, "Completed", "manager-2"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(LifecycleError);
      expect(rejected.reason.code).toBe("INVALID_TRANSITION");
    }

    const rotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FE_CRU_EVENT" });
    expect(rotation?.completedAssignments).toBe(1);
    expect(await db.collection("audit_events").countDocuments({ eventType: "ASSIGNMENT_STATUS_CHANGED", "metadata.to": "Completed" })).toBe(1);
  });


  it("serializes concurrent rotation skips and keeps the cooldown isolated to its queue", async () => {
    await db.collection<EngineerRecord>("engineers").insertMany([
      makeEngineer("skip-a"),
      makeEngineer("skip-b"),
      makeEngineer("skip-c"),
    ]);
    await seedRotation(["skip-a", "skip-b", "skip-c"], "FE_CRU_EVENT");
    await seedRotation(["skip-a", "skip-b", "skip-c"], "FTS");

    setSession("lead-one", "Team Lead");
    setSession("manager-two", "Manager");
    const responses = await Promise.all([
      postRotationSkip(rotationSkipRequest("FE_CRU_EVENT")),
      postRotationSkip(rotationSkipRequest("FE_CRU_EVENT")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200]);

    const payloads = await Promise.all(responses.map((response) => response.json()));
    const skippedIds = new Set(payloads.map((payload) => payload.engineerId));
    expect(skippedIds).toEqual(new Set(["skip-a", "skip-b"]));

    const skippedEngineers = await db.collection<EngineerRecord>("engineers")
      .find({ id: { $in: Array.from(skippedIds) } }).toArray();
    expect(skippedEngineers).toHaveLength(2);
    for (const engineer of skippedEngineers) {
      expect(engineer.skipUntilCompletionByRotation?.FE_CRU_EVENT).toBe(3);
      expect(engineer.skipUntilCompletionByRotation?.FTS).toBeUndefined();
    }

    const callRotation = await db.collection<RotationRecord>("rotation_state")
      .findOne({ _id: "FE_CRU_EVENT" });
    expect(callRotation?.nextIndex).toBe(0);
    expect(callRotation?.completedAssignments).toBe(0);
    expect(callRotation?.skipMutationVersion).toBe(2);
    expect(await db.collection("audit_events").countDocuments({
      eventType: "ROTATION_ENGINEER_SKIPPED",
      "metadata.rotation": "FE_CRU_EVENT",
    })).toBe(2);

    const ftsAssignment = await createAssignment({
      ...assignmentInput("fts-after-call-skips"),
      rotation: "FTS",
      kind: "FTS",
    });
    expect(ftsAssignment.engineerId).toBe("skip-a");

    const callAssignment = await createAssignment(assignmentInput("call-after-skips"));
    expect(callAssignment.engineerId).toBe("skip-c");
  });

  it("serializes same-day WFH check-ins and records only one event", async () => {
    await db.collection("wfh_quota").insertOne({
      engineerId: "wfh-engineer",
      quarterStart: "2026-10-01",
      reservationVersion: 0,
      createdAt: now,
    });

    const results = await Promise.all([
      runWfhCheckIn("2026-10-30"),
      runWfhCheckIn("2026-10-30"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ reason: "already-recorded" });
    expect(await db.collection("attendance_events").countDocuments({ eventType: "WFH_CHECKED_IN" })).toBe(1);
  });

  it("enforces the accrued WFH allowance across sequential check-ins", async () => {
    await db.collection("wfh_quota").insertOne({
      engineerId: "wfh-engineer",
      quarterStart: "2026-10-01",
      reservationVersion: 0,
      createdAt: now,
    });

    const first = await runWfhCheckIn("2026-10-01");
    const second = await runWfhCheckIn("2026-10-02");
    const third = await runWfhCheckIn("2026-10-03");

    expect([first.ok, second.ok, third.ok]).toEqual([true, true, false]);
    if (!third.ok) expect(third.reason).toBe("limit");
    expect(await db.collection("attendance_events").countDocuments({ eventType: "WFH_CHECKED_IN" })).toBe(2);
  });

  it("creates an engineer and rotation memberships atomically, rejecting invalid SSE queue access", async () => {
    setSession("manager-create", "Manager");
    const created = await postEngineer(engineerPostRequest({
      name: "Created Engineer",
      role: "Engineer",
      callQueue: true,
      ftsQueue: true,
    }));
    expect(created.status).toBe(201);
    const payload = await created.json();
    const engineer = payload.engineer as EngineerRecord;

    const callRotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FE_CRU_EVENT" });
    const ftsRotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FTS" });
    expect(callRotation?.engineerIds).toContain(engineer.id);
    expect(ftsRotation?.engineerIds).toContain(engineer.id);
    expect(await db.collection("audit_events").countDocuments({
      eventType: "ENGINEER_CREATED",
      entityId: engineer.id,
      actorId: "manager-create",
    })).toBe(1);

    setSession("team-lead-create", "Team Lead");
    const invalidSse = await postEngineer(engineerPostRequest({
      name: "Invalid SSE",
      role: "SSE",
      callQueue: true,
      ftsQueue: false,
    }));
    expect(invalidSse.status).toBe(422);
    expect(await db.collection<EngineerRecord>("engineers").countDocuments({ name: "Invalid SSE" })).toBe(0);

    setSession("team-lead-create", "Team Lead");
    const privilegedProfile = await postEngineer(engineerPostRequest({
      name: "Unauthorized Manager Profile",
      role: "Manager",
      callQueue: false,
      ftsQueue: false,
    }));
    expect(privilegedProfile.status).toBe(403);
    expect(await db.collection<EngineerRecord>("engineers").countDocuments({ name: "Unauthorized Manager Profile" })).toBe(0);
  });

  it("creates a linked team profile for the bootstrapped Manager", async () => {
    const previousToken = process.env.CALLFLOW_BOOTSTRAP_TOKEN;
    const previousEmail = process.env.BOOTSTRAP_MANAGER_EMAIL;
    const token = "callflow-integration-bootstrap-token-2026-10-30";
    const email = "bootstrap-manager@example.test";
    const request = () => new NextRequest("http://localhost/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: "Bootstrap Manager",
        email,
        password: "CallFlow-Integration-Password-2026!",
      }),
    });

    process.env.CALLFLOW_BOOTSTRAP_TOKEN = token;
    process.env.BOOTSTRAP_MANAGER_EMAIL = email;
    try {
      const response = await postBootstrapManager(request());
      expect(response.status).toBe(201);
      const user = await db.collection("users").findOne({ email });
      expect(user).toMatchObject({ email, role: "Manager", active: true });
      const profile = await db.collection<EngineerRecord>("engineers").findOne({ id: user?.id });
      expect(profile).toMatchObject({
        id: user?.id,
        email,
        name: "Bootstrap Manager",
        role: "Manager",
        active: true,
        callQueue: false,
        ftsQueue: false,
        attendanceStatus: "Not checked in",
      });

      const secondSetup = await postBootstrapManager(request());
      expect(secondSetup.status).toBe(409);
      expect(await db.collection("users").countDocuments({ role: "Manager" })).toBe(1);
      expect(await db.collection("engineers").countDocuments({ id: user?.id })).toBe(1);
      expect(await db.collection("audit_events").countDocuments({ eventType: "INITIAL_MANAGER_BOOTSTRAPPED" })).toBe(1);
    } finally {
      if (previousToken === undefined) delete process.env.CALLFLOW_BOOTSTRAP_TOKEN;
      else process.env.CALLFLOW_BOOTSTRAP_TOKEN = previousToken;
      if (previousEmail === undefined) delete process.env.BOOTSTRAP_MANAGER_EMAIL;
      else process.env.BOOTSTRAP_MANAGER_EMAIL = previousEmail;
    }
  });

  it("creates linked team profiles when a Manager provisions Team Lead and Manager logins", async () => {
    setSession("manager-user-creator", "Manager");
    const teamLeadResponse = await postUser(new NextRequest("http://localhost/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Provisioned Team Lead",
        email: "provisioned-team-lead@example.test",
        password: "CallFlow-TeamLead-Password-2026!",
        role: "Team Lead",
      }),
    }));
    expect(teamLeadResponse.status).toBe(201);
    const teamLeadPayload = await teamLeadResponse.json();
    expect(teamLeadPayload.engineerCreated).toBe(true);
    const teamLeadProfile = await db.collection<EngineerRecord>("engineers").findOne({ id: teamLeadPayload.user.id });
    expect(teamLeadProfile).toMatchObject({
      id: teamLeadPayload.user.id,
      email: "provisioned-team-lead@example.test",
      role: "Team Lead",
      active: true,
      callQueue: false,
      ftsQueue: false,
    });

    setSession("manager-user-creator", "Manager");
    const managerResponse = await postUser(new NextRequest("http://localhost/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Provisioned Manager",
        email: "provisioned-manager@example.test",
        password: "CallFlow-Manager-Password-2026!",
        role: "Manager",
      }),
    }));
    expect(managerResponse.status).toBe(201);
    const managerPayload = await managerResponse.json();
    expect(managerPayload.engineerCreated).toBe(true);
    expect(await db.collection<EngineerRecord>("engineers").findOne({ id: managerPayload.user.id })).toMatchObject({
      id: managerPayload.user.id,
      email: "provisioned-manager@example.test",
      role: "Manager",
      active: true,
      callQueue: false,
      ftsQueue: false,
    });
  });

  it("restricts engineer mutations and updates queue membership with an audit event", async () => {
    await db.collection<EngineerRecord>("engineers").insertOne({
      ...makeEngineer("engineer-patch"),
      callQueue: true,
      ftsQueue: true,
    });
    await seedRotation(["engineer-patch", "other-call"], "FE_CRU_EVENT");
    await seedRotation(["engineer-patch", "other-fts"], "FTS");

    setSession("engineer-patch", "Engineer");
    const forbidden = await patchEngineer(
      engineerPatchRequest({ name: "Unauthorized rename" }),
      { params: Promise.resolve({ id: "engineer-patch" }) },
    );
    expect(forbidden.status).toBe(403);

    setSession("team-lead-patch", "Team Lead");
    const updated = await patchEngineer(
      engineerPatchRequest({ name: "Updated Engineer", callQueue: false }),
      { params: Promise.resolve({ id: "engineer-patch" }) },
    );
    expect(updated.status).toBe(200);

    const engineer = await db.collection<EngineerRecord>("engineers").findOne({ id: "engineer-patch" });
    expect(engineer?.name).toBe("Updated Engineer");
    expect(engineer?.callQueue).toBe(false);
    expect(engineer?.ftsQueue).toBe(true);

    const callRotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FE_CRU_EVENT" });
    const ftsRotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FTS" });
    expect(callRotation?.engineerIds).not.toContain("engineer-patch");
    expect(ftsRotation?.engineerIds).toContain("engineer-patch");
    expect(await db.collection("audit_events").countDocuments({
      eventType: "ENGINEER_UPDATED",
      entityId: "engineer-patch",
      actorId: "team-lead-patch",
    })).toBe(1);
  });


  it("synchronizes roster and login roles and prevents Team Lead privilege escalation", async () => {
    const engineer = makeEngineer("role-engineer");
    const managerTarget: EngineerRecord = {
      ...makeEngineer("role-manager-target"),
      role: "Manager",
      callQueue: false,
      ftsQueue: false,
    };
    const managerActor: EngineerRecord = {
      ...makeEngineer("role-manager-actor"),
      role: "Manager",
      callQueue: false,
      ftsQueue: false,
    };
    await db.collection<EngineerRecord>("engineers").insertMany([engineer, managerTarget, managerActor]);
    await db.collection("users").insertMany([
      { id: engineer.id, email: "role-engineer@example.test", name: engineer.name, role: "Engineer", active: true, passwordHash: "test-hash", createdAt: now, updatedAt: now },
      { id: managerTarget.id, email: "role-manager-target@example.test", name: managerTarget.name, role: "Manager", active: true, passwordHash: "test-hash", createdAt: now, updatedAt: now },
      { id: managerActor.id, email: "role-manager-actor@example.test", name: managerActor.name, role: "Manager", active: true, passwordHash: "test-hash", createdAt: now, updatedAt: now },
    ]);
    await seedRotation([engineer.id, "other-call"], "FE_CRU_EVENT");
    await seedRotation([engineer.id, "other-fts"], "FTS");

    setSession("team-lead-role", "Team Lead");
    const promotion = await patchEngineer(
      engineerPatchRequest({ role: "Manager" }),
      { params: Promise.resolve({ id: engineer.id }) },
    );
    expect(promotion.status).toBe(403);

    setSession("team-lead-role", "Team Lead");
    const managerEdit = await patchEngineer(
      engineerPatchRequest({ name: "Unauthorized manager rename" }),
      { params: Promise.resolve({ id: managerTarget.id }) },
    );
    expect(managerEdit.status).toBe(403);

    setSession("team-lead-role", "Team Lead");
    const updated = await patchEngineer(
      engineerPatchRequest({ name: "Updated SSE", role: "SSE", callQueue: false, ftsQueue: false }),
      { params: Promise.resolve({ id: engineer.id }) },
    );
    expect(updated.status).toBe(200);

    const updatedEngineer = await db.collection<EngineerRecord>("engineers").findOne({ id: engineer.id });
    const updatedUser = await db.collection("users").findOne({ id: engineer.id });
    expect(updatedEngineer).toMatchObject({ name: "Updated SSE", role: "SSE", callQueue: false, ftsQueue: false });
    expect(updatedUser).toMatchObject({ name: "Updated SSE", role: "SSE", active: true });
    expect((await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FE_CRU_EVENT" }))?.engineerIds).not.toContain(engineer.id);
    expect((await db.collection<RotationRecord>("rotation_state").findOne({ _id: "FTS" }))?.engineerIds).not.toContain(engineer.id);

    setSession("role-manager-actor", "Manager");
    const demoted = await patchEngineer(
      engineerPatchRequest({ name: "Former Manager", role: "Engineer", active: false }),
      { params: Promise.resolve({ id: managerTarget.id }) },
    );
    expect(demoted.status).toBe(200);
    expect(await db.collection<EngineerRecord>("engineers").findOne({ id: managerTarget.id })).toMatchObject({
      name: "Former Manager",
      role: "Engineer",
      active: false,
    });
    expect(await db.collection("users").findOne({ id: managerTarget.id })).toMatchObject({
      name: "Former Manager",
      role: "Engineer",
      active: false,
    });

    setSession("role-manager-actor", "Manager");
    const selfDeactivation = await patchEngineer(
      engineerPatchRequest({ active: false }),
      { params: Promise.resolve({ id: managerActor.id }) },
    );
    expect(selfDeactivation.status).toBe(409);
    expect(await db.collection("users").findOne({ id: managerActor.id })).toMatchObject({
      role: "Manager",
      active: true,
    });
  });

  it("restricts temporary leave exclusions and commits their audit events with the roster update", async () => {
    const memberId = "leave-exclusion-member";
    await db.collection<EngineerRecord>("engineers").insertOne(makeEngineer(memberId));

    setSession("leave-exclusion-lead", "Team Lead");
    const started = await postEngineerLeaveExclusion(
      engineerLeaveExclusionRequest("start"),
      { params: Promise.resolve({ id: memberId }) },
    );
    expect(started.status).toBe(200);
    const startedPayload = await started.json();
    expect(typeof startedPayload.leaveUntil).toBe("string");
    const afterStart = await db.collection<EngineerRecord>("engineers").findOne({ id: memberId });
    expect(afterStart?.leaveUntil).toBeInstanceOf(Date);
    expect(afterStart?.leaveUntil?.getTime()).toBeGreaterThan(Date.now());
    expect(await db.collection("audit_events").findOne({
      eventType: "LEAVE_EXCLUSION_STARTED",
      entityId: memberId,
      actorId: "leave-exclusion-lead",
    })).toMatchObject({ metadata: { durationHours: 24 } });

    setSession(memberId, "Engineer");
    const forbiddenClear = await postEngineerLeaveExclusion(
      engineerLeaveExclusionRequest("clear"),
      { params: Promise.resolve({ id: memberId }) },
    );
    expect(forbiddenClear.status).toBe(403);
    expect((await db.collection<EngineerRecord>("engineers").findOne({ id: memberId }))?.leaveUntil).toBeInstanceOf(Date);

    setSession("leave-exclusion-manager", "Manager");
    const cleared = await postEngineerLeaveExclusion(
      engineerLeaveExclusionRequest("clear"),
      { params: Promise.resolve({ id: memberId }) },
    );
    expect(cleared.status).toBe(200);
    expect((await db.collection<EngineerRecord>("engineers").findOne({ id: memberId }))?.leaveUntil).toBeUndefined();
    expect(await db.collection("audit_events").countDocuments({
      eventType: "LEAVE_EXCLUSION_STARTED",
      entityId: memberId,
    })).toBe(1);
    expect(await db.collection("audit_events").countDocuments({
      eventType: "LEAVE_EXCLUSION_CLEARED",
      entityId: memberId,
      actorId: "leave-exclusion-manager",
    })).toBe(1);
  });

  it("limits SSE roster and record access to self while permitting own assignment updates", async () => {
    const sse: EngineerRecord = {
      ...makeEngineer("sse-member"),
      role: "SSE",
      callQueue: false,
      ftsQueue: false,
    };
    const other = makeEngineer("other-member");
    await db.collection<EngineerRecord>("engineers").insertMany([sse, other]);
    await db.collection("assignments").insertMany([
      {
        id: "sse-assignment",
        requestId: "sse-assignment",
        rotation: "FE_CRU_EVENT",
        kind: "FE",
        caseNumber: "SSE-CASE",
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        engineerId: sse.id,
        status: "Scheduled",
        createdBy: "manager",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "other-assignment",
        requestId: "other-assignment",
        rotation: "FE_CRU_EVENT",
        kind: "FE",
        caseNumber: "OTHER-CASE",
        scheduledStartAt: startAt,
        scheduledEndAt: endAt,
        engineerId: other.id,
        status: "Scheduled",
        createdBy: "manager",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.collection("leave_requests").insertMany([
      { id: "sse-leave", engineerId: sse.id, engineerName: sse.name, startDate: "2026-11-10", endDate: "2026-11-10", reason: "SSE leave", status: "Pending", createdAt: now, updatedAt: now },
      { id: "other-leave", engineerId: other.id, engineerName: other.name, startDate: "2026-11-10", endDate: "2026-11-10", reason: "Other leave", status: "Pending", createdAt: now, updatedAt: now },
    ]);

    setSession(sse.id, "SSE");
    const roster = await getEngineers();
    expect((await roster.json()).engineers.map((item: EngineerRecord) => item.id)).toEqual([sse.id]);

    setSession(sse.id, "SSE");
    const assignments = await getAssignments();
    expect((await assignments.json()).assignments.map((item: { id: string }) => item.id)).toEqual(["sse-assignment"]);

    setSession(sse.id, "SSE");
    const leaves = await getLeaves();
    expect((await leaves.json()).leaves.map((item: { id: string }) => item.id)).toEqual(["sse-leave"]);

    setSession(sse.id, "SSE");
    const reports = await getReports(new NextRequest("http://localhost/api/reports"));
    expect(reports.status).toBe(403);

    setSession(sse.id, "SSE");
    const createEngineer = await postEngineer(engineerPostRequest({
      name: "SSE Cannot Create",
      role: "Engineer",
      callQueue: false,
      ftsQueue: false,
    }));
    expect(createEngineer.status).toBe(403);

    setSession(sse.id, "SSE");
    const createAssignment = await postAssignment(new NextRequest("http://localhost/api/assignments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "FE", caseNumber: "SSE-FORBIDDEN", scheduledStartAt: startAt.toISOString() }),
    }));
    expect(createAssignment.status).toBe(403);

    setSession(sse.id, "SSE");
    const createUser = await postUser(new NextRequest("http://localhost/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "SSE Cannot Create", email: "sse-cannot-create@example.test", password: "CallFlow-Test-Password-2026!", role: "Manager" }),
    }));
    expect(createUser.status).toBe(403);

    setSession(sse.id, "SSE");
    const skipRotation = await postRotationSkip(rotationSkipRequest("FTS"));
    expect(skipRotation.status).toBe(403);

    setSession(sse.id, "SSE");
    const patchRoster = await patchEngineer(
      engineerPatchRequest({ name: "SSE Cannot Rename" }),
      { params: Promise.resolve({ id: other.id }) },
    );
    expect(patchRoster.status).toBe(403);

    setSession(sse.id, "SSE");
    const approveOtherLeave = await patchLeave(
      leavePatchRequest("Approved"),
      { params: Promise.resolve({ id: "other-leave" }) },
    );
    expect(approveOtherLeave.status).toBe(403);

    setSession(sse.id, "SSE");
    const ownAssignmentUpdate = await patchAssignment(
      assignmentPatchRequest("sse-assignment", "In Progress"),
      { params: Promise.resolve({ id: "sse-assignment" }) },
    );
    expect(ownAssignmentUpdate.status).toBe(200);

    setSession(sse.id, "SSE");
    const otherAssignmentUpdate = await patchAssignment(
      assignmentPatchRequest("other-assignment", "In Progress"),
      { params: Promise.resolve({ id: "other-assignment" }) },
    );
    expect(otherAssignmentUpdate.status).toBe(403);
  });

  it("enforces check-in and check-out state transitions and audits accepted events", async () => {
    await db.collection<EngineerRecord>("engineers").insertOne(makeEngineer("attendance-member"));

    setSession("attendance-member", "Engineer");
    const earlyCheckout = await postAttendance(attendanceRequest({ action: "check-out" }));
    expect(earlyCheckout.status).toBe(409);

    setSession("attendance-member", "Engineer");
    const checkIn = await postAttendance(attendanceRequest({ action: "check-in", workMode: "Office" }));
    expect(checkIn.status).toBe(200);

    setSession("attendance-member", "Engineer");
    const duplicateCheckIn = await postAttendance(attendanceRequest({ action: "check-in", workMode: "Office" }));
    expect(duplicateCheckIn.status).toBe(409);

    setSession("attendance-member", "Engineer");
    const checkOut = await postAttendance(attendanceRequest({ action: "check-out" }));
    expect(checkOut.status).toBe(200);

    setSession("attendance-member", "Engineer");
    const duplicateCheckout = await postAttendance(attendanceRequest({ action: "check-out" }));
    expect(duplicateCheckout.status).toBe(409);

    const engineer = await db.collection<EngineerRecord>("engineers").findOne({ id: "attendance-member" });
    expect(engineer?.attendanceStatus).toBe("Not checked in");
    expect(engineer?.checkedInAt).toBeInstanceOf(Date);
    expect(engineer?.checkedOutAt).toBeInstanceOf(Date);
    expect(await db.collection("attendance_events").countDocuments({ engineerId: "attendance-member" })).toBe(2);
    expect(await db.collection("audit_events").countDocuments({ entityId: "attendance-member" })).toBe(2);
  });

  it("serializes concurrent office check-ins at the attendance route", async () => {
    await db.collection<EngineerRecord>("engineers").insertOne(makeEngineer("attendance-race"));

    setSession("attendance-race", "Engineer");
    setSession("attendance-race", "Engineer");
    const responses = await Promise.all([
      postAttendance(attendanceRequest({ action: "check-in", workMode: "Office" })),
      postAttendance(attendanceRequest({ action: "check-in", workMode: "Office" })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await db.collection("attendance_events").countDocuments({
      engineerId: "attendance-race",
      eventType: "CHECKED_IN",
    })).toBe(1);
    expect(await db.collection("audit_events").countDocuments({
      entityId: "attendance-race",
      eventType: "ATTENDANCE_CHECKED_IN",
    })).toBe(1);
    const engineer = await db.collection<EngineerRecord>("engineers").findOne({ id: "attendance-race" });
    expect(engineer?.attendanceStatus).toBe("Present");
    expect(engineer?.attendanceWorkMode).toBe("Office");
  });

  it("serializes concurrent check-outs so only one request closes the attendance session", async () => {
    await db.collection<EngineerRecord>("engineers").insertOne(makeEngineer("checkout-race"));

    setSession("checkout-race", "Engineer");
    const checkIn = await postAttendance(attendanceRequest({ action: "check-in", workMode: "Office" }));
    expect(checkIn.status).toBe(200);

    setSession("checkout-race", "Engineer");
    setSession("checkout-race", "Engineer");
    const responses = await Promise.all([
      postAttendance(attendanceRequest({ action: "check-out" })),
      postAttendance(attendanceRequest({ action: "check-out" })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await db.collection("attendance_events").countDocuments({
      engineerId: "checkout-race",
      eventType: { $in: ["CHECKED_IN", "CHECKED_OUT"] },
    })).toBe(2);
    expect(await db.collection("audit_events").countDocuments({
      entityId: "checkout-race",
      eventType: { $in: ["ATTENDANCE_CHECKED_IN", "ATTENDANCE_CHECKED_OUT"] },
    })).toBe(2);
    const engineer = await db.collection<EngineerRecord>("engineers").findOne({ id: "checkout-race" });
    expect(engineer?.attendanceStatus).toBe("Not checked in");
    expect(engineer?.checkedOutAt).toBeInstanceOf(Date);
  });

  it("commits WFH quota and attendance once under concurrent route check-ins", async () => {
    await db.collection<EngineerRecord>("engineers").insertOne(makeEngineer("wfh-route-race"));

    setSession("wfh-route-race", "Engineer");
    setSession("wfh-route-race", "Engineer");
    const responses = await Promise.all([
      postAttendance(attendanceRequest({ action: "check-in", workMode: "WFH" })),
      postAttendance(attendanceRequest({ action: "check-in", workMode: "WFH" })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await db.collection("attendance_events").countDocuments({
      engineerId: "wfh-route-race",
      eventType: "WFH_CHECKED_IN",
    })).toBe(1);
    expect(await db.collection("audit_events").countDocuments({
      entityId: "wfh-route-race",
      eventType: "ATTENDANCE_CHECKED_IN",
    })).toBe(1);
    const quota = await db.collection("wfh_quota").findOne({ engineerId: "wfh-route-race" });
    expect(quota?.reservationVersion).toBe(1);
    const engineer = await db.collection<EngineerRecord>("engineers").findOne({ id: "wfh-route-race" });
    expect(engineer?.attendanceStatus).toBe("Present");
    expect(engineer?.attendanceWorkMode).toBe("WFH");
  });

  it("prevents Managers and Team Leads from approving their own leave requests", async () => {
    const day = "2026-11-12";
    await db.collection("leave_requests").insertMany([
      {
        id: "team-lead-own-leave",
        engineerId: "team-lead-own",
        engineerName: "Team Lead",
        startDate: day,
        endDate: day,
        reason: "Team Lead self-review guard",
        status: "Pending",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "manager-own-leave",
        engineerId: "manager-own",
        engineerName: "Manager",
        startDate: day,
        endDate: day,
        reason: "Manager self-review guard",
        status: "Pending",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    setSession("team-lead-own", "Team Lead");
    const teamLeadReview = await patchLeave(
      leavePatchRequest("Approved"),
      { params: Promise.resolve({ id: "team-lead-own-leave" }) },
    );
    expect(teamLeadReview.status).toBe(403);

    setSession("manager-own", "Manager");
    const managerReview = await patchLeave(
      leavePatchRequest("Rejected"),
      { params: Promise.resolve({ id: "manager-own-leave" }) },
    );
    expect(managerReview.status).toBe(403);

    expect(await db.collection("leave_requests").findOne({ id: "team-lead-own-leave" })).toMatchObject({ status: "Pending" });
    expect(await db.collection("leave_requests").findOne({ id: "manager-own-leave" })).toMatchObject({ status: "Pending" });
    expect(await db.collection("audit_events").countDocuments({ eventType: "LEAVE_STATUS_CHANGED" })).toBe(0);
    expect(await db.collection<{ _id: string }>("leave_capacity").countDocuments({ _id: day })).toBe(0);
  });

  it("serializes leave capacity, commits audit events, and releases capacity on cancellation", async () => {
    const day = "2026-11-10";
    await db.collection<EngineerRecord>("engineers").insertMany([
      makeEngineer("eng-existing"),
      makeEngineer("eng-two"),
      makeEngineer("eng-three"),
    ]);
    await db.collection("leave_requests").insertOne({
      id: "leave-existing",
      engineerId: "eng-existing",
      engineerName: "eng-existing",
      startDate: day,
      endDate: day,
      reason: "Existing pending request",
      status: "Pending",
      createdAt: now,
      updatedAt: now,
    });
    await db.collection<{ _id: string; reservationVersion: number; createdAt: Date }>("leave_capacity").insertOne({ _id: day, reservationVersion: 0, createdAt: now });

    setSession("eng-two", "Engineer");
    setSession("eng-three", "Engineer");
    const responses = await Promise.all([postLeave(leavePostRequest()), postLeave(leavePostRequest())]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

    const accepted = await db.collection("leave_requests").find({
      engineerId: { $in: ["eng-two", "eng-three"] },
      status: "Pending",
    }).toArray();
    expect(accepted).toHaveLength(1);
    const acceptedLeave = accepted[0];
    const rejectedEngineerId = acceptedLeave.engineerId === "eng-two" ? "eng-three" : "eng-two";

    setSession(acceptedLeave.engineerId, "Engineer");
    const cancelled = await patchLeave(leavePatchRequest("Cancelled"), { params: Promise.resolve({ id: acceptedLeave.id }) });
    expect(cancelled.status).toBe(200);

    setSession(rejectedEngineerId, "Engineer");
    const retried = await postLeave(leavePostRequest());
    expect(retried.status).toBe(201);
    const retriedLeave = await db.collection("leave_requests").findOne({
      engineerId: rejectedEngineerId,
      status: "Pending",
    });
    expect(retriedLeave).not.toBeNull();

    setSession("team-lead", "Team Lead");
    const approved = await patchLeave(leavePatchRequest("Approved"), { params: Promise.resolve({ id: retriedLeave!.id }) });
    expect(approved.status).toBe(200);

    setSession("team-lead", "Team Lead");
    const reReview = await patchLeave(leavePatchRequest("Rejected"), { params: Promise.resolve({ id: retriedLeave!.id }) });
    expect(reReview.status).toBe(409);

    expect(await db.collection("leave_requests").countDocuments({
      status: { $in: ["Pending", "Approved"] },
      startDate: day,
      endDate: day,
    })).toBe(2);
    expect(await db.collection("audit_events").countDocuments({ eventType: "LEAVE_STATUS_CHANGED" })).toBe(2);
    expect(await db.collection("audit_events").countDocuments({ eventType: "LEAVE_REQUESTED" })).toBe(2);
  });
});
