import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase } from "@/lib/mongodb";
import type { EngineerRecord, RotationKey, RotationRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

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
    if (!["FTS", "FE_CRU_EVENT"].includes(String(value.rotation)) ||
        typeof value.engineerId !== "string" || !value.engineerId.trim()) {
      return NextResponse.json({ error: "A valid rotation and engineer are required." }, { status: 400, headers: noStore });
    }
    const rotationKey = value.rotation as RotationKey;
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const rotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: rotationKey });
    if (!rotation || !rotation.engineerIds.includes(value.engineerId)) {
      return NextResponse.json({ error: "Engineer is not a member of this rotation." }, { status: 422, headers: noStore });
    }
    const engineer = await db.collection<EngineerRecord>("engineers").findOne({ id: value.engineerId });
    if (!engineer || !engineer.active || engineer.role !== "Engineer" ||
        (rotationKey === "FTS" ? !engineer.ftsQueue : !engineer.callQueue)) {
      return NextResponse.json({ error: "Only an active engineer in this queue can be skipped." }, { status: 422, headers: noStore });
    }
    const now = new Date();
    const threshold = rotation.completedAssignments + 3;
    const updated = await db.collection<EngineerRecord>("engineers").updateOne(
      { id: engineer.id, active: true },
      { $set: { [`skipUntilCompletionByRotation.${rotationKey}`]: threshold, updatedAt: now } },
    );
    if (updated.modifiedCount !== 1) {
      return NextResponse.json({ error: "Engineer changed while applying the skip. Refresh and retry." }, { status: 409, headers: noStore });
    }
    await db.collection("audit_events").insertOne({
      eventType: "ROTATION_ENGINEER_SKIPPED",
      entityId: engineer.id,
      actorId: actor.id,
      occurredAt: now,
      metadata: { rotation: rotationKey, skipUntilCompletion: threshold, skippedCompletions: 3 },
    });
    return NextResponse.json({ ok: true, engineerId: engineer.id, rotation: rotationKey, skipUntilCompletion: threshold }, { headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
    }
    return NextResponse.json({ error: "Could not apply rotation skip." }, { status: 503, headers: noStore });
  }
}
