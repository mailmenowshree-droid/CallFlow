import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { EngineerRecord, EngineerRole, RotationKey, RotationRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const roles: EngineerRole[] = ["Engineer", "SSE", "Team Lead", "Manager"];

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await requireSession(["Team Lead", "Manager"]);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStore });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400, headers: noStore });
    }
    const value = body as Record<string, unknown>;
    const allowed = ["name", "role", "active", "absent", "callQueue", "ftsQueue"];
    if (Object.keys(value).some((key) => !allowed.includes(key)) ||
        (value.name !== undefined && (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 120)) ||
        (value.role !== undefined && (typeof value.role !== "string" || !roles.includes(value.role as EngineerRole))) ||
        (["active", "absent", "callQueue", "ftsQueue"].some((key) => value[key] !== undefined && typeof value[key] !== "boolean"))) {
      return NextResponse.json({ error: "One or more team fields are invalid." }, { status: 400, headers: noStore });
    }

    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const session = client.startSession();
    const now = new Date();
    let result: EngineerRecord | undefined;
    try {
      await session.withTransaction(async () => {
        const collection = db.collection<EngineerRecord>("engineers");
        const current = await collection.findOne({ id: id }, { session });
        if (!current) throw new Error("NOT_FOUND");
        const nextRole = (value.role as EngineerRole | undefined) ?? current.role;
        const callQueue = (value.callQueue as boolean | undefined) ?? current.callQueue;
        const ftsQueue = (value.ftsQueue as boolean | undefined) ?? current.ftsQueue;
        if ((nextRole === "Team Lead" || nextRole === "Manager" || nextRole === "SSE") && (callQueue || ftsQueue)) {
          throw new Error("INVALID_QUEUE_ROLE");
        }
        const patch: Partial<EngineerRecord> = {
          ...(typeof value.name === "string" ? { name: value.name.trim() } : {}),
          role: nextRole,
          active: (value.active as boolean | undefined) ?? current.active,
          absent: (value.absent as boolean | undefined) ?? current.absent ?? false,
          attendanceStatus: value.absent === true ? "Absent" : value.absent === false && current.absent ? "Not checked in" : current.attendanceStatus ?? "Not checked in",
          callQueue: nextRole === "Engineer" && callQueue,
          ftsQueue: nextRole === "Engineer" && ftsQueue,
          updatedAt: now,
        };
        await collection.updateOne({ id: current.id }, { $set: patch }, { session });
        const memberships: Array<[RotationKey, boolean, boolean]> = [
          ["FE_CRU_EVENT", current.callQueue, patch.callQueue ?? current.callQueue],
          ["FTS", current.ftsQueue, patch.ftsQueue ?? current.ftsQueue],
        ];
        for (const [key, wasMember, isMember] of memberships) {
          const rotations = db.collection<RotationRecord>("rotation_state");
          if (isMember) {
            await rotations.updateOne(
              { _id: key },
              { $addToSet: { engineerIds: current.id }, $set: { updatedAt: now } },
              { upsert: true, session },
            );
          } else if (wasMember || nextRole !== current.role) {
            await rotations.updateOne(
              { _id: key },
              { $pull: { engineerIds: current.id }, $set: { updatedAt: now } },
              { session },
            );
          }
        }
        if (value.absent !== undefined && value.absent !== current.absent) {
          await db.collection("attendance_events").insertOne({
            id: crypto.randomUUID(),
            engineerId: current.id,
            eventType: value.absent ? "MARKED_ABSENT" : "MARKED_PRESENT",
            actorId: actor.id,
            occurredAt: now,
          }, { session });
        }
        await db.collection("audit_events").insertOne({
          eventType: "ENGINEER_UPDATED",
          entityId: current.id,
          actorId: actor.id,
          occurredAt: now,
          metadata: { changedFields: Object.keys(value) },
        }, { session });
        result = { ...current, ...patch };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ engineer: result }, { headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
    if (error instanceof Error && error.message === "NOT_FOUND") return NextResponse.json({ error: "Team member not found." }, { status: 404, headers: noStore });
    if (error instanceof Error && error.message === "INVALID_QUEUE_ROLE") return NextResponse.json({ error: "SSE, Team Leads and Managers cannot join automatic rotations." }, { status: 422, headers: noStore });
    return NextResponse.json({ error: "The team service is temporarily unavailable." }, { status: 503, headers: noStore });
  }
}
