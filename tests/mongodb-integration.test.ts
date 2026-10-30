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
    expect(await db.collection("audit_events").countDocuments({ eventType: "ASSIGNMENT_STATUS_CHANGED" })).toBe(1);
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
    await db.collection("leave_capacity").insertOne({ _id: day, reservationVersion: 0, createdAt: now });

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
    const cancelled = await patchLeave(leavePatchRequest("Cancelled"), { params: { id: acceptedLeave.id } });
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
    const approved = await patchLeave(leavePatchRequest("Approved"), { params: { id: retriedLeave!.id } });
    expect(approved.status).toBe(200);

    setSession("team-lead", "Team Lead");
    const reReview = await patchLeave(leavePatchRequest("Rejected"), { params: { id: retriedLeave!.id } });
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
