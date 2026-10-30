import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getDateKeysInRange } from "@/lib/date-key";
import { ensureCallFlowIndexes, getDatabase, getMongoClient } from "@/lib/mongodb";
import { validateLeaveTransition, type LeaveStatus } from "@/lib/leave-transition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

type LeaveRecord = {
  id: string;
  engineerId: string;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
};

class LeaveMutationError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "CLOSED" | "ALREADY_REVIEWED" | "INVALID_DATES" | "CONFLICT") {
    super(code);
    this.name = "LeaveMutationError";
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await requireSession();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || !["Approved", "Rejected", "Cancelled"].includes(String(body.status))) {
      return NextResponse.json({ error: "Choose Approved, Rejected or Cancelled." }, { status: 400, headers });
    }

    const nextStatus = body.status as LeaveStatus;
    await ensureCallFlowIndexes();
    const db = await getDatabase();
    const client = await getMongoClient();
    const session = client.startSession();
    let result: { id: string; status: LeaveStatus } | undefined;

    try {
      await session.withTransaction(async () => {
        const leaves = db.collection<LeaveRecord>("leave_requests");
        const leave = await leaves.findOne({ id: id }, { session });
        if (!leave) throw new LeaveMutationError("NOT_FOUND");

        const transitionError = validateLeaveTransition({
          currentStatus: leave.status,
          nextStatus,
          actorRole: actor.role,
          actorId: actor.id,
          engineerId: leave.engineerId,
        });
        if (transitionError) throw new LeaveMutationError(transitionError);

        // Capacity is counted across Pending + Approved requests. Lock the same
        // per-day documents used by request creation so cancellation/review cannot
        // race with a new request's capacity snapshot.
        const dates = getDateKeysInRange(leave.startDate, leave.endDate);
        if (!dates) throw new LeaveMutationError("INVALID_DATES");
        const now = new Date();
        for (const day of dates) {
          await db.collection<{ _id: string; reservationVersion?: number }>("leave_capacity").updateOne(
            { _id: day },
            { $inc: { reservationVersion: 1 }, $setOnInsert: { createdAt: now } },
            { upsert: true, session },
          );
        }

        const updated = await leaves.updateOne(
          { id: id, status: leave.status },
          { $set: { status: nextStatus, updatedAt: now, reviewedBy: actor.id, reviewedAt: now } },
          { session },
        );
        if (updated.modifiedCount !== 1) throw new LeaveMutationError("CONFLICT");

        await db.collection("audit_events").insertOne({
          eventType: "LEAVE_STATUS_CHANGED",
          entityId: id,
          actorId: actor.id,
          occurredAt: now,
          metadata: { from: leave.status, to: nextStatus },
        }, { session });

        result = { id: id, status: nextStatus };
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    } finally {
      await session.endSession();
    }

    if (!result) throw new Error("Leave transaction completed without a result.");
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Sign in required." }, { status: 401, headers });
    }
    if (error instanceof LeaveMutationError) {
      if (error.code === "NOT_FOUND") return NextResponse.json({ error: "Leave request not found." }, { status: 404, headers });
      if (error.code === "FORBIDDEN") return NextResponse.json({ error: "You do not have permission to update this leave request." }, { status: 403, headers });
      if (error.code === "INVALID_DATES") return NextResponse.json({ error: "The stored leave date range is invalid." }, { status: 422, headers });
      if (error.code === "CONFLICT") return NextResponse.json({ error: "Leave request changed. Refresh and retry." }, { status: 409, headers });
      if (error.code === "ALREADY_REVIEWED") return NextResponse.json({ error: "Only pending leave can be approved or rejected." }, { status: 409, headers });
      return NextResponse.json({ error: "Only pending or approved leave can be cancelled." }, { status: 409, headers });
    }
    return NextResponse.json({ error: "Could not update leave request." }, { status: 503, headers });
  }
}
