import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureCallFlowIndexes, getDatabase } from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    const actor = await requireSession();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !["Approved", "Rejected", "Cancelled"].includes(String(body.status))) return NextResponse.json({ error: "Choose Approved, Rejected or Cancelled." }, { status: 400, headers });
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const leave = await db.collection("leave_requests").findOne({ id: context.params.id });
    if (!leave) return NextResponse.json({ error: "Leave request not found." }, { status: 404, headers });
    if (body.status !== "Cancelled" && actor.role !== "Manager" && actor.role !== "Team Lead") return NextResponse.json({ error: "Only a Manager or Team Lead can review leave." }, { status: 403, headers });
    if (body.status === "Cancelled" && leave.status !== "Pending" && leave.status !== "Approved") return NextResponse.json({ error: "Only pending or approved leave can be cancelled." }, { status: 409, headers });
    if (body.status === "Cancelled" && actor.role !== "Manager" && leave.engineerId !== actor.id) return NextResponse.json({ error: "You cannot cancel another person's leave." }, { status: 403, headers });
    if (leave.status === "Rejected" || leave.status === "Cancelled") return NextResponse.json({ error: "This leave request is already closed." }, { status: 409, headers });
    const now = new Date();
    const result = await db.collection("leave_requests").updateOne({ id: context.params.id, status: leave.status }, { $set: { status: body.status, updatedAt: now, reviewedBy: actor.id, reviewedAt: now } });
    if (!result.modifiedCount) return NextResponse.json({ error: "Leave request changed. Refresh and retry." }, { status: 409, headers });
    await db.collection("audit_events").insertOne({ eventType: "LEAVE_STATUS_CHANGED", entityId: context.params.id, actorId: actor.id, occurredAt: now, metadata: { from: leave.status, to: body.status } });
    return NextResponse.json({ ok: true, id: context.params.id, status: body.status }, { headers });
  } catch (error) {
    const unauth = error instanceof Error && error.message === "UNAUTHENTICATED";
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    return NextResponse.json({ error: unauth ? "Sign in required." : forbidden ? "You do not have permission to update this leave request." : "Could not update leave request." }, { status: unauth ? 401 : forbidden ? 403 : 503, headers });
  }
}
