import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { EngineerRecord, EngineerRole, RotationKey, RotationRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const roles: EngineerRole[] = ["Engineer", "SSE", "Team Lead", "Manager"];

function failure(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
  }
  return NextResponse.json({ error: "The team service is temporarily unavailable." }, { status: 503, headers: noStore });
}

export async function GET() {
  try {
    const user = await requireSession();
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const filter = user.role === "Team Lead" || user.role === "Manager" ? {} : { id: user.id };
    const engineers = await db.collection<EngineerRecord>("engineers")
      .find(filter)
      .sort({ name: 1 })
      .limit(300)
      .toArray();
    return NextResponse.json({ engineers }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
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
    if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 120 ||
        typeof value.role !== "string" || !roles.includes(value.role as EngineerRole) ||
        typeof value.callQueue !== "boolean" || typeof value.ftsQueue !== "boolean") {
      return NextResponse.json({ error: "Name, role, and queue membership are required." }, { status: 400, headers: noStore });
    }
    const role = value.role as EngineerRole;
    if (actor.role === "Team Lead" && role !== "Engineer" && role !== "SSE") {
      return NextResponse.json({ error: "Only a Manager can create Team Lead or Manager profiles." }, { status: 403, headers: noStore });
    }
    if ((role === "Team Lead" || role === "Manager") && (value.callQueue || value.ftsQueue)) {
      return NextResponse.json({ error: "Team Leads and Managers cannot be rotation members." }, { status: 422, headers: noStore });
    }
    if (role === "SSE" && (value.callQueue || value.ftsQueue)) {
      return NextResponse.json({ error: "SSE is manual-assignment only and cannot join automatic rotations." }, { status: 422, headers: noStore });
    }
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const session = client.startSession();
    const now = new Date();
    const engineer: EngineerRecord = {
      id: randomUUID(),
      name: value.name.trim(),
      role,
      active: true,
      callQueue: role === "Engineer" && value.callQueue,
      ftsQueue: role === "Engineer" && value.ftsQueue,
      absent: false,
      attendanceStatus: "Not checked in",
      createdAt: now,
      updatedAt: now,
    };
    try {
      await session.withTransaction(async () => {
        await db.collection<EngineerRecord>("engineers").insertOne(engineer, { session });
        const membership: Array<[RotationKey, boolean]> = [
          ["FE_CRU_EVENT", engineer.callQueue],
          ["FTS", engineer.ftsQueue],
        ];
        for (const [key, enabled] of membership) {
          if (!enabled) continue;
          const rotations = db.collection<RotationRecord>("rotation_state");
          const state = await rotations.findOne({ _id: key }, { session });
          if (!state) {
            await rotations.insertOne({ _id: key, engineerIds: [engineer.id], nextIndex: 0, completedAssignments: 0, updatedAt: now }, { session });
          } else {
            await rotations.updateOne({ _id: key }, { $addToSet: { engineerIds: engineer.id }, $set: { updatedAt: now } }, { session });
          }
        }
        await db.collection("audit_events").insertOne({
          eventType: "ENGINEER_CREATED",
          entityId: engineer.id,
          actorId: actor.id,
          occurredAt: now,
          metadata: { role, callQueue: engineer.callQueue, ftsQueue: engineer.ftsQueue },
        }, { session });
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ engineer }, { status: 201, headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
