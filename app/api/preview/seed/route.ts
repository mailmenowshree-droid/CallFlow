import { NextResponse } from "next/server";
import { getDatabase, getMongoClient } from "@/lib/mongodb";
import type { EngineerRecord, AssignmentRecord, RotationKey, RotationRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/**
 * Creates synthetic, repeatable preview records for manual QA.
 * Deliberately unavailable outside Vercel Preview; it never deletes existing records.
 */
export async function POST() {
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Preview-only endpoint." }, { status: 404, headers });
  }

  const db = await getDatabase();
  const client = await getMongoClient();
  const session = client.startSession();
  const markerId = "callflow-demo-data-v1";
  const now = new Date();
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const atIst = (dayOffset: number, hour: number, minute: number) => {
    const day = new Date(`${todayKey}T12:00:00+05:30`);
    day.setUTCDate(day.getUTCDate() + dayOffset);
    const dateKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(day);
    return new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`);
  };

  const roster: Array<Omit<EngineerRecord, "createdAt" | "updatedAt">> = [
    { id: "demo-eng-01", name: "Demo Engineer Asha", role: "Engineer", active: true, callQueue: true, ftsQueue: true, absent: false, attendanceStatus: "Present", attendanceWorkMode: "Office" },
    { id: "demo-eng-02", name: "Demo Engineer Ben", role: "Engineer", active: true, callQueue: true, ftsQueue: true, absent: false, attendanceStatus: "Present", attendanceWorkMode: "WFH" },
    { id: "demo-eng-03", name: "Demo Engineer Chen", role: "Engineer", active: true, callQueue: true, ftsQueue: true, absent: false, attendanceStatus: "Present", attendanceWorkMode: "Office" },
    { id: "demo-eng-04", name: "Demo Engineer Divya", role: "Engineer", active: true, callQueue: true, ftsQueue: true, absent: false, attendanceStatus: "Not checked in" },
    { id: "demo-eng-05", name: "Demo Engineer Eli", role: "Engineer", active: true, callQueue: true, ftsQueue: false, absent: true, attendanceStatus: "Absent" },
    { id: "demo-eng-06", name: "Demo Engineer Farah", role: "Engineer", active: true, callQueue: false, ftsQueue: true, absent: false, attendanceStatus: "Not checked in" },
    { id: "demo-sse-01", name: "Demo SSE Geetha", role: "SSE", active: true, callQueue: false, ftsQueue: false, absent: false, attendanceStatus: "Present", attendanceWorkMode: "Office" },
    { id: "demo-tl-01", name: "Demo Team Lead", role: "Team Lead", active: true, callQueue: false, ftsQueue: false, absent: false, attendanceStatus: "Present", attendanceWorkMode: "Office" },
  ];

  const assignments: AssignmentRecord[] = [
    {
      id: "demo-assignment-completed", requestId: "demo-request-completed", rotation: "FE_CRU_EVENT",
      kind: "FE", caseNumber: "DEMO-1001", scheduledStartAt: atIst(-1, 10, 0), scheduledEndAt: atIst(-1, 10, 30),
      engineerId: "demo-eng-01", status: "Completed", notes: "Synthetic sample: completed field escalation.",
      createdBy: "callflow-preview-manager", createdAt: now, updatedAt: now, completedAt: atIst(-1, 10, 24),
    },
    {
      id: "demo-assignment-fts", requestId: "demo-request-fts", rotation: "FTS",
      kind: "FTS", caseNumber: "DEMO-1002", scheduledStartAt: atIst(0, 9, 0), scheduledEndAt: atIst(0, 9, 30),
      engineerId: "demo-eng-02", status: "Completed", notes: "Synthetic sample: completed FTS monitoring call.",
      createdBy: "callflow-preview-manager", createdAt: now, updatedAt: now, completedAt: atIst(0, 9, 26),
    },
    {
      id: "demo-assignment-attention", requestId: "demo-request-attention", rotation: "FE_CRU_EVENT",
      kind: "CRU", caseNumber: "DEMO-1003", scheduledStartAt: new Date(now.getTime() - 20 * 60 * 1000), scheduledEndAt: new Date(now.getTime() + 10 * 60 * 1000),
      engineerId: "demo-eng-03", status: "Needs attention", notes: "Synthetic sample: use this record to test the urgent-call alert.",
      createdBy: "callflow-preview-manager", createdAt: now, updatedAt: now,
    },
    {
      id: "demo-assignment-scheduled", requestId: "demo-request-scheduled", rotation: "FTS",
      kind: "FTS", caseNumber: "DEMO-1004", scheduledStartAt: atIst(0, 23, 30), scheduledEndAt: atIst(1, 0, 0),
      engineerId: "demo-eng-06", status: "Scheduled", notes: "Synthetic sample: scheduled call for calendar and assignment testing.",
      createdBy: "callflow-preview-manager", createdAt: now, updatedAt: now,
    },
    {
      id: "demo-assignment-manual", requestId: "demo-request-manual", rotation: "FE_CRU_EVENT",
      kind: "Event", caseNumber: "DEMO-1005", scheduledStartAt: atIst(1, 11, 0), scheduledEndAt: atIst(1, 11, 30),
      engineerId: "demo-sse-01", manual: true, status: "Scheduled", notes: "Synthetic sample: manually assigned to SSE.",
      createdBy: "callflow-preview-manager", createdAt: now, updatedAt: now,
    },
  ];

  try {
    const existingMarker = await db.collection<{ _id: string; createdAt: Date }>("preview_seed_markers").findOne({ _id: markerId });
    if (existingMarker) {
      return NextResponse.json({ status: "already_seeded", message: "Demo data has already been loaded; no records were changed." }, { headers });
    }
    await session.withTransaction(async () => {
      await db.collection<{ _id: string; createdAt: Date }>("preview_seed_markers").insertOne({ _id: markerId, createdAt: now }, { session });
      const engineers = db.collection<EngineerRecord>("engineers");
      for (const engineer of roster) {
        await engineers.updateOne(
          { id: engineer.id },
          { $setOnInsert: { ...engineer, createdAt: now, updatedAt: now } },
          { upsert: true, session },
        );
      }
      const queueIds = {
        FE_CRU_EVENT: roster.filter(e => e.callQueue && e.role === "Engineer").map(e => e.id),
        FTS: roster.filter(e => e.ftsQueue && e.role === "Engineer").map(e => e.id),
      } satisfies Record<RotationKey, string[]>;
      const rotations = db.collection<RotationRecord>("rotation_state");
      for (const key of ["FE_CRU_EVENT", "FTS"] as const) {
        await rotations.updateOne(
          { _id: key },
          { $setOnInsert: { nextIndex: 0, completedAssignments: 0, updatedAt: now }, $addToSet: { engineerIds: { $each: queueIds[key] } } },
          { upsert: true, session },
        );
      }
      await db.collection<AssignmentRecord>("assignments").insertMany(assignments, { session });
      await db.collection("leave_requests").insertOne({
        id: "demo-leave-pending", engineerId: "demo-eng-04", engineerName: "Demo Engineer Divya",
        startDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(atIst(2, 12, 0)),
        endDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(atIst(2, 12, 0)),
        reason: "Synthetic preview data for leave approval testing.", status: "Pending", createdAt: now, updatedAt: now,
      }, { session });
      await db.collection("audit_events").insertOne({
        eventType: "PREVIEW_DEMO_DATA_SEEDED", entityId: markerId, actorId: "callflow-preview-manager",
        occurredAt: now, metadata: { engineerCount: roster.length, assignmentCount: assignments.length },
      }, { session });
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    return NextResponse.json({
      status: "seeded",
      counts: { engineers: roster.length, assignments: assignments.length, leaveRequests: 1 },
      message: "Synthetic demo data loaded. No existing records were deleted.",
    }, { headers });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      const marker = await db.collection<{ _id: string; createdAt: Date }>("preview_seed_markers").findOne({ _id: markerId }).catch(() => null);
      if (marker) return NextResponse.json({ status: "already_seeded", message: "Demo data has already been loaded; no records were changed." }, { headers });
    }
    console.error("CallFlow preview seed failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Could not load preview demo data. Check database health and transaction support." }, { status: 503, headers });
  } finally {
    await session.endSession();
  }
}
