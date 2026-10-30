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
import { POST as postLeave } from "../app/api/leaves/route";
import { PATCH as patchLeave } from "../app/api/leaves/[id]/route";
import { POST as postRotationSkip } from "../app/api/rotations/skip/route";
import { POST as postAttendance } from "../app/api/attendance/route";
import { POST as postEngineer } from "../app/api/engineers/route";
import { PATCH as patchEngineer } from "../app/api/engineers/[id]/route";

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
    vi.mocked(requireSession).mockResolvedValueOnce(makeSession(id, role));
  };

  async function resetDatabase() {
    const collections = [
      "engineers",
      "assignments",
      "rotation_state",
      "audit_events",
      "leave_requests",
      "leave_capacity",
      "wfh_quota",
      "attendance_events",
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
