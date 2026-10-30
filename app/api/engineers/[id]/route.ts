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
        const users = db.collection<{ id: string; name: string; role: EngineerRole; active: boolean }>("users");
        const currentUser = await users.findOne({ id: current.id }, { session });
        if (
          actor.role === "Team Lead" &&
          (
            (current.role !== "Engineer" && current.role !== "SSE") ||
            (currentUser && currentUser.role !== "Engineer" && currentUser.role !== "SSE")
          )
        ) {
          throw new Error("FORBIDDEN");
        }
        const nextRole = (value.role as EngineerRole | undefined) ?? current.role;
        if (
          actor.role === "Team Lead" &&
          value.role !== undefined &&
          nextRole !== "Engineer" &&
          nextRole !== "SSE"
        ) {
          throw new Error("FORBIDDEN");
        }
        const nextActive = (value.active as boolean | undefined) ?? current.active;
        const removingActiveManager = currentUser?.role === "Manager" &&
          currentUser.active &&
          (nextRole !== "Manager" || !nextActive);
        if (removingActiveManager) {
          // Serialize Manager demotions/deactivations so concurrent reviews cannot
          // each observe the same final Manager and both remove it.
          await db.collection<{ _id: string; version?: number; createdAt?: Date }>("role_policy_locks").updateOne(
            { _id: "active-manager-accounts" },
            { $inc: { version: 1 }, $setOnInsert: { createdAt: now } },
            { upsert: true, session },
          );
          const activeManagers = await users.countDocuments({ role: "Manager", active: true }, { session });
          if (activeManagers <= 1) throw new Error("LAST_ACTIVE_MANAGER");
        }
        const callQueue = (value.callQueue as boolean | undefined) ?? current.callQueue;
        const ftsQueue = (value.ftsQueue as boolean | undefined) ?? current.ftsQueue;
        if ((nextRole === "Team Lead" || nextRole === "Manager" || nextRole === "SSE") && (callQueue || ftsQueue)) {
          throw new Error("INVALID_QUEUE_ROLE");
        }
        const patch: Partial<EngineerRecord> = {
          ...(typeof value.name === "string" ? { name: value.name.trim() } : {}),
          role: nextRole,
          active: nextActive,
          absent: (value.absent as boolean | undefined) ?? current.absent ?? false,
          attendanceStatus: value.absent === true ? "Absent" : value.absent === false && current.absent ? "Not checked in" : current.attendanceStatus ?? "Not checked in",
          callQueue: nextRole === "Engineer" && callQueue,
          ftsQueue: nextRole === "Engineer" && ftsQueue,
          updatedAt: now,
        };
        await collection.updateOne({ id: current.id }, { $set: patch }, { session });
        const userFields: { name?: string; role?: EngineerRole; active?: boolean; updatedAt: Date } = { updatedAt: now };
        if (typeof value.name === "string") userFields.name = value.name.trim();
        if (value.role !== undefined) userFields.role = nextRole;
        if (value.active !== undefined) userFields.active = nextActive;
        if (Object.keys(userFields).length > 1) {
          await users.updateOne({ id: current.id }, { $set: userFields }, { session });
        }
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
    if (error instanceof Error && error.message === "LAST_ACTIVE_MANAGER") return NextResponse.json({ error: "At least one other active Manager account must remain." }, { status: 409, headers: noStore });
    return NextResponse.json({ error: "The team service is temporarily unavailable." }, { status: 503, headers: noStore });
  }
}
