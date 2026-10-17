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
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !["FTS", "FE_CRU_EVENT"].includes(String((body as Record<string, unknown>).rotation))) {
      return NextResponse.json({ error: "A valid rotation is required." }, { status: 400, headers: noStore });
    }
    const rotationKey = (body as { rotation: RotationKey }).rotation;
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const rotation = await db.collection<RotationRecord>("rotation_state").findOne({ _id: rotationKey });
    if (!rotation || rotation.engineerIds.length === 0) {
      return NextResponse.json({ error: "No engineers are configured in this rotation." }, { status: 422, headers: noStore });
    }
    const engineers = await db.collection<EngineerRecord>("engineers").find({ id: { $in: rotation.engineerIds } }).toArray();
    const byId = new Map(engineers.map(engineer => [engineer.id, engineer]));
    let selected: EngineerRecord | undefined;
    for (let offset = 0; offset < rotation.engineerIds.length; offset += 1) {
      const index = (rotation.nextIndex + offset) % rotation.engineerIds.length;
      const candidate = byId.get(rotation.engineerIds[index]);
      if (!candidate || !candidate.active || candidate.absent || candidate.role !== "Engineer") continue;
      if (candidate.leaveUntil && candidate.leaveUntil > new Date()) continue;
      if (rotationKey === "FTS" ? !candidate.ftsQueue : !candidate.callQueue) continue;
      const previousThreshold = candidate.skipUntilCompletionByRotation?.[rotationKey] ?? candidate.skipUntilCompletion;
      if (previousThreshold !== undefined && rotation.completedAssignments < previousThreshold) continue;
      selected = candidate;
      break;
    }
    if (!selected) {
      return NextResponse.json({ error: "There is no eligible engineer to skip in this rotation." }, { status: 422, headers: noStore });
    }
    const now = new Date();
    const threshold = rotation.completedAssignments + 3;
    const updated = await db.collection<EngineerRecord>("engineers").updateOne(
      { id: selected.id, active: true },
      { $set: { [`skipUntilCompletionByRotation.${rotationKey}`]: threshold, updatedAt: now } },
    );
    if (updated.modifiedCount !== 1) {
      return NextResponse.json({ error: "Rotation changed while applying the skip. Refresh and retry." }, { status: 409, headers: noStore });
    }
    await db.collection("audit_events").insertOne({
      eventType: "ROTATION_ENGINEER_SKIPPED",
      entityId: selected.id,
      actorId: actor.id,
      occurredAt: now,
      metadata: { rotation: rotationKey, skipUntilCompletion: threshold, skippedCompletions: 3 },
    });
    return NextResponse.json({ ok: true, engineerId: selected.id, engineerName: selected.name, rotation: rotationKey, skipUntilCompletion: threshold }, { headers: noStore });
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
