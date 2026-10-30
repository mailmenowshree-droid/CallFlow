import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { chooseEngineerToSkip } from "@/lib/rotation-skip";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import type { EngineerRecord, RotationKey, RotationRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

class SkipActionError extends Error {
  constructor(public readonly code: "NO_ROTATION" | "NO_ELIGIBLE_ENGINEER" | "ROTATION_CHANGED") {
    super(code);
    this.name = "SkipActionError";
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
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !["FTS", "FE_CRU_EVENT"].includes(String((body as Record<string, unknown>).rotation))) {
      return NextResponse.json({ error: "A valid rotation is required." }, { status: 400, headers: noStore });
    }

    const rotationKey = (body as { rotation: RotationKey }).rotation;
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const session = client.startSession();
    let result: { engineerId: string; engineerName: string; skipUntilCompletion: number } | undefined;

    try {
      await session.withTransaction(async () => {
        const rotations = db.collection<RotationRecord>("rotation_state");
        const rotation = await rotations.findOne({ _id: rotationKey }, { session });
        if (!rotation || rotation.engineerIds.length === 0) throw new SkipActionError("NO_ROTATION");

        const engineersCollection = db.collection<EngineerRecord>("engineers");
        const engineers = await engineersCollection.find(
          { id: { $in: rotation.engineerIds } },
          { session },
        ).toArray();
        const now = new Date();
        const selected = chooseEngineerToSkip(rotation, engineers, rotationKey, now);
        if (!selected) throw new SkipActionError("NO_ELIGIBLE_ENGINEER");

        // Write the rotation document as a serialization point. Assignment creation
        // and completion already write this same document, so a concurrent operation
        // forces one transaction to retry against a fresh rotation snapshot.
        const lock = await rotations.updateOne(
          {
            _id: rotationKey,
            nextIndex: rotation.nextIndex,
            completedAssignments: rotation.completedAssignments,
          },
          { $inc: { skipMutationVersion: 1 }, $set: { updatedAt: now } },
          { session },
        );
        if (lock.modifiedCount !== 1) throw new SkipActionError("ROTATION_CHANGED");

        const threshold = rotation.completedAssignments + 3;
        const updated = await engineersCollection.updateOne(
          { id: selected.id, active: true },
          { $set: { [`skipUntilCompletionByRotation.${rotationKey}`]: threshold, updatedAt: now } },
          { session },
        );
        if (updated.modifiedCount !== 1) throw new SkipActionError("ROTATION_CHANGED");

        await db.collection("audit_events").insertOne({
          eventType: "ROTATION_ENGINEER_SKIPPED",
          entityId: selected.id,
          actorId: actor.id,
          occurredAt: now,
          metadata: { rotation: rotationKey, skipUntilCompletion: threshold, skippedCompletions: 3 },
        }, { session });

        result = { engineerId: selected.id, engineerName: selected.name, skipUntilCompletion: threshold };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }

    if (!result) throw new Error("Skip transaction completed without a result.");
    return NextResponse.json({
      ok: true,
      engineerId: result.engineerId,
      engineerName: result.engineerName,
      rotation: rotationKey,
      skipUntilCompletion: result.skipUntilCompletion,
    }, { headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
    }
    if (error instanceof SkipActionError) {
      if (error.code === "NO_ROTATION") {
        return NextResponse.json({ error: "No engineers are configured in this rotation." }, { status: 422, headers: noStore });
      }
      if (error.code === "NO_ELIGIBLE_ENGINEER") {
        return NextResponse.json({ error: "There is no eligible engineer to skip in this rotation." }, { status: 422, headers: noStore });
      }
      return NextResponse.json({ error: "Rotation changed while applying the skip. Refresh and retry." }, { status: 409, headers: noStore });
    }
    return NextResponse.json({ error: "Could not apply rotation skip." }, { status: 503, headers: noStore });
  }
}
