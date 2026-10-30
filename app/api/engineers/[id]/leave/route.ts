import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase } from "@/lib/mongodb";
import type { EngineerRecord } from "@/lib/callflow-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await requireSession(["Team Lead", "Manager"]);
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStore });
    }
    const value = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    if (value.action !== undefined && value.action !== "start" && value.action !== "clear") {
      return NextResponse.json({ error: "Action must be start or clear." }, { status: 400, headers: noStore });
    }
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const now = new Date();
    const clear = value.action === "clear";
    const update = clear
      ? await db.collection<EngineerRecord>("engineers").updateOne(
          { id: id },
          { $unset: { leaveUntil: "" }, $set: { updatedAt: now } },
        )
      : await db.collection<EngineerRecord>("engineers").updateOne(
          { id: id, active: true },
          { $set: { leaveUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000), updatedAt: now } },
        );
    if (update.matchedCount !== 1) {
      return NextResponse.json({ error: "Active team member not found." }, { status: 404, headers: noStore });
    }
    await db.collection("audit_events").insertOne({
      eventType: clear ? "LEAVE_EXCLUSION_CLEARED" : "LEAVE_EXCLUSION_STARTED",
      entityId: id,
      actorId: actor.id,
      occurredAt: now,
      metadata: clear ? {} : { durationHours: 24, expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    });
    return NextResponse.json({ ok: true, leaveUntil: clear ? null : new Date(now.getTime() + 24 * 60 * 60 * 1000) }, { headers: noStore });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: noStore });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "You do not have permission to perform this action." }, { status: 403, headers: noStore });
    return NextResponse.json({ error: "Could not update leave exclusion." }, { status: 503, headers: noStore });
  }
}
